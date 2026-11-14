import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { LoadedLocalModel, ModelInfo } from "../stores/ChatStoreContext";
import { getModelService, groupModels } from "../utils/modelGroups";

interface ModelSelectProps {
  value: string;
  modelList: ModelInfo[];
  getModelIcon: (model: ModelInfo) => string;
  onChange: (modelName: string) => void;
  loadedLocalModels: LoadedLocalModel[];
  onUnload: () => void;
}

export default function ModelSelect({
  value,
  modelList,
  getModelIcon,
  onChange,
  loadedLocalModels,
  onUnload,
}: ModelSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const groups = groupModels(modelList, query);

  const selectedModel = modelList.find(m => m.model === value) || null;
  const selectedModelName = selectedModel ? selectedModel.name : "Select a model";
  const selectedModelIcon = selectedModel ? getModelIcon(selectedModel) : "";

  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  function openMenu() {
    setQuery("");
    setIsOpen(true);
  }

  function closeMenu() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

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
      triggerRef.current?.focus();
    },
    [onChange]
  );

  function handleKeydown(event: React.KeyboardEvent, model: ModelInfo) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectModel(model);
    }
  }

  function handleMenuKeydown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    const isSearch = event.target === searchRef.current;
    const options = Array.from(
      wrapperRef.current?.querySelectorAll<HTMLElement>('[role="option"]') || []
    );
    const index = options.indexOf(event.target as HTMLElement);
    let next: number;
    if (event.key === "ArrowDown") next = Math.min(index + 1, options.length - 1);
    else if (event.key === "ArrowUp") next = index <= 0 ? options.length - 1 : index - 1;
    else if (!isSearch && event.key === "Home") next = 0;
    else if (!isSearch && event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    options[next]?.focus();
  }

  function unloadModels() {
    closeMenu();
    onUnload();
  }

  return (
    <div
      className="model-select-wrapper"
      ref={wrapperRef}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        className="model-select-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listId : undefined}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
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
        <div className="model-dropdown-menu" onKeyDown={handleMenuKeydown}>
          <div className="model-search">
            <input
              ref={searchRef}
              type="search"
              aria-label="Search models"
              aria-controls={listId}
              placeholder="Search models, providers…"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <div className="model-dropdown-options" role="listbox" aria-label="Models" id={listId}>
            {groups.map(({ provider, models }, index) => (
              <div key={provider} role="group" aria-labelledby={`${listId}-group-${index}`}>
                <div className="model-provider-heading" id={`${listId}-group-${index}`}>
                  {provider}
                </div>
                {models.map(model => (
                  <div
                    key={model.model}
                    className={`model-dropdown-item${model.model === value ? " is-active" : ""}`}
                    role="option"
                    aria-selected={model.model === value}
                    tabIndex={0}
                    onClick={() => selectModel(model)}
                    onKeyDown={e => handleKeydown(e, model)}
                  >
                    <div className="model-option-content">
                      <span className="model-option-name">{model.name}</span>
                      <span className="model-service-badge">{getModelService(model)}</span>
                      {getModelIcon(model) && (
                        <span className="model-option-icon">
                          <span className="emoji-icon">{getModelIcon(model)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {groups.length === 0 && (
            <div className="model-search-empty" role="status">
              No models match your search.
            </div>
          )}
          {loadedLocalModels.length > 0 && (
            <button className="model-unload-action" type="button" onClick={unloadModels}>
              <span>Unload local model{loadedLocalModels.length > 1 ? "s" : ""}</span>
              <small>Free GPU memory</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
