import { Effect, Option, Schema, Scope, Stream } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import * as path from "path"
import * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./read.txt"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { Instruction } from "../session/instruction"
import { isPdfAttachment, sniffAttachmentMime } from "@/util/media"
import { execFile } from "node:child_process"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const DEFAULT_SPREADSHEET_LIMIT = 25
const MAX_SPREADSHEET_LIMIT = 100
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const STRUCTURED_DOCUMENT_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
])
const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx", ".xlsm"])

class ReadStop extends Schema.TaggedErrorClass<ReadStop>()("ReadStop", {}) {}

// `offset` and `limit` were originally `z.coerce.number()` — the runtime
// coercion was useful when the tool was called from a shell but serves no
// purpose in the LLM tool-call path (the model emits typed JSON). The JSON
// Schema output is identical (`type: "number"`), so the LLM view is
// unchanged; purely CLI-facing uses must now send numbers rather than strings.
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file or directory to read" }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "The line number to start reading from (1-indexed)",
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: "The maximum number of lines to read (defaults to 2000)",
  }),
})

type Display =
  | {
      type: "directory"
      path: string
      entries: string[]
      offset: number
      totalEntries: number
      truncated: boolean
    }
  | {
      type: "file"
      path: string
      text: string
      lineStart: number
      lineEnd: number
      totalLines: number
      truncated: boolean
    }

type Metadata = {
  preview: string
  truncated: boolean
  loaded: string[]
  display?: Display
}

export const ReadTool = Tool.define<
  typeof Parameters,
  Metadata,
  FSUtil.Service | Instruction.Service | LSP.Service | Scope.Scope
