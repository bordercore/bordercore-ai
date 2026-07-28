import { useRef, useCallback, useEffect } from "react";
import { encodeWAV } from "../utils/audio";
import axios from "axios";
import AudioMotionAnalyzer from "audiomotion-analyzer";
import { VadConfig } from "../utils/vadConfig";
import { describeVadStartupError, VadRuntimeState } from "../utils/vadRuntime";

// Declare global vad type from CDN script
declare const vad: any;

const VAD_ASSET_BASE = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/";
const ONNX_WASM_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

interface VadInstance {
  pause: () => void;
  start: () => void;
  stream: MediaStream;
}

interface SpeculativeRequest {
  controller: AbortController;
  promise: Promise<string | null>;
  revision: number;
}

const VAD_SAMPLE_RATE = 16000;

function joinFrames(frames: Float32Array[]): Float32Array {
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const joined = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    joined.set(frame, offset);
    offset += frame.length;
  }
  return joined;
}

interface UseVADOptions {
  audioMotionRef: React.RefObject<AudioMotionAnalyzer | null>;
  micStreamRef: React.MutableRefObject<MediaStreamAudioSourceNode | null>;
  connectStream: (stream: MediaStream) => void;
  onSpeechResult: (text: string, voiceTurnId?: string) => boolean;
  onBargeIn: () => void;
  onVoiceTurnStart: () => string;
  onSpeechEnded: (turnId: string | null) => void;
  onAsrStarted: (turnId: string | null) => void;
  onTranscriptionReady: (turnId: string | null) => void;
  onVoiceTurnFailed: (turnId: string | null) => void;
  onVadFrame: (turnId: string | null, speechProbability: number) => void;
  onVadConfirmed: (turnId: string | null) => void;
  onVadComplete: (turnId: string | null) => void;
  onVadMisfire: (turnId: string | null) => void;
  onRuntimeStateChange: (state: VadRuntimeState) => void;
  config: VadConfig;
  setNotice: (notice: string) => void;
}

