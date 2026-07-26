# Interpreting Voice Latency Metrics

Bordercore AI displays latency measurements for the latest voice turn in the
controls sidebar. Use the following guidance to identify which stage of the
voice pipeline is limiting responsiveness.

## Metrics

### ASR

Time from when you stop speaking until the transcription is ready. Lower is
better.

- Under 500 ms: excellent
- 500 ms–1 s: good
- Over 1.5 s: likely noticeable

### VAD confirmation

Time from tentative speech detection until the segment accumulates enough
speech-positive frames to be accepted. Barge-in occurs at this point, so a
misfire can be discarded without interrupting the assistant.

- Around 250–350 ms is expected with the current 250 ms minimum
- A much larger value suggests intermittent or low-confidence speech

### VAD endpoint

Time from the final speech-positive Silero frame until VAD commits the end of
the utterance. The default redemption window is 900 ms, reduced from the
library default of 1.4 seconds. It can be adjusted in Preferences under VAD.

- Around 900–1050 ms is expected because inference frames and callback
  scheduling add a small amount of overhead
- A substantially higher value suggests intermittent speech classifications
  during background noise
- If natural mid-sentence pauses are submitted as separate turns, the
  redemption window is too aggressive for that speaker or environment

### VAD presets

Preferences provides four starting points:

| Preset | Start / end | Silence | Minimum | Pre-pad |
| --- | ---: | ---: | ---: | ---: |
| Responsive | 0.30 / 0.25 | 600 ms | 200 ms | 650 ms |
| Balanced | 0.30 / 0.25 | 900 ms | 250 ms | 800 ms |
| Patient Speaker | 0.30 / 0.25 | 1500 ms | 250 ms | 800 ms |
| Noisy Environment | 0.50 / 0.35 | 1000 ms | 350 ms | 800 ms |

Changing any individual setting selects Custom automatically. Resetting VAD
defaults restores Balanced.

### First token

Time from sending the request until the LLM begins responding.

- Under 500 ms: very responsive
- 500 ms–1.5 s: reasonable
- Over 2 s: model loading, prompt processing, or inference may be the
  bottleneck

### First sentence

Time between the first LLM token and enough text accumulating for the first TTS
segment.

- Under 500 ms: excellent
- 500 ms–1 s: normal
- Higher values can mean the model is producing text slowly or the sentence
  segmenter is waiting too long for a safe boundary

### First audio

Time from the end of your speech until audio is scheduled to play. This is the
most important perceived-latency measurement because it represents how long
you wait for the assistant to answer aloud.

- Under 1.5 s: excellent
- 1.5–2.5 s: good
- 2.5–4 s: noticeable
- Over 4 s: worth optimizing

### Total turn

Time from speech detection until the response finishes playing, fails, is
cancelled, or is interrupted. This depends heavily on answer length, so it is
not primarily a responsiveness metric.

### TTS RTF

Real-time factor: synthesis time divided by generated audio duration.

- `0.20×` means 10 seconds of speech was synthesized in 2 seconds
- Below `0.5×`: excellent
- Below `1.0×`: faster than playback
- Above `1.0×`: TTS cannot synthesize speech as quickly as it is consumed and
  may cause gaps

### Queue / buffer

Peak pending sentence count and peak scheduled audio duration.

- A queue depth around 1–3 is healthy
- A large queue means text is being produced faster than TTS can process it
- Several seconds of buffer produces smooth playback but makes interruption
  less efficient and uses more memory
- Bordercore AI currently limits scheduled audio to roughly eight seconds

### VAD confidence / speech frames

Average and peak Silero speech probability, followed by the number of frames
that met the configured positive-speech threshold.

- A high peak with very few speech frames often indicates a click, cough, or
  other short transient
- Consistently low averages during real speech suggest that the positive
  threshold may be too strict for the microphone or environment
- A growing misfire count means VAD detected a possible start but rejected the
  segment for not meeting the 250 ms minimum speech duration

## Turn outcomes

- **Completed**: Response and playback finished normally
- **Interrupted**: VAD barge-in stopped the response
- **Cancelled**: The response was manually stopped or replaced
- **Failed**: ASR, LLM, or TTS encountered an error
- **Discarded**: ASR returned empty, non-speech, or known boilerplate text
- **Misfire**: VAD detected a possible start but rejected the short segment
- **Active**: The turn is still underway

## Diagnosing bottlenecks

- High **ASR**, with everything else low: speech recognition bottleneck
- High **VAD endpoint**: background noise or a conservative redemption window
- High **First token**: LLM or model bottleneck
- Low **First token** but high **First sentence**: slow token generation or
  conservative sentence segmentation
- Low **First sentence** but high **First audio**: TTS or network bottleneck
- High **TTS RTF** with a growing queue: TTS cannot keep pace with playback
- Low individual stages but high **First audio**: buffering or an unmeasured
  handoff delay

A dash means that a milestone did not occur. For example, TTS measurements
remain blank when Text to Speech is disabled.
