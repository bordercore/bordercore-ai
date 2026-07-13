# GPU service systemd units

User-scope units for the TTS engines and the deepvirtual vLLM service:

| Unit                        | Engine     | Host         | Runtime                                          |
|-----------------------------|------------|--------------|--------------------------------------------------|
| `kokoro-tts.service`        | Kokoro     | wumpus       | `~/dev/bordercoreai/.venv/bin/python`            |
| `chatterbox-tts.service`    | Chatterbox | deepvirtual  | `~/dev/bordercoreai/tts/chatterbox_tts/.venv/bin/python` (isolated 3.11 venv) |
| `qwen3-tts.service`         | Qwen3      | deepvirtual  | `~/dev/envs/bordercoreai/bin/python`             |
| `vllm.service`              | vLLM       | deepvirtual  | Pinned `vllm/vllm-openai` Docker image           |

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

### deepvirtual vLLM service

The service runs one allow-listed AWQ checkpoint at a time on the loopback-only
OpenAI-compatible endpoint `http://127.0.0.1:8001/v1`. The included profiles
cover Qwen3 8B/14B, Qwen2.5 7B Instruct/Coder, Qwen2.5-VL 3B/7B, and Llama 3
Instruct; Qwen3 8B is the default. All use at most 55% of the RTX 3090's memory.
The Docker image is pinned by digest and currently contains vLLM 0.25.0 and
Transformers 5.13.0. The unit persists vLLM's compilation cache under
`~/.cache/vllm` so subsequent starts avoid recompiling unchanged model graphs.

```sh
docker pull vllm/vllm-openai@sha256:fc56161ee42a011aeee78b65d0a81b6683c7d04402fd40503d14d4d6c98f07cb
mkdir -p ~/.config/bordercore ~/.local/bin
ln -sfn ~/dev/bordercoreai/deploy/linux/systemd/vllm-profiles/Qwen3-8B-AWQ.env \
        ~/.config/bordercore/vllm.env
ln -sfn ~/dev/bordercoreai/deploy/linux/systemd/vllm.service \
        ~/.config/systemd/user/vllm.service
ln -sfn ~/dev/bordercoreai/deploy/linux/bin/vllm-model \
        ~/.local/bin/vllm-model
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

List the configured models, inspect the active server, or switch models with:

```sh
vllm-model list
vllm-model status
vllm-model switch Qwen3-14B-AWQ
vllm-model switch Qwen3-8B-AWQ
```

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
- Add new checkpoints by creating another reviewed profile under
  `vllm-profiles/`. The switch command does not accept arbitrary model paths or
  models that are absent from `~/models`.
- Managed vLLM entries are canonical in Bordercore: matching local checkpoint
  entries are hidden, Qwen3 8B is the default, and `/info` reconciles managed
  UI state with the model ID currently advertised by vLLM.
