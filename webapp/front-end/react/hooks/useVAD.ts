import { useRef, useCallback, useEffect } from "react";
import { encodeWAV } from "../utils/audio";
import axios from "axios";
import AudioMotionAnalyzer from "audiomotion-analyzer";

// Declare global vad type from CDN script
declare const vad: any;

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
    setNotice,
  } = options;

  const vadRef = useRef<any>(null);
  const bargeInTimerRef = useRef<number | null>(null);
  const bargeInConfirmedRef = useRef(false);
  const voiceTurnIdRef = useRef<string | null>(null);

  const confirmBargeIn = useCallback(() => {
    if (bargeInConfirmedRef.current) return;
    bargeInConfirmedRef.current = true;
    if (bargeInTimerRef.current !== null) {
      window.clearTimeout(bargeInTimerRef.current);
      bargeInTimerRef.current = null;
    }
    onBargeIn();
  }, [onBargeIn]);

  const startVAD = useCallback(async () => {
    vadRef.current = await vad.MicVAD.new({
      onSpeechStart: () => {
        voiceTurnIdRef.current = onVoiceTurnStart();
        bargeInConfirmedRef.current = false;
        if (bargeInTimerRef.current !== null) window.clearTimeout(bargeInTimerRef.current);
        bargeInTimerRef.current = window.setTimeout(() => {
          bargeInTimerRef.current = null;
          confirmBargeIn();
        }, 150);

        setNotice("Listening...");
        if (audioMotionRef.current) {
          audioMotionRef.current.gradient = "rainbow";
          audioMotionRef.current.volume = 0;
        }
      },
      onSpeechEnd: (audio: Float32Array) => {
        // A short utterance that ends inside the debounce window is itself
        // confirmation. Interrupt before starting ASR so a fast transcript
        // cannot accidentally cancel the next response.
        confirmBargeIn();
        const turnId = voiceTurnIdRef.current;
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
    setNotice,
  ]);

  const stopVAD = useCallback(() => {
    if (bargeInTimerRef.current !== null) {
      window.clearTimeout(bargeInTimerRef.current);
      bargeInTimerRef.current = null;
    }
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
