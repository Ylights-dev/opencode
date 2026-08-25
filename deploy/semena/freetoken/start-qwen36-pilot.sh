#!/usr/bin/env bash
set -euo pipefail

root="${FREETOKEN_ROOT:-/home/installer/freetoken-pilot}"
model="${FREETOKEN_MODEL:-$root/models/Qwen3.6-35B-A3B-NVFP4}"
python="$root/.venv/bin/python"
ft="$root/.venv/bin/ft"

for path in "$python" "$ft" "$model/config.json"; do
  if [[ ! -e "$path" ]]; then
    echo "FreeToken pilot prerequisite is missing: $path" >&2
    exit 2
  fi
done

# The 16 GiB GPU cannot safely host this runtime and an Ollama model together.
ollama_models="$({ curl -fsS --max-time 3 http://127.0.0.1:11434/api/ps || echo '{"models":[]}'; } | \
  "$python" -c 'import json,sys; print(len(json.load(sys.stdin).get("models", [])))')"
if [[ "$ollama_models" != "0" ]]; then
  echo "Refusing to start: unload all Ollama models first (Ollama service may stay running)." >&2
  exit 3
fi

gpu_apps="$(nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader,nounits 2>/dev/null || true)"
if [[ -n "$gpu_apps" ]]; then
  echo "Refusing to start while another CUDA compute process owns the GPU:" >&2
  echo "$gpu_apps" >&2
  exit 4
fi

export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-13.0}"
export PATH="$root/.venv/bin:$HOME/.local/bin:$CUDA_HOME/bin:$PATH"

exec "$ft" serve \
  --model-path "$model" \
  --served-model-name semena-qwen36 \
  --host "${FREETOKEN_HOST:-0.0.0.0}" \
  --port "${FREETOKEN_PORT:-1919}" \
  --max-running-requests 1 \
  --max-seq-len-override 57344 \
  --max-output-tokens 4096 \
  --max-prefill-length 4096 \
  --memory-ratio 0.80 \
  --num-tokens 57344 \
  --kv-reserve-tokens 57344 \
  --cache-type radix \
  --moe-backend hybrid \
  --moe-cache-auto \
  --expert-load serial \
  --cuda-graph-max-bs 1 \
  --tool-call-parser auto \
  --reasoning-parser auto \
  --sampling-defaults model \
  --enable-cache-report
