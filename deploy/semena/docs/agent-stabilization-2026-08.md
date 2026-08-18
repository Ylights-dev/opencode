# Semena Agent stabilization report

Assessment and implementation date: 2026-08-17.

## Scope

This report records the failures observed while adapting OpenCode Desktop to the
local `semena-gemma4` model, the implemented corrections, and the checks required
before publishing a Windows installer.

The changes are deliberately provider-scoped. Upstream OpenCode behavior for
other providers remains unchanged.

## Observed failures

The failures initially looked like insufficient model capability, but several
were integration defects:

- the Semena request enabled or preserved reasoning fields that consumed the
  response budget and exposed internal reasoning instead of completing work;
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

### Semena request normalization

For the `semena` OpenAI-compatible provider, requests now explicitly set:

```json
{
  "reasoning_effort": "none",
  "think": false
}
```

The values are applied both at provider-option transformation and immediately
before `/chat/completions` is sent. The second layer protects against SDKs that
drop provider-specific options.

### Provider-scoped tool set

The Semena model receives only the core tools needed for local agent work:

```text
bash, edit, glob, grep, list, lsp, read, skill, task,
todowrite, webfetch, websearch, write
```

External MCP and plugin tools are omitted only for the Semena provider. This
reduces prompt size and tool-choice ambiguity without disabling OpenCode
extensions globally.

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
- `reasoning_effort: none`;
- `think: false`;
- 10 active core tools and no unrelated 1C/video tools.

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

1. A no-tool prompt returned exactly `OK` with zero reasoning tokens.
2. From the employee workspace, the agent found `Аэлита вес.xls` with `glob`,
   read it with the built-in spreadsheet-aware `read` tool, and returned
   `TDSheet, 1374, 22` without creating files.

### Automated checks

```text
Semena provider tests:                         3 passed
Spreadsheet read regression:                  1 passed
OpenCode TypeScript typecheck:                passed
Semena deployment pytest suite:              29 passed
Web-search tool tests from the prior build:  10 passed
```

## Build and publication

The one-file Windows installer was rebuilt, installed locally, launched, and
published at:

```text
http://10.1.50.101:3010/downloads/Semena-Agent-Setup-x64.exe
```

Published artifact:

```text
SHA-256: C9ADB94A24F63EF643BF1BDFCF4DCB8B2D68E0C6619AB9D202EFBA93D496DAC9
Size: approximately 152 MiB
```

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
