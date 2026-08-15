# BordercoreAI TODO

## Hermes integration roadmap

**Status:** Planned; implement incrementally with read-only capabilities first.

Reference material:

- [Hermes memory guide](docs/hermes-memory-guide.md)
- [Hermes capabilities and Bordercore applications](docs/hermes-capabilities.md)

Priorities:

1. Add a Manage Memory interface for inspecting, correcting, and removing
   entries.
2. Add a read-only System Health action covering services, GPU state, disk
   space, and recent errors on `deepvirtual`.
3. Schedule the health workflow as an optional morning brief.
4. Encode verified deployment and diagnostic procedures as a Bordercore
   Operations skill.
5. Design an explicit Agent Mode with visible tool activity, restricted
   toolsets, and approval controls. Keep this separate from Agent Memory so the
   selected UI model remains authoritative for normal chat.
6. Add searchable Hermes session history for previous investigations.
7. Evaluate narrowly filtered GitHub and Bordercore notes MCP integrations.

Do not give Hermes write or process-control access until the read-only workflow
has suitable logging, timeouts, tool restrictions, and approval boundaries.

## Evaluate streaming audio transport and Parakeet STT

**Status:** Deferred

This evaluation originated from the
[“Talking with Gemma 4 31B” LocalLLaMA discussion](https://www.reddit.com/r/LocalLLaMA/comments/1ulgwld/talking_with_gemma_4_31b/).
Evaluate the streaming audio transport and progressive transcription approach
from [Hugging Face speech-to-speech](https://github.com/huggingface/speech-to-speech).
Its current Linux implementation uses
[Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
through `nano-parakeet`.

### Expected benefit

- Parakeet on CUDA may make ASR inference approximately 2–4 times faster than
  the current `distil-whisper/distil-large-v3` path.
- For a typical 3–8 second utterance, the likely warm-ASR saving is about
  200–500 ms.
- Because VAD, the local 27B LLM, and TTS account for the rest of the turn,
  expected end-to-end improvement is approximately 10–25%.
- Progressive partial transcripts should make the interface feel more
  responsive. They will not let the assistant answer earlier unless
  speculative LLM processing or early turn submission is also implemented.
- Streaming audio transport itself should consume negligible VRAM.

### GPU constraints

The measured RTX 3090 allocation with the current stack was approximately:

| Consumer | VRAM |
| --- | ---: |
| Qwen3.6 27B through llama.cpp | 17.6 GB |
| Qwen3 TTS | 2.6 GB |
| SteamVR | 0.5 GB |
| Free | 2.6 GB |

Parakeet TDT 0.6B v3 is expected to require approximately 1.5–2.5 GB of
persistent VRAM. Reserve 2.5–3 GB when accounting for temporary inference
buffers. Keeping CUDA Parakeet permanently resident alongside the current chat
and TTS models would leave too little safety margin.

### CPU assessment

`deepvirtual` has an Intel Core i7-7700K with four cores and eight threads.
Parakeet on this CPU is unlikely to beat warm GPU Distil-Whisper consistently.
A typical conversational utterance may take roughly 0.7–2 seconds on CPU,
compared with an estimated 0.3–0.8 seconds for the current warm GPU path.

CPU Parakeet may still be useful because it:

- consumes no VRAM;
- provides progressive transcription;
- reduces GPU contention;
- may improve English accuracy, punctuation, and capitalization.

### Future implementation

1. Add streaming audio transport independently of the STT backend.
2. Add Parakeet behind a disabled-by-default feature flag.
3. Support explicit `cpu` and `cuda` modes.
4. Default to CPU when the 27B chat model and Qwen TTS are resident.
5. Add a CUDA VRAM preflight check with at least 3.5 GB free as the initial
   safety threshold.
6. Use short rolling windows for progressive transcription.
7. Preserve final-turn transcription as the authoritative text sent to the
   LLM.
8. Add idle unloading and expose readiness in the existing ASR controls.

### Benchmark before enabling

Use the same short, medium, noisy, and accented recordings for:

1. GPU Distil-Whisper Large v3, cold and warm.
2. CPU Parakeet TDT 0.6B v3, cold and warm.
3. CUDA Parakeet TDT 0.6B v3, cold and warm, with sufficient VRAM available.

Record model-load time, transcription latency, real-time factor, peak VRAM,
CPU utilization, transcript accuracy, and end-to-end time from speech end to
first assistant audio. Do not change the default until measurements show a
meaningful benefit without destabilizing the active chat and TTS services.

## Deferred voice-pipeline ideas

**Status:** Deferred; revisit only for a clear use case or measured bottleneck.

The current speculative ASR implementation produces a measured head start of
about 577 ms and completely hides ASR latency on the tested voice turn. Avoid
the following larger changes while the current experience remains reliable.

### Speculative LLM generation

Start LLM prefill or generation from a provisional transcript before VAD
confirms the turn.

- Potential benefit: hide part of time-to-first-token behind the remaining VAD
  silence window.
- Costs: provisional transcript revisions, generation cancellation, wasted GPU
  work during natural pauses, hidden response buffering, and safeguards
  preventing stale text or TTS audio from reaching the user.
- Revisit when first-token latency is a significant remaining bottleneck and
  measurements justify the added cancellation complexity.

### WebSocket microphone streaming

Replace complete-turn audio uploads with a live browser-to-server audio
transport.

- Potential benefit: earlier server-side processing, partial transcripts,
  cleaner cancellation, and a common transport for future clients.
- Costs: connection lifecycle and reconnection handling, audio framing,
  backpressure, turn revisions, server session state, and substantially more
  integration testing.
- Streaming transport should consume negligible VRAM, but its standalone
  latency benefit is limited now that speculative browser-side ASR already
  hides the measured recognition delay.
- If implemented, keep it independent of the ASR backend so Distil-Whisper,
  Parakeet, and future engines can share it.

### OpenAI Realtime API compatibility

Expose a compatible realtime voice-agent interface for external clients.

- Potential benefit: reuse BordercoreAI as a backend for standard realtime
  clients and integrations.
- Costs: protocol translation, session state, event ordering, cancellation,
  audio codecs, authentication, and compatibility maintenance.
- This is primarily an interoperability feature rather than a direct
  performance optimization. Revisit only when an external client needs it.

### Additional audio preprocessing

Evaluate denoising or echo suppression such as DeepFilterNet only if recordings
show a concrete accuracy problem that browser processing cannot address.

- Potential benefit: improved ASR and VAD behavior in noisy rooms or when
  speakers feed back into the microphone.
- Costs: more dependencies, CPU/GPU work, latency, device-specific tuning, and
  the possibility of degrading already-clean speech.
- Benchmark against the existing browser echo cancellation and noise
  suppression before adopting another model.

### Additional TTS engines

Do not add more engines without a specific missing capability.

- Kokoro covers lightweight synthesis, Chatterbox covers expressive and cloned
  voices, and Qwen3-TTS provides the newer optimized path.
- Every additional engine adds installation, service management, preferences,
  capability detection, testing, and VRAM or RAM considerations.
- Revisit only for an obvious quality, language, licensing, or latency benefit
  that the current engines cannot provide.
