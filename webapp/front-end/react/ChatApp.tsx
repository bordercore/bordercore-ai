import React, { useEffect, useCallback, useRef, useState } from "react";
import { Modal } from "bootstrap";
import axios from "axios";

import { useChatStore, Switches } from "./stores/ChatStoreContext";
import { doGet, doPost } from "./utils/reactUtils";
import { convertBase64ToBytes } from "./utils/audio";
import { animateCSS } from "./utils/animateCSS";

import Nav from "./components/Nav";
import ChatInput from "./components/ChatInput";
import MessageList from "./components/MessageList";
import ModelSelect from "./components/ModelSelect";
import GpuOrb from "./components/GpuOrb";
import ThinkingIcon from "./components/ThinkingIcon";
import Options from "./components/Options";
import FileUpload from "./components/FileUpload";
import ImagePreview from "./components/ImagePreview";
import AudioPlayer from "./components/AudioPlayer";
import PreferencesMenu from "./components/PreferencesMenu";
import ToastContainer from "./components/Toast";

import useStreamingChat from "./hooks/useStreamingChat";
import useAudio from "./hooks/useAudio";
import useVAD from "./hooks/useVAD";
import useSensor from "./hooks/useSensor";
import useClipboardPaste from "./hooks/useClipboardPaste";
import useEvent from "./hooks/useEvent";

interface ChatAppProps {
  session: any;
  settings: any;
  controlValue: string;
}

