import { useRef, useCallback } from "react";
import AudioMotionAnalyzer from "audiomotion-analyzer";
import axios from "axios";

interface UseAudioOptions {
  session: any;
  onSpeechResult: (text: string) => void;
  setNotice: (notice: string) => void;
}

export default function useAudio(options: UseAudioOptions) {
  const { onSpeechResult, setNotice } = options;

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioMotionRef = useRef<AudioMotionAnalyzer | null>(null);
  const micStreamRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // TTS playback is driven by the Web Audio API (fetch → PCM → scheduled
  // AudioBufferSourceNodes). We keep handles to the active fetch and the
  // scheduled sources so a new request or pauseAudio() can cancel in flight.
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsSourcesRef = useRef<AudioBufferSourceNode[]>([]);

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
      if (motion) {
        try {
          motion.disconnectInput(src, true);
        } catch {
          /* not connected */
        }
      }
    }
    ttsSourcesRef.current = [];
  }, []);

  const doTTS = useCallback(
    (response: string, speak: boolean, ttsHost: string, voice: string, audioSpeed: number) => {
      if (!speak) return;
      const motion = audioMotionRef.current;
      if (!motion) return;

      // Cancel any in-flight TTS before starting a new one.
      cancelTTSPlayback();

      const outputFile = "stream_output.wav";
      const url = `${ttsHost}/?text=${encodeURIComponent(response)}&voice=${encodeURIComponent(voice)}&language=en&output_file=${outputFile}`;

      const ctx = motion.audioCtx;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {
          /* no user gesture yet; will play silently until resumed */
        });
      }
      motion.gradient = "steelblue";
      motion.volume = 1;

      const abort = new AbortController();
      ttsAbortRef.current = abort;

      (async () => {
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
        // When to schedule the next buffer (AudioContext timeline). Starts a
        // hair after ctx.currentTime so the first source has slack to queue.
        let nextStartTime = 0;

        const concat = (
          a: Uint8Array<ArrayBufferLike>,
          b: Uint8Array<ArrayBufferLike>,
        ): Uint8Array<ArrayBufferLike> => {
          const out = new Uint8Array(a.length + b.length);
          out.set(a, 0);
          out.set(b, a.length);
          return out;
        };

        while (true) {
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

          // Parse the 44-byte canonical WAV header on the first chunk that
          // completes it. RIFF magic check only; the server controls format.
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
            leftover = leftover.slice(44);
            nextStartTime = ctx.currentTime + 0.05;
          }

          // Consume whole PCM frames; stash any trailing partial frame.
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
          motion.connectInput(source);

          // If the prior buffer already finished (we fell behind — the gen
          // pipeline couldn't keep up), reset to currentTime so the new chunk
          // plays immediately rather than compounding a silent backlog.
          const when = Math.max(nextStartTime, ctx.currentTime);
          source.start(when);
          nextStartTime = when + audioBuffer.duration / audioSpeed;

          ttsSourcesRef.current.push(source);
          source.onended = () => {
            try {
              motion.disconnectInput(source, true);
            } catch {
              /* noop */
            }
            ttsSourcesRef.current = ttsSourcesRef.current.filter(s => s !== source);
          };
        }
      })();
    },
    [cancelTTSPlayback]
  );

  const handleListen = useCallback(
    (microPhoneOn: boolean) => {
      if (!microPhoneOn) {
        if (audioMotionRef.current && micStreamRef.current) {
          audioMotionRef.current.disconnectInput(micStreamRef.current, true);
        }
        return;
      }

      setNotice("Listening...");
      if (audioMotionRef.current) {
        audioMotionRef.current.gradient = "rainbow";
      }

      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then(stream => {
          connectStream(stream);

          const recorder = new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;
          recorder.start();

          recorder.ondataavailable = event => {
            audioChunksRef.current.push(event.data);
          };

          recorder.onstop = () => {
            setNotice("");
            const blob = new Blob(audioChunksRef.current, { type: "audio/wav" });
            const formData = new FormData();
            formData.append("audio", blob);
            setNotice("Waiting for speech to text");

            axios.post("/speech2text", formData).then(response => {
              setNotice("");
              onSpeechResult(response.data.input);
              audioChunksRef.current = [];
            });
          };
        })
        .catch(err => {
          alert("Microphone access denied by user: " + err);
        });
    },
    [connectStream, onSpeechResult, setNotice]
  );

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const pauseAudio = useCallback(() => {
    cancelTTSPlayback();
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
    }
  }, [cancelTTSPlayback]);

  return {
    audioElementRef,
    audioMotionRef,
    micStreamRef,
    createAudioMotionAnalyzer,
    connectStream,
    doTTS,
    handleListen,
    stopRecording,
    pauseAudio,
  };
}
