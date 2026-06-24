import { mapApiChatsToUiChats, resolveChatDisplayName } from "@/lib/chats";
import { describe, expect, it } from "vitest";

describe("mapApiChatsToUiChats", () => {
  it("maps api chats using real ids and names", () => {
    const chats = mapApiChatsToUiChats([
      {
        id: "chat-1",
        name: "Design Team",
        members: [{ id: "user-1", nickname: "alice" }, { id: "user-2", nickname: "bob" }],
      },
    ]);

    expect(chats[0]?.id).toBe("chat-1");
    expect(chats[0]?.name).toBe("Design Team");
    expect(chats[0]?.messages).toEqual([]);
    expect(chats[0]?.lastMessage).toBe("");
    expect(chats[0]?.lastMessageAt).toBe("");
    expect(chats[0]?.members).toEqual([
      { id: "user-1", nickname: "alice" },
      { id: "user-2", nickname: "bob" },
    ]);
  });

  it("assigns distinct avatar colors by name", () => {
    const chats = mapApiChatsToUiChats([
      { id: "unknown-1", name: "Alpha", members: [] },
      { id: "unknown-2", name: "Beta", members: [] },
    ]);

    expect(chats[0]?.avatarColor).not.toBe(chats[1]?.avatarColor);
  });
});

describe("resolveChatDisplayName", () => {
  it("shows the other member nickname for two-person chats", () => {
    const chat = {
      name: "Design Team",
      members: [
        { id: "user-1", nickname: "alice" },
        { id: "user-2", nickname: "carol" },
      ],
    };

    expect(resolveChatDisplayName(chat, "user-1")).toBe("carol");
    expect(resolveChatDisplayName(chat, "user-2")).toBe("alice");
  });

  it("keeps the chat name for group chats", () => {
    const chat = {
      name: "Design Team",
      members: [
        { id: "user-1", nickname: "alice" },
        { id: "user-2", nickname: "carol" },
        { id: "user-3", nickname: "bob" },
      ],
    };

    expect(resolveChatDisplayName(chat, "user-1")).toBe("Design Team");
  });
});
