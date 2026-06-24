import type { MessageItem } from "@/lib/api";
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