export default function ChatApp({ session, settings, controlValue }: ChatAppProps) {
  const store = useChatStore();
  const {
    chatHistory, setChatHistory,
    mode, setMode,
    model, setModel,
    modelList, setModelList,
    switches, setSwitches,
    temperature, setTemperature,
    audioSpeed, setAudioSpeed,
    ttsHost, setTtsHost,
    prompt, setPrompt,
    error, setError,
    clipboard, setClipboard,
    url, setUrl,
    waiting, setWaiting,
    notice, setNotice,
    uploadedFilename, setUploadedFilename,
    visionImage, setVisionImage,
    ragFileUploaded, setRagFileUploaded,
    ragFileSize, setRagFileSize,
    audioFileTranscript, setAudioFileTranscript,
    audioFileSize, setAudioFileSize,
    audioIsPlayingOrPaused, setAudioIsPlayingOrPaused,
    musicInfo, setMusicInfo,
    currentSong, setCurrentSong,
    sha1sum, setSha1sum,
    isDragOver, setIsDragOver,
    showMenu, setShowMenu,
    isGenerating, setIsGenerating,
    nextId,
    filteredChatHistory,
    chatEndpoint,
    inputIsDisabled,
  } = store;

  const [copyIcon, setCopyIcon] = useState("copy");
  const [imageSrc, setImageSrc] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  const sensorDetectModeRef = useRef(true);
  const sensorThreshold = settings.sensor_threshold ?? 100;

  // --- Hooks ---
  const { sendMessage, stopGeneration, abortControllerRef } = useStreamingChat();

  // Use ref to always call the latest handleSendMessage (avoids stale closures)
  const handleSendMessageRef = useRef(handleSendMessage);
  handleSendMessageRef.current = handleSendMessage;

  const handleSpeechResult = useCallback(
    (text: string) => {
      handleSendMessageRef.current(text);
    },
    []
  );

  const audioHook = useAudio({
    session,
    onSpeechResult: handleSpeechResult,
    setNotice,
  });

  const vadHook = useVAD({
    audioMotionRef: audioHook.audioMotionRef,
    audioElementRef: audioHook.audioElementRef,
    micStreamRef: audioHook.micStreamRef,
    connectStream: audioHook.connectStream,
    onSpeechResult: handleSpeechResult,
    setNotice,
  });

  const handleSensorData = useCallback(
    (data: any) => {
      if (data.moving_target_energy === sensorThreshold && sensorDetectModeRef.current) {
        sensorDetectModeRef.current = false;
        audioHook.handleListen(true);
        setTimeout(() => {
          sensorDetectModeRef.current = true;
        }, 2000);
      }
    },
    [sensorThreshold, audioHook]
  );

  const sensorHook = useSensor({
    sensorUri: settings.sensor_uri || "",
    onSensorData: handleSensorData,
  });

  // --- Clipboard paste hook ---
  useClipboardPaste({
    onURL: useCallback(
      (pastedUrl: string) => {
        setUrl(pastedUrl);
        setPrompt("");
        if (mode === "Audio") {
          handleTranscribeAudioUrl(pastedUrl);
        }
      },
      [mode]
    ),
    onLongText: useCallback(
      (text: string, id: number) => {
        setClipboard({ content: text, id });
      },
      []
    ),
    onShortText: useCallback(
      (text: string) => {
        setPrompt((prev) => prev + text);
      },
      []
    ),
    getNextId: nextId,
  });

  // --- Audio player events ---
  useEvent("ended", handleAudioEnded as EventListener, { id: "player" });
  useEvent("pause", handleAudioPlayerPause as EventListener, { id: "player" });
  useEvent("play", handleAudioPlayerPlay as EventListener, { id: "player" });

  // --- Switch change handling ---
  const prevSwitchesRef = useRef(switches);
  useEffect(() => {
    const prev = prevSwitchesRef.current;

    if (prev.speech2text !== switches.speech2text) {
      if (switches.speech2text) {
        audioHook.handleListen(true);
      }
    }

    if (prev.vad !== switches.vad) {
      if (switches.vad) {
        vadHook.startVAD();
      } else {
        vadHook.stopVAD();
      }
    }

    prevSwitchesRef.current = switches;
  }, [switches]);

  // --- Mount effects ---
  useEffect(() => {
    audioHook.createAudioMotionAnalyzer();

    // Click outside to close menu
    function handleDocClick(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        hamburgerRef.current &&
        !hamburgerRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    }
    document.addEventListener("click", handleDocClick);

    getModelInfo();
    getModelList();

    setTimeout(() => {
      document.getElementById("prompt")?.focus();
    });

    return () => {
      document.removeEventListener("click", handleDocClick);
    };
  }, []);

  // --- Helper functions ---
  function getModelAttribute(modelName: string, attribute: string) {
    const result = modelList.find((obj) => obj.model === modelName);
    return result ? result[attribute] : "";
  }

  function getModelIcon(m: any) {
    if (m.thinking) return "\uD83E\uDDE0";
    if (m.qwen_vision) return "\uD83D\uDC41\uFE0F";
    if (m.type === "api") return "\u2601\uFE0F";
    return "";
  }

  function removeThinkingField(array: any[]) {
    return array.map((obj) => {
      const newObj = { ...obj };
      if ("thinking" in newObj) delete newObj.thinking;
      return newObj;
    });
  }

  function addClipboardToMessages() {
    if (!clipboard) return chatHistory;
    const copiedArray = JSON.parse(JSON.stringify(chatHistory));
    copiedArray.forEach((element: any) => {
      if (element.id === clipboard.id) {
        element.content += ": " + clipboard.content;
      }
    });
    return copiedArray;
  }

  function addMessage(role: "user" | "assistant", message: string) {
    const id = nextId();
    setChatHistory((prev) => [...prev, { id, content: message, role }]);
  }

  function getModelInfo() {
    doGet("/info", (response: any) => setModel(response.data), "Error getting model info");
  }

  function getModelList() {
    doGet("/list", (response: any) => setModelList(response.data), "Error getting model list");
  }

  // --- Event handlers ---
  function handleSwitchMode(newMode: string) {
    setMode(newMode);
  }

  function handleChangeModel(modelName: string) {
    const modelType = getModelAttribute(modelName, "type");
    let modal: Modal | null = null;
    if (modelType !== "api") {
      modal = new Modal("#modalProcessing");
      modal.show();
    }
    doPost(
      "/load",
      { model: modelName },
      () => {
        getModelInfo();
        if (modelType !== "api" && modal) {
          setTimeout(() => modal!.hide(), 500);
        }
      },
      "",
      () => {
        if (modelType !== "api" && modal) {
          setTimeout(() => modal!.hide(), 500);
        }
      }
    );
  }

  function handleNewChat() {
    setChatHistory([chatHistory[0]]);
    setClipboard(null);
    setUrl("");
    setError("");
    setVisionImage(null);
  }

  function handleSendMessage(message?: string) {
    const msg = message ?? prompt;
    if (mode === "RAG") {
      handleSendMessageRag();
    } else if (mode === "Audio") {
      handleSendMessageAudio();
    } else if (mode === "Vision") {
      handleSendMessageVision();
    } else {
      sendMessageToChatbot(msg);
    }
  }

  function handleSendMessageRag() {
    sendMessageToChatbot(prompt, { sha1sum });
  }

  function handleSendMessageAudio() {
    if (!audioFileTranscript) return;
    sendMessageToChatbot(prompt, { transcript: audioFileTranscript });
  }

  function handleSendMessageVision(regenerate = false) {
    if (!visionImage) return;
    const reader = new FileReader();
    reader.onload = function (event) {
      sendMessageToChatbot(prompt, { image: event.target!.result as string }, regenerate);
    };
    reader.readAsDataURL(visionImage);
  }

  function handleRegenerate() {
    if (mode === "Vision") {
      handleSendMessageVision(true);
    } else {
      sendMessageToChatbot(prompt, {}, true);
    }
  }

  function handleStopGeneration() {
    audioHook.pauseAudio();
    stopGeneration();
  }

  function handleToggleSwitch(key: keyof Switches) {
    setSwitches({ ...switches, [key]: !switches[key] });
  }

  function handleSensorToggle() {
    sensorHook.toggleSensor(true);
  }

  function handleClipboardClick() {
    const modal = new Modal("#modalClipboard");
    modal.show();
  }

  function handleDeleteClipboard() {
    const el = document.getElementById("modalClipboard");
    if (el) {
      const modal = Modal.getInstance(el);
      modal?.hide();
    }
    setTimeout(() => setClipboard(null), 500);
  }

  function handleCopyText() {
    if (navigator.clipboard && audioFileTranscript) {
      navigator.clipboard.writeText(audioFileTranscript);
      setCopyIcon("check");
      setTimeout(() => setCopyIcon("copy"), 2000);
    }
  }

  function handleTranscribeAudio(event: React.ChangeEvent<HTMLInputElement>) {
    handleTranscribeAudioInternal(event);
  }

  function handleTranscribeAudioUrl(audioUrl: string) {
    handleTranscribeAudioInternal(null, audioUrl);
  }

  function handleTranscribeAudioInternal(
    event: React.ChangeEvent<HTMLInputElement> | null,
    audioUrl: string | null = null
  ) {
    const formData = new FormData();
    let fileData: File | null = null;
    let endpoint: string;

    if (audioUrl) {
      endpoint = "audio/upload/url";
      formData.append("url", audioUrl);
    } else {
      endpoint = "audio/upload/file";
      fileData = event!.target.files![0];
      if (!fileData) return;
      formData.append("file", fileData);
    }

    const modal = new Modal("#modalProcessing");
    modal.show();

    axios
      .post(endpoint, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((response) => {
        setAudioFileTranscript(response.data.text);
        setAudioFileSize(response.data.text.length);
        if (audioUrl) {
          setUploadedFilename(response.data.title);
        } else {
          setUploadedFilename(event!.target.files![0].name);
        }
        modal.hide();
        // Load audio into player
        const el = document.getElementById("audioPlayer");
        if (el) el.classList.replace("d-none", "d-flex");
        const playerEl = document.getElementById("player") as HTMLAudioElement;
        if (audioUrl) {
          fileData = convertBase64ToBytes(response.data) as any;
        }
        const audioURL = URL.createObjectURL(fileData as any);
        if (playerEl) playerEl.src = audioURL;
      });
  }

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const modal = new Modal("#modalProcessing");
    modal.show();

    const formData = new FormData();
    const fileData = event.target.files?.[0];
    if (!fileData) return;
    setRagFileSize(fileData.size);
    formData.append("file", fileData);

    axios
      .post("rag/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((response) => {
        setRagFileUploaded(true);
        setSha1sum(response.data.sha1sum);
        setUploadedFilename(event.target.files![0].name);
        window.setTimeout(() => {
          const modalEl = document.getElementById("modalProcessing");
          if (modalEl) {
            const m = Modal.getInstance(modalEl);
            m?.hide();
          }
        }, 500);
      });
  }

  function handleFileUploadVision(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setVisionImage(file);

    const reader = new FileReader();
    reader.onload = function (ev) {
      setImageSrc(ev.target!.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleImageDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
    const image = event.dataTransfer.files[0];
    if (image && image.type.indexOf("image/") >= 0) {
      setVisionImage(image);
      const reader = new FileReader();
      reader.onload = function (ev) {
        setImageSrc(ev.target!.result as string);
      };
      reader.readAsDataURL(image);
    }
  }

  function handleAudioPlayerPlay() {
    if (audioIsPlayingOrPaused) {
      const el = document.getElementById("isPlaying") as HTMLImageElement;
      if (el) el.src = "/static/img/equaliser-animated-green.gif";
    } else {
      setAudioIsPlayingOrPaused(true);
    }
  }

  function handleAudioPlayerPause() {
    const el = document.getElementById("isPlaying") as HTMLImageElement;
    if (el) el.src = "/static/img/equaliser-animated-green-frozen.gif";
  }

  function handleAudioEnded() {
    if (musicInfo && musicInfo.length > 0) {
      const idx = musicInfo.findIndex((x) => x === currentSong);
      if (idx < musicInfo.length - 1) {
        playSong(musicInfo[idx + 1]);
      } else {
        setMusicInfo(null);
      }
    }
  }

  function handleSongBackward(event: React.MouseEvent) {
    if (!musicInfo) return;
    const idx = musicInfo.findIndex((x) => x === currentSong);
    if (idx > 0) {
      animateCSS(event.currentTarget as HTMLElement, "heartBeat");
      playSong(musicInfo[idx - 1]);
    }
  }

  function handleSongForward(event: React.MouseEvent) {
    if (!musicInfo) return;
    const idx = musicInfo.findIndex((x) => x === currentSong);
    if (idx < musicInfo.length - 1) {
      animateCSS(event.currentTarget as HTMLElement, "heartBeat");
      playSong(musicInfo[idx + 1]);
    }
  }

  async function playSong(song: any) {
    setChatHistory((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        content: `Playing **${song.title}** by **${song.artist}**`,
      };
      return updated;
    });

    const el = document.getElementById("audioPlayer");
    if (el) el.classList.replace("d-none", "d-flex");
    const playerEl = document.getElementById("player") as HTMLAudioElement;
    setCurrentSong(song);
    if (playerEl) {
      playerEl.src = settings.music_uri + song.uuid;
      playerEl.play();
    }

    try {
      const myModule = await import(/* @vite-ignore */ "@optional-module");
      myModule.run(song.uuid);
    } catch {
      // Optional module not available
    }
  }

  // --- Core streaming function ---
  function sendMessageToChatbot(message: string, args: Record<string, any> = {}, regenerate = false) {
    if (
      mode === "Vision" &&
      getModelAttribute(model.name, "qwen_vision") === null
    ) {
      setError({
        body: "Error: you must load a vision model to use this feature.",
        variant: "danger",
      });
      return;
    }

    // Build history synchronously before any state updates to avoid stale closures.
    // React batches setChatHistory, so we must compute the payload from a local copy.
    let currentHistory = chatHistory;

    if (regenerate) {
      if (!error) {
        currentHistory = currentHistory.slice(0, -1);
      }
    } else {
      const id = nextId();
      currentHistory = [...currentHistory, { id, content: message, role: "user" as const }];
    }

    // Build messages from the up-to-date history (including clipboard injection)
    const messagesWithClipboard = clipboard
      ? currentHistory.map((el) =>
          el.id === clipboard.id
            ? { ...el, content: el.content + ": " + clipboard.content }
            : el
        )
      : currentHistory;
    const messages = removeThinkingField(messagesWithClipboard);

    // Add empty assistant message for streaming
    const assistantId = nextId();
    const historyWithAssistant = [...currentHistory, { id: assistantId, content: "", role: "assistant" as const }];

    // Now update state
    setChatHistory(historyWithAssistant);
    setError("");
    setPrompt("");

    const payload: Record<string, any> = {
      message: JSON.stringify(messages),
      model: model.name,
      audio_speed: audioSpeed,
      speak: switches.text2speech,
      temperature,
      wolfram_alpha: switches.wolframAlpha,
      enable_thinking: switches.enableThinking,
      url,
      ...args,
    };

    sendMessage(payload, {
      chatEndpoint,
      controlValue,
      onStreamStart: () => {},
      onStreamChunk: (cleanedContent: string) => {
        setChatHistory((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: cleanedContent,
          };
          return updated;
        });
      },
      onStreamEnd: (result: string, buffer: string) => {
        // Handle control payloads
        if (
          buffer.slice(0, controlValue.length) === controlValue &&
          buffer.length > controlValue.length
        ) {
          const jsonObject = JSON.parse(buffer.slice(controlValue.length));
          if (jsonObject?.music_info) {
            if (jsonObject.music_info.length > 0) {
              setMusicInfo(jsonObject.music_info);
              playSong(jsonObject.music_info[0]);
            } else {
              setChatHistory((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: "No music found.",
                };
                return updated;
              });
            }
          } else if (jsonObject?.content && jsonObject?.lights) {
            setChatHistory((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: jsonObject.content,
              };
              return updated;
            });
          }
        }

        audioHook.doTTS(result, switches.text2speech, ttsHost, audioSpeed);
      },
      onStreamError: (err: Error) => {
        setError({ body: "Error communicating with webapp.", variant: "danger" });
        console.error("Error:", err);
      },
      onAbort: (hasContent: boolean) => {
        setChatHistory((prev) => {
          const updated = [...prev];
          const lastMessage = updated[updated.length - 1];
          if (lastMessage?.role === "assistant") {
            if (!lastMessage.content || !lastMessage.content.trim()) {
              return updated.slice(0, -1);
            } else {
              updated[updated.length - 1] = {
                ...lastMessage,
                content: `${lastMessage.content.trimEnd()}\n\n_Generation stopped._`,
              };
            }
          }
          return updated;
        });
      },
      setWaiting,
      setIsGenerating,
    });
  }

  const showRegenerate = chatHistory.length > 2 || !!error;

  return (
    <>
      {/* Shooting stars background */}
      <div className="animation-container">
        {Array.from({ length: settings.num_stars || 7 }, (_, i) => (
          <div key={i} className="c"></div>
        ))}
      </div>

      {/* ─── Top Header Bar ─── */}
      <header className="app-header">
        <div className="app-header-left">
          <img src="/static/img/logo.png" className="header-logo" alt="Bordercore AI" />
        </div>

        <div className="app-header-center"></div>

        <div className="app-header-right">
          <Nav active={mode} onModeChange={handleSwitchMode} />
          <button
            className="hamburger"
            ref={hamburgerRef}
            onClick={() => setShowMenu(!showMenu)}
          >
            <div className="hamburger__line"></div>
            <div className="hamburger__line"></div>
            <div className="hamburger__line"></div>
          </button>
        </div>
      </header>

      {/* ─── Main Two-Panel Layout ─── */}
      <div className="chatbot-container">
        {/* Left Panel — Chat */}
        <div className="panel-card chat-panel">
          <div className="chat-panel-header">
            <span className="chat-panel-title">
              <span className="status-dot online"></span>
              Conversation
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {model.name || "No model loaded"}
            </span>
          </div>

          <div
            className={`container d-flex${isDragOver ? " drag-over" : ""}`}
            style={{ flex: 1, minHeight: 0 }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDrop={handleImageDrop}
            onDragEnter={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragOver(false);
            }}
          >
            <MessageList
              messages={filteredChatHistory}
              waiting={waiting}
              error={error}
            />
            <ImagePreview
              visionImage={visionImage}
              isDragOver={isDragOver}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDrop={handleImageDrop}
              onDragEnter={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOver(false);
              }}
              imageSrc={imageSrc}
            />
          </div>

          <FileUpload
            mode={mode}
            url={url}
            uploadedFilename={uploadedFilename}
            audioFileTranscript={audioFileTranscript}
            audioFileSize={audioFileSize}
            ragFileUploaded={ragFileUploaded}
            ragFileSize={ragFileSize}
            visionImage={visionImage}
            copyIcon={copyIcon}
            onTranscribeAudio={handleTranscribeAudio}
            onFileUploadVision={handleFileUploadVision}
            onFileUpload={handleFileUpload}
            onCopyText={handleCopyText}
          />

          <div className="chat-input-area">
            <ChatInput
              prompt={prompt}
              onPromptChange={setPrompt}
              onSend={() => handleSendMessage()}
              onRegenerate={handleRegenerate}
              onNewChat={handleNewChat}
              onStopGeneration={handleStopGeneration}
              onClipboardClick={handleClipboardClick}
              inputIsDisabled={inputIsDisabled}
              showRegenerate={showRegenerate}
              isGenerating={isGenerating}
              hasClipboard={!!clipboard}
            />
          </div>
        </div>

        {/* Right Panel — Controls & Diagnostics */}
        <div className="panel-card sidebar-panel">
          <div className="sidebar-section">
            <div className="sidebar-section-title">Model</div>
            <ModelSelect
              value={model.name}
              modelList={modelList}
              getModelIcon={getModelIcon}
              onChange={handleChangeModel}
            />
          </div>

          <div className="sidebar-section">
            <div className="thinking-area">
              {switches.gpuOrb
                ? <GpuOrb active={isGenerating} size={140} />
                : <ThinkingIcon active={isGenerating} size={140} />
              }
            </div>
            {notice && (
              <div className="notice animate__animated animate__pulse animate__slower animate__infinite">
                {notice}
              </div>
            )}
          </div>

          <div className="sidebar-section" style={{ flex: 1 }}>
            <div className="sidebar-section-title">Controls</div>
            <Options
              switches={switches}
              onToggle={handleToggleSwitch}
              onSensorToggle={handleSensorToggle}
            />
          </div>
        </div>
      </div>

      {/* ─── Audio Player ─── */}
      <AudioPlayer
        audioIsPlayingOrPaused={audioIsPlayingOrPaused}
        musicInfo={musicInfo}
        currentSong={currentSong}
        uploadedFilename={uploadedFilename}
        onSongBackward={handleSongBackward}
        onSongForward={handleSongForward}
      />

      {/* ─── Preferences Flyout ─── */}
      <div ref={menuRef}>
        <PreferencesMenu
          show={showMenu}
          temperature={temperature}
          onTemperatureChange={setTemperature}
          audioSpeed={audioSpeed}
          onAudioSpeedChange={setAudioSpeed}
          ttsHost={ttsHost}
          onTtsHostChange={setTtsHost}
        />
      </div>

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Processing Modal */}
      <div
        id="modalProcessing"
        className="modal fade"
        tabIndex={-1}
        role="dialog"
        aria-hidden="true"
      >
        <div className="modal-dialog modal-sm modal-dialog-centered" role="document">
          <h4 className="modal-content p-3 d-flex flex-row justify-content-center">
            <div>Processing...</div>
            <div className="spinner-border ms-2 text-secondary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </h4>
        </div>
      </div>

      {/* Clipboard Modal */}
      <div
        id="modalClipboard"
        className="modal fade"
        tabIndex={-1}
        role="dialog"
        aria-hidden="true"
      >
        <div className="modal-dialog modal-lg modal-dialog-centered" role="document">
          <h6 className="modal-content p-3 d-flex flex-row justify-content-center">
            <div className="d-flex flex-column">
              <h5 className="text-info">Pasted content</h5>
              <div>{clipboard?.content}</div>
              <div>
                <button
                  type="button"
                  className="btn btn-primary button-small mt-3"
                  data-bs-dismiss="modal"
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-warning button-small ms-3 mt-3"
                  onClick={handleDeleteClipboard}
                >
                  Delete
                </button>
              </div>
            </div>
          </h6>
        </div>
      </div>
    </>
  );
}
