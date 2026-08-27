# OpenCode, OpenClaw, And Model Research

Updated: 2026-08-27.

## Harness Decision

Use the Semena OpenCode fork locally on each employee PC. Do not put OpenClaw in the employee request path.

OpenClaw can dispatch OpenCode through ACP, but its documented boundary is one trusted operator per gateway. It does not solve employee identity, local workspace access, or tenant isolation for this deployment.

## Current Stable Model

The stable model is:

```text
Internal id:   semena/semena-qwen36
User label:    Семена Агент
Runtime:       FreeToken
Context:       57344 tokens
Output:        4096 tokens
```

The exact model family and parameter count are intentionally not shown in the normal UI. They remain implementation details.

## Rejected Or Superseded Models

These variants were evaluated during the project and are not part of the stable employee picker:

- `qwen3.5:9b` / `semena-code` - could pass some edit cases but failed broader tool-use and Excel scenarios.
- `qwen3:14b` - failed the strict spreadsheet/tool-use evaluation.
- `qwen3:30b-a3b` - failed earlier with low context and later still made unreliable tool decisions.
- `qwen3-coder:30b` - searched correctly in some cases but generated incorrect demo-like scripts in production-style tasks.
- `semena-assistant` old alias - removed from the stable picker.
- `gemma4:12b` / `semena-gemma4` - useful earlier baseline, now superseded by FreeToken Qwen36.
- Muse Glimmer 30B - promising model card, but not deployable on the supported inference stack at the time of testing.
- DeepSeek V4 Flash - not viable on the current 32 GB RAM host.

## Why Qwen36/FreeToken Stayed

The current FreeToken runtime showed materially better local-agent behavior:

- native tool selection;
- recovery after failed tool calls;
- verified file mutation loop;
- large-context marker tests up to the selected 57K production context;
- successful OpenCode MCP catalog exposure and 1C tool calls.

The selected setup is still constrained to one running request and explicit context capacity until longer soak tests justify higher concurrency.

## 1C Direction

1C functionality must be handled through the existing MCP server, not through ad hoc local filesystem exploration. The stable client exposes `semena_1c_*` tools and instructs the model to use them as the authoritative source for 1C metadata, modules, registers, and BSL code.

The weather investigation in `ЗаданиеНаПеревозку` demonstrated the intended path: search and inspect through MCP, then answer from observed configuration facts.

## Remaining Product Boundary

This deployment proves the general local agent loop: local files, scripts, spreadsheets, MCP tools, identity, revocation, TLS, and network isolation.

Domain-specific business workflows should continue to move into tools or skills with their own tests. Do not hardcode task-specific scripts into the model prompt.
