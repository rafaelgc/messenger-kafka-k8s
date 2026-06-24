import { createMessage } from "@/test/utils/fixtures";
import { MessageBubble } from "@/components/chats/message-bubble";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("MessageBubble", () => {
  it("renders the message text and time", () => {
    render(
      <MessageBubble
        message={createMessage({ text: "On my way" })}
        isOwn={false}
        showSenderName
      />,
    );

    expect(screen.getByText("On my way")).toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it("shows the sender name for other users when requested", () => {
    render(
      <MessageBubble
        message={createMessage({ senderName: "Bob" })}
        isOwn={false}
        showSenderName
      />,
    );

    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("hides the sender name for own messages", () => {
    render(
      <MessageBubble
        message={createMessage({ senderName: "Alice" })}
        isOwn
        showSenderName
      />,
    );

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("hides the sender name when showSenderName is false", () => {
    render(
      <MessageBubble
        message={createMessage({ senderName: "Bob" })}
        isOwn={false}
        showSenderName={false}
      />,
    );

    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });
});
