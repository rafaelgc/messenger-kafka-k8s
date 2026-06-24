import { http, HttpResponse } from "msw";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const handlers = [
  http.get(`${API_BASE_URL}/health`, () => {
    return HttpResponse.json({ status: "ok" });
  }),
];
