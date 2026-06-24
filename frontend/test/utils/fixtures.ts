import type { TokenClaims } from "@/lib/jwt";

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createTestToken(claims: TokenClaims): string {
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `header.${payload}.signature`;
}

export function createMessage(overrides: Partial<import("@/lib/mock-data").Message> = {}) {
  return {
    id: "msg-1",
    senderId: "user-1",
    senderName: "Alice",
    text: "Hello",
    sentAt: "2026-06-23T10:00:00.000Z",
    ...overrides,
  };
}

export function createChat(overrides: Partial<import("@/lib/mock-data").Chat> = {}) {
  return {
    id: "chat-1",
    name: "Design Team",
    avatarColor: "#6366f1",
    lastMessage: "See you at standup.",
    lastMessageAt: "2026-06-23T08:30:00.000Z",
    unreadCount: 0,
    messages: [],
    ...overrides,
  };
}
