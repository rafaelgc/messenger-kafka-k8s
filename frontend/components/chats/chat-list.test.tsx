import { createChat } from "@/test/utils/fixtures";
import { ChatList } from "@/components/chats/chat-list";
import styles from "@/components/chats/chats.module.css";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("ChatList", () => {
  const currentUserId = "user-1";
  const chats = [
    createChat({
      id: "chat-1",
      name: "Design Team",
      members: [
        { id: "user-1", nickname: "alice" },
        { id: "user-2", nickname: "carol" },
        { id: "user-3", nickname: "bob" },
      ],
      lastMessage: "Latest update",
      unreadCount: 2,
    }),
    createChat({
      id: "chat-2",
      name: "Bob",
      members: [
        { id: "user-1", nickname: "alice" },
        { id: "user-4", nickname: "bob" },
      ],
      lastMessage: "See you soon",
    }),
  ];

  it("renders chats with preview text", () => {
    render(
      <ChatList
        chats={chats}
        currentUserId={currentUserId}
        selectedChatId="chat-1"
        onSelectChat={vi.fn()}
      />,
    );

    expect(screen.getByText("Design Team")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("Latest update")).toBeInTheDocument();
    expect(screen.getByText("See you soon")).toBeInTheDocument();
  });

  it("shows unread badges when present", () => {
    render(
      <ChatList
        chats={chats}
        currentUserId={currentUserId}
        selectedChatId={null}
        onSelectChat={vi.fn()}
      />,
    );

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("marks the selected chat as active", () => {
    render(
      <ChatList
        chats={chats}
        currentUserId={currentUserId}
        selectedChatId="chat-2"
        onSelectChat={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]?.className).not.toContain(styles.chatListItemActive);
    expect(buttons[1]?.className).toContain(styles.chatListItemActive);
  });

  it("calls onSelectChat when a chat is clicked", async () => {
    const user = userEvent.setup();
    const onSelectChat = vi.fn();

    render(
      <ChatList
        chats={chats}
        currentUserId={currentUserId}
        selectedChatId={null}
        onSelectChat={onSelectChat}
      />,
    );

    await user.click(screen.getByRole("button", { name: /bob/i }));

    expect(onSelectChat).toHaveBeenCalledWith("chat-2");
  });
});
