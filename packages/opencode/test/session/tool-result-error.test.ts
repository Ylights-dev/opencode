import { describe, expect, test } from "bun:test"
import { toolResultError } from "../../src/session/tools"
import { hasUnresolvedToolError, needsMutationAudit } from "../../src/session/prompt"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

describe("toolResultError", () => {
  test("turns a nonzero command exit into a model-visible error", () => {
    expect(toolResultError({ metadata: { exit: 1 }, output: "SyntaxError" })?.message).toContain(
      "exit code 1.\nSyntaxError",
    )
  })

  test("accepts zero exit and tools without exit metadata", () => {
    expect(toolResultError({ metadata: { exit: 0 }, output: "ok" })).toBeUndefined()
    expect(toolResultError({ metadata: {}, output: "ok" })).toBeUndefined()
  })
})

describe("hasUnresolvedToolError", () => {
  const messages = (statuses: Array<"completed" | "error">, command = "Set-Content result.txt ok") =>
    [
      {
        info: { role: "assistant", parentID: "user-1" },
        parts: statuses.map((status) => ({
          type: "tool",
          tool: "bash",
          metadata: {},
          state: { status, input: { command } },
        })),
      },
    ] as unknown as SessionV1.WithParts[]

  test("detects an error when it is the latest tool result", () => {
    expect(hasUnresolvedToolError(messages(["completed", "error"]), "user-1")).toBe(true)
  })

  test("accepts a successful retry after an error", () => {
    expect(hasUnresolvedToolError(messages(["error", "completed"]), "user-1")).toBe(false)
  })

  test("audits a completed mutation-capable tool", () => {
    expect(needsMutationAudit(messages(["completed"]), "user-1")).toBe(true)
  })

  test("does not audit an observational shell command", () => {
    expect(needsMutationAudit(messages(["completed"], "py -3 -c \"import pandas; print('ok')\""), "user-1")).toBe(false)
  })

  test("audits a spreadsheet write inside Python", () => {
    expect(needsMutationAudit(messages(["completed"], "df.to_excel('result.xlsx')"), "user-1")).toBe(true)
  })
})
