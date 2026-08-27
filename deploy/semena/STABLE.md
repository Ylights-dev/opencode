# Stable Semena Agent Build

Stable date: 2026-08-27.

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

## MCP

- `semena_1c`: `http://10.1.50.40:3000/sse`
- `semena_image`: `http://10.1.50.40:3003/sse`

## Stable Client Policy

- Keep only the `semena` provider and `semena-qwen36` model in employee configs.
- Do not expose implementation names such as Qwen, Gemma, parameter count, or quantization in the normal UI.
- Use `semena_1c_*` for 1C configuration questions.
- Use `semena_image_image_*` for image operations.
- Verify every changed artifact before reporting success.

## Verification

```powershell
python -m unittest deploy.semena.tests.test_platform
bun test test/session/system.test.ts
```
