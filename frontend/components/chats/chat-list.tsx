import { formatChatListTime } from "@/lib/format";
import { getChatListPresentation } from "@/lib/chats";
import { getInitials, type Chat } from "@/lib/mock-data";
import styles from "./chats.module.css";

type ChatListProps = {
  chats: Chat[];
  currentUserId: string;
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
};

export function ChatList({
  chats,
  currentUserId,
  selectedChatId,
  onSelectChat,
}: ChatListProps) {
  return (
    <ul className={styles.chatList}>
      {chats.map((chat) => {
        const isActive = chat.id === selectedChatId;
        const { displayName, avatarColor } = getChatListPresentation(
          chat,
          currentUserId,
        );

        return (
          <li key={chat.id}>
            <button
              type="button"
              className={`${styles.chatListItem} ${
                isActive ? styles.chatListItemActive : ""
              }`}
              onClick={() => onSelectChat(chat.id)}
            >
              <span
                className={styles.avatar}
                style={{ backgroundColor: avatarColor }}
                aria-hidden
              >
                {getInitials(displayName)}
              </span>
              <span className={styles.chatName}>{displayName}</span>
              {chat.lastMessage ? (
                <>
                  <span className={styles.chatTime}>
                    {formatChatListTime(chat.lastMessageAt)}
                  </span>
                  <span className={styles.chatPreview}>{chat.lastMessage}</span>
                </>
              ) : null}
              {chat.unreadCount ? (
                <span className={styles.unreadBadge}>{chat.unreadCount}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
