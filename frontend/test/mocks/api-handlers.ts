import type { ChatListItem, MessageItem } from "@/lib/api";
import { http, HttpResponse } from "msw";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const testChatMembers = {
  alice: { id: "user-1", nickname: "alice" },
  carol: { id: "user-2", nickname: "carol" },
  bob: { id: "user-3", nickname: "bob" },
} as const;

export const defaultTestChats: ChatListItem[] = [
  {
    id: "chat-1",
    name: "Design Team",
    members: [testChatMembers.alice, testChatMembers.carol],
  },
  {
    id: "chat-2",
    name: "Bob",
    members: [testChatMembers.alice, testChatMembers.bob],
  },
];

export const defaultTestMessages: Record<string, MessageItem[]> = {
  "chat-1": [
    {
      id: "649a1b2c3d4e5f6789012345",
      chat_id: "chat-1",
      text: "Hello from the team",
      sender_id: "user-2",
    },
  ],
  "chat-2": [
    {
      id: "649a1b2d3d4e5f6789012346",
      chat_id: "chat-2",
      text: "See you at standup",
      sender_id: "user-3",
    },
  ],
};

type ChatApiHandlersOptions = {
  chats?: ChatListItem[];
  messagesByChatId?: Record<string, MessageItem[]>;
  onSendMessage?: (chatId: string, text: string) => void;
  chatsStatus?: number;
  sendStatus?: number;
};

export function createChatApiHandlers({
  chats = defaultTestChats,
  messagesByChatId = defaultTestMessages,
  onSendMessage,
  chatsStatus = 200,
  sendStatus = 201,
}: ChatApiHandlersOptions = {}) {
  return [
    http.get(`${API_BASE_URL}/chats`, () => {
      if (chatsStatus !== 200) {
        return new HttpResponse(null, { status: chatsStatus });
      }

      return HttpResponse.json({
        chats,
        pagination: { has_more: false },
      });
    }),
    http.get(`${API_BASE_URL}/chats/:chatId/messages`, ({ params }) => {
      const chatId = String(params.chatId);
      const messages = messagesByChatId[chatId] ?? [];

      return HttpResponse.json({
        messages,
        pagination: { has_more: false },
      });
    }),
    http.post(
      `${API_BASE_URL}/chats/:chatId/messages`,
      async ({ params, request }) => {
        const chatId = String(params.chatId);
        const body = (await request.json()) as { text: string };
        onSendMessage?.(chatId, body.text);

        if (sendStatus !== 201) {
          return new HttpResponse(null, { status: sendStatus });
        }

        return new HttpResponse(null, { status: 201 });
      },
    ),
  ];
}
