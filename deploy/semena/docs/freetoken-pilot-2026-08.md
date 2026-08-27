# FreeToken pilot for the Semena agent

Assessment dates: 2026-08-24 through 2026-08-27.

## Decision

`Qwen3.6-35B-A3B-NVFP4` is a materially better agent model than the current
12B Gemma integration: it selected native tools, recovered from a failed tool,
completed multi-turn OpenCode work, and verified its own mutations. It is a
viable production replacement.

Production was switched to FreeToken on 2026-08-24 after adding exclusive
runtime ownership: the FreeToken systemd unit conflicts with `ollama.service`,
the gateway proxies `/v1/` to port `1919`, and the firewall blocks direct access
to both local model ports from employee workstations. Ollama remains installed
only as an empty runtime shell: the old local Gemma/Qwen model catalog was
removed after the Qwen36 cutover, and `ollama.service` is inactive during
production service.

As of 2026-08-27 this is the stable Semena Agent runtime. The employee UI hides
the implementation name and shows the model as `Семена Агент`; the internal API
model id remains `semena/semena-qwen36`.

DeepSeek V4 Flash is not viable on this host: its expert pool needs roughly
140 GB of host RAM, while this machine has 32 GB. FreeToken does not turn an
undersized machine into a DeepSeek V4 host. Qwen3.6 35B-A3B is the useful target
because only about 3B parameters are active per token and its NVFP4 checkpoint
fits the available RAM.

## Installed pilot

- Host: `10.1.50.101`, Ubuntu 24.04, Ryzen 7 2700X, 32 GB RAM.
- GPU: RTX 5060 Ti 16 GB, PCIe Gen3 x8 negotiated.
- CUDA Toolkit: 13.0; the existing NVIDIA driver was preserved.
- FreeToken: 0.1.2 in `/home/installer/freetoken-pilot/.venv`.
- Model: `nvidia/Qwen3.6-35B-A3B-NVFP4`, 23.42 GB of safetensors.
- Production listener: `0.0.0.0:1919`, protected by `firewall.nft` and reached
  by the Docker gateway through `host.docker.internal`.

FreeToken also required Ubuntu's `python3.12-dev` package for Triton JIT. The
first Blackwell start compiled FlashInfer kernels for `sm_120`; later starts use
the generated cache.

## Hardware result

`ft bench bw --dtype nvfp4 --model qwen3.6-moe` measured:

| Measurement | Result |
| --- | ---: |
| CPU STREAM read | 33.55 GB/s |
| PCIe linear H2D / D2H | 7.23 / 7.15 GB/s |
| Qwen NVFP4 CPU MoE | 14.92 GB/s |
| Qwen NVFP4 PCIe gather | 6.71 GB/s |
| CPU / PCIe ratio | 2.224x |
| Selected backend | `hybrid` |

The complete compact result is in `freetoken/benchbw-qwen36.json`.

## API and context checks

All requests used `reasoning_effort: none`. Without it, Qwen spends the output
budget on reasoning and can return an empty visible answer. In OpenCode this is
configured per model as `options.reasoningEffort`, leaving the general Semena
agent prompt and tool policy unchanged.

| Check | Result |
| --- | --- |
| Plain completion | HTTP 200; exact answer |
| Native tool choice | valid `write_file` call and JSON arguments |
| Tool-result continuation | final answer only after successful tool result |
| Tool error | corrected path and emitted a second tool call |
| 23,031-token prompt | 21.56 s; exact end marker |
| 30,029-token prompt | 22.86 s; exact end marker |
| 49K stable baseline | `context_length=49152`; 40K-token marker prompt returned exact marker in 28.9 s |
| 57K production context | `context_length=57344`; 52,031-token marker prompt returned exact marker in 38.09 s |
| 57K near-limit prompt | 56,032 prompt tokens; exact marker in 40.9 s; 13.5 GiB VRAM used, 2.3 GiB free |
| Over-limit prompt | HTTP 400 in 0.21 s; no scheduler hang |

