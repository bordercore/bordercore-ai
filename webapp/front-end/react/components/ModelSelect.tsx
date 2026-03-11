import React, { useState, useRef, useEffect, useCallback } from "react";
import { ModelInfo } from "../stores/ChatStoreContext";

interface ModelSelectProps {
  value: string;
  modelList: ModelInfo[];
  getModelIcon: (model: ModelInfo) => string;
  onChange: (modelName: string) => void;
}

export default function ModelSelect({
  value,
  modelList,
  getModelIcon,
  onChange,
}: ModelSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedModel = modelList.find((m) => m.model === value) || null;
  const selectedModelName = selectedModel ? selectedModel.name : "Select a model";
  const selectedModelIcon = selectedModel ? getModelIcon(selectedModel) : "";

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectModel = useCallback(
    (model: ModelInfo) => {
      onChange(model.model!);
      setIsOpen(false);
    },
    [onChange]
  );

  function handleKeydown(event: React.KeyboardEvent, model: ModelInfo) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectModel(model);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="model-select-wrapper" ref={wrapperRef}>
      <button
        className="model-select-trigger form-select"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="model-select-content">
          <span className="model-select-name">{selectedModelName}</span>
          {selectedModelIcon && (
            <span className="model-select-icon">
              <span className="emoji-icon">{selectedModelIcon}</span>
            </span>
          )}
        </span>
        <span className="model-select-arrow">{"\u25BC"}</span>
      </button>

      {isOpen && (
        <div className="model-dropdown-menu" role="listbox">
          {modelList.map((model) => (
            <div
              key={model.model}
              className={`model-dropdown-item${model.model === value ? " is-active" : ""}`}
              role="option"
              aria-selected={model.model === value}
              tabIndex={0}
              onClick={() => selectModel(model)}
              onKeyDown={(e) => handleKeydown(e, model)}
            >
              <div className="model-option-content">
                <span className="model-option-name">{model.name}</span>
                {getModelIcon(model) && (
                  <span className="model-option-icon">
                    <span className="emoji-icon">{getModelIcon(model)}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
