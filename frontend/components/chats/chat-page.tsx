"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { MOCK_CHATS } from "@/lib/mock-data";
import { ChatList } from "./chat-list";
import { ChatPanel } from "./chat-panel";
import styles from "./chats.module.css";

export function ChatPage() {
  const { user, signOut } = useAuth();
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    MOCK_CHATS[0]?.id ?? null,
  );

  const selectedChat = useMemo(
    () => MOCK_CHATS.find((chat) => chat.id === selectedChatId) ?? null,
    [selectedChatId],
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.userMeta}>
            <span className={styles.userLabel}>Signed in as</span>
            <span className={styles.userName}>{user?.nickname ?? "Alice"}</span>
          </div>
          <button className={styles.signOut} type="button" onClick={signOut}>
            Sign out
          </button>
        </div>

        <ChatList
          chats={MOCK_CHATS}
          selectedChatId={selectedChatId}
          onSelectChat={setSelectedChatId}
        />
      </aside>

      <ChatPanel chat={selectedChat} />
    </div>
  );
}
