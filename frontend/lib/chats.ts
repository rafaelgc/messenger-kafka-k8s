import type { ChatListItem } from "@/lib/api";
import { MOCK_CHATS, type Chat } from "@/lib/mock-data";

const AVATAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
];

const MOCK_PREVIEWS = MOCK_CHATS.map(
  ({ lastMessage, lastMessageAt, unreadCount }) => ({
    lastMessage,
    lastMessageAt,
    unreadCount,
  }),
);

function avatarColorForName(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash + char.charCodeAt(0)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash]!;
}

export function mapApiChatsToUiChats(apiChats: ChatListItem[]): Chat[] {
  return apiChats.map((chat, index) => {
    const mockChat = MOCK_CHATS.find((entry) => entry.id === chat.id);
    const preview = MOCK_PREVIEWS[index % MOCK_PREVIEWS.length]!;

    return {
      id: chat.id,
      name: chat.name,
      avatarColor: mockChat?.avatarColor ?? avatarColorForName(chat.name),
      lastMessage: mockChat?.lastMessage ?? preview.lastMessage,
      lastMessageAt: mockChat?.lastMessageAt ?? preview.lastMessageAt,
      unreadCount: mockChat?.unreadCount ?? preview.unreadCount,
      members: chat.members,
      messages: [],
    };
  });
}
