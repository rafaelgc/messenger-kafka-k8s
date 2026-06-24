import type { ChatMember } from "@/lib/api";

export type Message = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: string;
};

export type Chat = {
  id: string;
  name: string;
  avatarColor: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount?: number;
  members: ChatMember[];
  messages: Message[];
};

export const MOCK_CHATS: Chat[] = [
  {
    id: "chat-design",
    name: "Design Team",
    avatarColor: "#6366f1",
    lastMessage: "Carol: I'll share the mockups after lunch.",
    lastMessageAt: "2026-06-23T11:42:00.000Z",
    unreadCount: 2,
    members: [],
    messages: [
      {
        id: "m1",
        senderId: "bob",
        senderName: "Bob",
        text: "Can we align on the sidebar layout today?",
        sentAt: "2026-06-23T09:15:00.000Z",
      },
      {
        id: "m2",
        senderId: "alice",
        senderName: "Alice",
        text: "Yes — I like the two-panel approach we're using.",
        sentAt: "2026-06-23T09:18:00.000Z",
      },
      {
        id: "m3",
        senderId: "carol",
        senderName: "Carol",
        text: "Same here. Keeping the list on the left feels familiar.",
        sentAt: "2026-06-23T09:22:00.000Z",
      },
      {
        id: "m4",
        senderId: "bob",
        senderName: "Bob",
        text: "Great. Let's polish spacing and typography next.",
        sentAt: "2026-06-23T10:05:00.000Z",
      },
      {
        id: "m5",
        senderId: "carol",
        senderName: "Carol",
        text: "I'll share the mockups after lunch.",
        sentAt: "2026-06-23T11:42:00.000Z",
      },
    ],
  },
  {
    id: "chat-bob",
    name: "Bob",
    avatarColor: "#0ea5e9",
    lastMessage: "See you at standup.",
    lastMessageAt: "2026-06-23T08:30:00.000Z",
    members: [],
    messages: [
      {
        id: "m6",
        senderId: "bob",
        senderName: "Bob",
        text: "Hey, are you joining the call in 10?",
        sentAt: "2026-06-23T08:12:00.000Z",
      },
      {
        id: "m7",
        senderId: "alice",
        senderName: "Alice",
        text: "Yep, almost done with the auth UI.",
        sentAt: "2026-06-23T08:18:00.000Z",
      },
      {
        id: "m8",
        senderId: "bob",
        senderName: "Bob",
        text: "See you at standup.",
        sentAt: "2026-06-23T08:30:00.000Z",
      },
    ],
  },
  {
    id: "chat-weekend",
    name: "Weekend Plans",
    avatarColor: "#10b981",
    lastMessage: "You: Sounds good to me!",
    lastMessageAt: "2026-06-22T19:10:00.000Z",
    members: [],
    messages: [
      {
        id: "m9",
        senderId: "dana",
        senderName: "Dana",
        text: "Hike on Saturday morning?",
        sentAt: "2026-06-22T18:45:00.000Z",
      },
      {
        id: "m10",
        senderId: "erik",
        senderName: "Erik",
        text: "I'm in if we start early.",
        sentAt: "2026-06-22T18:52:00.000Z",
      },
      {
        id: "m11",
        senderId: "alice",
        senderName: "Alice",
        text: "Sounds good to me!",
        sentAt: "2026-06-22T19:10:00.000Z",
      },
    ],
  },
  {
    id: "chat-carol",
    name: "Carol",
    avatarColor: "#f59e0b",
    lastMessage: "Thanks for the quick review!",
    lastMessageAt: "2026-06-21T16:20:00.000Z",
    members: [],
    messages: [
      {
        id: "m12",
        senderId: "carol",
        senderName: "Carol",
        text: "Could you glance at the PR when you have a minute?",
        sentAt: "2026-06-21T15:55:00.000Z",
      },
      {
        id: "m13",
        senderId: "alice",
        senderName: "Alice",
        text: "Done — left a couple of minor notes.",
        sentAt: "2026-06-21T16:08:00.000Z",
      },
      {
        id: "m14",
        senderId: "carol",
        senderName: "Carol",
        text: "Thanks for the quick review!",
        sentAt: "2026-06-21T16:20:00.000Z",
      },
    ],
  },
];

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
