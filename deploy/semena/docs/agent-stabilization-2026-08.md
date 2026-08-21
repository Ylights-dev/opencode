# Semena Agent stabilization report

Assessment dates: 2026-08-17 and 2026-08-20.

## Scope

This report records the failures observed while adapting OpenCode Desktop to the
local `semena-gemma4` model, the implemented corrections, and the checks required
before publishing a Windows installer.

The changes are deliberately provider-scoped. Upstream OpenCode behavior for
other providers remains unchanged.

## Observed failures

The failures initially looked like insufficient model capability, but several
were integration defects:

- an early stabilization attempt disabled reasoning, truncated tool
  descriptions, replaced the upstream system prompt, forced tool selection,
  and added a synthetic `finish_task` tool; this made the weak local model less
  capable of planning and allowed it to report completion without evidence;
- the local 12B model received a large set of unrelated MCP/plugin tools, making
  tool selection unreliable;
- the desktop sidecar did not consistently receive the corporate CA path;
- the CA path contained Cyrillic characters, which was unreliable in the
  Electron/Node/OpenSSL startup path;
- an OpenCode source CLI test could accidentally use the user's global OpenCode
  configuration and a different provider, producing a false positive;
- Python and shell availability, Windows command syntax, legacy `.xls` files,
  and Cyrillic filenames amplified the request/protocol problems.

## Implemented corrections

### OpenCode agent contract

The Semena provider now preserves the full upstream OpenCode system prompt,
full tool descriptions, and complete JSON schemas. The Semena instructions are
an overlay that adds Windows and artifact-verification rules; they do not
replace the upstream agent contract. The provider no longer forces
`reasoning_effort`, `think`, or `toolChoice: required`, and there is no
synthetic `finish_task` tool.

Tool execution errors are authoritative. A non-zero shell exit is returned to
the model as an error. Before a final answer, the session may perform at most
one universal recovery turn for an unresolved tool error. After an edit, write,
or side-effecting shell command, the session requires a separate read-only
inspection turn before accepting a completion claim.

The fork includes a built-in `verify-work` skill. Semena loads its full content
automatically on every turn, so the model cannot skip activation by omitting a
`skill` call. The skill defines evidence appropriate to files, spreadsheets,
code, commands, system state, and web research. The host audit remains the
enforcement layer: a `skill` or task-management call after a mutation does not
satisfy verification; a completed `read`, `grep`, diagnostic shell command, or
`lsp` inspection after the latest mutation is required.

### Provider-scoped tool set

The Semena model receives only the core tools needed for local agent work:

```text
bash, edit, glob, grep, list, lsp, read, skill, task,
todowrite, webfetch, websearch, write
```

External MCP and plugin tools are omitted only for the Semena provider. This
keeps the employee agent focused without weakening the contract of the tools
that remain available or disabling OpenCode extensions globally.

Desktop starts the sidecar with `OPENCODE_PURE=1` as an additional isolation
measure.

### Corporate CA handling

The installer keeps its existing application data but also copies the corporate
certificate to the ASCII-only path:

```text
%LOCALAPPDATA%\Semena-Agent\semena-agent-ca.crt
```

Desktop and its sidecar set `NODE_EXTRA_CA_CERTS` to this path before contacting
the TLS gateway. This avoids failures caused by the Cyrillic application name in
the original certificate path.

## Verification

### Request inspection

A captured OpenCode request contained:

- model `semena-gemma4`;
- `max_tokens: 4096`;
- the full upstream system prompt plus the Semena overlay;
- complete descriptions and schemas for the active core tools;
- no forced reasoning or tool-choice overrides;
- active core tools and no unrelated 1C/video tools.

### Live gateway

The authenticated TLS smoke test passed against
`https://10.1.50.101:8443/v1`. A real chat-completion request made from the
OpenCode request body returned HTTP 200 and a valid SSE response.

### Agent scenarios

The source CLI must be launched with the Semena configuration and CA explicitly
selected:

```powershell
$env:OPENCODE_CONFIG_DIR = "$env:LOCALAPPDATA\Семена - Агент\config\opencode"
$env:NODE_EXTRA_CA_CERTS = "$env:LOCALAPPDATA\Semena-Agent\semena-agent-ca.crt"
```

Verified scenarios:

1. From the employee workspace, the agent found `Аэлита вес.xls` with `glob`
   and inspected it with the built-in spreadsheet-aware `read` tool.
2. The reader inferred the physical columns under the compound
   `Культура,Сорт` heading and reported the stable first data row.
3. A real end-to-end extraction created an `.xlsx` artifact, then performed a
   separate read-back inspection before answering. Independent validation found
   exactly 1103 unique varieties: zero missing, zero extra, zero duplicates.
4. A non-zero shell exit remains a tool error and cannot be converted into a
   successful completion claim.
5. A live `semena-gemma4` run in a fresh workspace created a two-line text file
   with `write`, independently reopened it with `read`, observed the exact two
   requested lines, and only then returned a successful final answer.

### Automated checks

