"use client";

import { AuthScreen } from "@/components/auth/auth-screen";
import { ChatPage } from "@/components/chats/chat-page";
import { useAuth } from "@/components/providers/auth-provider";

export function HomeClient() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <ChatPage />;
  }

  return <AuthScreen />;
}
