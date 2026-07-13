"use client";

import { useAuth } from "@/components/providers/auth-provider";
import {
  isMessageSentEvent,
  MESSAGE_DELIVERY_WS_URL,
  type MessageSentEvent,
} from "@/lib/message-delivery";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type MessageListener = (event: MessageSentEvent) => void;

type MessageDeliveryContextValue = {
  subscribe: (listener: MessageListener) => () => void;
};

const MessageDeliveryContext =
  createContext<MessageDeliveryContextValue | null>(null);

const MAX_RECONNECT_DELAY_MS = 30_000;

export function MessageDeliveryProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const listenersRef = useRef(new Set<MessageListener>());
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const tokenRef = useRef(token);

  tokenRef.current = token;

  const subscribe = useCallback((listener: MessageListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
      reconnectAttemptRef.current = 0;
      return;
    }

    let cancelled = false;

    function notifyListeners(event: MessageSentEvent) {
      listenersRef.current.forEach((listener) => listener(event));
    }

    function scheduleReconnect() {
      if (cancelled || !tokenRef.current) {
        return;
      }

      const delay = Math.min(
        1000 * 2 ** reconnectAttemptRef.current,
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttemptRef.current += 1;

      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, delay);
    }

    function connect() {
      if (cancelled || !tokenRef.current) {
        return;
      }

      const socket = new WebSocket(MESSAGE_DELIVERY_WS_URL);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (cancelled || !tokenRef.current) {
          socket.close();
          return;
        }

        reconnectAttemptRef.current = 0;
        // [TODO] After reconnect, refetch open chat messages from the API. While the WebSocket
        // is down (spot eviction, rollout, network blip), message.sent events are not pushed
        // but are persisted by message-storage — the UI can miss live updates until refresh.
        socket.send(
          JSON.stringify({
            type: "auth",
            token: tokenRef.current,
          }),
        );
      });

      socket.addEventListener("message", (messageEvent) => {
        try {
          const payload: unknown = JSON.parse(String(messageEvent.data));
          if (isMessageSentEvent(payload)) {
            notifyListeners(payload);
          }
        } catch {
          // Ignore malformed frames.
        }
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        if (!cancelled) {
          scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    }

    connect();

    return () => {
      cancelled = true;

      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      socketRef.current?.close();
      socketRef.current = null;
      reconnectAttemptRef.current = 0;
    };
  }, [token]);

  const value = useMemo(() => ({ subscribe }), [subscribe]);

  return (
    <MessageDeliveryContext.Provider value={value}>
      {children}
    </MessageDeliveryContext.Provider>
  );
}

export function useMessageDelivery() {
  const context = useContext(MessageDeliveryContext);
  if (!context) {
    throw new Error(
      "useMessageDelivery must be used within MessageDeliveryProvider",
    );
  }
  return context;
}
