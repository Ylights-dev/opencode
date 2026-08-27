# Semena Agent Architecture

Updated: 2026-08-27.

## Stable Decision

Use the Semena OpenCode fork as the only employee agent harness. OpenClaw stays outside the employee path.

The stable production model is exposed to users as `Семена Агент`. The internal model reference remains `semena/semena-qwen36` so the gateway and stored sessions keep a stable technical id.

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

## Security Boundary

- One API key per employee.
- Passwords are checked during enrollment and are not stored by the installer.
- FreeToken is not exposed as an employee-facing endpoint.
- OpenCode asks before accessing external directories.
- MCP 1C access is read-oriented for investigation; do not mutate production 1C data through generic calls.

## Rollback

The stable source point is the git tag `semena-stable-2026-08-27`. Rollback means restoring that tag and reinstalling the matching `Semena-Agent-Setup-x64.exe`. Old Gemma/Ollama model catalogs are not part of the stable rollback path.
