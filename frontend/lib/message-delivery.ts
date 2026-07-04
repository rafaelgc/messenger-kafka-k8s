const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://ws.localhost/ws";

export const MESSAGE_DELIVERY_WS_URL = WS_BASE_URL.endsWith("/ws")
  ? WS_BASE_URL
  : `${WS_BASE_URL.replace(/\/$/, "")}/ws`;

export type MessageSentEvent = {
  chat_id: string;
  text: string;
  sender_id: string;
  recipient_ids: string[];
};

export type AuthClientMessage = {
  type: "auth";
  token: string;
};

export function isMessageSentEvent(
  value: unknown,
): value is MessageSentEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    typeof event.chat_id === "string" &&
    typeof event.text === "string" &&
    typeof event.sender_id === "string"
  );
}
