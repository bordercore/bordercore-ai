import { useRef, useCallback, useEffect } from "react";
import { encodeWAV } from "../utils/audio";
import axios from "axios";
import AudioMotionAnalyzer from "audiomotion-analyzer";

// Declare global vad type from CDN script
declare const vad: any;

const VAD_ASSET_BASE = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/";
const ONNX_WASM_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

interface UseVADOptions {
  audioMotionRef: React.RefObject<AudioMotionAnalyzer | null>;
  micStreamRef: React.MutableRefObject<MediaStreamAudioSourceNode | null>;
  connectStream: (stream: MediaStream) => void;
  onSpeechResult: (text: string, voiceTurnId?: string) => void;
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
    setNotice,
  } = options;

  const vadRef = useRef<any>(null);
  const bargeInConfirmedRef = useRef(false);
  const voiceTurnIdRef = useRef<string | null>(null);

  const confirmBargeIn = useCallback(() => {
    if (bargeInConfirmedRef.current) return;
    bargeInConfirmedRef.current = true;
    onVadConfirmed(voiceTurnIdRef.current);
    onBargeIn();
  }, [onBargeIn, onVadConfirmed]);

  const startVAD = useCallback(async () => {
    vadRef.current = await vad.MicVAD.new({
      model: "v5",
      baseAssetPath: VAD_ASSET_BASE,
      onnxWASMBasePath: ONNX_WASM_BASE,
      // Pin the documented detector defaults so a future library update
      // cannot silently change turn timing or sensitivity.
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      redemptionMs: 1400,
      preSpeechPadMs: 800,
      // Keep short conversational utterances such as "Howdy" while still
      // rejecting clicks and other very brief transients.
      minSpeechMs: 250,
      onFrameProcessed: (probabilities: { isSpeech: number }) => {
        onVadFrame(voiceTurnIdRef.current, probabilities.isSpeech);
      },
      onSpeechStart: () => {
        voiceTurnIdRef.current = onVoiceTurnStart();
        bargeInConfirmedRef.current = false;

        setNotice("Listening...");
        if (audioMotionRef.current) {
          audioMotionRef.current.gradient = "rainbow";
          audioMotionRef.current.volume = 0;
        }
      },
      // Do not interrupt on tentative speech. Silero invokes this only after
      // the segment has accumulated minSpeechMs of speech-positive frames.
      onSpeechRealStart: confirmBargeIn,
      onSpeechEnd: (audio: Float32Array) => {
        // onSpeechRealStart should already have confirmed a valid segment.
        // Keep this as a safeguard for runtimes that omit that callback.
        confirmBargeIn();
        const turnId = voiceTurnIdRef.current;
        onVadComplete(turnId);
        voiceTurnIdRef.current = null;
        onSpeechEnded(turnId);
        onAsrStarted(turnId);
        setNotice("");
        const wavBuffer = encodeWAV(audio);
        const blob = new Blob([wavBuffer], { type: "audio/wav" });
        const formData = new FormData();
        formData.append("audio", blob);
        if (turnId) formData.append("voice_turn_id", turnId);
        setNotice("Waiting for speech to text");

        axios
          .post("/speech2text", formData)
          .then(response => {
            onTranscriptionReady(turnId);
            setNotice("");
            onSpeechResult(response.data.input, turnId || undefined);
          })
          .catch(error => {
            onVoiceTurnFailed(turnId);
            console.error("VAD speech-to-text request failed:", error);
            setNotice("Speech to text failed");
            window.setTimeout(() => setNotice(""), 2000);
          });
      },
      onVADMisfire: () => {
        const turnId = voiceTurnIdRef.current;
        onVadComplete(turnId);
        onVadMisfire(turnId);
        voiceTurnIdRef.current = null;
        bargeInConfirmedRef.current = false;
        setNotice("");
      },
    });

    if (audioMotionRef.current) {
      audioMotionRef.current.gradient = "rainbow";
    }
    connectStream(vadRef.current.stream);
    vadRef.current.start();
  }, [
    audioMotionRef,
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
    setNotice,
  ]);

  const stopVAD = useCallback(() => {
    bargeInConfirmedRef.current = false;
    if (audioMotionRef.current && micStreamRef.current) {
      audioMotionRef.current.disconnectInput(micStreamRef.current, true);
    }
    if (vadRef.current) {
      vadRef.current.pause();
    }
  }, [audioMotionRef, micStreamRef]);

  useEffect(() => stopVAD, [stopVAD]);

  return { startVAD, stopVAD };
}
