import { useRef, useCallback } from "react";
import { encodeWAV } from "../utils/audio";
import axios from "axios";
import AudioMotionAnalyzer from "audiomotion-analyzer";

// Declare global vad type from CDN script
declare const vad: any;

interface UseVADOptions {
  audioMotionRef: React.RefObject<AudioMotionAnalyzer | null>;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  micStreamRef: React.MutableRefObject<MediaStreamAudioSourceNode | null>;
  connectStream: (stream: MediaStream) => void;
  onSpeechResult: (text: string) => void;
  setNotice: (notice: string) => void;
}

export default function useVAD(options: UseVADOptions) {
  const {
    audioMotionRef,
    audioElementRef,
    micStreamRef,
    connectStream,
    onSpeechResult,
    setNotice,
  } = options;

  const vadRef = useRef<any>(null);

  const startVAD = useCallback(async () => {
    vadRef.current = await vad.MicVAD.new({
      onSpeechStart: () => {
        // Stop any TTS currently playing
        if (audioElementRef.current) {
          audioElementRef.current.pause();
          audioElementRef.current.src = "";
        }

        setNotice("Listening...");
        if (audioMotionRef.current) {
          audioMotionRef.current.gradient = "rainbow";
          audioMotionRef.current.volume = 0;
        }
      },
      onSpeechEnd: (audio: Float32Array) => {
        setNotice("");
        const wavBuffer = encodeWAV(audio);
        const blob = new Blob([wavBuffer], { type: "audio/wav" });
        const formData = new FormData();
        formData.append("audio", blob);
        setNotice("Waiting for speech to text");

        axios
          .post("/speech2text", formData)
          .then((response) => {
            onSpeechResult(response.data.input);
          });
      },
    });

    if (audioMotionRef.current) {
      audioMotionRef.current.gradient = "rainbow";
    }
    connectStream(vadRef.current.stream);
    vadRef.current.start();
  }, [audioMotionRef, audioElementRef, connectStream, onSpeechResult, setNotice]);

  const stopVAD = useCallback(() => {
    if (audioMotionRef.current && micStreamRef.current) {
      audioMotionRef.current.disconnectInput(micStreamRef.current, true);
    }
    if (vadRef.current) {
      vadRef.current.pause();
    }
  }, [audioMotionRef, micStreamRef]);

  return { startVAD, stopVAD };
}
