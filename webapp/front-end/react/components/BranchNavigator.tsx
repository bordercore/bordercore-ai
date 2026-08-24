import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faCodeBranch,
  faPen,
  faPlus,
  faSitemap,
  faTrash,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { Conversation } from "../utils/conversations";
import {
  conversationDepth,
  conversationDescendantIds,
  orderConversationTree,
} from "../utils/conversations";

interface BranchNavigatorProps {
  conversations: Conversation[];
  activeConversation: Conversation;
  disabled: boolean;
  onSwitch: (conversationId: string) => void;
  onBranchTip: () => void;
  onRename: (conversationId: string, title: string) => void;
  onDelete: (conversationId: string) => void;
}

export default function BranchNavigator({
  conversations,
  activeConversation,
  disabled,
  onSwitch,
  onBranchTip,
  onRename,
  onDelete,
}: BranchNavigatorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ordered = orderConversationTree(conversations);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [drawerOpen]);

  function handleRename(conversation: Conversation) {
    const title = window.prompt("Rename conversation", conversation.title);
    if (title) onRename(conversation.id, title);
  }

  function handleDelete(conversation: Conversation) {
    const descendants = conversationDescendantIds(conversation.id, conversations).size;
    const detail = descendants
      ? ` This will also delete ${descendants} descendant ${descendants === 1 ? "branch" : "branches"}.`
      : "";
    if (window.confirm(`Delete “${conversation.title}”?${detail}`)) {
      onDelete(conversation.id);
    }
  }

  function selectConversation(conversationId: string) {
    onSwitch(conversationId);
    setMenuOpen(false);
    setDrawerOpen(false);
  }

  return (
    <>
      <div className="branch-switcher" ref={menuRef}>
        <button
          type="button"
          className="branch-switcher-trigger"
          onClick={() => setMenuOpen(open => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Switch conversation branch"
        >
          <FontAwesomeIcon icon={faCodeBranch} />
          <span>{activeConversation.title}</span>
          <FontAwesomeIcon icon={faChevronDown} className="branch-switcher-chevron" />
        </button>
        {menuOpen && (
          <div className="branch-switcher-menu" role="menu">
            <div className="branch-switcher-menu-title">Conversation branches</div>
            <div className="branch-switcher-options">
              {ordered.map(conversation => (
                <button
                  type="button"
                  role="menuitem"
                  key={conversation.id}
                  className={`branch-switcher-option${
                    conversation.id === activeConversation.id ? " is-active" : ""
                  }`}
                  style={{
                    paddingLeft: `${0.75 + conversationDepth(conversation, conversations)}rem`,
                  }}
                  onClick={() => selectConversation(conversation.id)}
                >
                  <span className="branch-tree-line" aria-hidden="true">
                    {conversation.parentConversationId ? "└" : "●"}
                  </span>
                  <span>{conversation.title}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="branch-switcher-action"
              onClick={() => {
                setMenuOpen(false);
                onBranchTip();
              }}
              disabled={disabled}
            >
              <FontAwesomeIcon icon={faPlus} /> Branch from here
            </button>
            <button
              type="button"
              className="branch-switcher-action"
              onClick={() => {
                setMenuOpen(false);
                setDrawerOpen(true);
              }}
            >
              <FontAwesomeIcon icon={faSitemap} /> Manage branches…
            </button>
          </div>
        )}
      </div>

      {drawerOpen && (
        <div className="branch-drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <aside
            className="branch-drawer"
            aria-label="Conversation branches"
            onClick={event => event.stopPropagation()}
          >
            <div className="branch-drawer-header">
              <div>
                <span className="branch-drawer-kicker">Conversation map</span>
                <h2>Branches</h2>
              </div>
              <button
                type="button"
                className="branch-icon-button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close branch navigator"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="branch-drawer-tree">
              {ordered.map(conversation => {
                const depth = conversationDepth(conversation, conversations);
                return (
                  <div
                    className={`branch-drawer-row${
                      conversation.id === activeConversation.id ? " is-active" : ""
                    }`}
                    style={{ marginLeft: `${depth * 1.1}rem` }}
                    key={conversation.id}
                  >
                    <button
                      type="button"
                      className="branch-drawer-select"
                      onClick={() => selectConversation(conversation.id)}
                    >
                      <span className="branch-node" aria-hidden="true"></span>
                      <span>
                        <strong>{conversation.title}</strong>
                        <small>{new Date(conversation.updatedAt).toLocaleString()}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="branch-icon-button"
                      onClick={() => handleRename(conversation)}
                      aria-label={`Rename ${conversation.title}`}
                    >
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                    <button
                      type="button"
                      className="branch-icon-button danger"
                      onClick={() => handleDelete(conversation)}
                      disabled={conversations.length === 1}
                      aria-label={`Delete ${conversation.title}`}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="branch-drawer-create"
              onClick={() => {
                setDrawerOpen(false);
                onBranchTip();
              }}
              disabled={disabled}
            >
              <FontAwesomeIcon icon={faCodeBranch} /> Branch current conversation
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
