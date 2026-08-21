import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ChildProcess } from "effect/unstable/process"
import { Effect, Schema } from "effect"
import path from "path"

import { InstanceState } from "@/effect/instance-state"
import { containsPath } from "@/project/instance-context"
import { ShellID } from "./shell/id"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  script: Schema.String.annotate({
    description: "Complete Python source code to execute. Pass multiline code directly without shell quoting.",
  }),
  workdir: Schema.optional(AbsolutePath).annotate({
    description: "Absolute working directory. Defaults to the active workspace directory.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Timeout in milliseconds. Defaults to 120000.",
  }),
})

export const PythonTool = Tool.define(
  "python",
  Effect.gen(function* () {
    const processService = yield* AppProcess.Service

    return {
      description:
        "Execute Python source directly through standard input. Parameters: script is complete Python source; workdir is an optional absolute working directory; timeout is optional milliseconds. Use this for multiline Python, data processing, spreadsheets, and scripts that would be fragile inside shell quoting. The process runs in UTF-8 and returns the real exit code and combined output.",
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cwd = input.workdir ? path.resolve(input.workdir) : instance.directory
          if (!containsPath(cwd, instance)) {
            yield* ctx.ask({
              permission: "external_directory",
              patterns: [path.join(cwd, "*")],
              always: [path.join(cwd, "*")],
              metadata: { directory: cwd },
            })
          }
          yield* ctx.ask({
            permission: ShellID.ToolID,
            patterns: ["python *"],
            always: ["python *"],
            metadata: { command: "python <stdin>" },
          })

          const executable = process.platform === "win32" ? "py" : "python3"
          const args = process.platform === "win32" ? ["-3", "-"] : ["-"]
          const result = yield* processService
            .run(
              ChildProcess.make(executable, args, {
                cwd,
                env: {
                  ...process.env,
                  PYTHONIOENCODING: "utf-8",
                  PYTHONUTF8: "1",
                },
              }),
              {
                stdin: input.script,
                combineOutput: true,
                maxOutputBytes: 1024 * 1024,
                signal: ctx.abort,
                timeout: `${input.timeout ?? 120_000} millis`,
              },
            )
            .pipe(Effect.orDie)
          const output = result.output?.toString("utf8").trim() || "(no output)"
          return {
            title: "Python script",
            output,
            metadata: {
              exit: result.exitCode,
              truncated: result.outputTruncated === true,
            },
          }
        }),
    }
  }),
)
