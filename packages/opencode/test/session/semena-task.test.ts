import { describe, expect, test } from "bun:test"
import {
  assessSemenaCompletion,
  collectSemenaTaskEvidence,
  readSemenaTask,
  semenaRequiredPhase,
  semenaTaskContract,
  semenaTaskRequirements,
  updateSemenaTask,
} from "../../src/session/semena-task"

function tool(tool: string, input: Record<string, unknown>, output: string) {
  return {
    info: { time: { created: 10 } },
    parts: [
      {
        type: "tool" as const,
        tool,
        state: { status: "completed" as const, input, output, title: "", metadata: {}, time: { start: 10, end: 11 } },
      },
    ],
  } as any
}

const none = {
  completedTools: 0,
  mutationTools: 0,
  externalTools: 0,
  failedTools: 0,
  verificationTools: 0,
  externalBeforeMutation: false,
}

describe("semena durable task state", () => {
  test("keeps the original request while appending later instructions", () => {
    const root = updateSemenaTask(undefined, "Обнови отчет.xlsx и проверь результат", 100)
    const next = updateSemenaTask(root, "Используй официальный источник", 200)

    expect(next.root).toBe("Обнови отчет.xlsx и проверь результат")
    expect(next.updates).toEqual(["Используй официальный источник"])
    expect(next.startedAt).toBe(100)
    expect(semenaTaskContract(next)).toContain("Обнови отчет.xlsx")
    expect(semenaTaskContract(next)).toContain("Используй официальный источник")
  })

  test("reads a valid persisted state and rejects malformed metadata", () => {
    expect(
      readSemenaTask({ semena_task: { root: "Запусти тесты", updates: ["Исправь ошибки"], startedAt: 42 } }),
    ).toEqual({ root: "Запусти тесты", updates: ["Исправь ошибки"], startedAt: 42 })
    expect(readSemenaTask({ semena_task: { root: 123 } })).toBeUndefined()
    expect(
      readSemenaTask({
        semena_task: {
          root: "Task",
          updates: [],
          startedAt: 42,
          forcedPhase: "external",
          forcedTool: "websearch",
        },
      }),
    ).toMatchObject({ forcedPhase: "external", forcedTool: "websearch" })
  })

  test("starts a fresh durable task after the previous one completed", () => {
    const completed = { ...updateSemenaTask(undefined, "Создай отчет", 10), completedAt: 20 }
    const next = updateSemenaTask(completed, "Проверь новый проект", 30)

    expect(next).toEqual({ root: "Проверь новый проект", updates: [], startedAt: 30 })
  })
})