The 49K configuration is the stable rollback baseline. The 57K configuration is
the current production target after live tests on 2026-08-25. Its observed cost
is longer prefill latency on very large prompts: roughly 38-41 s for 52K-56K
prompt tokens versus 28.9 s for the previous 40K marker prompt. The observed
steady VRAM footprint remained around 13.5 GiB used with about 2.3 GiB free.

With Ollama already occupying 9.35 GiB VRAM, FreeToken created 639 expert cache
slots, used about 5.46 GiB, and had about 0.94 GiB free before serving. In an
exclusive run it created 5,059 slots, used 12.97 GiB, and retained 2.79 GiB
after initialization. The exclusive run returned a short answer in 2.86 s and
a native tool call in 3.96 s.

## OpenCode end-to-end checks

The source CLI used the real Semena provider ID, full upstream prompt, mandatory
`verify-work` skill, and the core tool set. The model received roughly 10K input
tokens per agent step.

1. It created a requested two-line file with `write`.
2. It called `read` in a separate turn, observed both exact lines, and only then
   returned success. Independent host inspection matched the tool output.
3. In the recovery scenario, the first `read` failed with `File not found`.
4. It selected `glob`, found the actual file, read the marker, wrote a result,
   read the result back, and then completed accurately.

This demonstrates model-selected tools and a real execution loop. No task-specific
Excel, filename, or command sequence was hardcoded into the model request.

## Safe reproduction

The pilot launcher refuses to start if an Ollama model or any CUDA compute
process is active:

```bash
systemctl start semena-freetoken-qwen36.service
```

For a Windows source-CLI test, select the production gateway config explicitly:

```powershell
$env:OPENCODE_CONFIG = (Resolve-Path 'deploy\semena\freetoken\opencode.pilot.json')
$env:SEMENA_AGENT_API_KEY = '<employee key>'
bun run --cwd packages/opencode --conditions=browser src/index.ts run --pure --auto `
  --model semena/semena-qwen36 --dir C:\path\to\isolated-workspace 'your task'
```

Rollback to Ollama now requires explicitly pulling or rebuilding a model first.
Stop FreeToken before loading any Ollama model, then verify `/api/ps`,
`nvidia-smi`, the runtime API, and `https://127.0.0.1:8443/health`.

## Open WebUI model list

Open WebUI runs separately from the OpenCode gateway. After the Qwen36 cutover,
its runtime settings were cleaned so the chat model picker is no longer backed
by the deleted Ollama catalog:

- `DEFAULT_MODELS=semena-qwen36`;
- `ENABLE_OLLAMA_API=false`;
- `OLLAMA_BASE_URL=` empty;
- `ENABLE_OPENAI_API=true`;
- `OPENAI_API_BASE_URL=http://172.17.0.1:1919/v1`.

The active `webui.db` config now pins `models.default`, `ui.default_models`,
`ui.default_pinned_models`, and `ui.model_order_list` to `semena-qwen36`.
Open WebUI's built-in arena picker is disabled with `evaluation.arena.enable=false`.
The previous database was backed up as
`webui.before_qwen36_only_20260824_170009.db` before the cleanup.

## Production status

The Windows client config now points only at `semena/semena-qwen36` and displays
that model as `Семена Агент`. The old model aliases are intentionally absent
from the employee picker.

Keep one running request and explicit 57K KV capacity until soak tests prove
higher context or concurrency safe. Use the 49K launcher backup as the runtime
rollback point if long-prefill latency or FreeToken beta behavior regresses.

Startup/request watchdogs remain useful follow-up work for FreeToken beta
failure modes: backend death, over-capacity prompts, and stalled prefill.

References: [FreeToken](https://github.com/FlashML-org/FreeToken),
[Qwen3.6 NVFP4](https://huggingface.co/nvidia/Qwen3.6-35B-A3B-NVFP4), and known
beta issues [#110](https://github.com/FlashML-org/FreeToken/issues/110),
[#111](https://github.com/FlashML-org/FreeToken/issues/111), and
[#72](https://github.com/FlashML-org/FreeToken/issues/72).
