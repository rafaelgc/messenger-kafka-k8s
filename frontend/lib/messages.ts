import type { ChatMember } from "@/lib/api";
import type { MessageItem } from "@/lib/api";
import type { MessageSentEvent } from "@/lib/message-delivery";
import type { Message } from "@/lib/mock-data";

function objectIdToIsoDate(objectId: string): string {
  const timestamp = Number.parseInt(objectId.slice(0, 8), 16);
  return new Date(timestamp * 1000).toISOString();
}

export function resolveSenderName(
  senderId: string,
  members: ChatMember[],
  currentUserId: string,
  currentUserNickname: string,
): string {
  if (senderId === currentUserId) {
    return currentUserNickname;
  }

  return (
    members.find((member) => member.id === senderId)?.nickname ??
    senderId.slice(0, 8)
  );
}

export function formatChatListPreview(
  text: string,
  senderId: string,
  members: ChatMember[],
  currentUserId: string,
  currentUserNickname: string,
): string {
  if (senderId === currentUserId) {
    return `You: ${text}`;
  }

  const senderName = resolveSenderName(
    senderId,
    members,
    currentUserId,
    currentUserNickname,
  );

  return `${senderName}: ${text}`;
}

export function lastMessagePreviewFromMessageItem(
  item: MessageItem,
  members: ChatMember[],
  currentUserId: string,
  currentUserNickname: string,
): { lastMessage: string; lastMessageAt: string } {
  const uiMessage = mapApiMessageToUiMessage(
    item,
    members,
    currentUserId,
    currentUserNickname,
  );

  return {
    lastMessage: formatChatListPreview(
      uiMessage.text,
      item.sender_id,
      members,
      currentUserId,
      currentUserNickname,
    ),
    lastMessageAt: uiMessage.sentAt,
  };
}

export function lastMessagePreviewFromWsEvent(
  event: MessageSentEvent,
  members: ChatMember[],
  currentUserId: string,
  currentUserNickname: string,
): { lastMessage: string; lastMessageAt: string } {
  return {
    lastMessage: formatChatListPreview(
      event.text,
      event.sender_id,
      members,
      currentUserId,
      currentUserNickname,
    ),
    lastMessageAt: new Date().toISOString(),
  };
}

export function mapApiMessageToUiMessage(
  item: MessageItem,
  members: ChatMember[],
  currentUserId: string,
  currentUserNickname: string,
): Message {
  return {
    id: item.id,
    senderId: item.sender_id,
    senderName: resolveSenderName(
      item.sender_id,
      members,
      currentUserId,
      currentUserNickname,
    ),
    text: item.text,
    sentAt: objectIdToIsoDate(item.id),
  };
}

export function mergeOlderMessages(
  existing: Message[],
  older: Message[],
): Message[] {
  const existingIds = new Set(existing.map((message) => message.id));
  const uniqueOlder = older.filter((message) => !existingIds.has(message.id));
  return [...uniqueOlder, ...existing];
}

export function mapWsMessageToUiMessage(
  event: MessageSentEvent,
  members: ChatMember[],
  currentUserId: string,
  currentUserNickname: string,
): Message {
  return {
    id: `ws-${crypto.randomUUID()}`,
    senderId: event.sender_id,
    senderName: resolveSenderName(
      event.sender_id,
      members,
      currentUserId,
      currentUserNickname,
    ),
    text: event.text,
    sentAt: new Date().toISOString(),
  };
}

export function createOptimisticMessage(
  text: string,
  currentUserId: string,
  currentUserNickname: string,
): Message {
  return {
    id: `pending-${crypto.randomUUID()}`,
    senderId: currentUserId,
    senderName: currentUserNickname,
    text,
    sentAt: new Date().toISOString(),
  };
}

export function appendNewMessage(
  existing: Message[],
  incoming: Message,
): Message[] {
  const pendingIndex = existing.findIndex(
    (message) =>
      message.id.startsWith("pending-") &&
      message.senderId === incoming.senderId &&
      message.text === incoming.text,
  );

  if (pendingIndex >= 0) {
    const next = [...existing];
    next[pendingIndex] = incoming;
    return next;
  }

  if (existing.some((message) => message.id === incoming.id)) {
    return existing;
  }

  const last = existing[existing.length - 1];
  if (
    last &&
    last.senderId === incoming.senderId &&
    last.text === incoming.text &&
    Math.abs(
      new Date(last.sentAt).getTime() - new Date(incoming.sentAt).getTime(),
    ) < 5000
  ) {
    return existing;
  }

  return [...existing, incoming];
}

export function removeMessage(existing: Message[], messageId: string): Message[] {
  return existing.filter((message) => message.id !== messageId);
}

function isNearBottom(element: HTMLElement, threshold = 120): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight < threshold
  );
}

export { isNearBottom };
