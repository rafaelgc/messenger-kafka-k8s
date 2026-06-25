import { CreateChatForm } from "@/components/chats/create-chat-form";
import { createChatApiHandlers } from "@/test/mocks/api-handlers";
import { server } from "@/test/mocks/server";
import { createValidToken } from "@/test/utils/fixtures";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("CreateChatForm", () => {
  it("creates a direct chat with one nickname", async () => {
    const user = userEvent.setup();
    const onChatCreated = vi.fn();
    const onCreateChat = vi.fn();
    server.use(...createChatApiHandlers({ onCreateChat }));

    render(
      <CreateChatForm
        token={createValidToken()}
        currentUserNickname="alice"
        onChatCreated={onChatCreated}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Member nicknames"), "bob");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Create chat" }));

    await waitFor(() => {
      expect(onCreateChat).toHaveBeenCalledWith({
        member_nicknames: ["bob"],
      });
    });

    expect(onChatCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^chat-/),
        name: "bob",
        members: expect.arrayContaining([
          { id: "user-1", nickname: "alice" },
          { id: expect.stringMatching(/^user-new-/), nickname: "bob" },
        ]),
      }),
    );
    expect(screen.queryByLabelText("Group name")).not.toBeInTheDocument();
  });

  it("requires a group name for multiple nicknames", async () => {
    const user = userEvent.setup();

    render(
      <CreateChatForm
        token={createValidToken()}
        currentUserNickname="alice"
        onChatCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Member nicknames"), "bob");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Member nicknames"), "carol");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByLabelText("Group name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create chat" }));

    expect(await screen.findByText("Give the group a name.")).toBeInTheDocument();
  });

  it("creates a group chat when a name is provided", async () => {
    const user = userEvent.setup();
    const onCreateChat = vi.fn();
    server.use(...createChatApiHandlers({ onCreateChat }));

    render(
      <CreateChatForm
        token={createValidToken()}
        currentUserNickname="alice"
        onChatCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Member nicknames"), "bob");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Member nicknames"), "carol");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Group name"), "Weekend plans");
    await user.click(screen.getByRole("button", { name: "Create chat" }));

    await waitFor(() => {
      expect(onCreateChat).toHaveBeenCalledWith({
        member_nicknames: ["bob", "carol"],
        name: "Weekend plans",
      });
    });
  });

  it("prevents adding your own nickname", async () => {
    const user = userEvent.setup();

    render(
      <CreateChatForm
        token={createValidToken()}
        currentUserNickname="alice"
        onChatCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Member nicknames"), "alice");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("You are already in the chat.")).toBeInTheDocument();
  });
});
