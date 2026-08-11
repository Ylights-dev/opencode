# OpenCode and OpenClaw assessment

Assessment date: 2026-08-09.

## OpenCode

- Upstream: https://github.com/anomalyco/opencode
- License: MIT.
- Evaluated release: 1.18.15.
- Supports Ollama through an OpenAI-compatible provider and exposes terminal,
  desktop, headless server, and web clients.
- The built-in network authentication is one Basic Auth username/password for a
  server. It is not employee identity or workspace isolation.
- OpenCode permissions can deny or ask for external paths. The employee profile
  now allows shell/scripts and the built-in agent tools inside the active project
  because the product requirement is full local automation in the selected
  working folder. Access outside that folder remains an explicit prompt through
  `external_directory`.

## OpenClaw

- Upstream: https://github.com/openclaw/openclaw
- License: MIT.
- OpenClaw can launch OpenCode through the official ACPX backend.
- Its security documentation explicitly defines one trusted operator boundary
  per Gateway and says it is not a hostile multi-user tenant boundary. Separate
  gateways and preferably separate OS users or hosts are required for different
  trust boundaries.
- Adding OpenClaw between employees and OpenCode would add another privileged
  gateway without solving company authentication. It remains a possible isolated
  administrator channel, not part of this employee deployment.

## Live model evaluation

`qwen3:30b-a3b` with the previous 4096-token runtime context failed the strict
edit test: it confused the workspace path and wrote an empty file elsewhere.

`qwen3.5:9b` was initially installed as `semena-code` with a 16384-token context and low
temperature. After adding explicit guidance about OpenCode's line-number display
and edit argument names, it passed three independent edit cases and the external
directory boundary test through the authenticated TLS gateway.

On 2026-08-11 the live Excel/tool-use failure was reproduced with a dedicated
Ollama tool-calling evaluation. `qwen3.5:9b`, `qwen3:14b`, `qwen3:30b-a3b`, and
`semena-assistant` all failed to produce the expected verified top-level Excel
list. `gemma4:12b` passed the same scenario through Ollama and then through the
authenticated TLS gateway. The employee client now selects the `semena-gemma4`
Ollama alias so the runtime keeps Gemma's renderer/parser while forcing a
16384-token context instead of the default 4096-token slot.

Muse Glimmer 30B is relevant to this product because it is positioned for
autonomous local agents, reliable tool use, multi-step reasoning, and failure
recovery. It is not the current production default because the Ollama build
available on 2026-08-11 required a newer prerelease Ollama on our server, and
the GGUF package is too close to the 16 GB GPU memory ceiling for a conservative
employee rollout. Keep it on the next model-evaluation pass once NVIDIA support
is stable.

## Decision

Use OpenCode locally on each employee PC and connect it to the authenticated
gateway on `10.1.50.101:8443`. A local OpenCode process is required because a
central OpenCode server cannot see employee-local files and does not isolate
employee sessions.

Do not deploy OpenClaw in the employee request path. Do not expose Ollama port
11434 to employee workstations.

## Remaining product boundary

This deployment proves the agent loop, local file edits, identity, revocation,
TLS, script execution, and network isolation. OpenCode does not automatically reproduce the old
agent's domain-specific Excel, Word, registry, SQL, and 1C operations. Those
capabilities should be migrated as narrowly scoped tools or skills with their own
tests; arbitrary shell access is available in the active project workspace.
