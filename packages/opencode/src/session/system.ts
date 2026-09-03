import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_META from "./prompt/meta.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Reference } from "@opencode-ai/core/reference"
import { MCP } from "@/mcp"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { store as memory } from "@/memory"

const PROMPT_SEMENA = [
  "You are Semena, a general-purpose Windows desktop agent.",
  "Help with requests across all subject areas, including general knowledge, business, office work, 1C, research, creative work, programming, personal matters, medicine, law, and finance. Do not refuse or redirect a request merely because it is outside software engineering.",
  "Use the available tools to complete requested actions end to end; do not stop at a plan or claim an unobserved result.",
  "Treat tool errors as authoritative. Never claim that a command or file update succeeded after an error.",
  "After changing an artifact, inspect the resulting artifact with a tool before reporting success. A zero exit code alone does not prove that the requested content is correct.",
  "Select tools from their full descriptions and preserve exact paths returned by tools.",
  "Use persistent memory selectively. Save only durable user preferences, profile facts, and recurring workflows; do not save transient tasks, guesses, credentials, secrets, sensitive records, or full conversation text. Use memory_forget when the user asks to forget something.",
  "For 1C/1С configuration questions, prefer semena_1c_* MCP tools as the authoritative source. Do not inspect AppData, exported 1C cache folders, or local config files with shell/read/glob/grep unless the user explicitly asks for filesystem work or the relevant semena_1c_* tools fail to provide the needed data.",
  "Answer in Russian unless the user requests another language.",
].join("\n")

const PROMPT_SEMENA_DEFAULT = PROMPT_DEFAULT.replace(
  "IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.",
  "Do not invent URLs. Use URLs supplied by the user, discovered through tools, or known with high confidence when they are relevant to the user's request.",
).replace(
  "The user will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended:",
  "When the user requests a software engineering task, such as solving bugs, adding functionality, refactoring code, or explaining code, follow these steps:",
)

export function provider(model: Provider.Model) {
  if (model.providerID === "semena") return [PROMPT_SEMENA, PROMPT_SEMENA_DEFAULT]
  if (model.api.id.includes("muse-spark")) return [PROMPT_META]
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info, model?: Provider.Model) => Effect.Effect<string | undefined>
  readonly mcp: (agent: Agent.Info, permission?: PermissionV1.Ruleset) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const mcp = yield* MCP.Service
    const locations = yield* LocationServiceMap.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        const references = yield* Effect.gen(function* () {
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
        const persistentMemory =
          model.providerID === "semena" ? yield* Effect.promise(() => memory.prompt()) : undefined
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .flatMap((reference) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
          persistentMemory,
        ].filter((part): part is string => part !== undefined)
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info, model?: Provider.Model) {
        const mandatory = model?.providerID === "semena" ? yield* skill.get(Skill.VERIFY_WORK_SKILL_NAME) : undefined
        const parts = mandatory
          ? [
              `<mandatory_skill name="${mandatory.name}" loaded="true">`,
              mandatory.content.trim(),
              "</mandatory_skill>",
              "This skill is already loaded. Follow it without calling the skill tool again.",
            ]
          : []

        if (!Permission.disabled(["skill"], agent.permission).has("skill")) {
          const list = yield* skill.available(agent)
          parts.push(
            "Skills provide specialized instructions and workflows for specific tasks.",
            "Use the skill tool to load a skill when a task matches its description.",
            // the agents seem to ingest the information about skills a bit better if we present a more verbose
            // version of them here and a less verbose version in tool description, rather than vice versa.
            Skill.fmt(list, { verbose: true }),
          )
        }

        return parts.length ? parts.join("\n") : undefined
      }),

      mcp: Effect.fn("SystemPrompt.mcp")(function* (agent: Agent.Info, permission?: PermissionV1.Ruleset) {
        const ruleset = Permission.merge(agent.permission, permission ?? [])
        const tools = yield* mcp.tools()
        const disabled = Permission.disabled(Object.keys(tools), ruleset)
        const instructions = (yield* mcp.instructions()).filter(
          (item) => item.tools.length === 0 || Permission.disabled(item.tools, ruleset).size < item.tools.length,
        )
        const toolEntries = Object.entries(tools)
          .filter(([name]) => !disabled.has(name))
          .toSorted(([a], [b]) => a.localeCompare(b))
        if (instructions.length === 0 && toolEntries.length === 0) return

        return [
          "<mcp_instructions>",
          ...instructions.flatMap((item) => [
            `  <server name="${item.name}">`,
            ...item.instructions.split("\n").map((line) => `    ${line}`),
            "  </server>",
          ]),
          ...(toolEntries.length === 0
            ? []
            : [
                "  <available_tools>",
                "    MCP tools are model tools, not shell commands. Call them directly by their exact tool name; do not use bash, PowerShell, curl, or filesystem search to check whether an MCP tool exists.",
                ...toolEntries.map(([name, entry]) => {
                  const description = entry.def.description?.trim()
                  return description ? `    - ${name}: ${description}` : `    - ${name}`
                }),
                "  </available_tools>",
              ]),
          "</mcp_instructions>",
        ].join("\n")
      }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Skill.node, MCP.node, locationServiceMapNode],
})

export * as SystemPrompt from "./system"
