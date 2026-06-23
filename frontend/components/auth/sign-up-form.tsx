"use client";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { FormEvent, useState } from "react";
import styles from "./auth.module.css";

export function SignUpForm() {
  const { signUp } = useAuth();
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      await signUp(nickname, password);
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
          disabled={isSubmitting}
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
          disabled={isSubmitting}
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
          disabled={isSubmitting}
          required
        />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <button className={styles.submit} type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating account..." : "Create account"}
      </button>
    </form>
  );
}
