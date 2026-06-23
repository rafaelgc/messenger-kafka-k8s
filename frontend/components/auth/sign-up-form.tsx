"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import styles from "./auth.module.css";

export function SignUpForm() {
  const { signUp } = useAuth();
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    signUp(nickname, password);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="sign-up-nickname">
          Nickname
        </label>
        <input
          id="sign-up-nickname"
          className={styles.input}
          type="text"
          name="nickname"
          autoComplete="username"
          placeholder="Pick a unique nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sign-up-password">
          Password
        </label>
        <input
          id="sign-up-password"
          className={styles.input}
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="Create a password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sign-up-confirm-password">
          Confirm password
        </label>
        <input
          id="sign-up-confirm-password"
          className={styles.input}
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <button className={styles.submit} type="submit">
        Create account
      </button>
    </form>
  );
}
