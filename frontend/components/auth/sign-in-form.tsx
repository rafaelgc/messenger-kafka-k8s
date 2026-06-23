"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import styles from "./auth.module.css";

export function SignInForm() {
  const { signIn } = useAuth();
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn(nickname, password);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="sign-in-nickname">
          Nickname
        </label>
        <input
          id="sign-in-nickname"
          className={styles.input}
          type="text"
          name="nickname"
          autoComplete="username"
          placeholder="Your nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sign-in-password">
          Password
        </label>
        <input
          id="sign-in-password"
          className={styles.input}
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      <button className={styles.submit} type="submit">
        Sign in
      </button>
    </form>
  );
}
