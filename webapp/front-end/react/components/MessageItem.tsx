import React, { useRef } from "react";
import { renderMarkdown } from "../utils/markdown";
import { ChatMessage } from "../stores/ChatStoreContext";
import {
  ActiveSpokenSegment,
  findSpokenTextRange,
  renderHighlightedHtml,
  TextRange,
} from "../utils/spokenHighlight";

interface MessageItemProps {
  message: ChatMessage;
  activeSpokenSegment: ActiveSpokenSegment | null;
}

/**
 * Renders a single chat message with markdown.
 * Content is sanitized via DOMPurify in renderMarkdown() before rendering.
 */
export default function MessageItem({ message, activeSpokenSegment }: MessageItemProps) {
  // renderMarkdown() sanitizes HTML output with DOMPurify before returning
  const sanitizedHtml = renderMarkdown(message.content);
  const searchOffsetRef = useRef(0);
  const responseIdRef = useRef<number | null>(null);
  const highlightedSequenceRef = useRef<number | null>(null);
  const highlightedRangeRef = useRef<TextRange | null>(null);

  let renderedHtml = sanitizedHtml;
  if (activeSpokenSegment?.responseId === message.id) {
    if (responseIdRef.current !== activeSpokenSegment.responseId) {
      responseIdRef.current = activeSpokenSegment.responseId;
      searchOffsetRef.current = 0;
      highlightedSequenceRef.current = null;
      highlightedRangeRef.current = null;
    }

    if (highlightedSequenceRef.current !== activeSpokenSegment.sequence) {
      const root = document.createElement("div");
      root.innerHTML = sanitizedHtml;
      const renderedText = root.textContent || "";
      const range =
        findSpokenTextRange(renderedText, activeSpokenSegment.text, searchOffsetRef.current) ??
        findSpokenTextRange(renderedText, activeSpokenSegment.text);
      if (range) {
        highlightedSequenceRef.current = activeSpokenSegment.sequence;
        highlightedRangeRef.current = range;
        searchOffsetRef.current = range.end;
      }
    }

    if (highlightedRangeRef.current) {
      renderedHtml = renderHighlightedHtml(
        sanitizedHtml,
        highlightedRangeRef.current,
        "spoken-sentence-highlight"
      );
    }
  }

  return (
    <div className={`chatbot-${message.role} flex items-baseline`}>
      <div className="role font-bold mr-2" style={{ minWidth: "1.5rem" }}>
        {message.role === "user" ? "You" : "AI"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        {activeSpokenSegment?.responseId === message.id && (
          <span className="sr-only" role="status" aria-live="polite">
            Currently speaking: {activeSpokenSegment.text}
          </span>
        )}
        {message.interrupted && (
          <div className="message-interrupted" role="status">
            Response interrupted
          </div>
        )}
      </div>
    </div>
  );
}
