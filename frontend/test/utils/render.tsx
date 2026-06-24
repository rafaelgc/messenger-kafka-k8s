import { AuthProvider } from "@/components/providers/auth-provider";
import { MessageDeliveryProvider } from "@/components/providers/message-delivery-provider";
import { setStoredToken } from "@/lib/auth-storage";
import { createValidToken } from "@/test/utils/fixtures";
import { render, screen, waitFor, type RenderOptions } from "@testing-library/react";
import { expect } from "vitest";
import type { ReactElement } from "react";

type RenderWithProvidersOptions = RenderOptions & {
  token?: string;
};

export function renderWithProviders(
  ui: ReactElement,
  { token = createValidToken(), ...options }: RenderWithProvidersOptions = {},
) {
  localStorage.clear();
  setStoredToken(token);

  return render(
    <AuthProvider>
      <MessageDeliveryProvider>{ui}</MessageDeliveryProvider>
    </AuthProvider>,
    options,
  );
}

export async function waitForChatsToLoad() {
  await waitFor(() => {
    expect(screen.queryByText("Loading chats...")).not.toBeInTheDocument();
  });
}

export async function waitForMessagesToLoad() {
  await waitFor(() => {
    expect(screen.queryByText("Loading messages...")).not.toBeInTheDocument();
  });
}
