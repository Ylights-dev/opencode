# Semena Agent Stabilization

Updated: 2026-08-27.

## Stable Status

The Semena OpenCode fork is stable for the current production contour:

- local Desktop agent on employee Windows machines;
- single visible model `Семена Агент`;
- internal model id `semena/semena-qwen36`;
- FreeToken backend with 57344-token context;
- mandatory self-verification skill;
- working MCP tool catalog for 1C and image operations.

## Fixed Failure Classes

Earlier failures were not only model quality issues. The agent loop and integration also allowed bad behavior:

- the model could claim a file was edited without a real mutation;
- shell/Python quoting on Windows caused silent no-op behavior;
- tool errors could be summarized as success;
- MCP tools were available in runtime but not obvious enough to the local model;
- the model sometimes tried to discover MCP tools through PowerShell;
- after correct 1C MCP calls, the model could drift into AppData and local exported cache folders.

## Current Safeguards

- Semena keeps the upstream OpenCode prompt and adds a narrow Semena overlay.
- The model receives full tool descriptions and schemas.
- A completed mutation must be followed by a read-only verification before success is reported.
- Tool errors are authoritative.
- The `verify-work` skill is loaded automatically for Semena turns.
- The `python` tool executes UTF-8 multiline code reliably through stdin.
- MCP tool names are listed in system context under `<available_tools>`.
- The prompt explicitly says MCP tools are model tools, not shell commands.
- For 1C questions, `semena_1c_*` tools are authoritative; shell/read/glob/grep against AppData or exported 1C folders are discouraged unless explicitly requested or MCP fails.

## Active Tool Policy

Core local tools remain available because employees need real local automation:

```text
bash, edit, glob, grep, list, lsp, python, read, task,
todowrite, webfetch, websearch, write
```

MCP tools are allowed by prefix:

```text
semena_1c_*
semena_image_image_*
```

The product currently uses one primary agent. Hidden subagent delegation is not required for the stable Semena path.

## Verified 1C MCP Behavior

On 2026-08-27 the build agent prepared 64 tools, including the `semena_1c_*` catalog, and successfully called `semena_1c_list_configs`.

Observed configurations:

```text
KA
Производство
Розница
Торговля
```

The earlier "1C tools are not shell commands" failure is fixed. The remaining risk was model drift into local cache paths; this is now addressed in the Semena prompt policy.

## Stable Verification Commands

```powershell
python -m unittest deploy.semena.tests.test_platform
bun test test/session/system.test.ts
```

Expected MCP check:

```text
semena_1c connected
semena_image connected
```

## Operational Notes

- Reinstall the Windows app after source changes to Desktop, session, provider, tool, installer, or bundled config code.
- Pure server-side model/runtime changes do not require a client reinstall if the API contract and model id stay unchanged.
- Do not expose old model names in UI. Keep the user-facing label `Семена Агент`.
- Do not add old Ollama/Gemma/Qwen variants back to the employee model picker without a measured regression pass.
