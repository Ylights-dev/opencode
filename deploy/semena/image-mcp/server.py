#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import TextContent, Tool
from PIL import Image, ImageDraw
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
import uvicorn


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3003"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
INPUT_DIR = DATA_DIR / "input"
OUTPUT_DIR = DATA_DIR / "output"
MODEL_ID = os.environ.get("MODEL_ID", "Qwen/Qwen-Image-Edit-2511")
DEVICE = os.environ.get("DEVICE", "cuda")
TORCH_DTYPE = os.environ.get("TORCH_DTYPE", "bfloat16")
MAX_IMAGE_SIDE = int(os.environ.get("MAX_IMAGE_SIDE", "1536"))
DEFAULT_STEPS = int(os.environ.get("DEFAULT_STEPS", "20"))
DEFAULT_GUIDANCE_SCALE = float(os.environ.get("DEFAULT_GUIDANCE_SCALE", "4.0"))
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
DRY_RUN = os.environ.get("SEMENA_IMAGE_DRY_RUN", "").lower() in {"1", "true", "yes"}

for directory in (INPUT_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)

server = Server("semena-image")
sse = SseServerTransport("/messages/")
_pipeline: Any | None = None
_pipeline_lock = asyncio.Lock()
_started_at = time.time()


TOOLS = [
    Tool(
        name="image_health",
        description="Check Semena local image editing service status without loading the image model.",
        inputSchema={"type": "object", "properties": {}},
    ),
    Tool(
        name="image_models",
        description="List supported local image editing backends and why Qwen-Image-Edit-2511 is the default.",
        inputSchema={"type": "object", "properties": {}},
    ),
    Tool(
        name="image_edit",
        description=(
            "Edit a local image by text instruction using Qwen-Image-Edit-2511. "
            "Use for product photo cleanup, background replacement, style edits, text fixes, "
            "and visual variants. Returns saved output path and download URL."
        ),
        inputSchema={
            "type": "object",
            "required": ["prompt"],
            "properties": {
                "prompt": {"type": "string", "description": "Natural-language edit instruction."},
                "image_path": {"type": "string", "description": "Path to an existing image on the server or mounted data volume."},
                "image_base64": {"type": "string", "description": "Base64-encoded PNG/JPEG input image."},
                "output_name": {"type": "string", "description": "Optional output filename, .png is added if omitted."},
                "num_inference_steps": {"type": "integer", "default": DEFAULT_STEPS, "minimum": 1, "maximum": 60},
                "guidance_scale": {"type": "number", "default": DEFAULT_GUIDANCE_SCALE},
                "seed": {"type": "integer", "description": "Optional deterministic seed."},
                "max_side": {"type": "integer", "default": MAX_IMAGE_SIDE, "minimum": 256, "maximum": 2048},
            },
        },
    ),
]


def _json_text(payload: dict[str, Any]) -> list[TextContent]:
    return [TextContent(type="text", text=json.dumps(payload, ensure_ascii=False, indent=2))]


def _public_url(path: Path) -> str | None:
    if not PUBLIC_BASE_URL:
        return None
    return f"{PUBLIC_BASE_URL}/api/output/{path.name}"


def _safe_output_name(value: str | None) -> str:
    if not value:
        return f"qwen-edit-{uuid.uuid4().hex[:12]}.png"
    name = Path(value).name.replace("\\", "_").replace("/", "_").strip()
    if not name:
        return f"qwen-edit-{uuid.uuid4().hex[:12]}.png"
    if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        name += ".png"
    return name


def _fit_image(image: Image.Image, max_side: int) -> Image.Image:
    image = image.convert("RGB")
    width, height = image.size
    largest = max(width, height)
    if largest <= max_side:
        return image
    scale = max_side / float(largest)
    return image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.LANCZOS)


def _load_input_image(args: dict[str, Any]) -> Image.Image:
    if args.get("image_base64"):
        raw = base64.b64decode(str(args["image_base64"]), validate=True)
        return Image.open(io.BytesIO(raw))

    image_path = args.get("image_path")
    if not image_path:
        raise ValueError("image_path or image_base64 is required")
    path = Path(str(image_path)).expanduser()
    if not path.is_absolute():
        path = INPUT_DIR / path
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"image not found: {path}")
    return Image.open(path)


async def _get_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    async with _pipeline_lock:
        if _pipeline is not None:
            return _pipeline

        def load():
            import torch
            from diffusers import QwenImageEditPlusPipeline

            dtype = {
                "float16": torch.float16,
                "bfloat16": torch.bfloat16,
                "float32": torch.float32,
            }.get(TORCH_DTYPE, torch.bfloat16)
            pipe = QwenImageEditPlusPipeline.from_pretrained(MODEL_ID, torch_dtype=dtype)
            pipe.to(DEVICE)
            pipe.set_progress_bar_config(disable=None)
            return pipe

        _pipeline = await asyncio.to_thread(load)
        return _pipeline


