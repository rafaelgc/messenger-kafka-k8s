import type { ChatListItem, MessageItem } from "@/lib/api";
import { http, HttpResponse } from "msw";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://api.localhost";

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
  onCreateChat?: (request: {
    member_nicknames: string[];
    name?: string;
  }) => void;
  chatsStatus?: number;
  sendStatus?: number;
  createStatus?: number;
};

export function createChatApiHandlers({
  chats = defaultTestChats,
  messagesByChatId = defaultTestMessages,
  onSendMessage,
  onCreateChat,
  chatsStatus = 200,
  sendStatus = 201,
  createStatus = 201,
}: ChatApiHandlersOptions = {}) {
  let nextChatId = 100;

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
    http.post(`${API_BASE_URL}/chats`, async ({ request }) => {
      const body = (await request.json()) as {
        member_nicknames: string[];
        name?: string;
      };

      onCreateChat?.(body);

      if (createStatus !== 201) {
        return new HttpResponse(null, { status: createStatus });
      }

      if (
        body.member_nicknames.length === 0 ||
        body.member_nicknames.some((nickname) => !nickname.trim())
      ) {
        return new HttpResponse(null, { status: 400 });
      }

      if (body.member_nicknames.length > 1 && !body.name?.trim()) {
        return new HttpResponse(null, { status: 400 });
      }

      nextChatId += 1;
      const chatId = `chat-${nextChatId}`;
      const otherMembers = body.member_nicknames.map((nickname, index) => ({
        id: `user-new-${nextChatId}-${index}`,
        nickname,
      }));

      const chat: ChatListItem = {
        id: chatId,
        name:
          body.member_nicknames.length === 1
            ? body.member_nicknames[0]
            : body.name!.trim(),
        members: [testChatMembers.alice, ...otherMembers],
      };

      return HttpResponse.json(chat, { status: 201 });
    }),
    http.get(`${API_BASE_URL}/chats/:chatId/messages`, ({ params, request }) => {
      const chatId = String(params.chatId);
      const allMessages = messagesByChatId[chatId] ?? [];
      const limitParam = new URL(request.url).searchParams.get("limit");
      const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
      const messages =
        limit !== undefined && Number.isFinite(limit)
          ? allMessages.slice(-limit)
          : allMessages;

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
