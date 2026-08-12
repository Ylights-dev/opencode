import { SessionV1 } from "@opencode-ai/core/v1/session"

export const SEMENA_TASK_METADATA_KEY = "semena_task"

const MAX_ROOT_CHARS = 6_000
const MAX_UPDATE_CHARS = 1_500
const MAX_UPDATES = 6

export interface SemenaTaskState {
  root: string
  updates: string[]
  startedAt: number
  completedAt?: number
  forcedPhase?: "external" | "mutation" | "verification"
  forcedTool?: "websearch"
}

export interface SemenaTaskEvidence {
  completedTools: number
  usefulTools: number
  mutationTools: number
  externalTools: number
  failedTools: number
  verificationTools: number
  externalBeforeMutation: boolean
  repeatedFailureStreak: number
  repeatedFailure?: string
}

export interface SemenaCompletionAssessment {
  complete: boolean
  reason: string
}

export interface SemenaTaskRequirements {
  mutation: boolean
  external: boolean
  localTool: boolean
}

export type SemenaRequiredPhase = "external" | "mutation" | "verification" | ""

export function semenaRequiredPhase(
  requirements: SemenaTaskRequirements,
  evidence: SemenaTaskEvidence,
): SemenaRequiredPhase {
  if (requirements.external && !evidence.externalTools) return "external"
  if (
    requirements.mutation &&
    (!evidence.mutationTools || (requirements.external && !!evidence.externalTools && !evidence.externalBeforeMutation))
  )
    return "mutation"
  if (requirements.mutation && !evidence.verificationTools) return "verification"
  return ""
}

