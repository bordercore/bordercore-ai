import { useRef, useCallback } from "react";
import AudioMotionAnalyzer from "audiomotion-analyzer";
import axios from "axios";

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Initialize audio element once
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

  const doTTS = useCallback(
    (response: string, speak: boolean, ttsHost: string, audioSpeed: number) => {
      if (!speak) return;

      const voice = session.tts_voice;
      const outputFile = "stream_output.wav";
      const streamingUrl = `${ttsHost}/?text=${encodeURIComponent(response)}&voice=${voice}&language=en&output_file=${outputFile}`;
      audioElementRef.current!.src = streamingUrl;
      if (audioMotionRef.current) {
        audioMotionRef.current.gradient = "steelblue";
        audioMotionRef.current.volume = 1;
      }
      audioElementRef.current!.playbackRate = audioSpeed;
      audioElementRef.current!.play();
    },
    [session]
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
        .then((stream) => {
          connectStream(stream);

          const recorder = new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;
          recorder.start();

          recorder.ondataavailable = (event) => {
            audioChunksRef.current.push(event.data);
          };

          recorder.onstop = () => {
            setNotice("");
            const blob = new Blob(audioChunksRef.current, { type: "audio/wav" });
            const formData = new FormData();
            formData.append("audio", blob);
            setNotice("Waiting for speech to text");

            axios
              .post("/speech2text", formData, {
                headers: { "Content-Type": "multipart/form-data" },
              })
              .then((response) => {
                setNotice("");
                onSpeechResult(response.data.input);
                audioChunksRef.current = [];
              });
          };
        })
        .catch((err) => {
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
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
    }
  }, []);

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
