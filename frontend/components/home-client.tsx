"use client";

import { AuthScreen } from "@/components/auth/auth-screen";
import { ChatPage } from "@/components/chats/chat-page";
import { useAuth } from "@/components/providers/auth-provider";

export function HomeClient() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return <ChatPage />;
  }

  return <AuthScreen />;
}
