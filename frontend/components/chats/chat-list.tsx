import { formatChatListTime } from "@/lib/format";
import { getInitials, type Chat } from "@/lib/mock-data";
import styles from "./chats.module.css";

type ChatListProps = {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
};

export function ChatList({ chats, selectedChatId, onSelectChat }: ChatListProps) {
  return (
    <ul className={styles.chatList}>
      {chats.map((chat) => {
        const isActive = chat.id === selectedChatId;

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
                style={{ backgroundColor: chat.avatarColor }}
                aria-hidden
              >
                {getInitials(chat.name)}
              </span>
              <span className={styles.chatName}>{chat.name}</span>
              <span className={styles.chatTime}>
                {formatChatListTime(chat.lastMessageAt)}
              </span>
              <span className={styles.chatPreview}>{chat.lastMessage}</span>
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
