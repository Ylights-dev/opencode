# Semena Image MCP

Local image editing MCP server for Semena Agent.

Default model: `Qwen/Qwen-Image-Edit-2511`.

## Tools

- `image_health` checks service status without loading the model.
- `image_models` describes the configured backend and useful alternatives.
- `image_edit` edits an input image by text instruction and saves the result under `/data/output`.

## Run

```bash
cd /opt/semena-opencode/deploy/semena/image-mcp
docker compose -f compose.gpu.yaml up -d --build
```

For plumbing tests without downloading model weights:

```bash
SEMENA_IMAGE_DRY_RUN=1 docker compose -f compose.gpu.yaml up -d --build
```

On a host without NVIDIA runtime, use the smoke compose. It validates HTTP, SSE,
REST, and agent tool registration only; responses include `dry_run: true` and
must not be treated as real model edits.

```bash
docker compose -f compose.smoke.yaml up -d --build
```

The MCP endpoint is:

```text
http://10.1.50.40:3003/sse
```

The model is loaded lazily on the first real `image_edit` call. Keep the Qwen36 text model on a separate GPU budget; image generation is memory-heavy.
