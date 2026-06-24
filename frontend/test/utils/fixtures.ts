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
