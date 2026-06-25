"use client";

import { ApiError, createChat } from "@/lib/api";
import { mapApiChatToUiChatItem } from "@/lib/chats";
import { type Chat } from "@/lib/mock-data";
import {
  FormEvent,
  KeyboardEvent,
  useState,
} from "react";
import styles from "./chats.module.css";

type CreateChatFormProps = {
  token: string;
  currentUserNickname: string;
  onChatCreated: (chat: Chat) => void;
  onCancel: () => void;
};

function normalizeNickname(value: string): string {
  return value.trim().toLowerCase();
}

export function CreateChatForm({
  token,
  currentUserNickname,
  onChatCreated,
  onCancel,
}: CreateChatFormProps) {
  const [nicknameInput, setNicknameInput] = useState("");
  const [memberNicknames, setMemberNicknames] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isGroupChat = memberNicknames.length > 1;

  function addNickname(rawValue: string) {
    const nickname = rawValue.trim();
    if (!nickname) {
      return;
    }

    const normalized = normalizeNickname(nickname);

    if (normalized === normalizeNickname(currentUserNickname)) {
      setError("You are already in the chat.");
      return;
    }

    if (memberNicknames.some((entry) => normalizeNickname(entry) === normalized)) {
      setError("That nickname is already added.");
      return;
    }

    setMemberNicknames((current) => [...current, nickname]);
    setNicknameInput("");
    setError(null);
  }

  function removeNickname(index: number) {
    setMemberNicknames((current) => current.filter((_, entryIndex) => entryIndex !== index));
    setError(null);
  }

  function handleNicknameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addNickname(nicknameInput);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (memberNicknames.length === 0) {
      setError("Add at least one nickname.");
      return;
    }

    if (isGroupChat && !groupName.trim()) {
      setError("Give the group a name.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await createChat(token, {
        member_nicknames: memberNicknames,
        ...(isGroupChat ? { name: groupName.trim() } : {}),
      });

      onChatCreated(mapApiChatToUiChatItem(response));
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setError(submitError.message);
      } else {
        setError("Could not create the chat. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.createChatForm} onSubmit={handleSubmit}>
      <div className={styles.createChatField}>
        <label className={styles.createChatLabel} htmlFor="member-nickname">
          Member nicknames
        </label>
        <div className={styles.nicknameInputRow}>
          <input
            id="member-nickname"
            className={styles.createChatInput}
            type="text"
            placeholder="Type a nickname"
            value={nicknameInput}
            onChange={(event) => setNicknameInput(event.target.value)}
            onKeyDown={handleNicknameKeyDown}
            disabled={isSubmitting}
          />
          <button
            className={styles.addNicknameButton}
            type="button"
            onClick={() => addNickname(nicknameInput)}
            disabled={isSubmitting || !nicknameInput.trim()}
          >
            Add
          </button>
        </div>
      </div>

      {memberNicknames.length > 0 ? (
        <ul className={styles.nicknameList}>
          {memberNicknames.map((nickname, index) => (
            <li key={`${nickname}-${index}`} className={styles.nicknameChip}>
              <span>{nickname}</span>
              <button
                type="button"
                className={styles.nicknameRemove}
                onClick={() => removeNickname(index)}
                disabled={isSubmitting}
                aria-label={`Remove ${nickname}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {isGroupChat ? (
        <div className={styles.createChatField}>
          <label className={styles.createChatLabel} htmlFor="group-name">
            Group name
          </label>
          <input
            id="group-name"
            className={styles.createChatInput}
            type="text"
            placeholder="e.g. Design Team"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>
      ) : null}

      {error ? <p className={styles.createChatError}>{error}</p> : null}

      <div className={styles.createChatActions}>
        <button
          className={styles.createChatCancel}
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          className={styles.createChatSubmit}
          type="submit"
          disabled={isSubmitting || memberNicknames.length === 0}
        >
          {isSubmitting ? "Creating..." : "Create chat"}
        </button>
      </div>
    </form>
  );
}
