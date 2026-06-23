"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { getInitials, type Chat } from "@/lib/mock-data";
import { MessageBubble } from "./message-bubble";
import styles from "./chats.module.css";

type ChatPanelProps = {
  chat: Chat | null;
};

export function ChatPanel({ chat }: ChatPanelProps) {
  const { user } = useAuth();
  const currentUserId = user?.nickname.toLowerCase() ?? "alice";

  if (!chat) {
    return (
      <section className={`${styles.chatPanel} ${styles.chatPanelEmpty}`}>
        <div className={styles.emptyPanel}>
          <h2 className={styles.emptyPanelTitle}>Select a chat</h2>
          <p className={styles.emptyPanelText}>
            Choose a conversation from the list to view messages.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.chatPanel}>
      <header className={styles.panelHeader}>
        <span
          className={styles.panelHeaderAvatar}
          style={{ backgroundColor: chat.avatarColor }}
          aria-hidden
        >
          {getInitials(chat.name)}
        </span>
        <div className={styles.panelHeaderInfo}>
          <h2 className={styles.panelTitle}>{chat.name}</h2>
          <p className={styles.panelSubtitle}>
            {chat.messages.length} messages · mock data
          </p>
        </div>
      </header>

      <div className={styles.messageList}>
        {chat.messages.map((message, index) => {
          const isOwn = message.senderId.toLowerCase() === currentUserId;
          const previous = chat.messages[index - 1];
          const showSenderName =
            !isOwn &&
            (previous === undefined ||
              previous.senderId !== message.senderId ||
              previous.senderId.toLowerCase() === currentUserId);

          return (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={isOwn}
              showSenderName={showSenderName}
            />
          );
        })}
      </div>

      <footer className={styles.composer}>
        <textarea
          className={styles.composerInput}
          rows={1}
          placeholder="Type a message"
          disabled
          aria-label="Message input"
        />
        <button className={styles.composerSend} type="button" disabled aria-label="Send">
          ↑
        </button>
      </footer>
    </section>
  );
}
