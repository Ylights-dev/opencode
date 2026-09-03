# Stable Semena Agent Build

Stable date: 2026-09-03.

Current stable runtime note: the production Open WebUI entry point is the normal
password-based route at `http://ai.semena.local/` and direct fallback
`http://10.1.50.101:3000/`. Domain SSO/Kerberos is not enabled on the main
route after the 2026-09-03 rollback; future SSO work must use a separate test
route so the stable user entry point is not broken again.

Post-SSO-rollback runtime snapshot:
`20260903-153016-stable-webui-restored-after-sso-rollback-2026-09-03`.

Live runtime snapshot: `20260901-084230-model-access-fix-2026-09-01`.

Pre-model-access rollback snapshot: `20260901-083501-pre-model-access-fix-2026-09-01`.

Pre-registration-flow rollback snapshot: `20260901-081955-pre-registration-flow-2026-09-01`.

Pre-context-guard rollback snapshot: `20260831-160052-pre-context-guard-2026-08-31`.

User pilot snapshot: `20260830-170319-stable-user-pilot-2026-08-30` (same
model runtime plus cumulative per-user quality logs and the employee guide).

## Source

- Git tag: `semena-stable-2026-08-27`
- Stable commits included:
  - `65e8f4ccd3` - expose MCP tool catalog to Semena models
  - `24051287cd` - prefer MCP tools for 1C investigations
  - `1d5b23fd8e` - hide Semena model implementation name

## Runtime

- User-visible model: `Семена Агент`
- Internal model id: `semena/semena-qwen36`
- Gateway: `https://10.1.50.101:8443/v1`
- FreeToken service: `semena-freetoken-qwen36.service`
- Context: `57344`
- Output: `4096`
- Context safety reserve: `12288`
- Tool output cap: `20000` bytes
- Native thinking mode: disabled

## MCP

- `semena_1c`: `http://10.1.50.40:3000/sse`
- `semena_image`: `http://10.1.50.40:3003/sse`

## Stable Client Policy

- Keep only the `semena` provider and `semena-qwen36` model in employee configs.
- Do not expose implementation names such as Qwen, Gemma, parameter count, or quantization in the normal UI.
- Use `semena_1c_*` for 1C configuration questions.
- Use `semena_image_image_*` for image operations.
- Verify every changed artifact before reporting success.
- Preserve automatic compaction and the manual `Сжать контекст`/`/compact` recovery path.
- Publish only `Semena-Agent-Setup-x64.exe`; registration in Open WebUI must precede installation.

## Verification

```powershell
python -m unittest deploy.semena.tests.test_platform
bun test test/session/system.test.ts
```

## Runtime rollback

The production host has an independent rollback utility. The current stable
snapshot contains the Open WebUI database, Semena Agent and OpenCode deployment
trees, FreeToken launcher and service unit, persistent agent data, container
definitions, and immutable tags for the running Docker images.

```bash
sudo semena-stable list
sudo semena-stable verify 20260830-101818-stable-2026-08-30
sudo semena-stable restore 20260830-101818-stable-2026-08-30
```

The restore command above is a dry run. Add `--apply` only after reviewing the
target. An applied restore automatically creates a `pre-restore` snapshot
before stopping any service. Snapshots are root-only under
`/var/backups/semena-agent`.
