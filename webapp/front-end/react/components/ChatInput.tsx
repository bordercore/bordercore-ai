import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRotateLeft,
  faPlus,
  faCircleStop,
  faPaste,
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
    if (event.key === "Enter") {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <form>
      <div className="d-flex align-items-center mb-3">
        <input
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          id="prompt"
          className="form-control"
          type="text"
          placeholder="Prompt"
          onKeyDown={handleKeyDown}
          disabled={inputIsDisabled}
        />
        {showRegenerate && (
          <>
            <div
              className="icon text-primary ms-3"
              onClick={onRegenerate}
              data-bs-toggle="tooltip"
              title="Regenerate Response"
            >
              <FontAwesomeIcon icon={faRotateLeft} />
            </div>
            <div
              className="icon text-primary ms-3"
              onClick={onNewChat}
              data-bs-toggle="tooltip"
              title="New Chat"
            >
              <FontAwesomeIcon icon={faPlus} />
            </div>
          </>
        )}
        {isGenerating && (
          <div
            className="icon text-primary ms-3"
            onClick={onStopGeneration}
            data-bs-toggle="tooltip"
            title="Stop Response"
          >
            <FontAwesomeIcon icon={faCircleStop} />
          </div>
        )}
        {hasClipboard && (
          <div
            className="icon text-info ms-3 animate__animated animate__bounceIn"
            onClick={onClipboardClick}
            data-bs-toggle="tooltip"
            title="Clipboard"
          >
            <FontAwesomeIcon icon={faPaste} className="fa-2x" />
          </div>
        )}
      </div>
    </form>
  );
}