describe("semena evidence-based completion", () => {
  test("recognizes real Russian file and registry requirements", () => {
    const task = updateSemenaTask(
      undefined,
      "\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u0440\u0430\u0441\u0442\u0435\u043d\u0438\u044f \u043d\u0430 \u0441\u0430\u0439\u0442\u0435 \u0440\u0435\u0435\u0441\u0442\u0440\u0430 \u0438 \u043e\u0431\u043d\u043e\u0432\u0438 \u0444\u0430\u0439\u043b result.xlsx",
      1,
    )

    expect(semenaTaskRequirements(task)).toEqual({ mutation: true, external: true, localTool: true })
  })

  test("accepts a Russian completion signal with matching evidence", () => {
    const task = updateSemenaTask(undefined, "\u0421\u043e\u0437\u0434\u0430\u0439 \u0444\u0430\u0439\u043b result.xlsx", 1)
    const result = assessSemenaCompletion({
      task,
      evidence: { ...none, completedTools: 2, mutationTools: 1, verificationTools: 1 },
      assistantText: "\u0413\u043e\u0442\u043e\u0432\u043e: \u0444\u0430\u0439\u043b \u0441\u043e\u0437\u0434\u0430\u043d \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d.",
    })

    expect(result.complete).toBeTrue()
  })

  test("rejects a file completion claim without a successful mutation", () => {
    const task = updateSemenaTask(undefined, "Обнови файл отчет.xlsx и сохрани рядом", 1)
    expect(
      assessSemenaCompletion({ task, evidence: { ...none, completedTools: 4 }, assistantText: "Готово." }),
    ).toEqual({
      complete: false,
      reason: "the request requires a file or project change, but no mutating tool succeeded",
    })
  })

  test("rejects a registry completion claim without external lookup", () => {
    const task = updateSemenaTask(undefined, "Проверь список на актуальном сайте реестра и обнови таблицу Excel", 1)
    expect(
      assessSemenaCompletion({
        task,
        evidence: { ...none, completedTools: 3, mutationTools: 1 },
        assistantText: "Задача выполнена.",
      }).reason,
    ).toBe("the request requires current external data, but no web or network tool succeeded")
  })

  test("accepts completion when required tool evidence exists", () => {
    const task = updateSemenaTask(undefined, "Найди данные на сайте и сохрани их в файл result.xlsx", 1)
    expect(
      assessSemenaCompletion({
        task,
        evidence: {
          completedTools: 5,
          mutationTools: 1,
          externalTools: 2,
          failedTools: 1,
          verificationTools: 1,
          externalBeforeMutation: true,
        },
        assistantText: "Готово: файл создан и проверен.",
        finish: "stop",
      }).complete,
    ).toBeTrue()
  })

  test("never accepts a response cut off by the output limit", () => {
    const task = updateSemenaTask(undefined, "Запусти тесты проекта", 1)
    expect(
      assessSemenaCompletion({
        task,
        evidence: { ...none, completedTools: 1 },
        assistantText: "Задача выполнена.",
        finish: "length",
      }).complete,
    ).toBeFalse()
  })

  test("requires a separate verification after the last mutation", () => {
    const task = updateSemenaTask(undefined, "Создай файл result.xlsx", 1)
    expect(
      assessSemenaCompletion({
        task,
        evidence: { ...none, completedTools: 1, mutationTools: 1 },
        assistantText: "Файл создан.",
      }).reason,
    ).toBe("the changed result has not been verified with a separate tool call")
  })

  test("allows ordinary conversational answers without forcing tools", () => {
    const task = updateSemenaTask(undefined, "Объясни разницу между RAM и VRAM", 1)
    expect(
      assessSemenaCompletion({ task, evidence: none, assistantText: "RAM хранит данные процессора." }).complete,
    ).toBeTrue()
  })

  test("does not count a shell command with an embedded runtime error as success", () => {
    const task = updateSemenaTask(undefined, "Save current registry data to result.xlsx", 1)
    const messages = [
      tool(
        "shell",
        { command: "python -c \"df.to_excel('result.xlsx')\"" },
        "Traceback (most recent call last):\nSyntaxError: invalid syntax",
      ),
      tool("shell", { command: "curl https://example.test" }, "curl: (7) Failed to connect"),
      tool("shell", { command: "python script.py" }, "Error reading file: Invalid argument: '????.xls'"),
    ]

    expect(collectSemenaTaskEvidence(messages, task)).toMatchObject({
      mutationTools: 0,
      externalTools: 0,
    })
  })

  test("requires a fresh result mutation after external data arrives", () => {
    expect(
      semenaRequiredPhase(
        { mutation: true, external: true, localTool: true },
        {
          completedTools: 8,
          mutationTools: 1,
          externalTools: 2,
          failedTools: 0,
          verificationTools: 3,
          externalBeforeMutation: false,
        },
      ),
    ).toBe("mutation")
  })

  test("does not mistake a helper script for the requested workbook", () => {
    const task = updateSemenaTask(undefined, "Create result.xlsx and verify it", 1)
    const evidence = collectSemenaTaskEvidence(
      [
        tool(
          "write",
          { filePath: "process_excel.py", content: "output = 'result.xlsx'\nprint(output)" },
          "Wrote process_excel.py",
        ),
      ],
      task,
    )

    expect(evidence.mutationTools).toBe(0)
  })
})
