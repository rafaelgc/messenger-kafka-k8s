"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { useMessageDelivery } from "@/components/providers/message-delivery-provider";
import { listChats } from "@/lib/api";
import {
  loadLastMessagePreviews,
  mapApiChatsToUiChats,
  updateChatLastMessage,
} from "@/lib/chats";
import { lastMessagePreviewFromWsEvent } from "@/lib/messages";
import { type Chat } from "@/lib/mock-data";
import { useEffect, useMemo, useState } from "react";
import { ChatList } from "./chat-list";
import { ChatPanel } from "./chat-panel";
import styles from "./chats.module.css";

export function ChatPage() {
  const { user, token, signOut } = useAuth();
  const { subscribe } = useMessageDelivery();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [chatsError, setChatsError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) {
      return;
    }

    const authToken = token;
    const currentUser = user;

    let cancelled = false;

    async function loadChats() {
      setIsLoadingChats(true);
      setChatsError(null);

      try {
        const response = await listChats(authToken);
        if (cancelled) {
          return;
        }

        const uiChats = mapApiChatsToUiChats(response.chats);
        const chatsWithPreviews = await loadLastMessagePreviews(
          authToken,
          uiChats,
          currentUser.id,
          currentUser.nickname,
        );

        if (cancelled) {
          return;
        }

        setChats(chatsWithPreviews);
        setSelectedChatId((current) => {
          if (current && chatsWithPreviews.some((chat) => chat.id === current)) {
            return current;
          }
          return chatsWithPreviews[0]?.id ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setChatsError(
            error instanceof Error ? error.message : "Could not load your chats.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingChats(false);
        }
      }
    }

    void loadChats();

    return () => {
      cancelled = true;
    };
  }, [token, user?.id, user?.nickname]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribe((event) => {
      setChats((current) => {
        const chat = current.find((entry) => entry.id === event.chat_id);
        if (!chat) {
          return current;
        }

        const preview = lastMessagePreviewFromWsEvent(
          event,
          chat.members,
          user.id,
          user.nickname,
        );

        return updateChatLastMessage(current, event.chat_id, preview);
      });
    });
  }, [subscribe, user?.id, user?.nickname]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
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

        {isLoadingChats ? (
          <p className={styles.sidebarStatus}>Loading chats...</p>
        ) : chatsError ? (
          <p className={styles.sidebarStatus}>{chatsError}</p>
        ) : chats.length === 0 ? (
          <p className={styles.sidebarStatus}>No chats yet.</p>
        ) : (
          <ChatList
            chats={chats}
            selectedChatId={selectedChatId}
            onSelectChat={setSelectedChatId}
          />
        )}
      </aside>

      <ChatPanel chat={selectedChat} />
    </div>
  );
}
