"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { useMessageDelivery } from "@/components/providers/message-delivery-provider";
import { listMessages } from "@/lib/api";
import {
  appendNewMessage,
  isNearBottom,
  mapApiMessageToUiMessage,
  mapWsMessageToUiMessage,
  mergeOlderMessages,
} from "@/lib/messages";
import { getInitials, type Chat, type Message } from "@/lib/mock-data";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MessageBubble } from "./message-bubble";
import styles from "./chats.module.css";

const MESSAGES_PAGE_SIZE = 30;

type ChatPanelProps = {
  chat: Chat | null;
};

export function ChatPanel({ chat }: ChatPanelProps) {
  const { user, token } = useAuth();
  const { subscribe } = useMessageDelivery();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageListRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const scrollHeightBeforePrepend = useRef(0);
  const isPrependingRef = useRef(false);
  const shouldScrollToBottomRef = useRef(false);

  useEffect(() => {
    const chatId = chat?.id;

    if (!chatId || !token || !user) {
      setMessages([]);
      setHasMore(false);
      setNextCursor(null);
      setError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      return;
    }

    let cancelled = false;

    async function loadInitialMessages() {
      setIsLoading(true);
      setIsLoadingMore(false);
      setError(null);
      setMessages([]);
      setHasMore(false);
      setNextCursor(null);

      try {
        const response = await listMessages(token, chatId, {
          limit: MESSAGES_PAGE_SIZE,
        });

        if (cancelled) {
          return;
        }

        const uiMessages = response.messages.map((message) =>
          mapApiMessageToUiMessage(message, user.id, user.nickname),
        );

        setMessages(uiMessages);
        setHasMore(response.pagination.has_more);
        setNextCursor(response.pagination.next_cursor ?? null);
        shouldScrollToBottomRef.current = true;
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load messages.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialMessages();

    return () => {
      cancelled = true;
    };
  }, [chat?.id, token, user?.id, user?.nickname]);

  useLayoutEffect(() => {
    if (!shouldScrollToBottomRef.current || !messageListRef.current) {
      return;
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    shouldScrollToBottomRef.current = false;
  }, [messages, isLoading]);

  useLayoutEffect(() => {
    if (!isPrependingRef.current || !messageListRef.current) {
      return;
    }

    const list = messageListRef.current;
    list.scrollTop = list.scrollHeight - scrollHeightBeforePrepend.current;
    isPrependingRef.current = false;
  }, [messages]);

  const loadOlderMessages = useCallback(async () => {
    if (
      !chat ||
      !token ||
      !user ||
      !hasMore ||
      !nextCursor ||
      isLoading ||
      isLoadingMore
    ) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const response = await listMessages(token, chat.id, {
        limit: MESSAGES_PAGE_SIZE,
        before: nextCursor,
      });

      if (messageListRef.current) {
        scrollHeightBeforePrepend.current = messageListRef.current.scrollHeight;
      }

      const olderMessages = response.messages.map((message) =>
        mapApiMessageToUiMessage(message, user.id, user.nickname),
      );

      isPrependingRef.current = true;
      setMessages((current) => mergeOlderMessages(current, olderMessages));
      setHasMore(response.pagination.has_more);
      setNextCursor(response.pagination.next_cursor ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load older messages.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }, [chat, token, user, hasMore, nextCursor, isLoading, isLoadingMore]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = messageListRef.current;

    if (!sentinel || !root || !hasMore || isLoading || messages.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadOlderMessages();
        }
      },
      { root, threshold: 0 },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, isLoading, messages.length, loadOlderMessages]);

  useEffect(() => {
    const chatId = chat?.id;

    if (!chatId || !user) {
      return;
    }

    return subscribe((event) => {
      if (event.chat_id !== chatId) {
        return;
      }

      const incoming = mapWsMessageToUiMessage(event, user.id, user.nickname);

      setMessages((current) => appendNewMessage(current, incoming));

      const list = messageListRef.current;
      if (list && isNearBottom(list)) {
        shouldScrollToBottomRef.current = true;
      }
    });
  }, [chat?.id, subscribe, user?.id, user?.nickname]);

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

  const currentUserId = user?.id ?? "";

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
            {isLoading ? "Loading messages..." : `${messages.length} messages`}
          </p>
        </div>
      </header>

      <div ref={messageListRef} className={styles.messageList}>
        {hasMore ? (
          <div ref={topSentinelRef} className={styles.messageListTop}>
            {isLoadingMore ? (
              <span className={styles.messageListStatus}>
                Loading older messages...
              </span>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <p className={styles.messageListStatus}>Loading messages...</p>
        ) : error ? (
          <p className={styles.messageListStatus}>{error}</p>
        ) : messages.length === 0 ? (
          <p className={styles.messageListStatus}>No messages yet.</p>
        ) : (
          messages.map((message, index) => {
            const isOwn = message.senderId === currentUserId;
            const previous = messages[index - 1];
            const showSenderName =
              !isOwn &&
              (previous === undefined || previous.senderId !== message.senderId);

            return (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={isOwn}
                showSenderName={showSenderName}
              />
            );
          })
        )}
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
