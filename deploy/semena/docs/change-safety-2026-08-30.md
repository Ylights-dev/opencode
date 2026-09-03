# Semena Agent change safety

Updated: 2026-08-30.

## Protected production point

The live production contour was captured without restarting the model or user
services as `20260830-101818-stable-2026-08-30`. Independent verification
passed for all payload checksums, SQLite integrity, and retained Docker images.
The restore preflight also passed in dry-run mode.

## Why earlier changes degraded the agent

The model weights were not the main cause. Most regressions came from changing
several orchestration layers at once:

1. The fork accumulated special auto-continue, progress watchdog, task-phase,
   forced-tool, output-truncation, and compaction behavior. The later
   `addd962144 Remove Semena loop overrides` commit removed 389 lines from the
   session loop. Those overrides injected synthetic instructions repeatedly,
   enlarged context, and replaced the model's general tool choice with brittle
   task heuristics.
2. Open WebUI maintenance scripts addressed the retired
   `semena-assistant:latest` row while production uses `semena-qwen36`. This
   made some changes no-ops and allowed different interfaces to receive
   different policies under the same public product name.
3. Old Open WebUI scripts combined a long, task-specific system prompt with a
   broad capability shutdown. The prompt mentioned Excel order-plan details and
   forced bridge routing, while MCP availability was determined elsewhere. A
   missing or unauthorized tool therefore left the model with instructions it
   could not satisfy.
4. Context pressure was treated as a context-window problem even when repeated
   synthetic turns and skipped compaction were consuming the window. Increasing
   the limit reduced overflow frequency but did not correct the loop. The 57K
   runtime is valid, but near-limit prefill is observably slower.
5. Tool success and task success were conflated. A zero exit code, an empty
   shell result, or a proposed script could be reported as a completed file
   mutation. The stable fork now uses narrow error recovery and a separate
   read-only mutation audit instead of a task-specific workflow engine.
6. FreeToken requires `reasoning_effort: none` for this model in the current
   serving path. Without it, the output budget can be consumed by reasoning and
   the user receives little or no visible answer.

The active Open WebUI `semena-qwen36` row currently has an empty system prompt.
Its stable general-chat behavior therefore does not depend on the legacy
Open WebUI prompt scripts. The OpenCode client adds only a narrow Semena overlay
to the upstream prompt and exposes real tool schemas dynamically.

## Required change procedure

1. Create and verify a named production snapshot.
2. Change one layer only: model runtime, OpenCode loop, prompt, MCP, Open WebUI,
   or desktop client.
3. Keep production users on the stable contour and expose the candidate to a
   separate test configuration.
4. Run the same factual tasks against stable and candidate, including a failed
   tool, a real file mutation with independent verification, long context, and
   a 1C MCP request.
5. Promote only a measured improvement. Otherwise restore the named snapshot.

Do not reintroduce generic auto-continue phases, task-specific routing in the
session loop, or a growing system prompt as a substitute for reliable tool
state. Verification belongs in the runtime; domain choice belongs to the model
and the tools it actually receives.
