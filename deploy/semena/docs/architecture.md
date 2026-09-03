# Semena Agent Architecture

Updated: 2026-08-31.

## Stable Decision

Use the Semena OpenCode fork as the only employee agent harness. OpenClaw stays outside the employee path.

The stable production model is exposed to users as `Семена Агент`. The internal model reference remains `semena/semena-qwen36` so the gateway and stored sessions keep a stable technical id.

Open WebUI follows the same public naming rule: response headers and the model
selector use `Семена Агент`; the backend id is retained only for routing. Its
visible conversations are read from Open WebUI and retained in one cumulative
JSONL archive per user. Messages already exported remain available for quality
analysis even if the source chat is later deleted. Ratings, reasons and comments
are attached to the rated answer; deleted rated exchanges are recovered from
Open WebUI's feedback snapshot. The protected Semena admin panel can search,
inspect and download these files and highlights negative ratings. Hidden model
reasoning, system prompts and credentials are excluded.

The current Open WebUI model has a wildcard authenticated-user read grant.
Branding migration also removes orphan grants and replaces legacy Semena model
ids in per-user UI settings, so accounts created before a model-id migration
retain a working model selector.

The employee onboarding guide is available at
`http://10.1.50.101:3010/guide.html` and linked from the Open WebUI banner,
download page and installation instructions. It links to separate example
pages for logistics, sales, accounting, procurement and stocktaking/audit; the
general examples remain on the main guide.

Employees register through the existing Open WebUI account flow at
`http://10.1.50.101:3000/auth` before installing the desktop client. The same
email and password are used by the installer to enroll the client. The only
supported download is `Semena-Agent-Setup-x64.exe`; legacy ZIP, portable,
executor, and separate admin clients are not published.

The employee agent is general-purpose. Its Semena-specific system layer removes the upstream coding-only topic and URL framing; domain questions are not rejected merely for being outside software engineering. Tool permissions and result-verification rules remain independent from topic scope.

Persistent memory is local and per Windows user. It is stored in `data/semena-memory.json`, exposed only to the Semena provider through `memory_list`, `memory_save`, and `memory_forget`, and injected as bounded untrusted background data. The store is limited to 40 concise entries and 9,000 prompt characters. Missing or malformed memory fails open and does not block the agent loop.

Context protection is enforced by the client rather than by changing model weights. The runtime keeps its 57,344-token physical window, while OpenCode reserves 12,288 tokens for the next response and tool result, limits a single tool result to 20,000 bytes, and compacts older turns automatically. Qwen thinking is disabled with the runtime-native `chat_template_kwargs.enable_thinking=false`; `reasoningEffort=none` alone is not sufficient for the OpenAI-compatible FreeToken endpoint. Users can force the same safe compaction from the context panel or with `/compact`.

## Runtime Flow

```text
Employee Windows account
  -> Семена - Агент Desktop
  -> local OpenCode sidecar
  -> per-user Semena/Open WebUI API key
  -> TLS gateway https://10.1.50.101:8443/v1
  -> FreeToken on 10.1.50.101:1919
  -> semena-qwen36, 57344-token context
```

OpenCode runs locally on the employee computer so file, spreadsheet, shell, and document tools operate on that employee workspace. The model runtime is centralized and authenticated; employees do not connect directly to FreeToken.

## Active Services

- Model gateway: `https://10.1.50.101:8443/v1`.
- FreeToken runtime: `semena-freetoken-qwen36.service`.
- 1C MCP: `http://10.1.50.40:3000/sse`.
- Image MCP: `http://10.1.50.40:3003/sse`.
- Download endpoint: `http://10.1.50.101:3010/downloads/Semena-Agent-Setup-x64.exe`.

## Client Contract

- Only provider `semena` is enabled in the employee config.
- Only model `semena-qwen36` is configured for the employee client.
- UI display name is `Семена Агент`; implementation names such as Qwen/Gemma/parameter count are hidden from normal users.
- 1C tasks should use `semena_1c_*` MCP tools as the authoritative source. The agent must not inspect AppData or exported 1C cache folders unless the user explicitly asks for filesystem work or MCP cannot provide the data.
- Image tasks should use `semena_image_image_*` tools and verify returned status, output path, URL, and hash before claiming success.
- Automatic compaction remains enabled. Keep `compaction.reserved` at least 12,288 and `tool_output.max_bytes` at most 20,000 unless a measured load test justifies a change.
- Manual recovery is available through the `Сжать контекст` button in the context panel and the `/compact` command.

## Security Boundary

- One API key per employee.
- Passwords are checked during enrollment and are not stored by the installer.
- FreeToken is not exposed as an employee-facing endpoint.
- OpenCode asks before accessing external directories.
- MCP 1C access is read-oriented for investigation; do not mutate production 1C data through generic calls.

## Rollback

The stable source point is the git tag `semena-stable-2026-08-27`. Rollback means restoring that tag and reinstalling the matching `Semena-Agent-Setup-x64.exe`. Old Gemma/Ollama model catalogs are not part of the stable rollback path.
