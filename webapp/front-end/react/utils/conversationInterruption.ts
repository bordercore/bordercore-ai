import type { ChatMessage } from "../stores/ChatStoreContext";

export function markResponseInterrupted(
  messages: ChatMessage[],
  assistantId: number
): ChatMessage[] {
  return messages.map(message =>
    message.id === assistantId && message.role === "assistant"
      ? { ...message, interrupted: true }
      : message
  );
}

export function updateResponseContent(
  messages: ChatMessage[],
  assistantId: number,
  content: string
): ChatMessage[] {
  return messages.map(message =>
    message.id === assistantId && message.role === "assistant" && !message.interrupted
      ? { ...message, content }
      : message
  );
}

export function messagesForModel(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => {
    if (!message.interrupted || message.role !== "assistant") return message;
    return {
      ...message,
      content: `[This response was interrupted by the user and may not have been fully heard.]\n\n${message.content}`,
    };
  });
}
