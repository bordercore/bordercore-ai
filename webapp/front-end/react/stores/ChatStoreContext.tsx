import React, { createContext, useContext, useState, useMemo, useCallback, ReactNode } from "react";

export interface ChatMessage {
  id: number;
  content: string;
  role: "system" | "user" | "assistant";
  thinking?: string;
}

export interface Switches {
  text2speech: boolean;
  speech2text: boolean;
  vad: boolean;
  wolframAlpha: boolean;
  enableThinking: boolean;
}

export type VisualizationType = "gpuOrb" | "thinkingIcon" | "nexus";

export interface ModelInfo {
  name: string;
  model?: string;
  type?: string;
  thinking?: boolean;
  qwen_vision?: boolean | null;
  [key: string]: any;
}

export interface ClipboardData {
  content: string;
  id: number;
}

interface ChatStoreContextType {
  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  mode: string;
  setMode: (mode: string) => void;
  model: ModelInfo;
  setModel: (model: ModelInfo) => void;
  modelList: ModelInfo[];
  setModelList: (list: ModelInfo[]) => void;
  switches: Switches;
  setSwitches: (switches: Switches) => void;
  visualization: VisualizationType;
  setVisualization: (v: VisualizationType) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  audioSpeed: number;
  setAudioSpeed: (speed: number) => void;
  ttsHost: string;
  setTtsHost: (host: string) => void;
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  error: any;
  setError: (error: any) => void;
  clipboard: ClipboardData | null;
  setClipboard: (clipboard: ClipboardData | null) => void;
  url: string;
  setUrl: (url: string) => void;
  waiting: boolean;
  setWaiting: (waiting: boolean) => void;
  notice: string;
  setNotice: (notice: string) => void;
  uploadedFilename: string | null;
  setUploadedFilename: (filename: string | null) => void;
  visionImage: File | null;
  setVisionImage: (image: File | null) => void;
  ragFileUploaded: boolean;
  setRagFileUploaded: (uploaded: boolean) => void;
  ragFileSize: number | null;
  setRagFileSize: (size: number | null) => void;
  audioFileTranscript: string | null;
  setAudioFileTranscript: (transcript: string | null) => void;
  audioFileSize: number | null;
  setAudioFileSize: (size: number | null) => void;
  audioIsPlayingOrPaused: boolean;
  setAudioIsPlayingOrPaused: (playing: boolean) => void;
  musicInfo: any[] | null;
  setMusicInfo: (info: any[] | null) => void;
  currentSong: any;
  setCurrentSong: (song: any) => void;
  sha1sum: string;
  setSha1sum: (sha1sum: string) => void;
  isDragOver: boolean;
  setIsDragOver: (isDragOver: boolean) => void;
  showMenu: boolean;
  setShowMenu: (show: boolean) => void;
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;
  nextId: () => number;

  // Computed values
  filteredChatHistory: ChatMessage[];
  chatEndpoint: string;
  inputIsDisabled: boolean;
}

const ChatStoreContext = createContext<ChatStoreContextType | undefined>(undefined);

interface ChatStoreProviderProps {
  children: ReactNode;
  session: any;
}

export function ChatStoreProvider({ children, session }: ChatStoreProviderProps) {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { id: 1, content: "You are a helpful assistant.", role: "system" },
  ]);
  const [mode, setMode] = useState("Chat");
  const [model, setModel] = useState<ModelInfo>({} as ModelInfo);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [switches, setSwitches] = useState<Switches>({
    text2speech: session.speak !== undefined ? session.speak : false,
    speech2text: false,
    vad: false,
    wolframAlpha: false,
    enableThinking: session.enable_thinking !== undefined ? session.enable_thinking : false,
  });
  const [visualization, setVisualization] = useState<VisualizationType>(session.visualization || "gpuOrb");
  const [temperature, setTemperature] = useState(session.temperature || 0.7);
  const [audioSpeed, setAudioSpeed] = useState(session.audio_speed || 1);
  const [ttsHost, setTtsHost] = useState(session.tts_host || "");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<any>("");
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [url, setUrl] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [visionImage, setVisionImage] = useState<File | null>(null);
  const [ragFileUploaded, setRagFileUploaded] = useState(false);
  const [ragFileSize, setRagFileSize] = useState<number | null>(null);
  const [audioFileTranscript, setAudioFileTranscript] = useState<string | null>(null);
  const [audioFileSize, setAudioFileSize] = useState<number | null>(null);
  const [audioIsPlayingOrPaused, setAudioIsPlayingOrPaused] = useState(false);
  const [musicInfo, setMusicInfo] = useState<any[] | null>(null);
  const [currentSong, setCurrentSong] = useState<any>({});
  const [sha1sum, setSha1sum] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // ID counter ref (not state to avoid re-renders)
  const idRef = React.useRef(1);
  const nextId = useCallback(() => {
    idRef.current++;
    return idRef.current;
  }, []);

  const filteredChatHistory = useMemo(
    () => chatHistory.filter((x) => x.role !== "system"),
    [chatHistory]
  );

  const chatEndpoint = useMemo(() => {
    switch (mode) {
      case "Audio":
        return "/audio/chat";
      case "RAG":
        return "/rag/chat";
      default:
        return "/chat";
    }
  }, [mode]);

  const inputIsDisabled = useMemo(() => {
    if (mode === "Vision" && !visionImage) return true;
    if (mode === "RAG" && !ragFileUploaded) return true;
    return false;
  }, [mode, visionImage, ragFileUploaded]);

  const value = useMemo(
    () => ({
      chatHistory,
      setChatHistory,
      mode,
      setMode,
      model,
      setModel,
      modelList,
      setModelList,
      switches,
      setSwitches,
      visualization,
      setVisualization,
      temperature,
      setTemperature,
      audioSpeed,
      setAudioSpeed,
      ttsHost,
      setTtsHost,
      prompt,
      setPrompt,
      error,
      setError,
      clipboard,
      setClipboard,
      url,
      setUrl,
      waiting,
      setWaiting,
      notice,
      setNotice,
      uploadedFilename,
      setUploadedFilename,
      visionImage,
      setVisionImage,
      ragFileUploaded,
      setRagFileUploaded,
      ragFileSize,
      setRagFileSize,
      audioFileTranscript,
      setAudioFileTranscript,
      audioFileSize,
      setAudioFileSize,
      audioIsPlayingOrPaused,
      setAudioIsPlayingOrPaused,
      musicInfo,
      setMusicInfo,
      currentSong,
      setCurrentSong,
      sha1sum,
      setSha1sum,
      isDragOver,
      setIsDragOver,
      showMenu,
      setShowMenu,
      isGenerating,
      setIsGenerating,
      nextId,
      filteredChatHistory,
      chatEndpoint,
      inputIsDisabled,
    }),
    [
      chatHistory,
      mode,
      model,
      modelList,
      switches,
      visualization,
      temperature,
      audioSpeed,
      ttsHost,
      prompt,
      error,
      clipboard,
      url,
      waiting,
      notice,
      uploadedFilename,
      visionImage,
      ragFileUploaded,
      ragFileSize,
      audioFileTranscript,
      audioFileSize,
      audioIsPlayingOrPaused,
      musicInfo,
      currentSong,
      sha1sum,
      isDragOver,
      showMenu,
      isGenerating,
      nextId,
      filteredChatHistory,
      chatEndpoint,
      inputIsDisabled,
    ]
  );

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore() {
  const context = useContext(ChatStoreContext);
  if (context === undefined) {
    throw new Error("useChatStore must be used within a ChatStoreProvider");
  }
  return context;
}
