import { listMessages, type ChatListItem } from "@/lib/api";
import { lastMessagePreviewFromMessageItem } from "@/lib/messages";
import { type Chat } from "@/lib/mock-data";

const AVATAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
];

function avatarColorForName(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash + char.charCodeAt(0)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash]!;
}

export function resolveChatDisplayName(
  chat: Pick<Chat, "name" | "members">,
  currentUserId: string,
): string {
  if (chat.members.length === 2) {
    const otherMember = chat.members.find(
      (member) => member.id !== currentUserId,
    );
    if (otherMember) {
      return otherMember.nickname;
    }
  }

  return chat.name;
}

export function getChatListPresentation(
  chat: Chat,
  currentUserId: string,
): { displayName: string; avatarColor: string } {
  const displayName = resolveChatDisplayName(chat, currentUserId);
  const avatarColor =
    chat.members.length === 2
      ? avatarColorForName(displayName)
      : chat.avatarColor;

  return { displayName, avatarColor };
}

export function mapApiChatsToUiChats(apiChats: ChatListItem[]): Chat[] {
  return apiChats.map((chat) => ({
    id: chat.id,
    name: chat.name,
    avatarColor: avatarColorForName(chat.name),
    lastMessage: "",
    lastMessageAt: "",
    members: chat.members,
    messages: [],
  }));
}

// TODO: Lazy-load last message previews — fetch GET /chats/:id/messages?limit=1
// only when the corresponding chat list item is visible in the viewport
// (e.g. IntersectionObserver on ChatList items).
export async function loadLastMessagePreviews(
  token: string,
  chats: Chat[],
  currentUserId: string,
  currentUserNickname: string,
): Promise<Chat[]> {
  return Promise.all(
    chats.map(async (chat) => {
      try {
        const response = await listMessages(token, chat.id, { limit: 1 });
        const latestMessage = response.messages.at(-1);

        if (!latestMessage) {
          return chat;
        }

        const preview = lastMessagePreviewFromMessageItem(
          latestMessage,
          chat.members,
          currentUserId,
          currentUserNickname,
        );

        return {
          ...chat,
          ...preview,
        };
      } catch {
        return chat;
      }
    }),
  );
}

export function updateChatLastMessage(
  chats: Chat[],
  chatId: string,
  preview: { lastMessage: string; lastMessageAt: string },
): Chat[] {
  return chats.map((chat) =>
    chat.id === chatId
      ? {
          ...chat,
          lastMessage: preview.lastMessage,
          lastMessageAt: preview.lastMessageAt,
        }
      : chat,
  );
}
