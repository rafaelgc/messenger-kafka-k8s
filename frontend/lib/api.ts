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

function errorMessageForStatus(status: number, fallback: string): string {
  switch (status) {
    case 400:
      return "Please check your nickname and password.";
    case 401:
      return "Invalid nickname or password.";
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
