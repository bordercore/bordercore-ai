import React, { useRef, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import MessageItem from "./MessageItem";
import WaitingIndicator from "./WaitingIndicator";
import useCodeCopyObserver from "../hooks/useCodeCopyObserver";
import { ChatMessage, WaitingAnimation } from "../stores/ChatStoreContext";

interface MessageListProps {
  messages: ChatMessage[];
  waiting: boolean;
  waitingAnimation: WaitingAnimation;
  error: any;
}

const variantColorMap: Record<string, string> = {
  danger: "text-bs-danger",
  warning: "text-bs-warning",
  info: "text-bs-info",
};

export default function MessageList({
  messages,
  waiting,
  waitingAnimation,
  error,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useCodeCopyObserver(containerRef);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div id="message-container" className="items-start" ref={containerRef}>
      {messages.map(message => (
        <MessageItem key={message.id} message={message} />
      ))}
      {waiting && <WaitingIndicator animation={waitingAnimation} />}
      {error && (
        <div className="notice animate__animated animate__headShake w-full font-bold">
          <FontAwesomeIcon
            icon={faExclamationTriangle}
            className={`fa-xl mr-2 ${variantColorMap[error.variant] ?? ""}`}
          />
          <span>{error.body}</span>
        </div>
      )}
    </div>
  );
}
