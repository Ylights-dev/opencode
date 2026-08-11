#!/usr/bin/env python3
"""
Small Semena Agent model eval for local Ollama models.

It checks the exact failure class we saw in the desktop app:
- keep the user's Russian Excel task in mind;
- use tools instead of asking irrelevant questions;
- recover from normal filesystem/tool friction;
- create and verify an output workbook.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import textwrap
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any


OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
SHEET_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def post_json(path: str, payload: dict[str, Any], timeout: int = 300) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def make_fixture(workdir: Path) -> Path:
    rows = [
        ("Уровень 1", "Уровень 2", "Уровень 3", "Уровень 4"),
        ("Огурцы", "Партенокарпические", "Ранние", "Герман F1"),
        ("Огурцы", "Пчелоопыляемые", "Средние", "Нежинский"),
        ("Томаты", "Детерминантные", "Ранние", "Санька"),
        ("Перцы", "Сладкие", "Средние", "Калифорнийское чудо"),
        ("Капуста", "Белокочанная", "Поздние", "Амагер"),
        ("Морковь", "Нантская", "Средние", "Нантская 4"),
        ("Огурцы", "Партенокарпические", "Поздние", "Кураж F1"),
        ("Свекла", "Столовая", "Средние", "Бордо"),
    ]
    path = workdir / "Каталог сайта 2024.xlsx"
    write_xlsx(path, "Каталог сайта", rows)
    return path


def col_name(index: int) -> str:
    name = ""
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(65 + rem) + name
    return name


def write_xlsx(path: Path, sheet_name: str, rows: list[tuple[Any, ...]]) -> None:
    sheet_rows = []
    for row_idx, row in enumerate(rows, start=1):
        cells = []
        for col_idx, value in enumerate(row, start=1):
            ref = f"{col_name(col_idx)}{row_idx}"
            escaped = (
                str(value)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;")
            )
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escaped}</t></is></c>')
        sheet_rows.append(f'<row r="{row_idx}">{"".join(cells)}</row>')
    worksheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData>'
        "</worksheet>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/worksheets/sheet1.xml", worksheet)


def read_xlsx_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as zf:
        xml = zf.read("xl/worksheets/sheet1.xml")
    root = ET.fromstring(xml)
    rows: list[list[str]] = []
    for row in root.findall(".//a:sheetData/a:row", SHEET_NS):
        values = []
        for cell in row.findall("a:c", SHEET_NS):
            inline = cell.find("a:is/a:t", SHEET_NS)
            value = inline.text if inline is not None else ""
            values.append(value or "")
        rows.append(values)
    return rows


class ToolRuntime:
    def __init__(self, workdir: Path) -> None:
        self.workdir = workdir

    def list_files(self, pattern: str = "*") -> dict[str, Any]:
        files = sorted(p.name for p in self.workdir.glob(pattern) if p.is_file())
        return {"files": files}

    def run_python(self, code: str) -> dict[str, Any]:
        script = self.workdir / "_agent_attempt.py"
        script.write_text(code, encoding="utf-8")
        try:
            proc = subprocess.run(
                ["python3", str(script)],
                cwd=self.workdir,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
            )
        except FileNotFoundError:
            proc = subprocess.run(
                ["python", str(script)],
                cwd=self.workdir,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
            )
        return {
            "returncode": proc.returncode,
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-4000:],
        }

    def inspect_excel(self, path: str) -> dict[str, Any]:
        full = self.workdir / path
        if not full.exists():
            return {"error": f"file not found: {path}"}
        rows = read_xlsx_rows(full)
        return {
            "sheet": "Каталог сайта",
            "rows": rows[:6],
            "max_row": len(rows),
            "max_column": max((len(row) for row in rows), default=0),
        }

    def verify_excel(self, path: str) -> dict[str, Any]:
        full = self.workdir / path
        if not full.exists():
            return {"ok": False, "error": f"file not found: {path}"}
        try:
            rows = read_xlsx_rows(full)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        values = [row[0] for row in rows[1:] if row and row[0]]
        return {"ok": values == ["Капуста", "Морковь", "Огурцы", "Перцы", "Свекла", "Томаты"], "values": values}


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files in the current working directory by glob pattern.",
            "parameters": {
                "type": "object",
                "properties": {"pattern": {"type": "string"}},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_excel",
            "description": "Inspect an xlsx workbook and return sheet name, dimensions, headers and sample rows.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": "Run Python code in the working directory. openpyxl is installed.",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string"}},
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_excel",
            "description": "Verify the created workbook values.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
]


def run_eval(model: str, keep: bool = False) -> dict[str, Any]:
    started = time.time()
    with tempfile.TemporaryDirectory(prefix="semena-model-eval-", delete=not keep) as tmp:
        workdir = Path(tmp)
        make_fixture(workdir)
        runtime = ToolRuntime(workdir)
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": textwrap.dedent(
                    """
                    Ты Семена - Агент. Выполняй пользовательскую задачу до конца.
                    Рабочий каталог уже открыт. Не задавай уточняющих вопросов, если можно проверить файлы инструментами.
                    Для Excel используй Python. Если библиотеки для xlsx недоступны, можно писать xlsx как zip/xml.
                    После создания файла обязательно проверь результат.
                    Итоговый ответ дай по-русски, кратко: что сделал и имя файла.
                    """
                ).strip(),
            },
            {
                "role": "user",
                "content": "там лежит файл Каталог сайта 2024, вытащи из него первый уровень и положи рядом в другой excel файл списком",
            },
        ]
        transcript: list[dict[str, Any]] = []
        asked_question = False
        tool_count = 0

        for _ in range(10):
            response = post_json(
                "/api/chat",
                {
                    "model": model,
                    "messages": messages,
                    "tools": TOOLS,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_ctx": 16384},
                },
            )
            message = response.get("message", {})
            messages.append(message)
            transcript.append({"assistant": message})
            content = (message.get("content") or "").lower()
            if "?" in content or "уточ" in content or "какой файл" in content:
                asked_question = True
            calls = message.get("tool_calls") or []
            if not calls:
                break
            for call in calls:
                function = call.get("function", {})
                name = function.get("name")
                args = function.get("arguments") or {}
                if isinstance(args, str):
                    args = json.loads(args or "{}")
                tool_count += 1
                if not hasattr(runtime, name):
                    result = {"error": f"unknown tool: {name}"}
                else:
                    result = getattr(runtime, name)(**args)
                transcript.append({"tool": name, "args": args, "result": result})
                messages.append({"role": "tool", "name": name, "content": json.dumps(result, ensure_ascii=False)})

        expected = workdir / "Первый уровень каталога.xlsx"
        if not expected.exists():
            candidates = sorted(p for p in workdir.glob("*.xlsx") if p.name != "Каталог сайта 2024.xlsx")
            expected = candidates[0] if candidates else expected
        verification = runtime.verify_excel(expected.name) if expected.exists() else {"ok": False, "error": "no output workbook"}
        score = 0
        if tool_count >= 2:
            score += 1
        if not asked_question:
            score += 1
        if verification.get("ok"):
            score += 3
        final = messages[-1].get("content", "") if messages else ""
        if "перв" in final.lower() or expected.name in final:
            score += 1

        return {
            "model": model,
            "score": score,
            "passed": score >= 5 and verification.get("ok") is True,
            "tool_count": tool_count,
            "asked_question": asked_question,
            "verification": verification,
            "workdir": str(workdir) if keep else None,
            "elapsed_sec": round(time.time() - started, 2),
            "final": final,
            "transcript": transcript,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--json-out")
    args = parser.parse_args()

    results = [run_eval(model, keep=args.keep) for model in args.models]
    payload = {"results": results}
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)
    if args.json_out:
        Path(args.json_out).write_text(text, encoding="utf-8")
    return 0 if all(item["passed"] for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
