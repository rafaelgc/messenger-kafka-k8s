"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type Chat } from "@/lib/mock-data";
import { CreateChatForm } from "./create-chat-form";
import styles from "./chats.module.css";

type CreateChatDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  currentUserNickname: string;
  onChatCreated: (chat: Chat) => void;
};

export function CreateChatDialog({
  open,
  onOpenChange,
  token,
  currentUserNickname,
  onChatCreated,
}: CreateChatDialogProps) {
  function handleChatCreated(chat: Chat) {
    onChatCreated(chat);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            Add at least one person by nickname. More than one makes it a group
            chat.
          </DialogDescription>
        </DialogHeader>

        <CreateChatForm
          key={open ? "open" : "closed"}
          token={token}
          currentUserNickname={currentUserNickname}
          onChatCreated={handleChatCreated}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function NewChatButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button className={styles.newChatButton} type="button" onClick={onClick}>
      New chat
    </button>
  );
}