export default function useVAD(options: UseVADOptions) {
  const {
    audioMotionRef,
    micStreamRef,
    connectStream,
    onSpeechResult,
    onBargeIn,
    onVoiceTurnStart,
    onSpeechEnded,
    onAsrStarted,
    onTranscriptionReady,
    onVoiceTurnFailed,
    onVadFrame,
    onVadConfirmed,
    onVadComplete,
    onVadMisfire,
    onRuntimeStateChange,
    config,
    setNotice,
  } = options;

  const vadRef = useRef<VadInstance | null>(null);
  const vadGenerationRef = useRef(0);
  const bargeInConfirmedRef = useRef(false);
  const voiceTurnIdRef = useRef<string | null>(null);
  const preSpeechFramesRef = useRef<Float32Array[]>([]);
  const turnFramesRef = useRef<Float32Array[] | null>(null);
  const silenceMsRef = useRef(0);
  const speculationRevisionRef = useRef(0);
  const speculativeRequestRef = useRef<SpeculativeRequest | null>(null);

  const cancelSpeculation = useCallback(() => {
    speculationRevisionRef.current += 1;
    speculativeRequestRef.current?.controller.abort();
    speculativeRequestRef.current = null;
  }, []);

  const transcribe = useCallback(
    async (audio: Float32Array, turnId: string | null, signal?: AbortSignal): Promise<string> => {
      const wavBuffer = encodeWAV(audio);
      const blob = new Blob([wavBuffer], { type: "audio/wav" });
      const formData = new FormData();
      formData.append("audio", blob);
      if (turnId) formData.append("voice_turn_id", turnId);
      const response = await axios.post("/speech2text", formData, { signal });
      return response.data.input;
    },
    []
  );

  const startSpeculation = useCallback(() => {
    const frames = turnFramesRef.current;
    if (!config.speculativeAsr || !bargeInConfirmedRef.current || !frames?.length) return;
    if (speculativeRequestRef.current) return;

    const controller = new AbortController();
    const revision = ++speculationRevisionRef.current;
    const turnId = voiceTurnIdRef.current;
    onAsrStarted(turnId);
    const promise = transcribe(joinFrames(frames), turnId, controller.signal)
      .then(text => (revision === speculationRevisionRef.current ? text : null))
      .catch(error => {
        if (!axios.isCancel(error)) {
          console.debug("Speculative speech-to-text request failed; using final audio:", error);
        }
        return null;
      });
    speculativeRequestRef.current = { controller, promise, revision };
  }, [config.speculativeAsr, onAsrStarted, transcribe]);

  const confirmBargeIn = useCallback(() => {
    if (bargeInConfirmedRef.current) return;
    bargeInConfirmedRef.current = true;
    onVadConfirmed(voiceTurnIdRef.current);
    onBargeIn();
  }, [onBargeIn, onVadConfirmed]);

  const startVAD = useCallback(async () => {
    const generation = ++vadGenerationRef.current;
    if (vadRef.current) vadRef.current.pause();
    onRuntimeStateChange({ status: "starting" });
    let instance: VadInstance | null = null;
    try {
      const createdInstance = (await vad.MicVAD.new({
        model: "v5",
        baseAssetPath: VAD_ASSET_BASE,
        onnxWASMBasePath: ONNX_WASM_BASE,
        // Pin the documented detector defaults so a future library update
        // cannot silently change turn timing or sensitivity.
        positiveSpeechThreshold: config.positiveSpeechThreshold,
        negativeSpeechThreshold: config.negativeSpeechThreshold,
        // End turns promptly after sustained silence while retaining enough
        // room for natural pauses and hesitation.
        redemptionMs: config.redemptionMs,
        preSpeechPadMs: config.preSpeechPadMs,
        // Keep short conversational utterances such as "Howdy" while still
        // rejecting clicks and other very brief transients.
        minSpeechMs: config.minSpeechMs,
        onFrameProcessed: (probabilities: { isSpeech: number }, frame: Float32Array) => {
          onVadFrame(voiceTurnIdRef.current, probabilities.isSpeech);
          const frameCopy = frame.slice();
          const frameMs = (frameCopy.length / VAD_SAMPLE_RATE) * 1000;
          const turnFrames = turnFramesRef.current;

          if (turnFrames) {
            turnFrames.push(frameCopy);
            if (probabilities.isSpeech > config.negativeSpeechThreshold) {
              silenceMsRef.current = 0;
              if (speculativeRequestRef.current) cancelSpeculation();
            } else {
              silenceMsRef.current += frameMs;
              if (silenceMsRef.current >= config.speculationMs) startSpeculation();
            }
          } else {
            const preSpeechFrames = preSpeechFramesRef.current;
            preSpeechFrames.push(frameCopy);
            const maxFrames = Math.max(1, Math.ceil(config.preSpeechPadMs / frameMs));
            if (preSpeechFrames.length > maxFrames) {
              preSpeechFrames.splice(0, preSpeechFrames.length - maxFrames);
            }
          }
        },
        onSpeechStart: () => {
          cancelSpeculation();
          voiceTurnIdRef.current = onVoiceTurnStart();
          bargeInConfirmedRef.current = false;
          turnFramesRef.current = preSpeechFramesRef.current.map(frame => frame.slice());
          preSpeechFramesRef.current = [];
          silenceMsRef.current = 0;

          setNotice("Listening...");
          if (audioMotionRef.current) {
            audioMotionRef.current.gradient = "rainbow";
            audioMotionRef.current.volume = 0;
          }
        },
        // Do not interrupt on tentative speech. Silero invokes this only after
        // the segment has accumulated minSpeechMs of speech-positive frames.
        onSpeechRealStart: confirmBargeIn,
        onSpeechEnd: async (audio: Float32Array) => {
          // onSpeechRealStart should already have confirmed a valid segment.
          // Keep this as a safeguard for runtimes that omit that callback.
          confirmBargeIn();
          const turnId = voiceTurnIdRef.current;
          const speculativeRequest = speculativeRequestRef.current;
          speculativeRequestRef.current = null;
          turnFramesRef.current = null;
          silenceMsRef.current = 0;
          onVadComplete(turnId);
          voiceTurnIdRef.current = null;
          onSpeechEnded(turnId);
          setNotice("Waiting for speech to text");

          try {
            let transcript =
              speculativeRequest && speculativeRequest.revision === speculationRevisionRef.current
                ? await speculativeRequest.promise
                : null;
            if (transcript === null) {
              onAsrStarted(turnId);
              transcript = await transcribe(audio, turnId);
            }
            onTranscriptionReady(turnId);
            setNotice("");
            onSpeechResult(transcript, turnId || undefined);
          } catch (error) {
            onVoiceTurnFailed(turnId);
            console.error("VAD speech-to-text request failed:", error);
            setNotice("Speech to text failed");
            window.setTimeout(() => setNotice(""), 2000);
          }
        },
        onVADMisfire: () => {
          cancelSpeculation();
          const turnId = voiceTurnIdRef.current;
          turnFramesRef.current = null;
          silenceMsRef.current = 0;
          onVadComplete(turnId);
          onVadMisfire(turnId);
          voiceTurnIdRef.current = null;
          bargeInConfirmedRef.current = false;
          setNotice("");
        },
      })) as VadInstance;
      instance = createdInstance;
      if (generation !== vadGenerationRef.current) {
        createdInstance.pause();
        return;
      }
      vadRef.current = createdInstance;

      if (audioMotionRef.current) {
        audioMotionRef.current.gradient = "rainbow";
      }
      connectStream(createdInstance.stream);
      createdInstance.start();
      onRuntimeStateChange({ status: "ready" });
    } catch (error) {
      if (generation !== vadGenerationRef.current) return;
      if (instance) instance.pause();
      vadRef.current = null;
      onRuntimeStateChange({ status: "error", message: describeVadStartupError(error) });
    }
  }, [
    audioMotionRef,
    cancelSpeculation,
    config,
    confirmBargeIn,
    connectStream,
    onAsrStarted,
    onSpeechEnded,
    onSpeechResult,
    onTranscriptionReady,
    onVoiceTurnFailed,
    onVoiceTurnStart,
    onVadComplete,
    onVadFrame,
    onVadMisfire,
    onRuntimeStateChange,
    setNotice,
    startSpeculation,
    transcribe,
  ]);

  const stopVAD = useCallback(() => {
    vadGenerationRef.current += 1;
    cancelSpeculation();
    turnFramesRef.current = null;
    preSpeechFramesRef.current = [];
    silenceMsRef.current = 0;
    bargeInConfirmedRef.current = false;
    if (audioMotionRef.current && micStreamRef.current) {
      audioMotionRef.current.disconnectInput(micStreamRef.current, true);
    }
    if (vadRef.current) {
      vadRef.current.pause();
    }
  }, [audioMotionRef, cancelSpeculation, micStreamRef]);

  useEffect(() => stopVAD, [stopVAD]);

  return { startVAD, stopVAD };
}