>(
  "read",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const instruction = yield* Instruction.Service
    const lsp = yield* LSP.Service
    const scope = yield* Scope.Scope

    const miss = Effect.fn("ReadTool.miss")(function* (filepath: string) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)
      const items = yield* fs.readDirectory(dir).pipe(
        Effect.map((items) =>
          items
            .filter(
              (item) =>
                item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
            )
            .map((item) => path.join(dir, item))
            .slice(0, 3),
        ),
        Effect.catch(() => Effect.succeed([] as string[])),
      )

      if (items.length > 0) {
        return yield* Effect.fail(
          new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.join("\n")}`),
        )
      }

      return yield* Effect.fail(new Error(`File not found: ${filepath}`))
    })

    const list = Effect.fn("ReadTool.list")(function* (filepath: string) {
      const items = yield* fs.readDirectoryEntries(filepath)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (item.type === "directory") return item.name + "/"
          if (item.type !== "symlink") return item.name

          const target = yield* fs.stat(path.join(filepath, item.name)).pipe(Effect.catch(() => Effect.void))
          if (target?.type === "Directory") return item.name + "/"
          return item.name
        }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items: string[]) => items.sort((a, b) => a.localeCompare(b))))
    })

    const warm = Effect.fn("ReadTool.warm")(function* (filepath: string) {
      // LSP warm-up is optional; do not let a background defect fail an otherwise successful read.
      yield* lsp.touchFile(filepath).pipe(Effect.ignoreCause, Effect.forkIn(scope))
    })

    const readSample = Effect.fn("ReadTool.readSample")(function* (
      filepath: string,
      fileSize: number,
      sampleSize: number,
    ) {
      if (fileSize === 0) return new Uint8Array()

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(filepath, { flag: "r" })
          return Option.getOrElse(yield* file.readAlloc(Math.min(sampleSize, fileSize)), () => new Uint8Array())
        }),
      )
    })

    const lines = Effect.fn("ReadTool.lines")(function* (filepath: string, opts: { limit: number; offset: number }) {
      const start = opts.offset - 1
      const raw: string[] = []
      const flags = { bytes: 0, count: 0, cut: false, more: false, done: false }

      // Note: prefer manual TextDecoder over Stream.decodeText — when the source stream
      // ends without flushing, decodeText drops the final unterminated line. We also
      // avoid Stream.runForEachWhile (it currently swallows the final unterminated
      // line of the upstream splitLines pipeline) and use a tagged error to stop the
      // upstream file stream as soon as the byte cap is reached.
      const decoder = new TextDecoder("utf-8")
      yield* fs.stream(filepath).pipe(
        Stream.map((bytes) => decoder.decode(bytes, { stream: true })),
        Stream.splitLines,
        Stream.runForEach((text) =>
          Effect.gen(function* () {
            if (flags.done) return yield* new ReadStop()
            flags.count += 1
            if (flags.count <= start) return

            if (raw.length >= opts.limit) {
              flags.more = true
              return
            }

            const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
            const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
            if (flags.bytes + size <= MAX_BYTES) {
              raw.push(line)
              flags.bytes += size
              return
            }

            flags.cut = true
            flags.more = true
            flags.done = true
            return yield* new ReadStop()
          }),
        ),
        Effect.catchTag("ReadStop", () => Effect.void),
      )

      return { raw, count: flags.count, cut: flags.cut, more: flags.more, offset: opts.offset }
    })

    const isStructuredDocument = (filepath: string) =>
      STRUCTURED_DOCUMENT_EXTENSIONS.has(path.extname(filepath).toLowerCase())
    const isSpreadsheet = (filepath: string) => SPREADSHEET_EXTENSIONS.has(path.extname(filepath).toLowerCase())

    const inspectSpreadsheet = Effect.fn("ReadTool.inspectSpreadsheet")(function* (
      filepath: string,
      opts: { offset: number; limit: number },
    ) {
      const script = String.raw`
import json
import math
import os
import sys

filepath = sys.argv[1]
ext = os.path.splitext(filepath)[1].lower()
offset = max(1, int(sys.argv[2]))
limit_rows = max(1, min(${MAX_SPREADSHEET_LIMIT}, int(sys.argv[3])))
limit_cols = 20
start_row = offset - 1
landmark_scan_rows = 500
landmark_limit = 8

def clean(value):
    if value is None:
        return ""
    if isinstance(value, float):
        if math.isnan(value):
            return ""
        if value.is_integer():
            return int(value)
    return str(value)

def column_profiles(rows, width):
    profiles = []
    for col_idx in range(min(width, limit_cols)):
        count = 0
        samples = []
        seen = set()
        for values in rows:
            value = values[col_idx] if col_idx < len(values) else ""
            if value == "":
                continue
            count += 1
            key = json.dumps(value, ensure_ascii=False, sort_keys=True)
            if key in seen or len(samples) >= 6:
                continue
            seen.add(key)
            samples.append(value)
        if count:
            profiles.append({"index": col_idx, "non_empty": count, "samples": samples})
    return profiles

def infer_subcolumns(rows, profiles):
    counts = {item["index"]: item["non_empty"] for item in profiles}
    inferred = []
    for row_idx, values in enumerate(rows):
        occupied = [idx for idx, value in enumerate(values) if value != ""]
        for position, col_idx in enumerate(occupied):
            label = values[col_idx]
            if not isinstance(label, str):
                continue
            separator = "," if "," in label else ";" if ";" in label else None
            if not separator:
                continue
            fields = [part.strip() for part in label.split(separator) if part.strip()]
            if len(fields) < 2 or len(fields) > 6:
                continue
            end = occupied[position + 1] if position + 1 < len(occupied) else len(values)
            active = [idx for idx in range(col_idx, end) if counts.get(idx, 0) >= 3]
            if len(active) != len(fields):
                continue
            data_start = None
            for candidate in range(row_idx + 1, max(row_idx + 1, len(rows) - 2)):
                window = rows[candidate:candidate + 3]
                if len(window) == 3 and all(all(idx < len(item) and item[idx] != "" for idx in active) for item in window):
                    data_start = candidate + 1
                    break
            inferred.append({
                "row": row_idx + 1,
                "header": label,
                "data_start": data_start,
                "fields": [{"index": idx, "label": field} for idx, field in zip(active, fields)],
            })
    return inferred[:8]

sheets = []
if ext == ".xls":
    import xlrd
    book = xlrd.open_workbook(filepath)
    for sheet in book.sheets()[:5]:
        preview = []
        for row_idx in range(start_row, min(sheet.nrows, start_row + limit_rows)):
            preview.append([clean(sheet.cell_value(row_idx, col_idx)) for col_idx in range(min(sheet.ncols, limit_cols))])
        candidates = []
        scanned = []
        for row_idx in range(min(sheet.nrows, landmark_scan_rows)):
            values = [clean(sheet.cell_value(row_idx, col_idx)) for col_idx in range(min(sheet.ncols, limit_cols))]
            scanned.append(values)
            score = sum(1 for value in values if value != "")
            if score >= 2:
                candidates.append((score, row_idx, values))
        landmarks = [
            {"row": row_idx + 1, "values": values}
            for score, row_idx, values in sorted(candidates, key=lambda item: (-item[0], item[1]))[:landmark_limit]
        ]
        profiles = column_profiles(scanned, sheet.ncols)
        sheets.append({"name": sheet.name, "rows": sheet.nrows, "columns": sheet.ncols, "row_start": start_row + 1, "preview": preview, "landmarks": landmarks, "profiles": profiles, "inferred": infer_subcolumns(scanned, profiles)})
else:
    import openpyxl
    book = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    for sheet in book.worksheets[:5]:
        preview = []
        max_row = sheet.max_row or 0
        max_col = sheet.max_column or 0
        if start_row < max_row:
            for row in sheet.iter_rows(min_row=start_row + 1, max_row=min(max_row, start_row + limit_rows), max_col=min(max_col, limit_cols), values_only=True):
                preview.append([clean(value) for value in row])
        candidates = []
        scanned = []
        for row_idx, row in enumerate(sheet.iter_rows(min_row=1, max_row=min(max_row, landmark_scan_rows), max_col=min(max_col, limit_cols), values_only=True)):
            values = [clean(value) for value in row]
            scanned.append(values)
            score = sum(1 for value in values if value != "")
            if score >= 2:
                candidates.append((score, row_idx, values))
        landmarks = [
            {"row": row_idx + 1, "values": values}
            for score, row_idx, values in sorted(candidates, key=lambda item: (-item[0], item[1]))[:landmark_limit]
        ]
        profiles = column_profiles(scanned, max_col)
        sheets.append({"name": sheet.title, "rows": max_row, "columns": max_col, "row_start": start_row + 1, "preview": preview, "landmarks": landmarks, "profiles": profiles, "inferred": infer_subcolumns(scanned, profiles)})

print(json.dumps({"sheets": sheets}, ensure_ascii=False))
`
      const commands = process.platform === "win32" ? [["py", "-3"], ["python"]] : [["python3"], ["python"]]

      const failures: string[] = []
      for (const command of commands) {
        const result = yield* Effect.promise(
          () =>
            new Promise<{ stdout: string; stderr: string; code: number; command: string }>((resolve) => {
              execFile(
                command[0],
                [...command.slice(1), "-c", script, filepath, String(opts.offset), String(opts.limit)],
                {
                  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
                  encoding: "utf8",
                  maxBuffer: 10 * 1024 * 1024,
                  windowsHide: true,
                },
                (error, stdout, stderr) =>
                  resolve({
                    stdout,
                    stderr: stderr || error?.message || "",
                    code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
                    command: command.join(" "),
                  }),
              )
            }),
        )

        if (result.code === 0 && result.stdout.trim()) {
          return { ok: true as const, text: result.stdout.trim() }
        }
        const detail = result.stderr.trim().split(/\r?\n/).at(-1) || `exit code ${result.code}`
        failures.push(`${result.command}: ${detail}`)
      }

      return {
        ok: false as const,
        text: `Python spreadsheet parser is unavailable or could not open this file. Attempts: ${failures.join("; ")}`,
      }
    })

    const spreadsheetOutput = (
      filepath: string,
      inspection: { ok: true; text: string } | { ok: false; text: string },
    ) => {
      const ext = path.extname(filepath).toLowerCase()
      const content: string[] = [`<path>${filepath}</path>`, `<type>spreadsheet</type>`, `<content>`]

      if (inspection.ok) {
        try {
          const parsed = JSON.parse(inspection.text) as {
            sheets?: Array<{
              name?: string
              rows?: number
              columns?: number
              row_start?: number
              preview?: unknown[][]
              landmarks?: Array<{ row?: number; values?: unknown[] }>
              profiles?: Array<{ index?: number; non_empty?: number; samples?: unknown[] }>
              inferred?: Array<{
                row?: number
                header?: string
                data_start?: number
                fields?: Array<{ index?: number; label?: string }>
              }>
            }>
          }
          const sheets = parsed.sheets ?? []
          if (sheets.length === 0) content.push("No sheets were found.")
          for (const sheet of sheets) {
            content.push(`Sheet: ${sheet.name ?? "(unnamed)"}`)
            content.push(`Rows: ${sheet.rows ?? 0}`)
            content.push(`Columns: ${sheet.columns ?? 0}`)
            if ((sheet.profiles?.length ?? 0) > 0) {
              content.push("Column profiles (zero-based indexes; scanned first 500 workbook rows):")
              for (const profile of sheet.profiles ?? []) {
                content.push(
                  `${profile.index ?? "?"}: non-empty=${profile.non_empty ?? 0}, samples=${JSON.stringify(profile.samples ?? [])}`,
                )
              }
              content.push(
                "Identify physical data columns from these indexed samples. A merged header may label several columns and is not proof that its leftmost column contains every described value.",
              )
            }
            if ((sheet.inferred?.length ?? 0) > 0) {
              content.push("Inferred physical columns from spanning compound headers:")
              for (const inferred of sheet.inferred ?? []) {
                const fields = (inferred.fields ?? [])
                  .map((field) => `index ${field.index ?? "?"} = ${JSON.stringify(field.label ?? "")}`)
                  .join("; ")
                const data = inferred.data_start
                  ? `; stable data rows start at workbook row ${inferred.data_start}`
                  : ""
                content.push(
                  `Workbook row ${inferred.row ?? "?"}, ${JSON.stringify(inferred.header ?? "")}: ${fields}${data}`,
                )
                if (inferred.data_start) {
                  for (const field of inferred.fields ?? []) {
                    content.push(
                      `Pandas selection for ${JSON.stringify(field.label ?? "")}: read with header=None, then use df.iloc[${inferred.data_start - 1}:, ${field.index ?? 0}]. Do not include earlier rows.`,
                    )
                  }
                }
              }
            }
            if ((sheet.landmarks?.length ?? 0) > 0) {
              content.push(
                "Structure landmarks (original workbook row numbers; array positions use the zero-based column indexes above):",
              )
              for (const landmark of sheet.landmarks ?? []) {
                content.push(`${landmark.row ?? "?"}: ${JSON.stringify(landmark.values ?? [])}`)
              }
              content.push("Use the displayed workbook row number as offset to inspect that region.")
            }
            content.push("Preview:")
            const rowStart = sheet.row_start ?? 1
            for (const [index, row] of (sheet.preview ?? []).entries()) {
              content.push(`${rowStart + index}: ${JSON.stringify(row)}`)
            }
            const rowEnd = rowStart + (sheet.preview?.length ?? 0) - 1
            if (rowEnd < (sheet.rows ?? 0)) {
              content.push(`More rows are available. Call read again with offset=${rowEnd + 1}.`)
            }
            content.push("")
          }
        } catch {
          content.push(inspection.text)
        }
      } else {
        content.push(`Spreadsheet preview unavailable for this ${ext} file.`)
        content.push(inspection.text)
      }

      content.push(
        "This is only a preview. To transform or write spreadsheet data, use shell with Python and quote paths with -LiteralPath or normal string arguments.",
      )
      content.push(`</content>`)
      return content.join("\n")
    }

    const isBinaryFile = (filepath: string, bytes: Uint8Array) => {
      const ext = path.extname(filepath).toLowerCase()
      switch (ext) {
        case ".zip":
        case ".tar":
        case ".gz":
        case ".exe":
        case ".dll":
        case ".so":
        case ".class":
        case ".jar":
        case ".war":
        case ".7z":
        case ".doc":
        case ".docx":
        case ".xls":
        case ".xlsx":
        case ".ppt":
        case ".pptx":
        case ".odt":
        case ".ods":
        case ".odp":
        case ".bin":
        case ".dat":
        case ".obj":
        case ".o":
        case ".a":
        case ".lib":
        case ".wasm":
        case ".pyc":
        case ".pyo":
          return true
      }

      if (bytes.length === 0) return false

      let nonPrintableCount = 0
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) return true
        if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
          nonPrintableCount++
        }
      }

      return nonPrintableCount / bytes.length > 0.3
    }

    const run = Effect.fn("ReadTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const instance = yield* InstanceState.context
      let filepath = params.filePath
      if (!path.isAbsolute(filepath)) {
        filepath = path.resolve(instance.directory, filepath)
      }
      if (process.platform === "win32") {
        filepath = FSUtil.normalizePath(filepath)
      }
      const title = path.relative(instance.worktree, filepath)

      const stat = yield* fs.stat(filepath).pipe(
        Effect.catchIf(
          (err) => "reason" in err && err.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
      )

      yield* assertExternalDirectoryEffect(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
        kind: stat?.type === "Directory" ? "directory" : "file",
      })

      yield* ctx.ask({
        permission: "read",
        patterns: [path.relative(instance.worktree, filepath)],
        always: ["*"],
        metadata: {},
      })

      if (!stat) return yield* miss(filepath)

      if (stat.type === "Directory") {
        const items = yield* list(filepath)
        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset || 1
        const start = offset - 1
        const sliced = items.slice(start, start + limit)
        const truncated = start + sliced.length < items.length

        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            loaded: [] as string[],
            display: {
              type: "directory" as const,
              path: filepath,
              entries: sliced,
              offset,
              totalEntries: items.length,
              truncated,
            },
          },
        }
      }

      const loaded = yield* instruction.resolve(ctx.messages, filepath, ctx.messageID)
      const sample = yield* readSample(filepath, Number(stat.size), SAMPLE_BYTES)

      const mime = sniffAttachmentMime(sample, FSUtil.mimeType(filepath))
      const isImage = SUPPORTED_IMAGE_MIMES.has(mime)

      if (isImage || isPdfAttachment(mime)) {
        const bytes = yield* fs.readFile(filepath)
        const msg = isPdfAttachment(mime) ? "PDF read successfully" : "Image read successfully"
        return {
          title,
          output: msg,
          metadata: {
            preview: msg,
            truncated: false,
            loaded: loaded.map((item) => item.filepath),
          },
          attachments: [
            {
              type: "file" as const,
              mime,
              url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
            },
          ],
        }
      }

      if (isSpreadsheet(filepath)) {
        const offset = Math.max(1, params.offset ?? 1)
        const limit = Math.max(1, Math.min(MAX_SPREADSHEET_LIMIT, params.limit ?? DEFAULT_SPREADSHEET_LIMIT))
        const inspection = yield* inspectSpreadsheet(filepath, { offset, limit })
        const output = spreadsheetOutput(filepath, inspection)

        return {
          title,
          output,
          metadata: {
            preview: inspection.ok ? "Spreadsheet preview loaded" : "Spreadsheet preview unavailable",
            truncated: inspection.ok && output.includes("More rows are available."),
            loaded: loaded.map((item) => item.filepath),
          },
        }
      }

      if (isStructuredDocument(filepath)) {
        const ext = path.extname(filepath).toLowerCase()
        const output = [
          `<path>${filepath}</path>`,
          `<type>structured-document</type>`,
          `<content>`,
          `This is a ${ext} document, not a plain text file. The read tool cannot inspect word processor or presentation contents directly.`,
          `Use the shell tool with an appropriate parser or converter instead of calling read again.`,
          `</content>`,
        ].join("\n")

        return {
          title,
          output,
          metadata: {
            preview: `${ext} structured document. Use shell with an appropriate parser.`,
            truncated: false,
            loaded: loaded.map((item) => item.filepath),
          },
        }
      }

      if (isBinaryFile(filepath, sample)) {
        return yield* Effect.fail(new Error(`Cannot read binary file: ${filepath}`))
      }

      const file = yield* lines(filepath, { limit: params.limit ?? DEFAULT_READ_LIMIT, offset: params.offset || 1 })
      if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
        return yield* Effect.fail(
          new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`),
        )
      }

      let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
      output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n")

      const last = file.offset + file.raw.length - 1
      const next = last + 1
      const truncated = file.more || file.cut
      if (file.cut) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
      } else if (file.more) {
        output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`
      } else {
        output += `\n\n(End of file - total ${file.count} lines)`
      }
      output += "\n</content>"

      yield* warm(filepath)

      if (loaded.length > 0) {
        output += `\n\n<system-reminder>\n${loaded.map((item) => item.content).join("\n\n")}\n</system-reminder>`
      }

      return {
        title,
        output,
        metadata: {
          preview: file.raw.slice(0, 20).join("\n"),
          truncated,
          loaded: loaded.map((item) => item.filepath),
          display: {
            type: "file" as const,
            path: filepath,
            text: file.raw.join("\n"),
            lineStart: file.offset,
            lineEnd: last,
            totalLines: file.count,
            truncated,
          },
        },
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
