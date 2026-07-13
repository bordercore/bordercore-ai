# GPU service systemd units

User-scope units for the TTS and inference engines:

| Unit                        | Engine     | Host         | Runtime                                          |
|-----------------------------|------------|--------------|--------------------------------------------------|
| `kokoro-tts.service`        | Kokoro     | wumpus       | `~/dev/bordercoreai/.venv/bin/python`            |
| `chatterbox-tts.service`    | Chatterbox | deepvirtual  | `~/dev/bordercoreai/tts/chatterbox_tts/.venv/bin/python` (isolated 3.11 venv) |
| `qwen3-tts.service`         | Qwen3      | deepvirtual  | `~/dev/envs/bordercoreai/bin/python`             |
| `vllm.service`              | vLLM       | deepvirtual  | Pinned `vllm/vllm-openai` Docker image           |
| `llama-cpp.service`         | llama.cpp  | deepvirtual  | Pinned official CUDA server image                 |

The three TTS units listen on port 5001 and carry `Conflicts=` entries naming
the other two, so starting one automatically stops the others (mutex). Only one
TTS engine runs at a time by design.

## Install

Edit the files in this directory on wumpus; watchman syncs them to
deepvirtual. On each host, symlink the relevant unit(s) into
`~/.config/systemd/user/` and reload systemd.

### wumpus (kokoro only)

```sh
mkdir -p ~/.config/systemd/user
# If an older kokoro-tts.service exists as a real file, delete it first:
rm -f ~/.config/systemd/user/kokoro-tts.service
ln -s ~/dev/bordercoreai/deploy/linux/systemd/kokoro-tts.service \
      ~/.config/systemd/user/kokoro-tts.service
systemctl --user daemon-reload
systemctl --user enable --now kokoro-tts
```

### deepvirtual (chatterbox + qwen3)

```sh
mkdir -p ~/.config/systemd/user
for unit in chatterbox-tts qwen3-tts; do
    ln -s ~/dev/bordercoreai/deploy/linux/systemd/$unit.service \
          ~/.config/systemd/user/$unit.service
done
systemctl --user daemon-reload
# Start whichever you want running; the other will be stopped automatically
# if/when you start it:
systemctl --user enable --now qwen3-tts
```

### deepvirtual managed inference services

The service runs one allow-listed checkpoint at a time on the loopback-only
OpenAI-compatible endpoint `http://127.0.0.1:8001/v1`. The included profiles
cover Qwen3 8B/14B, Qwen3.5 4B/9B, Qwen2.5 7B Instruct/Coder,
Qwen2.5-VL 3B/7B, and Llama 3 Instruct; Qwen3 8B is the default. Profiles use
at most 55% of the RTX 3090's memory except Qwen3.5 9B AWQ, which needs 60% to
leave usable KV cache after its mixed quantized and unquantized weights load.
The Docker image is pinned by digest and currently contains vLLM 0.25.0 and
Transformers 5.13.0. The unit persists vLLM's compilation cache under
`~/.cache/vllm` so subsequent starts avoid recompiling unchanged model graphs.

The on-demand llama.cpp service exposes Qwen3.6 27B GGUF on
`http://127.0.0.1:8002/v1`. It conflicts with vLLM and the deepvirtual GPU TTS
units because the fully offloaded checkpoint uses about 17.7 GB. The shared
`model-engine` command records the active engine, verifies the replacement's
model identity and completion, and restores the previous engine after failure.

### Model inventory and resource boundary

A checkpoint is considered a comfortable single-GPU fit when it loads with no
more than 60% of the RTX 3090 under the standard 8K context and two-sequence
settings, without CPU offload or tensor parallelism. Every checkpoint meeting
that boundary has a managed profile and has passed an appropriate smoke test:

| Checkpoint | Disk size | Managed | Smoke test |
|------------|-----------|---------|------------|
| Llama 3 Instruct AWQ | 5.4 GB | Yes | Text passed |
| Qwen2.5-VL 3B Instruct AWQ | 6.4 GB | Yes | Vision passed |
| Qwen3.5 4B BF16 | 8.8 GB | Yes | Text and vision passed |
| Qwen2.5 7B Instruct AWQ | 11 GB | Yes | Text passed |
| Qwen2.5 Coder 7B Instruct AWQ | 11 GB | Yes | Code passed |
| Qwen3 8B AWQ | 12 GB | Yes | Text passed |
| Qwen3.5 9B AWQ | 12 GB | Yes | Text and vision passed at 60% VRAM cap |
| Qwen2.5-VL 7B Instruct AWQ | 13 GB | Yes | Vision passed |
| Qwen3 14B AWQ | 19 GB | Yes | Text passed |

The remaining large checkpoints are deliberately outside the managed profile
allow-list:

| Checkpoint | Disk size | Quantization | Status |
|------------|-----------|--------------|--------|
| Qwen3 32B AWQ | 37 GB | AWQ 4-bit | Deferred; weight shards alone exceed the current vLLM VRAM budget |
| Qwen3-VL 30B-A3B Instruct | 116 GB | Unquantized | Deferred; not part of the AWQ inventory and not a single-3090 fit |

