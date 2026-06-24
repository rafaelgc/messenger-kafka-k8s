import { mapApiChatsToUiChats } from "@/lib/chats";
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