function clip(value: string, max: number) {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n[request truncated by Semena task state]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readSemenaTask(metadata: Record<string, unknown> | undefined): SemenaTaskState | undefined {
  const raw = metadata?.[SEMENA_TASK_METADATA_KEY]
  if (!isRecord(raw) || typeof raw.root !== "string" || typeof raw.startedAt !== "number") return
  const updates = Array.isArray(raw.updates)
    ? raw.updates.filter((item): item is string => typeof item === "string")
    : []
  return {
    root: clip(raw.root, MAX_ROOT_CHARS),
    updates: updates.slice(-MAX_UPDATES).map((item) => clip(item, MAX_UPDATE_CHARS)),
    startedAt: raw.startedAt,
    ...(typeof raw.completedAt === "number" ? { completedAt: raw.completedAt } : {}),
    ...(raw.forcedPhase === "external" || raw.forcedPhase === "mutation" || raw.forcedPhase === "verification"
      ? { forcedPhase: raw.forcedPhase }
      : {}),
    ...(raw.forcedTool === "websearch" ? { forcedTool: raw.forcedTool } : {}),
  }
}

export function updateSemenaTask(
  current: SemenaTaskState | undefined,
  request: string,
  createdAt: number,
): SemenaTaskState {
  const text = clip(request, current ? MAX_UPDATE_CHARS : MAX_ROOT_CHARS)
  if (!current || current.completedAt) return { root: clip(request, MAX_ROOT_CHARS), updates: [], startedAt: createdAt }
  if (!text || text === current.root || current.updates.at(-1) === text) return current
  return { ...current, updates: [...current.updates, text].slice(-MAX_UPDATES) }
}

export function semenaTaskText(task: SemenaTaskState) {
  return [task.root, ...task.updates].filter(Boolean).join("\n\nAdditional user instruction:\n")
}

export function semenaTaskContract(task: SemenaTaskState) {
  const updates = task.updates.length
    ? `\nLater user instructions, in order:\n${task.updates.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : ""
  return `<semena-task-contract>
The original employee request below is durable and must survive summaries and context compaction.
Do not replace it with a preparatory subtask. Later instructions refine it; they do not erase unfinished requirements unless they explicitly cancel them.

Original employee request:
${task.root}${updates}

Execution rules:
- Work on the original request until every requested operation is complete.
- Use tools for file, system, code, or current external-data work. Do not merely print a command or a plan.
- A successful inspection, extracted list, draft, or intermediate script is not completion when the request also requires lookup, modification, export, execution, or verification.
- After a tool error, correct the call and retry with a concrete action.
- On Windows shell, use PowerShell-compatible commands. Use py -3 for Python when available, quote paths with spaces, and put complex Python into a script file before running it.
- If a command shape fails twice, stop repeating that shape. Switch tools or write a smaller diagnostic script that prints one concrete fact.
- Claim completion only after the requested result has been produced and verified with tools.
</semena-task-contract>`
}

// Keep these expressions ASCII-only so a Windows packaging shell cannot corrupt
// the Russian intent markers while copying the source tree.
const FILE_MUTATION_INTENT =
  /(?:\b(?:file|files|folder|workbook|spreadsheet|document|archive|project)\b|\u0444\u0430\u0439\u043b|\u043f\u0430\u043f\u043a|\u043a\u0430\u0442\u0430\u043b\u043e\u0433|\u0442\u0430\u0431\u043b\u0438\u0446|excel|xlsx|xls\b|\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442|\u0430\u0440\u0445\u0438\u0432).{0,160}(?:\u0441\u043e\u0437\u0434\u0430|\u0437\u0430\u043f\u0438\u0448|\u0441\u043e\u0445\u0440\u0430\u043d|\u043e\u0431\u043d\u043e\u0432|\u0438\u0437\u043c\u0435\u043d|\u0434\u043e\u0431\u0430\u0432|\u0432\u043d\u0435\u0441|\u0443\u0434\u0430\u043b|\u043f\u0435\u0440\u0435\u043c\u0435\u0441\u0442|\u0441\u043a\u043e\u043f\u0438\u0440|\u0432\u044b\u0433\u0440\u0443\u0437|\u044d\u043a\u0441\u043f\u043e\u0440\u0442|\u043f\u043e\u043b\u043e\u0436|\u0438\u0441\u043f\u0440\u0430\u0432|\u043e\u0431\u0440\u0430\u0431\u043e\u0442)|(?:\u0441\u043e\u0437\u0434\u0430|\u0437\u0430\u043f\u0438\u0448|\u0441\u043e\u0445\u0440\u0430\u043d|\u043e\u0431\u043d\u043e\u0432|\u0438\u0437\u043c\u0435\u043d|\u0434\u043e\u0431\u0430\u0432|\u0432\u043d\u0435\u0441|\u0443\u0434\u0430\u043b|\u043f\u0435\u0440\u0435\u043c\u0435\u0441\u0442|\u0441\u043a\u043e\u043f\u0438\u0440|\u0432\u044b\u0433\u0440\u0443\u0437|\u044d\u043a\u0441\u043f\u043e\u0440\u0442|\u043f\u043e\u043b\u043e\u0436|\u0438\u0441\u043f\u0440\u0430\u0432|\u043e\u0431\u0440\u0430\u0431\u043e\u0442).{0,160}(?:\b(?:file|files|folder|workbook|spreadsheet|document|archive|project)\b|\u0444\u0430\u0439\u043b|\u043f\u0430\u043f\u043a|\u043a\u0430\u0442\u0430\u043b\u043e\u0433|\u0442\u0430\u0431\u043b\u0438\u0446|excel|xlsx|xls\b|\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442|\u0430\u0440\u0445\u0438\u0432)/is

const EXTERNAL_RESEARCH_INTENT =
  /(?:\u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d|\u0441\u0435\u0439\u0447\u0430\u0441|\u0441\u0435\u0433\u043e\u0434\u043d\u044f|\u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442|\u0432\u0435\u0431|\u0441\u0430\u0439\u0442|\u0440\u0435\u0435\u0441\u0442\u0440|\u043d\u0430\u0439\u0434|\u043f\u043e\u0438\u0441\u043a|\u043f\u0440\u043e\u0432\u0435\u0440\u044c).{0,180}(?:\u0441\u0430\u0439\u0442|\u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442|\u0432\u0435\u0431|\u0440\u0435\u0435\u0441\u0442\u0440|url|https?:|\u0434\u0430\u043d\u043d)|(?:\u0441\u0430\u0439\u0442|\u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442|\u0432\u0435\u0431|\u0440\u0435\u0435\u0441\u0442\u0440|url|https?:).{0,180}(?:\u043d\u0430\u0439\u0434|\u043f\u043e\u0438\u0441\u043a|\u043f\u0440\u043e\u0432\u0435\u0440\u044c|\u0441\u0432\u0435\u0440|\u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d)/is

const LOCAL_TOOL_INTENT =
  /(?:\u0437\u0430\u043f\u0443\u0441\u0442|\u0432\u044b\u043f\u043e\u043b\u043d|\u0443\u0441\u0442\u0430\u043d\u043e\u0432|\u043f\u0435\u0440\u0435\u0443\u0441\u0442\u0430\u043d\u043e\u0432|\u0441\u043e\u0431\u0435\u0440|\u043f\u0440\u043e\u0442\u0435\u0441\u0442|\u043e\u0442\u043b\u0430\u0434|\u043f\u043e\u0447\u0438\u043d|\u0438\u0441\u043f\u0440\u0430\u0432|\u043f\u0440\u043e\u0447\u0438\u0442\u0430|\u043f\u0440\u043e\u0432\u0435\u0440\u044c|\u043f\u0440\u043e\u0430\u043d\u0430\u043b\u0438\u0437).{0,160}(?:\u0441\u043a\u0440\u0438\u043f\u0442|\u043a\u043e\u043c\u0430\u043d\u0434|\u043a\u043e\u0434|\u043f\u0440\u043e\u0435\u043a\u0442|\u043b\u043e\u0433|\u0444\u0430\u0439\u043b|\u043f\u0430\u043f\u043a|\u0441\u0438\u0441\u0442\u0435\u043c|\u043f\u0440\u0438\u043b\u043e\u0436)|(?:run|execute|install|build|test|debug|fix|read|inspect|analy[sz]e).{0,160}(?:script|command|code|project|log|file|folder|system|app)/is

const DONE_SIGNAL =
  /(^|\s)(\u0433\u043e\u0442\u043e\u0432\u043e|\u0437\u0430\u0434\u0430\u0447\u0430 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430|\u0440\u0430\u0431\u043e\u0442\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430|\u0444\u0430\u0439\u043b (\u0441\u043e\u0437\u0434\u0430\u043d|\u0441\u043e\u0445\u0440\u0430\u043d[\u0435\u0451]\u043d|\u043e\u0431\u043d\u043e\u0432\u043b[\u0435\u0451]\u043d|\u0437\u0430\u043f\u0438\u0441\u0430\u043d)|\u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u043e \d+|done|task completed|file (created|saved|updated)|final result|successfully)(\s|:|\.|,|$)/i

export function semenaTaskRequirements(task: SemenaTaskState): SemenaTaskRequirements {
  const text = semenaTaskText(task)
  return {
    mutation: FILE_MUTATION_INTENT.test(text),
    external: EXTERNAL_RESEARCH_INTENT.test(text),
    localTool: LOCAL_TOOL_INTENT.test(text),
  }
}

function requestedArtifactExtensions(task: SemenaTaskState) {
  return new Set(
    [...semenaTaskText(task).matchAll(/\.(xlsx|xlsm|xls|csv|tsv|docx|pdf|pptx)\b/gi)].map(
      (match) => `.${match[1].toLowerCase()}`,
    ),
  )
}

function successfulMutation(part: SessionV1.ToolPart, task: SemenaTaskState) {
  if (!successfulTool(part)) return false
  const expected = requestedArtifactExtensions(task)
  const input = JSON.stringify(part.state.input ?? {})
  const inputRecord = isRecord(part.state.input) ? part.state.input : {}
  const targetPath = [inputRecord.filePath, inputRecord.path].find(
    (value): value is string => typeof value === "string",
  )
  const touchesTargetArtifact =
    expected.size === 0 ||
    (!!targetPath && [...expected].some((extension) => targetPath.toLowerCase().endsWith(extension)))
  if (["write", "edit"].includes(part.tool)) return touchesTargetArtifact
  if (part.tool === "apply_patch") {
    if (expected.size === 0) return true
    const patchTargets = input.match(/^(?:\*{3} (?:Add|Update) File:|\+{3}|-{3})\s+(.+)$/gm) ?? []
    return patchTargets.some((line) => [...expected].some((extension) => line.toLowerCase().endsWith(extension)))
  }
  if (!["bash", "shell"].includes(part.tool)) return false
  const shellEvidence = `${input}\n${toolOutput(part) ?? ""}`.toLowerCase()
  if (expected.size > 0 && ![...expected].some((extension) => shellEvidence.includes(extension))) return false
  return /(?:Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|New-Item|Remove-Item|save\s*\(|to_excel\s*\(|write_(?:text|bytes)\s*\(|writeFile|mkdir|rename|copyfile|shutil\.copy|>\s*[^=&])/i.test(
    input,
  )
}

function successfulExternalTool(part: SessionV1.ToolPart) {
  if (!successfulTool(part)) return false
  if (["websearch", "webfetch"].includes(part.tool)) return true
  if (!["bash", "shell"].includes(part.tool)) return false
  return /(?:Invoke-WebRequest|Invoke-RestMethod|curl(?:\.exe)?\s|wget\s|https?:\/\/)/i.test(
    JSON.stringify(part.state.input ?? {}),
  )
}

function toolOutput(part: SessionV1.ToolPart) {
  return "output" in part.state && typeof part.state.output === "string" ? part.state.output : undefined
}

function toolExitCode(part: SessionV1.ToolPart) {
  const state = part.state
  const metadata = "metadata" in state && isRecord(state.metadata) ? state.metadata : {}
  const raw = metadata.exit ?? metadata.exitCode ?? metadata.exit_code
  return typeof raw === "number" ? raw : undefined
}

export function looksLikeFailedOutput(output: string | undefined) {
  if (!output) return false
  return /(?:Traceback \(most recent call last\):|SyntaxError:|ParserError:|CommandNotFoundException|is not recognized as an internal or external command|Invoke-WebRequest:\s.*(?:failed|error)|curl:\s*\(\d+\)|(?:^|\n)\s*(?:Error(?: reading file)?|Failed):|\bInvalid argument:|\b(?:fatal error|uncaught exception)\b)/i.test(
    output,
  )
}

function successfulTool(part: SessionV1.ToolPart) {
  if (part.state.status !== "completed") return false
  const exit = toolExitCode(part)
  if (exit !== undefined && exit !== 0) return false
  if (looksLikeFailedOutput(toolOutput(part))) return false
  return true
}

function failedTool(part: SessionV1.ToolPart) {
  if (part.state.status === "error") return true
  if (part.state.status !== "completed") return false
  const exit = toolExitCode(part)
  return (exit !== undefined && exit !== 0) || looksLikeFailedOutput(toolOutput(part))
}

function normalizeCommand(value: string) {
  return value
    .replace(/[A-Z]:\\Users\\[^"'\s]+/gi, "%USERPROFILE%")
    .replace(/0x[0-9a-f]+/gi, "0x#")
    .replace(/\b\d{2,}\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220)
}

export function semenaToolFailureFingerprint(part: SessionV1.ToolPart) {
  if (!failedTool(part)) return
  const input = isRecord(part.state.input) ? part.state.input : {}
  const command = typeof input.command === "string" ? input.command : JSON.stringify(part.state.input ?? {})
  const output = toolOutput(part) ?? ""
  const signature =
    output.match(
      /(Traceback \(most recent call last\):|SyntaxError:[^\n]*|ParserError[^\n]*|CommandNotFoundException|is not recognized as an internal or external command|Invalid argument:[^\n]*|curl:\s*\(\d+\)[^\n]*)/i,
    )?.[0] ?? output.split(/\r?\n/).find((line: string) => line.trim()) ?? part.state.status
  return `${part.tool}:${normalizeCommand(command)}:${normalizeCommand(signature)}`
}

export function collectSemenaTaskEvidence(messages: SessionV1.WithParts[], task: SemenaTaskState): SemenaTaskEvidence {
  const evidence: SemenaTaskEvidence = {
    completedTools: 0,
    usefulTools: 0,
    mutationTools: 0,
    externalTools: 0,
    failedTools: 0,
    verificationTools: 0,
    externalBeforeMutation: false,
    repeatedFailureStreak: 0,
  }
  let sawExternal = false
  let sawMutation = false
  let lastFailure: string | undefined
  let lastFailureStreak = 0
  for (const message of messages) {
    if (message.info.time.created < task.startedAt) continue
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const completed = part.state.status === "completed"
      const successful = successfulTool(part)
      const failed = failedTool(part)
      const mutation = successfulMutation(part, task)
      const external = successfulExternalTool(part)
      if (completed) evidence.completedTools++
      if (successful) evidence.usefulTools++
      if (failed) evidence.failedTools++
      const failure = semenaToolFailureFingerprint(part)
      if (failure) {
        lastFailureStreak = failure === lastFailure ? lastFailureStreak + 1 : 1
        lastFailure = failure
        if (lastFailureStreak > evidence.repeatedFailureStreak) {
          evidence.repeatedFailureStreak = lastFailureStreak
          evidence.repeatedFailure = failure
        }
      } else if (successful) {
        lastFailure = undefined
        lastFailureStreak = 0
      }
      if (external) {
        evidence.externalTools++
        sawExternal = true
      }
      if (mutation) {
        evidence.mutationTools++
        evidence.externalBeforeMutation ||= sawExternal
        evidence.verificationTools = 0
        sawMutation = true
        continue
      }
      if (successful && sawMutation) evidence.verificationTools++
    }
  }
  return evidence
}

export function assessSemenaCompletion(input: {
  task: SemenaTaskState
  evidence: SemenaTaskEvidence
  assistantText?: string
  finish?: string
}): SemenaCompletionAssessment {
  const requirements = semenaTaskRequirements(input.task)
  const needsMutation = requirements.mutation
  const needsExternal = requirements.external
  const needsLocalTool = requirements.localTool
  const needsTool = needsMutation || needsExternal || needsLocalTool

  if (input.finish === "length") return { complete: false, reason: "the model output hit its length limit" }
  if (!needsTool) return { complete: true, reason: "the request does not require verifiable tool work" }
  if (!DONE_SIGNAL.test(input.assistantText ?? "")) {
    return { complete: false, reason: "the assistant stopped without explicitly completing the original request" }
  }
  if (needsExternal && input.evidence.externalTools === 0) {
    return {
      complete: false,
      reason: "the request requires current external data, but no web or network tool succeeded",
    }
  }
  if (needsMutation && input.evidence.mutationTools === 0) {
    return { complete: false, reason: "the request requires a file or project change, but no mutating tool succeeded" }
  }
  if (needsMutation && needsExternal && !input.evidence.externalBeforeMutation) {
    return { complete: false, reason: "external data was not obtained before the result was written" }
  }
  if (needsMutation && input.evidence.verificationTools === 0) {
    return { complete: false, reason: "the changed result has not been verified with a separate tool call" }
  }
  if (input.evidence.usefulTools === 0) {
    return { complete: false, reason: "the request requires tool work, but no tool completed successfully" }
  }
  return { complete: true, reason: "the completion claim has matching tool evidence" }
}
