import { useRef, useCallback } from "react";
import AudioMotionAnalyzer from "audiomotion-analyzer";
import axios from "axios";
import { SpeechSegmenter } from "../utils/speechSegments";

interface UseAudioOptions {
  session: any;
  onSpeechResult: (text: string) => void;
  setNotice: (notice: string) => void;
}

export default function useAudio(options: UseAudioOptions) {
  const { session, onSpeechResult, setNotice } = options;

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioMotionRef = useRef<AudioMotionAnalyzer | null>(null);
  const micStreamRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneEnabledRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);
  // TTS playback is driven by the Web Audio API (fetch → PCM → scheduled
  // AudioBufferSourceNodes). We keep handles to the active fetch and the
  // scheduled sources so a new request or pauseAudio() can cancel in flight.
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const ttsSessionRef = useRef(0);
  const ttsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ttsNextStartRef = useRef(0);
  const ttsPendingSegmentsRef = useRef(0);
  const speechSegmenterRef = useRef(
    new SpeechSegmenter({
      pronunciations: session.tts_pronunciations ?? {},
      doNotSpeakPatterns: session.tts_do_not_speak_patterns ?? [],
    })
  );
  const ttsConfigRef = useRef({
    speak: false,
    host: "",
    voice: "",
    audioSpeed: 1,
    engine: "",
  });
  // Fallback AudioContext used when the AudioMotionAnalyzer isn't present
  // (its canvas-container element isn't rendered in the current UI, so
  // audioMotionRef.current is usually null). Lazily initialized on first
  // TTS playback — that's always after a user gesture.
  const ttsCtxRef = useRef<AudioContext | null>(null);

  // The HTMLAudioElement is retained only because AudioMotionAnalyzer wants a
  // source node at construction time. It's idle for TTS playback now (TTS goes
  // through Web Audio buffer sources connected via connectInput).
  if (!audioElementRef.current) {
    audioElementRef.current = new Audio();
    audioElementRef.current.crossOrigin = "anonymous";
  }

  const createAudioMotionAnalyzer = useCallback(() => {
    const container = document.getElementById("canvas-container");
    if (!container || audioMotionRef.current) return;

    audioMotionRef.current = new AudioMotionAnalyzer(container, {
      bgAlpha: 0,
      overlay: true,
      showScaleX: false,
      source: audioElementRef.current!,
    });
  }, []);

  const connectStream = useCallback((stream: MediaStream) => {
    if (!audioMotionRef.current) return;
    micStreamRef.current = audioMotionRef.current.audioCtx.createMediaStreamSource(stream);
    audioMotionRef.current.connectInput(micStreamRef.current);
    audioMotionRef.current.volume = 0;
  }, []);

  const cancelTTSPlayback = useCallback(() => {
    const context = ttsCtxRef.current ?? audioMotionRef.current?.audioCtx;
    const hadActivePlayback =
      ttsAbortRef.current !== null ||
      ttsSourcesRef.current.length > 0 ||
      ttsPendingSegmentsRef.current > 0 ||
      (context !== undefined && ttsNextStartRef.current > context.currentTime);

    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    const motion = audioMotionRef.current;
    for (const src of ttsSourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      try {
        if (motion) {
          motion.disconnectInput(src, true);
        } else {
          src.disconnect();
        }
      } catch {
        /* not connected */
      }
    }
    ttsSourcesRef.current = [];
    ttsQueueRef.current = Promise.resolve();
    ttsNextStartRef.current = 0;
    ttsPendingSegmentsRef.current = 0;
    ttsSessionRef.current += 1;
    speechSegmenterRef.current.reset();
    return hadActivePlayback;
  }, []);

  const synthesizeSegment = useCallback(async (response: string, sessionId: number) => {
    const { host: ttsHost, voice, audioSpeed, engine } = ttsConfigRef.current;
    if (!response.trim() || sessionId !== ttsSessionRef.current) return;
    console.debug("[TTS] normalized segment", { sessionId, text: response });
    const outputFile = "stream_output.wav";
    // The UI stores reference-audio filenames, while profile-based engines
    // address those same voices by their extension-free profile name. Qwen
    // also resolves a bare stem; Kokoro uses its own kokoro_voice parameter.
    const voiceProfile = voice.replace(/^.*[\\/]/, "").replace(/\.(wav|mp3|flac|ogg)$/i, "");
    const voiceParameter = engine === "kokoro" ? "kokoro_voice" : "voice";
    const url = `${ttsHost}/?text=${encodeURIComponent(response)}&${voiceParameter}=${encodeURIComponent(voiceProfile)}&language=en&output_file=${outputFile}`;

    // Prefer the analyzer's AudioContext if it exists (so visualization
    // stays hooked up); otherwise fall back to a lazily-created context.
    const motion = audioMotionRef.current;
    let ctx: AudioContext;
    if (motion) {
      ctx = motion.audioCtx;
      motion.gradient = "steelblue";
      motion.volume = 1;
    } else {
      if (!ttsCtxRef.current) {
        ttsCtxRef.current = new AudioContext();
      }
      ctx = ttsCtxRef.current;
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        /* no user gesture yet; will play silently until resumed */
      });
    }

    // Keep only a modest amount of speech scheduled ahead. This bounds
    // AudioBuffer memory and leaves cancellation responsive on long answers.
    while (sessionId === ttsSessionRef.current && ttsNextStartRef.current - ctx.currentTime > 8) {
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    if (sessionId !== ttsSessionRef.current) return;

    const abort = new AbortController();
    ttsAbortRef.current = abort;

    let resp: Response;
    try {
      resp = await fetch(url, { signal: abort.signal });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("TTS fetch failed:", err);
      }
      return;
    }
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      console.error("TTS server error:", resp.status, text.slice(0, 200));
      return;
    }

    const reader = resp.body.getReader();
    let leftover: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let sampleRate = 0;
    let numChannels = 1;
    let bitsPerSample = 16;

    const concat = (
      a: Uint8Array<ArrayBufferLike>,
      b: Uint8Array<ArrayBufferLike>
    ): Uint8Array<ArrayBufferLike> => {
      const out = new Uint8Array(a.length + b.length);
      out.set(a, 0);
      out.set(b, a.length);
      return out;
    };

    while (sessionId === ttsSessionRef.current) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("TTS stream read failed:", err);
        }
        return;
      }
      if (chunk.done) break;
      leftover = concat(leftover, chunk.value);

      if (sampleRate === 0) {
        if (leftover.length < 44) continue;
        const view = new DataView(leftover.buffer, leftover.byteOffset, 44);
        if (view.getUint32(0, false) !== 0x52494646 /* "RIFF" */) {
          console.error("TTS stream: not a WAV response");
          return;
        }
        numChannels = view.getUint16(22, true);
        sampleRate = view.getUint32(24, true);
        bitsPerSample = view.getUint16(34, true);
        if (bitsPerSample !== 16) {
          console.error(`TTS stream: unsupported ${bitsPerSample}-bit PCM`);
          return;
        }
        leftover = leftover.slice(44);
        if (ttsNextStartRef.current < ctx.currentTime) {
          ttsNextStartRef.current = ctx.currentTime + 0.05;
        }
      }

      const bytesPerSample = bitsPerSample / 8;
      const frameBytes = bytesPerSample * numChannels;
      const usable = Math.floor(leftover.length / frameBytes) * frameBytes;
      if (usable === 0) continue;

      const pcm = leftover.subarray(0, usable);
      leftover = leftover.slice(usable);

      const frames = usable / frameBytes;
      const audioBuffer = ctx.createBuffer(numChannels, frames, sampleRate);
      const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < frames; i++) {
          const offset = (i * numChannels + ch) * bytesPerSample;
          channelData[i] = dv.getInt16(offset, true) / 32768;
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = audioSpeed;
      if (motion) {
        motion.connectInput(source);
      } else {
        source.connect(ctx.destination);
      }

      const when = Math.max(ttsNextStartRef.current, ctx.currentTime);
      source.start(when);
      ttsNextStartRef.current = when + audioBuffer.duration / audioSpeed;

      ttsSourcesRef.current.push(source);
      source.onended = () => {
        try {
          if (motion) {
            motion.disconnectInput(source, true);
          } else {
            source.disconnect();
          }
        } catch {
          /* noop */
        }
        ttsSourcesRef.current = ttsSourcesRef.current.filter(s => s !== source);
      };
    }

    if (ttsAbortRef.current === abort) ttsAbortRef.current = null;
  }, []);

  const enqueueSegments = useCallback(
    (segments: string[]) => {
      const sessionId = ttsSessionRef.current;
      for (const segment of segments) {
        ttsPendingSegmentsRef.current += 1;
        ttsQueueRef.current = ttsQueueRef.current
          .then(() => synthesizeSegment(segment, sessionId))
          .catch(error => console.error("TTS segment failed:", error))
          .finally(() => {
            if (sessionId === ttsSessionRef.current) {
              ttsPendingSegmentsRef.current = Math.max(0, ttsPendingSegmentsRef.current - 1);
            }
          });
      }
    },
    [synthesizeSegment]
  );

  const startTTSResponse = useCallback(
    (speak: boolean, ttsHost: string, voice: string, audioSpeed: number, engine: string) => {
      cancelTTSPlayback();
      ttsConfigRef.current = { speak, host: ttsHost, voice, audioSpeed, engine };
    },
    [cancelTTSPlayback]
  );

  const appendTTSResponse = useCallback(
    (fullText: string) => {
      if (!ttsConfigRef.current.speak) return;
      enqueueSegments(speechSegmenterRef.current.append(fullText));
    },
    [enqueueSegments]
  );

  const finishTTSResponse = useCallback(
    (fullText: string) => {
      if (!ttsConfigRef.current.speak) return;
      enqueueSegments(speechSegmenterRef.current.finish(fullText));
    },
    [enqueueSegments]
  );

  const stopMicrophoneStream = useCallback(() => {
    if (audioMotionRef.current && micStreamRef.current) {
      try {
        audioMotionRef.current.disconnectInput(micStreamRef.current, true);
      } catch {
        /* already disconnected */
      }
    }
    microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
    micStreamRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    } else {
      stopMicrophoneStream();
      setNotice("");
    }
  }, [setNotice, stopMicrophoneStream]);

  const handleListen = useCallback(
    (microPhoneOn: boolean) => {
      microphoneEnabledRef.current = microPhoneOn;

      if (!microPhoneOn) {
        stopRecording();
        return;
      }

      audioChunksRef.current = [];
      setNotice("Listening...");
      if (audioMotionRef.current) {
        audioMotionRef.current.gradient = "rainbow";
      }

      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then(stream => {
          if (!microphoneEnabledRef.current) {
            stream.getTracks().forEach(track => track.stop());
            setNotice("");
            return;
          }

          microphoneStreamRef.current = stream;
          connectStream(stream);

          const recorder = new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;
          recorder.start();

          recorder.ondataavailable = event => {
            audioChunksRef.current.push(event.data);
          };

          recorder.onstop = () => {
            stopMicrophoneStream();
            mediaRecorderRef.current = null;

            const chunks = audioChunksRef.current;
            audioChunksRef.current = [];
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            if (blob.size === 0) {
              setNotice("");
              return;
            }

            const formData = new FormData();
            formData.append("audio", blob, "speech.webm");
            setNotice("Waiting for speech to text");

            axios
              .post("/speech2text", formData)
              .then(response => {
                onSpeechResult(response.data.input);
                if (!microphoneEnabledRef.current) setNotice("");
              })
              .catch(error => {
                console.error("Speech-to-text request failed:", error);
                setNotice("Speech to text failed");
                window.setTimeout(() => {
                  if (!microphoneEnabledRef.current) setNotice("");
                }, 2000);
              });
          };
        })
        .catch(err => {
          microphoneEnabledRef.current = false;
          setNotice("");
          alert("Microphone access denied by user: " + err);
        });
    },
    [connectStream, onSpeechResult, setNotice, stopMicrophoneStream, stopRecording]
  );

  const pauseAudio = useCallback(() => {
    cancelTTSPlayback();
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
    }
  }, [cancelTTSPlayback]);

  const interruptTTSPlayback = useCallback(() => {
    const interrupted = cancelTTSPlayback();
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
    }
    return interrupted;
  }, [cancelTTSPlayback]);

  return {
    audioElementRef,
    audioMotionRef,
    micStreamRef,
    createAudioMotionAnalyzer,
    connectStream,
    startTTSResponse,
    appendTTSResponse,
    finishTTSResponse,
    handleListen,
    stopRecording,
    pauseAudio,
    interruptTTSPlayback,
  };
}
