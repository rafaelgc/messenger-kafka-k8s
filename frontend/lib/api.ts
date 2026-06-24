const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type CreateUserResponse = {
  id: string;
  nickname: string;
};

type AuthenticateResponse = {
  token: string;
};

export type ChatListItem = {
  id: string;
  name: string;
  members: string[];
};

export type PaginationMeta = {
  has_more: boolean;
  next_cursor?: string;
};

export type PaginatedChatsResponse = {
  chats: ChatListItem[];
  pagination: PaginationMeta;
};

export type MessageItem = {
  id: string;
  chat_id: string;
  text: string;
  sender_id: string;
};

export type PaginatedMessagesResponse = {
  messages: MessageItem[];
  pagination: PaginationMeta;
};

type ListChatsQuery = {
  limit?: number;
  before?: string;
};

function errorMessageForStatus(status: number, fallback: string): string {
  switch (status) {
    case 400:
      return "Please check your nickname and password.";
    case 401:
      return "Invalid nickname or password.";
    case 403:
      return "You do not have access to this chat.";
    case 409:
      return "That nickname is already taken.";
    case 502:
      return "The server is unavailable. Try again in a moment.";
    default:
      return fallback;
  }
}

async function parseError(response: Response, fallback: string): Promise<never> {
  throw new ApiError(
    response.status,
    errorMessageForStatus(response.status, fallback),
  );
}

export async function registerUser(
  nickname: string,
  password: string,
): Promise<CreateUserResponse> {
  const response = await fetch(`${API_BASE_URL}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password }),
  });

  if (!response.ok) {
    await parseError(response, "Could not create your account.");
  }

  return response.json() as Promise<CreateUserResponse>;
}

export async function authenticate(
  nickname: string,
  password: string,
): Promise<AuthenticateResponse> {
  const response = await fetch(`${API_BASE_URL}/authentications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password }),
  });

  if (!response.ok) {
    await parseError(response, "Could not sign you in.");
  }

  return response.json() as Promise<AuthenticateResponse>;
}

export async function listChats(
  token: string,
  query: ListChatsQuery = {},
): Promise<PaginatedChatsResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.before) {
    params.set("before", query.before);
  }

  const queryString = params.toString();
  const url = `${API_BASE_URL}/chats${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    await parseError(response, "Could not load your chats.");
  }

  return response.json() as Promise<PaginatedChatsResponse>;
}

type ListMessagesQuery = {
  limit?: number;
  before?: string;
};

export async function listMessages(
  token: string,
  chatId: string,
  query: ListMessagesQuery = {},
): Promise<PaginatedMessagesResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.before) {
    params.set("before", query.before);
  }

  const queryString = params.toString();
  const url = `${API_BASE_URL}/chats/${encodeURIComponent(chatId)}/messages${
    queryString ? `?${queryString}` : ""
  }`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    await parseError(response, "Could not load messages.");
  }

  return response.json() as Promise<PaginatedMessagesResponse>;
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!response.ok) {
    await parseError(response, "Could not send your message.");
  }
}
