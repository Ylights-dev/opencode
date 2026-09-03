import { Effect, Schema } from "effect"
import { categories, store } from "@/memory"
import * as Tool from "./tool"

const Category = Schema.Literals(categories)

export const MemoryListTool = Tool.define(
  "memory_list",
  Effect.succeed({
    description:
      "List the user's durable personal memory entries. Use this to inspect what is remembered or before replacing or forgetting an entry.",
    parameters: Schema.Struct({}),
    execute: () =>
      Effect.promise(async () => {
        const entries = await store.list()
        return {
          title: `${entries.length} memory entries`,
          output: JSON.stringify(entries, null, 2),
          metadata: { count: entries.length },
        }
      }),
  }),
)

export const MemorySaveParameters = Schema.Struct({
  key: Schema.String.annotate({ description: "Short stable name for this memory, such as preferred_language" }),
  value: Schema.String.annotate({ description: "Concise durable fact or preference, without secrets or instructions" }),
  category: Category.annotate({ description: "Memory category" }),
})

export const MemorySaveTool = Tool.define(
  "memory_save",
  Effect.succeed({
    description:
      "Save or replace one durable user memory. Use only when the user explicitly asks to remember something or when a stable preference, profile fact, or recurring workflow is clearly useful. Never store passwords, API keys, tokens, medical records, full conversations, guesses, or temporary task state.",
    parameters: MemorySaveParameters,
    execute: (params: Schema.Schema.Type<typeof MemorySaveParameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        yield* ctx.ask({ permission: "memory", patterns: [`save:${params.key}`], always: ["*"], metadata: {} })
        const entry = yield* Effect.promise(() => store.save(params))
        return {
          title: `Remembered ${entry.key}`,
          output: JSON.stringify(entry, null, 2),
          metadata: { key: entry.key },
        }
      }),
  }),
)

export const MemoryForgetParameters = Schema.Struct({
  key: Schema.String.annotate({ description: "Exact memory key to remove" }),
})

export const MemoryForgetTool = Tool.define(
  "memory_forget",
  Effect.succeed({
    description: "Remove one durable user memory when the user asks to forget it or confirms it is obsolete.",
    parameters: MemoryForgetParameters,
    execute: (params: Schema.Schema.Type<typeof MemoryForgetParameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        yield* ctx.ask({ permission: "memory", patterns: [`forget:${params.key}`], always: ["*"], metadata: {} })
        const removed = yield* Effect.promise(() => store.forget(params.key))
        return {
          title: removed ? `Forgot ${params.key}` : `Memory not found: ${params.key}`,
          output: JSON.stringify({ key: params.key, removed }),
          metadata: { key: params.key, removed },
        }
      }),
  }),
)