Do not add profiles for the deferred models until there is an explicit policy
for exclusive GPU use, TTS coexistence, context and concurrency limits,
offload or multi-GPU placement, and OOM rollback. This keeps an accidental UI
selection from turning an experimental large-model load into a production
resource-policy decision.

```sh
docker pull vllm/vllm-openai@sha256:fc56161ee42a011aeee78b65d0a81b6683c7d04402fd40503d14d4d6c98f07cb
docker pull ghcr.io/ggml-org/llama.cpp:server-cuda@sha256:7b3d7834fc7307cb54f24f8869b67bfff276404c416452a48d11321bc36a81be
mkdir -p ~/.config/bordercore ~/.local/bin
ln -sfn ~/dev/bordercoreai/deploy/linux/systemd/vllm-profiles/Qwen3-8B-AWQ.env \
        ~/.config/bordercore/vllm.env
ln -sfn ~/dev/bordercoreai/deploy/linux/systemd/vllm.service \
        ~/.config/systemd/user/vllm.service
ln -sfn ~/dev/bordercoreai/deploy/linux/systemd/llama-cpp-profiles/Qwen3.6-27B-GGUF.env \
        ~/.config/bordercore/llama-cpp.env
ln -sfn ~/dev/bordercoreai/deploy/linux/systemd/llama-cpp.service \
        ~/.config/systemd/user/llama-cpp.service
ln -sfn ~/dev/bordercoreai/deploy/linux/bin/vllm-model \
        ~/.local/bin/vllm-model
ln -sfn ~/dev/bordercoreai/deploy/linux/bin/model-engine \
        ~/.local/bin/model-engine
systemctl --user daemon-reload
systemctl --user enable --now vllm
```

The first startup can take roughly two minutes on deepvirtual while the
checkpoint loads and CUDA graphs compile. With the persisted cache, tested
restart readiness was about one minute. Check readiness and issue a minimal
request with:

```sh
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8001/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"Qwen3-8B-AWQ-vLLM","messages":[{"role":"user","content":"Reply with: ready /no_think"}],"max_tokens":32}'
```

List profiles, inspect the active engine, or switch across engines with:

```sh
model-engine list
model-engine status
model-engine unload
model-engine switch llama-cpp Qwen3.6-27B-GGUF
model-engine switch vllm Qwen3.5-9B-AWQ
```

`vllm-model` remains available for vLLM-only administration. Bordercore uses
`model-engine`, so selecting a managed model in the UI safely crosses the
engine boundary when necessary.

`model-engine unload` stops both managed inference services without changing
their selected profiles. The Bordercore model picker exposes the same operation
as **Unload local model**, also clearing any in-process Transformers model. The
UI keeps the current selection but disables chat until that local model is
loaded again; hosted API models remain usable while the GPU is free.

Switching stops the current container first, which unloads its weights and KV
cache from GPU memory. The command then selects the requested profile, starts
the service, waits for the exact model ID on `/v1/models`, and runs a minimal
completion. If the new model does not become healthy, it restores and starts
the previous profile. Selecting any managed vLLM model in Bordercore invokes
this same command through `/load`; the UI keeps its processing modal open until
the switch succeeds or fails. The selected model is updated only after a
successful health and completion check. All managed UI entries share the same
single-model endpoint, so only one is active at a time.

Measured on deepvirtual on July 13, 2026. Qwen3 TTS was active for the two text
transitions and inactive for the vision transition:

| Transition | Ready and verified | vLLM VRAM | Warm request |
|------------|--------------------|-----------|--------------|
| 8B to 14B, first load | 153 seconds | 12,176 MiB | 0.105 seconds |
| 14B to 8B, cached | 56 seconds | 13,484 MiB | 0.51 seconds through Bordercore |
| 8B to Qwen2.5-VL 3B, cached | 74 seconds | 13,824 MiB | 1.50-second image request through Bordercore |

The additional profiles were verified with Qwen3 TTS inactive:

| Transition | Ready and verified | vLLM VRAM | Warm request |
|------------|--------------------|-----------|--------------|
| Qwen3 8B to Llama 3 Instruct | 122 seconds | 12,632 MiB | 0.14 seconds |
| Llama 3 to Qwen2.5 7B Instruct | 104 seconds | 12,620 MiB | 0.04 seconds |
| Qwen2.5 7B Instruct to Coder | 104 seconds | 12,620 MiB | 0.14 seconds |
| Qwen2.5 Coder to VL 7B | 152 seconds | 13,892 MiB | 1.60-second image request |
| VL 7B to Qwen2.5 7B through Bordercore | 56 seconds | — | UI load and `/info` verified |
| Qwen2.5 7B to default Qwen3 8B through Bordercore | 58 seconds | — | UI load and `/info` verified |
| Qwen3 8B to Qwen3.5 4B BF16 | 189 seconds | 12,070 MiB | 0.24-second image request |
| Qwen3.5 4B to Qwen3.5 9B AWQ trial and retry | 376 seconds | 13,120 MiB | 55% rejected; 60% passed in the same rollback window |
| Qwen3 8B to Qwen3.5 4B through Bordercore | 219 seconds | — | UI load and `/info` verified |
| Qwen3.5 4B to 9B AWQ through Bordercore | 241 seconds | — | UI load and `/info` verified |
| Qwen3.5 9B AWQ to default Qwen3 8B through Bordercore | 98 seconds | — | UI load and `/info` verified |

