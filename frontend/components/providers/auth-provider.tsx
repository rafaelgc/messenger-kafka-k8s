"use client";

import { authenticate, registerUser } from "@/lib/api";
import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "@/lib/auth-storage";
import { decodeJwtPayload, isTokenExpired } from "@/lib/jwt";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthView = "sign-in" | "sign-up";

export type User = {
  id: string;
  nickname: string;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  token: string | null;
  authView: AuthView;
  setAuthView: (view: AuthView) => void;
  signIn: (nickname: string, password: string) => Promise<void>;
  signUp: (nickname: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromToken(token: string): User {
  const claims = decodeJwtPayload(token);

  if (isTokenExpired(claims)) {
    throw new Error("Token expired");
  }

  return {
    id: claims.sub,
    nickname: claims.nickname,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authView, setAuthView] = useState<AuthView>("sign-in");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    try {
      const storedUser = userFromToken(storedToken);
      setToken(storedToken);
      setUser(storedUser);
    } catch {
      clearStoredToken();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const completeAuthentication = useCallback((authToken: string) => {
    const authenticatedUser = userFromToken(authToken);
    setStoredToken(authToken);
    setToken(authToken);
    setUser(authenticatedUser);
  }, []);

  const signIn = useCallback(
    async (nickname: string, password: string) => {
      const { token: authToken } = await authenticate(nickname, password);
      completeAuthentication(authToken);
    },
    [completeAuthentication],
  );

  const signUp = useCallback(
    async (nickname: string, password: string) => {
      await registerUser(nickname, password);
      const { token: authToken } = await authenticate(nickname, password);
      completeAuthentication(authToken);
    },
    [completeAuthentication],
  );

  const signOut = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setAuthView("sign-in");
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: user !== null,
      isLoading,
      user,
      token,
      authView,
      setAuthView,
      signIn,
      signUp,
      signOut,
    }),
    [user, token, isLoading, authView, signIn, signUp, signOut],
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
