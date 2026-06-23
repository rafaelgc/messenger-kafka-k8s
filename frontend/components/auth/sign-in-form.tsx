"use client";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { FormEvent, useState } from "react";
import styles from "./auth.module.css";

export function SignInForm() {
  const { signIn } = useAuth();
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await signIn(nickname, password);
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setError(submitError.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
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
          disabled={isSubmitting}
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
          disabled={isSubmitting}
          required
        />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <button className={styles.submit} type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
