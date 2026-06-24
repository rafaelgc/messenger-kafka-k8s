import { ChatPage } from "@/components/chats/chat-page";
import { createChatApiHandlers } from "@/test/mocks/api-handlers";
import { server } from "@/test/mocks/server";
import {
  getLatestMockWebSocket,
  installMockWebSocket,
  resetMockWebSocket,
} from "@/test/mocks/websocket";
import {
  renderWithProviders,
  waitForChatsToLoad,
  waitForMessagesToLoad,
} from "@/test/utils/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ChatPage integration", () => {
  beforeEach(() => {
    installMockWebSocket();
    server.use(...createChatApiHandlers());
  });

  afterEach(() => {
    resetMockWebSocket();
  });

  it("loads chats and messages for the initially selected chat", async () => {
    renderWithProviders(<ChatPage />);

    await waitForChatsToLoad();
    await waitForMessagesToLoad();

    expect(screen.getByRole("heading", { name: "Design Team" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Design Team/i })).toBeInTheDocument();
    expect(screen.getByText("Hello from the team")).toBeInTheDocument();
    expect(screen.getByText("carol")).toBeInTheDocument();
    expect(screen.getByText("carol: Hello from the team")).toBeInTheDocument();
    expect(screen.getByText("Signed in as")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("loads messages when switching chats", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ChatPage />);

    await waitForChatsToLoad();
    await waitForMessagesToLoad();
    expect(screen.getByText("Hello from the team")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Bob/i }));

    await waitForMessagesToLoad();
    expect(screen.getByText("See you at standup")).toBeInTheDocument();
    expect(screen.queryByText("Hello from the team")).not.toBeInTheDocument();
  });

  it("sends a message and keeps the composer focused", async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();
    server.use(...createChatApiHandlers({ onSendMessage }));

    renderWithProviders(<ChatPage />);

    await waitForChatsToLoad();
    await waitForMessagesToLoad();

    const input = screen.getByLabelText("Message input");
    await user.click(input);
    await user.type(input, "Hello team");
    await user.keyboard("{Enter}");

    expect(onSendMessage).toHaveBeenCalledWith("chat-1", "Hello team");
    expect(await screen.findByText("Hello team")).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
  });

  it("shows an error when chat loading fails", async () => {
    server.use(...createChatApiHandlers({ chatsStatus: 500 }));

    renderWithProviders(<ChatPage />);

    expect(
      await screen.findByText("Could not load your chats."),
    ).toBeInTheDocument();
  });

  it("restores the draft and shows an error when sending fails", async () => {
    const user = userEvent.setup();
    server.use(...createChatApiHandlers({ sendStatus: 502 }));

    renderWithProviders(<ChatPage />);

    await waitForChatsToLoad();
    await waitForMessagesToLoad();

    const input = screen.getByLabelText("Message input");
    await user.type(input, "This will fail");
    await user.keyboard("{Enter}");

    expect(
      await screen.findByText("The server is unavailable. Try again in a moment."),
    ).toBeInTheDocument();
    expect(input).toHaveValue("This will fail");
  });

  it("appends websocket messages for the open chat", async () => {
    renderWithProviders(<ChatPage />);

    await waitForChatsToLoad();
    await waitForMessagesToLoad();

    const socket = getLatestMockWebSocket();
    expect(socket).not.toBeNull();
    expect(socket?.sentMessages[0]).toContain('"type":"auth"');

    socket?.simulateIncoming({
      chat_id: "chat-1",
      text: "Live update",
      sender_id: "user-2",
      recipient_ids: ["user-1", "user-2"],
    });

    expect(await screen.findByText("Live update")).toBeInTheDocument();
    expect(screen.getByText("carol: Live update")).toBeInTheDocument();
  });

  it("updates the chat list preview for websocket messages in other chats", async () => {
    renderWithProviders(<ChatPage />);

    await waitForChatsToLoad();
    await waitForMessagesToLoad();

    getLatestMockWebSocket()?.simulateIncoming({
      chat_id: "chat-2",
      text: "Wrong chat message",
      sender_id: "user-3",
      recipient_ids: ["user-1", "user-3"],
    });

    expect(
      await screen.findByText("bob: Wrong chat message"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Wrong chat message")).not.toBeInTheDocument();
  });
});