Stopping either text model returned total GPU use to approximately 2,959 MiB
before the replacement started, demonstrating that its GPU allocation was
released. With TTS stopped, unloading Qwen3 before the vision test returned GPU
use to 492 MiB.
Each additional profile transition returned GPU use to approximately 490–495
MiB before loading its replacement.

The Qwen2.5-VL checkpoints store `model.visual` in their AWQ exclusion lists,
while vLLM names the same modules `visual`. Their profiles supply an
`--hf-overrides` value that corrects this prefix without modifying the shared
checkpoints. The vision encoders remain unquantized and use FlashAttention; the
language layers use AWQ with Marlin. Direct and Bordercore image tests correctly
read the text from `logo.jpg` with both sizes.

The Qwen3.5 profiles use their native unified vision-language architecture.
The 4B BF16 and 9B AWQ profiles also correctly read `BORDERCORE AI` from
`logo.jpg`; thinking was disabled for these short deterministic OCR checks.

### Qwen3.6 27B GGUF managed profile

Qwen3.6 27B does not fit the managed vLLM budget with the available AWQ
checkpoint. It is served as an exclusive-GPU llama.cpp profile using
`unsloth/Qwen3.6-27B-GGUF` Q4_K_M and its F16 multimodal projector. The trial
artifacts live under `~/model-trials/Qwen3.6-27B-GGUF`, outside the production
`~/models` inventory. It used llama.cpp build 9982 (`99f3dc322`) from the
official CUDA server image
`sha256:7b3d7834fc7307cb54f24f8869b67bfff276404c416452a48d11321bc36a81be`.

The server uses full GPU layer offload, one sequence, and an 8K context. The
managed switcher unloads vLLM before launch. Measured on deepvirtual on July 13,
2026:

| Check | Result |
|-------|--------|
| Model and projector disk size | 17 GB |
| Model ready | Approximately 9 seconds |
| Idle / post-vision VRAM | 17,580 / 17,656 MiB |
| Text generation | 40–43 tokens per second |
| Deterministic text | Passed (`Qwen3.6 ready`) |
| Vision OCR | Passed (`BORDERCORE AI`) |
| Short multi-turn retention | Passed (`COBALT-7391`) |
| First managed vLLM-to-llama.cpp switch | 89 seconds |
| Warm UI vLLM-to-llama.cpp switch | 13 seconds |
| UI llama.cpp-to-Qwen3.5 9B vLLM switch | 208 seconds |
| Bordercore text / vision | 1.66 / 1.68 seconds |

The model is selectable in Bordercore as `Qwen3.6 27B GGUF`. The processing
dialog remains open until the target engine advertises the exact configured
model and passes a deterministic completion. `/info` reconciles either managed
endpoint, including switches performed from the command line.

To stop vLLM and remove its container without affecting the model files or
other GPU services:

```sh
systemctl --user disable --now vllm
```

## Day-to-day use

```sh
# Swap engines (Conflicts= stops the current one automatically):
systemctl --user start qwen3-tts
systemctl --user start chatterbox-tts

# Switch managed inference engines and models:
model-engine switch llama-cpp Qwen3.6-27B-GGUF
model-engine switch vllm Qwen3.5-9B-AWQ

# Check what's running:
systemctl --user status qwen3-tts

# Tail logs:
journalctl --user -u qwen3-tts -f

# Stop entirely:
systemctl --user stop qwen3-tts
```

## Notes

- The service files hardcode one Python path per engine because each engine has a
  canonical host. If you ever move chatterbox or qwen3 to wumpus, or kokoro to
  deepvirtual, point the `ExecStart` at whichever venv has the dependency
  installed on that host.
- Watchman syncs the files to both hosts, but you only symlink the units you
  actually want to run on each host. Extra files on disk are harmless.
- `Conflicts=` is an explicit mutex; the port 5001 binding is an implicit
  backstop — if somehow both tried to start, the second would fail on bind.
- The vLLM unit has no `Conflicts=` relationship with the TTS units. Its 55%
  GPU-memory ceiling is intentionally conservative, but concurrent peak loads
  should still be monitored.
- Add new checkpoints under the reviewed `vllm-profiles/` or
  `llama-cpp-profiles/` allow-lists. The switcher does not accept arbitrary
  model paths.
- Managed API entries are canonical in Bordercore. Matching local checkpoints
  are hidden, and `/info` reconciles UI state with either active engine.
