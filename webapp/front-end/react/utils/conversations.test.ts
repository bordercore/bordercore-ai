import { describe, expect, it } from "vitest";
import {
  branchConversation,
  conversationDescendantIds,
  conversationDepth,
  createRootConversation,
  orderConversationTree,
  suggestedBranchTitle,
} from "./conversations";

const messages = [
  { id: 1, role: "system" as const, content: "Be helpful" },
  { id: 2, role: "user" as const, content: "Explain GPU memory pressure" },
  { id: 3, role: "assistant" as const, content: "It depends on model size." },
  { id: 4, role: "user" as const, content: "What about deployment?" },
];

describe("conversation branching", () => {
  it("copies history only through the selected branch point", () => {
    const root = createRootConversation(messages);
    const branch = branchConversation(root, 3, "GPU tangent");
    expect(branch.parentConversationId).toBe(root.id);
    expect(branch.branchPointMessageId).toBe(3);
    expect(branch.messages.map(message => message.id)).toEqual([1, 2, 3]);
    expect(branch.messages).not.toBe(root.messages);
  });

  it("orders nested branches as a depth-first tree", () => {
    const root = createRootConversation(messages);
    const first = branchConversation(root, 3, "First");
    const nested = branchConversation(first, 2, "Nested");
    const second = branchConversation(root, 4, "Second");
    const conversations = [root, first, nested, second];
    expect(orderConversationTree(conversations).map(item => item.title)).toEqual([
      "Main conversation",
      "First",
      "Nested",
      "Second",
    ]);
    expect(conversationDepth(nested, conversations)).toBe(2);
    expect(conversationDescendantIds(root.id, conversations)).toEqual(
      new Set([first.id, nested.id, second.id])
    );
  });

  it("suggests a compact title from the branch context", () => {
    expect(suggestedBranchTitle(messages, 2)).toBe("Explain GPU memory pressure");
  });
});
