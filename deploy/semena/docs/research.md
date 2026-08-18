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

The live OpenCode regression was also repeated with `qwen3:30b-a3b` and the
official `qwen3-coder:30b`. Both models used a 16384-token context. The first
created a script with a hard-coded year instead of using registry evidence. The
coder model explored the official site but then generated demo scripts that
returned `нету` for every row. Neither model is safe as the employee default.

Muse Glimmer 30B remains relevant to this product because it is positioned for
autonomous local agents, reliable tool use, multi-step reasoning, and failure
recovery. The 19 GB `UD-Q4_K_XL` GGUF was downloaded and tested on 2026-08-11,
but Ollama 0.30.10 terminated before inference with `unknown model
architecture: 'muse-glimmer'`. It therefore cannot be evaluated or deployed on
the current supported inference stack. Do not replace Ollama solely for this
candidate until its architecture is supported and the same tool-use evaluation
passes.

The OpenCode fork now keeps the employee's original request in durable session
metadata, carries it through compaction, and checks completion against tool
evidence. Tasks that require current external data, a changed artifact, and
verification must perform those phases in that order. Repeated inspection is
interrupted by a bounded progress watchdog. A helper script, a failed command,
or an unverified file is no longer accepted as the requested result. These are
model-independent orchestration guards; they do not add a registry-specific
workflow or replace the model's general reasoning.

## Decision

Use OpenCode locally on each employee PC and connect it to the authenticated
gateway on `10.1.50.101:8443`. A local OpenCode process is required because a
central OpenCode server cannot see employee-local files and does not isolate
employee sessions.

Do not deploy OpenClaw in the employee request path. Do not expose Ollama port
11434 to employee workstations.

## DeepSeek Harness follow-up

Follow-up assessment date: 2026-08-18.

The name "DeepSeek Harness" currently refers to multiple unrelated projects.
The protocol adapter at `HenryZ838978/deepseek-harness` primarily preserves
DeepSeek V4 `reasoning_content`, streaming tool-call indexes, and cache behavior;
it is not a replacement desktop coding agent. Those protocol corrections do not
improve the Gemma-based `semena-gemma4` model.

The former `morlay/deepseek-harness` project now points to `morlay/playpen`. Its
agent loop has useful ideas: a compact tool set, up to 200 tool turns, orphaned
tool-call recovery, profiles, and an OpenAI-compatible endpoint. It is not yet a
drop-in corporate Windows replacement: the current source has no Windows release,
expects a Rust/MSVC build environment, uses Unix-oriented configuration path
fallbacks, and documents its OS sandbox primarily for macOS.

The official `deepseek-ai/awesome-deepseek-agent` repository is a catalog of
integrations, not an official standalone DeepSeek Harness. It lists OpenCode
alongside Pi, DeepSeek-TUI/CodeWhale, Reasonix, and other clients.

CodeWhale (formerly DeepSeek-TUI) is the most credible future comparison because
it provides Windows binaries, a Windows sandbox, session recovery, an HTTP
runtime, local OpenAI-compatible providers, and recursive large-input tooling.
It remains optimized for DeepSeek V4. Its DeepSeek-specific advantages do not
automatically transfer to a local Gemma 12B model.

Decision: keep the Semena OpenCode fork as the production harness. The useful
harness properties identified during this review--a small provider-scoped tool
set, disabled hidden reasoning, durable sessions, and explicit verification--are
already present in the current fork. Consider CodeWhale only as an isolated A/B
benchmark candidate, using the same Semena model, gateway, workspace, prompts,
and pass/fail criteria.

## Remaining product boundary

This deployment proves the agent loop, local file edits, identity, revocation,
TLS, script execution, and network isolation. OpenCode does not automatically reproduce the old
agent's domain-specific Excel, Word, registry, SQL, and 1C operations. Those
capabilities should be migrated as narrowly scoped tools or skills with their own
tests; arbitrary shell access is available in the active project workspace.
