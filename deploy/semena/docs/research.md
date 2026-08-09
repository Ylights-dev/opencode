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
- OpenCode permissions can deny external paths, but a live test showed that a
  model may retry a denied `read` through `bash`. The employee profile therefore
  denies `bash` completely instead of relying only on `external_directory`.

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

`qwen3.5:9b` was installed as `semena-code` with a 16384-token context and low
temperature. After adding explicit guidance about OpenCode's line-number display
and edit argument names, it passed three independent edit cases and the external
directory boundary test through the authenticated TLS gateway.

## Decision

Use OpenCode locally on each employee PC and connect it to the authenticated
gateway on `10.1.50.101:8443`. A local OpenCode process is required because a
central OpenCode server cannot see employee-local files and does not isolate
employee sessions.

Do not deploy OpenClaw in the employee request path. Do not expose Ollama port
11434 to employee workstations.

## Remaining product boundary

This deployment proves the agent loop, local file edits, identity, revocation,
TLS, and network isolation. OpenCode does not automatically reproduce the old
agent's domain-specific Excel, Word, registry, SQL, and 1C operations. Those
capabilities should be migrated as narrowly scoped tools or skills with their own
tests; arbitrary shell access stays disabled in the employee profile.
