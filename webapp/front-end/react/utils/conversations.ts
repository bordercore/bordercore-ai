import type { ChatMessage } from "../stores/ChatStoreContext";

export interface Conversation {
  id: string;
  title: string;
  parentConversationId: string | null;
  branchPointMessageId: number | null;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  draft: string;
}

export interface ConversationState {
  activeConversationId: string;
  conversations: Conversation[];
}

const DATABASE_NAME = "bordercoreai";
const DATABASE_VERSION = 1;
const STORE_NAME = "conversation-state";
const STATE_KEY = "default";

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function createRootConversation(
  messages: ChatMessage[],
  title = "Main conversation"
): Conversation {
  const now = new Date().toISOString();
  return {
    id: newId(),
    title,
    parentConversationId: null,
    branchPointMessageId: null,
    createdAt: now,
    updatedAt: now,
    messages: messages.map(message => ({ ...message })),
    draft: "",
  };
}

export function suggestedBranchTitle(messages: ChatMessage[], messageId?: number): string {
  const candidates = messageId
    ? messages.slice(0, messages.findIndex(message => message.id === messageId) + 1)
    : messages;
  const source =
    [...candidates].reverse().find(message => message.role !== "system")?.content ?? "";
  const plain = source
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/[*_`#>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "New branch";
  return plain.length > 42 ? `${plain.slice(0, 39).trimEnd()}…` : plain;
}

export function branchConversation(
  parent: Conversation,
  branchPointMessageId: number,
  title: string
): Conversation {
  const branchIndex = parent.messages.findIndex(message => message.id === branchPointMessageId);
  if (branchIndex < 0) throw new Error("The selected branch point no longer exists.");
  const now = new Date().toISOString();
  return {
    id: newId(),
    title: title.trim() || suggestedBranchTitle(parent.messages, branchPointMessageId),
    parentConversationId: parent.id,
    branchPointMessageId,
    createdAt: now,
    updatedAt: now,
    messages: parent.messages.slice(0, branchIndex + 1).map(message => ({ ...message })),
    draft: "",
  };
}

export function conversationDepth(
  conversation: Conversation,
  conversations: Conversation[]
): number {
  const byId = new Map(conversations.map(item => [item.id, item]));
  let depth = 0;
  let parentId = conversation.parentConversationId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentConversationId ?? null;
  }
  return depth;
}

export function conversationDescendantIds(
  conversationId: string,
  conversations: Conversation[]
): Set<string> {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const conversation of conversations) {
      if (
        conversation.parentConversationId &&
        (conversation.parentConversationId === conversationId ||
          descendants.has(conversation.parentConversationId)) &&
        !descendants.has(conversation.id)
      ) {
        descendants.add(conversation.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export function orderConversationTree(conversations: Conversation[]): Conversation[] {
  const children = new Map<string | null, Conversation[]>();
  for (const conversation of conversations) {
    const siblings = children.get(conversation.parentConversationId) ?? [];
    siblings.push(conversation);
    children.set(conversation.parentConversationId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const ordered: Conversation[] = [];
  const visit = (parentId: string | null) => {
    for (const conversation of children.get(parentId) ?? []) {
      ordered.push(conversation);
      visit(conversation.id);
    }
  };
  visit(null);
  return ordered;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadConversationState(): Promise<ConversationState | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve((request.result as ConversationState | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function saveConversationState(state: ConversationState): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
