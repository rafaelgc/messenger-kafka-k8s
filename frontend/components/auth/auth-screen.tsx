"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";
import styles from "./auth.module.css";

export function AuthScreen() {
  const { authView, setAuthView } = useAuth();
  const isSignIn = authView === "sign-in";

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.brand}>Messaging</h1>
        <p className={styles.subtitle}>
          {isSignIn
            ? "Welcome back. Sign in to pick up your conversations."
            : "Create an account to start messaging with your team."}
        </p>

        {isSignIn ? <SignInForm /> : <SignUpForm />}

        <p className={styles.footer}>
          {isSignIn ? (
            <>
              Don&apos;t have an account?{" "}
              <a
                className={styles.footerLink}
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  setAuthView("sign-up");
                }}
              >
                Sign up
              </a>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a
                className={styles.footerLink}
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  setAuthView("sign-in");
                }}
              >
                Sign in
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
