import React, { useRef, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import MessageItem from "./MessageItem";
import useCodeCopyObserver from "../hooks/useCodeCopyObserver";
import { ChatMessage } from "../stores/ChatStoreContext";

interface MessageListProps {
  messages: ChatMessage[];
  waiting: boolean;
  error: any;
}

export default function MessageList({ messages, waiting, error }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useCodeCopyObserver(containerRef);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div id="message-container" className="align-items-start" ref={containerRef}>
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {waiting && (
        <div
          className="spinner-border ms-3 text-info"
          role="status"
        />
      )}
      {error && (
        <div className="notice animate__animated animate__headShake w-100 fw-bold">
          <FontAwesomeIcon
            icon={faExclamationTriangle}
            className={`fa-xl me-2 text-${error.variant}`}
          />
          <span>{error.body}</span>
        </div>
      )}
    </div>
  );
}
