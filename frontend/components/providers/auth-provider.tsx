"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthView = "sign-in" | "sign-up";

export type User = {
  nickname: string;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  user: User | null;
  authView: AuthView;
  setAuthView: (view: AuthView) => void;
  signIn: (nickname: string, password: string) => void;
  signUp: (nickname: string, password: string) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>({ nickname: "alice" });
  const [authView, setAuthView] = useState<AuthView>("sign-in");

  const signIn = useCallback((nickname: string, _password: string) => {
    setUser({ nickname: nickname.trim() });
  }, []);

  const signUp = useCallback((nickname: string, _password: string) => {
    setUser({ nickname: nickname.trim() });
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setAuthView("sign-in");
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: user !== null,
      user,
      authView,
      setAuthView,
      signIn,
      signUp,
      signOut,
    }),
    [user, authView, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
