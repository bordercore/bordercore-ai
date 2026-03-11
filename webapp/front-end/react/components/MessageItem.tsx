import React from "react";
import { renderMarkdown } from "../utils/markdown";
import { ChatMessage } from "../stores/ChatStoreContext";

interface MessageItemProps {
  message: ChatMessage;
}

/**
 * Renders a single chat message with markdown.
 * Content is sanitized via DOMPurify in renderMarkdown() before rendering.
 */
export default function MessageItem({ message }: MessageItemProps) {
  // renderMarkdown() sanitizes HTML output with DOMPurify before returning
  const sanitizedHtml = renderMarkdown(message.content);

  return (
    <div className={`chatbot-${message.role} d-flex px-3 mt-2`}>
      <div className="role fw-bold me-2">
        {message.role === "user" ? "You" : "AI"}
      </div>
      <div>
        <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
      </div>
    </div>
  );
}