def _dry_run_edit(image: Image.Image, prompt: str, output_path: Path) -> None:
    edited = image.copy()
    draw = ImageDraw.Draw(edited)
    label = f"DRY RUN: {prompt[:80]}"
    draw.rectangle((8, 8, min(edited.width - 8, 900), 48), fill=(255, 255, 255))
    draw.text((16, 18), label, fill=(0, 0, 0))
    edited.save(output_path)


async def _image_edit(args: dict[str, Any]) -> dict[str, Any]:
    prompt = str(args["prompt"]).strip()
    if not prompt:
        raise ValueError("prompt is required")
    max_side = int(args.get("max_side") or MAX_IMAGE_SIDE)
    image = _fit_image(_load_input_image(args), max_side)
    output_path = OUTPUT_DIR / _safe_output_name(args.get("output_name"))

    if DRY_RUN:
        await asyncio.to_thread(_dry_run_edit, image, prompt, output_path)
    else:
        pipe = await _get_pipeline()

        def run():
            import torch

            generator = None
            if args.get("seed") is not None:
                generator = torch.Generator(device=DEVICE).manual_seed(int(args["seed"]))
            result = pipe(
                image=image,
                prompt=prompt,
                num_inference_steps=int(args.get("num_inference_steps") or DEFAULT_STEPS),
                guidance_scale=float(args.get("guidance_scale") or DEFAULT_GUIDANCE_SCALE),
                generator=generator,
            )
            result.images[0].save(output_path)

        await asyncio.to_thread(run)

    digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
    return {
        "status": "ok",
        "model": MODEL_ID,
        "dry_run": DRY_RUN,
        "output_path": str(output_path),
        "download_url": _public_url(output_path),
        "sha256": digest,
        "size": output_path.stat().st_size,
    }


def _health_payload() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_ID,
        "device": DEVICE,
        "dtype": TORCH_DTYPE,
        "dry_run": DRY_RUN,
        "loaded": _pipeline is not None,
        "uptime_sec": int(time.time() - _started_at),
    }


def _models_payload() -> dict[str, Any]:
    return {
        "default": MODEL_ID,
        "default_reason": "Apache-2.0, local Diffusers support, strong product/text editing and consistency.",
        "alternatives": [
            {
                "id": "black-forest-labs/FLUX.1-Kontext-dev",
                "notes": "Strong instruction editing and consistency; license/commercial terms must be checked before production use.",
            },
            {
                "id": "FireRedTeam/FireRed-Image-Edit",
                "notes": "Open image editor focused on high-fidelity edits, portraits and multi-element fusion.",
            },
            {
                "id": "LongCat-Image-Edit",
                "notes": "Instruction editing with good consistency; useful candidate for later benchmark.",
            },
            {
                "id": "lightx2v/Qwen-Image-Edit-2511-Lightning",
                "notes": "Distilled/optimized Qwen variant for faster inference after base pipeline is validated.",
            },
        ],
    }


@server.list_tools()
async def list_tools() -> list[Tool]:
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    try:
        if name == "image_health":
            return _json_text(_health_payload())
        if name == "image_models":
            return _json_text(_models_payload())
        if name == "image_edit":
            return _json_text(await _image_edit(arguments or {}))
        return _json_text({"status": "error", "error": f"unknown tool: {name}"})
    except Exception as exc:
        return _json_text({"status": "error", "error": str(exc)})


async def handle_sse(request):
    async with sse.connect_sse(request.scope, request.receive, request._send) as streams:
        await server.run(streams[0], streams[1], server.create_initialization_options())


async def handle_messages(request):
    await sse.handle_post_message(request.scope, request.receive, request._send)


async def api_health(request):
    return JSONResponse(_health_payload())


async def api_tools(request):
    return JSONResponse({"tools": [{"name": t.name, "description": t.description, "inputSchema": t.inputSchema} for t in TOOLS]})


async def api_tool(request):
    name = request.path_params["name"]
    payload = await request.json()
    result = await call_tool(name, payload)
    text = "\n".join(item.text for item in result)
    return JSONResponse(json.loads(text))


async def api_output(request):
    name = Path(request.path_params["name"]).name
    path = OUTPUT_DIR / name
    if not path.is_file():
        return JSONResponse({"error": "file not found"}, status_code=404)
    return FileResponse(path)


routes = [
    Route("/health", endpoint=api_health),
    Route("/api/tools", endpoint=api_tools),
    Route("/api/tool/{name}", endpoint=api_tool, methods=["POST"]),
    Route("/api/output/{name}", endpoint=api_output),
    Route("/sse", endpoint=handle_sse),
    Route("/messages/", endpoint=handle_messages, methods=["POST"]),
    Mount("/output", app=StaticFiles(directory=str(OUTPUT_DIR), html=False), name="output"),
]

app = Starlette(routes=routes)


if __name__ == "__main__":
    print(f"Semena Image MCP: http://{HOST}:{PORT}/sse model={MODEL_ID} dry_run={DRY_RUN}")
    uvicorn.run(app, host=HOST, port=PORT)
