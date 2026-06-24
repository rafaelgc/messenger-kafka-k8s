import type { MessageItem } from "@/lib/api";
import type { MessageSentEvent } from "@/lib/message-delivery";
import type { Message } from "@/lib/mock-data";

function objectIdToIsoDate(objectId: string): string {
  const timestamp = Number.parseInt(objectId.slice(0, 8), 16);
  return new Date(timestamp * 1000).toISOString();
}

export function mapApiMessageToUiMessage(
  item: MessageItem,
  currentUserId: string,
  currentUserNickname: string,
): Message {
  return {
    id: item.id,
    senderId: item.sender_id,
    senderName:
      item.sender_id === currentUserId
        ? currentUserNickname
        : item.sender_id.slice(0, 8),
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
  currentUserId: string,
  currentUserNickname: string,
): Message {
  return {
    id: `ws-${crypto.randomUUID()}`,
    senderId: event.sender_id,
    senderName:
      event.sender_id === currentUserId
        ? currentUserNickname
        : event.sender_id.slice(0, 8),
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
