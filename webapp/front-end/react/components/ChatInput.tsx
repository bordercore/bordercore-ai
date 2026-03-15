import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRotateLeft,
  faPlus,
  faCircleStop,
  faPaste,
  faPaperPlane,
} from "@fortawesome/free-solid-svg-icons";

interface ChatInputProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onRegenerate: () => void;
  onNewChat: () => void;
  onStopGeneration: () => void;
  onClipboardClick: () => void;
  inputIsDisabled: boolean;
  showRegenerate: boolean;
  isGenerating: boolean;
  hasClipboard: boolean;
}

export default function ChatInput({
  prompt,
  onPromptChange,
  onSend,
  onRegenerate,
  onNewChat,
  onStopGeneration,
  onClipboardClick,
  inputIsDisabled,
  showRegenerate,
  isGenerating,
  hasClipboard,
}: ChatInputProps) {
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && prompt.trim()) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <div className="chat-input-wrapper">
        <input
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          id="prompt"
          type="text"
          placeholder="Type your message..."
          onKeyDown={handleKeyDown}
          disabled={inputIsDisabled}
          autoComplete="off"
        />

        {showRegenerate && (
          <>
            <div
              className="input-action"
              onClick={onRegenerate}
              title="Regenerate Response"
            >
              <FontAwesomeIcon icon={faRotateLeft} />
            </div>
            <div
              className="input-action"
              onClick={onNewChat}
              title="New Chat"
            >
              <FontAwesomeIcon icon={faPlus} />
            </div>
          </>
        )}
        {isGenerating && (
          <div
            className="input-action"
            onClick={onStopGeneration}
            title="Stop Response"
          >
            <FontAwesomeIcon icon={faCircleStop} />
          </div>
        )}
        {hasClipboard && (
          <div
            className="input-action animate__animated animate__bounceIn"
            onClick={onClipboardClick}
            title="Clipboard"
          >
            <FontAwesomeIcon icon={faPaste} />
          </div>
        )}
        <div
          className="input-action"
          onClick={() => { if (prompt.trim() && !inputIsDisabled) onSend(); }}
          title="Send"
          style={{ color: prompt.trim() ? "var(--accent-cyan)" : undefined, opacity: prompt.trim() ? 1 : 0.4 }}
        >
          <FontAwesomeIcon icon={faPaperPlane} />
        </div>
      </div>
    </form>
  );
}