```text
Focused OpenCode tests:                       546 passed
Final recovery/read regression subset:         54 passed
OpenCode TypeScript typecheck:                 passed
Semena deployment pytest suite:                32 passed
```

## Build and publication

The one-file Windows installer was rebuilt, installed locally, launched, and
published at:

```text
http://10.1.50.101:3010/downloads/Semena-Agent-Setup-x64.exe
```

Published artifact:

```text
Version: 0.0.0-prod-202608201508
SHA-256: 77A3150F40DC37714BB8A3562F67CD975673D1A6BAAC3AFB2658EB8612491072
Size: 159382615 bytes
```

The compatibility archive remains available at
`/downloads/SemenaOpenCodeSetup.zip` with SHA-256
`0C09B9A63B694519F3D79590F23DB0F6F220905D4FABF2ED0559FD3E7E7375D4`.
Both artifacts were downloaded back through the public HTTP endpoint and their
sizes and hashes matched the local build.

The outer installer now passes `/S` to the embedded Electron installer. This
prevents an unattended reinstall from waiting indefinitely on a hidden nested
installer window.

Fresh desktop logs showed the sidecar becoming ready without the previous extra
certificate warning. A renderer `ResizeObserver` warning remains non-fatal and
unrelated to model execution.

## Operational conclusions

- Reinstall the published EXE when desktop or installer code changes; server-side
  model changes alone do not require a client reinstall.
- Always test the source CLI with `OPENCODE_CONFIG_DIR` set. The global OpenCode
  configuration may select a public provider and invalidate the test.
- Do not increase the tool set for the 12B model without a measured regression
  run.
- A longer maximum loop cannot compensate for bad tool selection. It can turn a
  short failure into a long loop.
- Preserve general-purpose tools and fix capabilities through tested tools or
  skills instead of adding task-specific behavior to the system prompt.

## Remaining work

- Add a repeatable end-to-end benchmark covering plain chat, local files,
  spreadsheet extraction, script execution, web search, and artifact creation.
- Record stop reasons, tool errors, token usage, and elapsed time as structured
  telemetry so future regressions are visible without reading the UI transcript.
- Evaluate larger local models only against the same benchmark and hardware
  limits; do not switch based on model-card claims alone.

## 2026-08-21: action integrity and reliable Python execution

The latest failed production conversation was inspected directly as session
`ses_fe03a778bffewnp7GgVdkXnvF8`. The agent emitted progress claims for batches
through row 140 and then stopped at "starting the next batch", despite having no
successful mutation tool call. Independent inspection of
`Сорта_и_культуры.xlsx` found 1232 rows and zero populated cells in both target
columns. The old conversation therefore made no real progress.

This was fixed at the general agent-loop boundary rather than with an Excel
workflow. Semena now rejects a final response that merely promises future work
or claims an artifact mutation without a completed mutation tool. A mutation
still requires a later, independent read-only observation before success may be
reported. Recovery is bounded to two tool-error retries, two action-integrity
retries, and three mutation-audit retries. These invariants apply to files,
spreadsheets, documents, code, and other tool-driven work.

A dedicated `python` tool now sends multiline source over stdin in UTF-8 and
reports the real process exit code. This avoids the PowerShell `py -c` quoting
and encoding failure seen in the Excel session. Non-zero exits are converted by
the standard OpenCode tool adapter into tool errors. The tool is exposed only to
the Semena provider. The `task` tool was removed from the Semena allowlist, so
the product continues to use one agent without hidden subagent delegation.

The one-file installer now reuses the existing user-level
`SEMENA_AGENT_API_KEY` during reinstall. This fixed the unattended installer
waiting on an invisible credential prompt. The rebuilt installer completed a
local reinstall with exit code 0, and the installed `app.asar` contains version
`0.0.0-prod-202608211421`.

A live run through the real `semena-gemma4` gateway, session
`ses_fdcc06894ffeOwMjExdcB4fq2O`, selected `python`, created a UTF-8 file with
three requested Russian lines, independently reopened it with `read`, and only
then returned success. Host verification found exactly three lines and SHA-256
`0758B341FC853DA0208D2856FAA29EF976DAE533A058DFC4BB7A9342BB0E7860`.

Verification results:

```text
Focused OpenCode tests:                       424 passed
OpenCode TypeScript typecheck:                 passed
Semena deployment pytest suite:                32 passed
git diff --check:                              passed
```

The full OpenCode suite reported 3285 passes and eight unrelated Windows-only
failures: seven symlink tests lacked Windows Developer Mode/privilege, and one
pre-existing formatter expectation (`xAB` versus `x`) also failed when rerun in
isolation.

Published and downloaded back through the public HTTP endpoint:

```text
Semena-Agent-Setup-x64.exe
Size:    159334934 bytes
SHA-256: C704FE7E340BEEC5851D8B3DD2AA0FF35E7A4749CCE1DCA190A802A978596A26

SemenaOpenCodeSetup.zip
Size:    159368290 bytes
SHA-256: DCCCD52C9317A1E34A783385F67CC6B2A29FEA1CE7A7D2E06F0F93B524CDD914
```
