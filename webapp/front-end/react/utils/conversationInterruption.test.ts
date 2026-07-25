import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../stores/ChatStoreContext";
import {
  markResponseInterrupted,
  messagesForModel,
  updateResponseContent,
} from "./conversationInterruption";

const history: ChatMessage[] = [
  { id: 1, role: "system", content: "Be helpful." },
  { id: 2, role: "user", content: "First question" },
  { id: 3, role: "assistant", content: "First answer" },
  { id: 4, role: "user", content: "Second question" },
  { id: 5, role: "assistant", content: "Partial second answer" },
];

describe("conversation interruption", () => {
  it("marks only the response associated with the interrupted turn", () => {
    const updated = markResponseInterrupted(history, 5);

    expect(updated.find(message => message.id === 3)?.interrupted).toBeUndefined();
    expect(updated.find(message => message.id === 5)?.interrupted).toBe(true);
  });

  it("rejects late chunks for an interrupted response", () => {
    const interrupted = markResponseInterrupted(history, 5);
    const withLateChunk = updateResponseContent(interrupted, 5, "Stale completed answer");
    const withOlderChunk = updateResponseContent(withLateChunk, 3, "Updated first answer");

    expect(withLateChunk.find(message => message.id === 5)?.content).toBe("Partial second answer");
    expect(withOlderChunk.find(message => message.id === 3)?.content).toBe("Updated first answer");
    expect(withOlderChunk.find(message => message.id === 5)?.content).toBe("Partial second answer");
  });

  it("tells the next model request that a response was not fully heard", () => {
    const messages = messagesForModel(markResponseInterrupted(history, 5));
    const interrupted = messages.find(message => message.id === 5);

    expect(interrupted?.content).toContain("interrupted by the user");
    expect(interrupted?.content).toContain("Partial second answer");
    expect(history[4].content).toBe("Partial second answer");
  });
});
