import { formatMessageTime } from "@/lib/format";
import type { Message } from "@/lib/mock-data";
import styles from "./chats.module.css";

type MessageBubbleProps = {
  message: Message;
  isOwn: boolean;
  showSenderName: boolean;
};

export function MessageBubble({
  message,
  isOwn,
  showSenderName,
}: MessageBubbleProps) {
  return (
    <div
      className={`${styles.messageRow} ${
        isOwn ? styles.messageRowOwn : styles.messageRowOther
      }`}
    >
      <div
        className={`${styles.bubble} ${
          isOwn ? styles.bubbleOwn : styles.bubbleOther
        }`}
      >
        {!isOwn && showSenderName ? (
          <p className={styles.senderName}>{message.senderName}</p>
        ) : null}
        <p className={styles.messageText}>{message.text}</p>
        <div className={styles.messageMeta}>
          <span className={styles.messageTime}>
            {formatMessageTime(message.sentAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
