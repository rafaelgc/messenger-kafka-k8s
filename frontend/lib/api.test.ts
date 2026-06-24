import {
  ApiError,
  authenticate,
  listChats,
  listMessages,
  registerUser,
  sendMessage,
} from "@/lib/api";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/mocks/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

describe("api client", () => {
  it("registers a user", async () => {
    server.use(
      http.post(`${API_BASE_URL}/users`, async ({ request }) => {
        const body = (await request.json()) as {
          nickname: string;
          password: string;
        };

        return HttpResponse.json({
          id: "user-1",
          nickname: body.nickname,
        });
      }),
    );

    await expect(registerUser("alice", "secret")).resolves.toEqual({
      id: "user-1",
      nickname: "alice",
    });
  });

  it("authenticates a user", async () => {
    server.use(
      http.post(`${API_BASE_URL}/authentications`, () => {
        return HttpResponse.json({ token: "jwt-token" });
      }),
    );

    await expect(authenticate("alice", "secret")).resolves.toEqual({
      token: "jwt-token",
    });
  });

  it("lists chats with the bearer token", async () => {
    server.use(
      http.get(`${API_BASE_URL}/chats`, ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer jwt-token");

        return HttpResponse.json({
          chats: [
            {
              id: "chat-1",
              name: "Design Team",
              members: [{ id: "user-1", nickname: "alice" }],
            },
          ],
          pagination: { has_more: false },
        });
      }),
    );

    await expect(listChats("jwt-token")).resolves.toEqual({
      chats: [
        {
          id: "chat-1",
          name: "Design Team",
          members: [{ id: "user-1", nickname: "alice" }],
        },
      ],
      pagination: { has_more: false },
    });
  });

  it("lists messages for a chat", async () => {
    server.use(
      http.get(`${API_BASE_URL}/chats/:chatId/messages`, ({ params }) => {
        expect(params.chatId).toBe("chat-1");

        return HttpResponse.json({
          messages: [
            {
              id: "msg-1",
              chat_id: "chat-1",
              text: "Hello",
              sender_id: "user-1",
            },
          ],
          pagination: { has_more: false },
        });
      }),
    );

    await expect(listMessages("jwt-token", "chat-1")).resolves.toEqual({
      messages: [
        {
          id: "msg-1",
          chat_id: "chat-1",
          text: "Hello",
          sender_id: "user-1",
        },
      ],
      pagination: { has_more: false },
    });
  });

  it("sends a message", async () => {
    server.use(
      http.post(`${API_BASE_URL}/chats/:chatId/messages`, async ({ request, params }) => {
        expect(params.chatId).toBe("chat-1");
        expect(await request.json()).toEqual({ text: "Hello team" });

        return new HttpResponse(null, { status: 201 });
      }),
    );

    await expect(sendMessage("jwt-token", "chat-1", "Hello team")).resolves.toBeUndefined();
  });

  it("maps known error statuses to friendly messages", async () => {
    server.use(
      http.post(`${API_BASE_URL}/authentications`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );

    await expect(authenticate("alice", "wrong")).rejects.toEqual(
      new ApiError(401, "Invalid nickname or password."),
    );
  });

  it("uses the fallback message for unknown error statuses", async () => {
    server.use(
      http.get(`${API_BASE_URL}/chats`, () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    await expect(listChats("jwt-token")).rejects.toEqual(
      new ApiError(500, "Could not load your chats."),
    );
  });
});
