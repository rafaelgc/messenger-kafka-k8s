#!/usr/bin/env node
/**
 * Simulate one user's activity against the public API.
 * Intended as the unit of work for a future Lambda-based load test.
 *
 * CLI:
 *   API_BASE_URL=http://api.localhost node infra/load-test/simulate-user.mjs \
 *     --uid 42 --users 100 --start-at 2026-07-16T20:00:00Z
 *
 * Lambda:
 *   handler({ uid: 42, users: 100, startAt: "2026-07-16T20:00:00Z" })
 *
 * Assumptions:
 *   - Peer nicknames are user0 .. user{users-1} (same password for all).
 *   - Optional startAt (UTC ISO-8601) holds until that wall time so parallel
 *     invocations can begin together.
 *   - Optional skipUserCreation skips POST /users (users already seeded).
 *   - After register, each invocation waits (soft barrier) so peer users from
 *     parallel runs are more likely to exist before createChat (skipped when
 *     skipUserCreation is set).
 *   - Direct (1:1) chats: one other member each, no chat name required.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://api.localhost";
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? "load-test-password";
/** Soft barrier after register so parallel workers can finish creating users. */
const DEFAULT_REGISTER_WAIT_MS = Number(process.env.REGISTER_WAIT_MS ?? 10_000);
/** When true, skip POST /users (assume nicknames already exist). */
const DEFAULT_SKIP_USER_CREATION = parseBool(process.env.SKIP_USER_CREATION, false);

const CHATS_PER_USER = 3;
const MESSAGES_PER_CHAT = 10;
/** Max sleep chunk so long waits stay responsive to clock skew / process signals. */
const WAIT_CHUNK_MS = 30_000;

/** Set in handler so every log line is attributable in CloudWatch. */
let logPrefix = "[simulate-user]";

function log(message, extra) {
  if (extra !== undefined) {
    console.log(`${logPrefix} ${message}`, typeof extra === "string" ? extra : JSON.stringify(extra));
  } else {
    console.log(`${logPrefix} ${message}`);
  }
}

function logError(message, extra) {
  if (extra !== undefined) {
    console.error(`${logPrefix} ${message}`, typeof extra === "string" ? extra : JSON.stringify(extra));
  } else {
    console.error(`${logPrefix} ${message}`);
  }
}

export async function handler(event = {}) {
  const uid = Number(event.uid);
  const users = Number(event.users);
  const registerWaitMs = resolveRegisterWaitMs(event.registerWaitMs);
  const startAtMs = resolveStartAtMs(event.startAt ?? event.startAtUtc ?? process.env.START_AT_UTC);
  const skipUserCreation = resolveSkipUserCreation(event.skipUserCreation);

  logPrefix = `[simulate-user uid=${event.uid}]`;
  log("start", {
    event,
    apiBaseUrl: API_BASE_URL,
    registerWaitMs,
    skipUserCreation,
    startAt: startAtMs !== null ? new Date(startAtMs).toISOString() : null,
  });

  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error(`uid must be a non-negative integer, got: ${event.uid}`);
  }
  if (!Number.isInteger(users) || users < CHATS_PER_USER + 1) {
    throw new Error(
      `users must be an integer >= ${CHATS_PER_USER + 1} (self + ${CHATS_PER_USER} peers), got: ${event.users}`,
    );
  }
  if (uid >= users) {
    throw new Error(`uid ${uid} is out of range for users=${users}`);
  }

  const nickname = `user${uid}`;
  logPrefix = `[simulate-user ${nickname}]`;
  const startedAt = Date.now();

  try {
    let waitedForStartMs = 0;
    if (startAtMs !== null) {
      const remainingMs = startAtMs - Date.now();
      log(`waiting for startAt (${remainingMs > 0 ? `${remainingMs}ms remaining` : "already past"})`);
      waitedForStartMs = await waitUntil(startAtMs);
      log(`startAt reached; waited ${waitedForStartMs}ms`);
    } else {
      log("no startAt; continuing immediately");
    }

    if (skipUserCreation) {
      log("skipping user creation (skipUserCreation=true)");
    } else {
      log("registering");
      const registerStatus = await register(nickname);
      log(`register done (status=${registerStatus})`);

      // Soft barrier: assumes all workers started around the same time. Not a real
      // distributed barrier — just buys time for slower registrations to finish.
      if (registerWaitMs > 0) {
        log(`register soft-barrier sleep ${registerWaitMs}ms`);
        await sleep(registerWaitMs);
        log("register soft-barrier done");
      }
    }

    log("authenticating");
    const { token } = await authenticate(nickname);
    log("authenticate done");

    const peers = pickRandomPeers(uid, users, CHATS_PER_USER);
    log("peers selected", { peers });
    const chatIds = [];

    for (const peer of peers) {
      log(`ensureDirectChat with ${peer}`);
      const chatId = await ensureDirectChat(token, peer);
      chatIds.push(chatId);
      log(`chat ready with ${peer}`, { chatId });

      for (let i = 0; i < MESSAGES_PER_CHAT; i++) {
        await sendMessage(token, chatId, `load-test msg ${i + 1} from ${nickname} to ${peer}`);
      }
      log(`sent ${MESSAGES_PER_CHAT} messages to chat ${chatId}`);

      // Hit the list endpoint for load; body is discarded on purpose.
      const listed = await listMessages(token, chatId);
      log(`listMessages done for chat ${chatId}`, {
        count: listed?.messages?.length ?? 0,
      });
    }

    const result = {
      ok: true,
      nickname,
      peers,
      chatIds,
      messagesSent: chatIds.length * MESSAGES_PER_CHAT,
      startAt: startAtMs !== null ? new Date(startAtMs).toISOString() : null,
      waitedForStartMs,
      registerWaitMs: skipUserCreation ? 0 : registerWaitMs,
      skipUserCreation,
      durationMs: Date.now() - startedAt,
    };
    log("complete", result);
    return result;
  } catch (error) {
    logError(`failed after ${Date.now() - startedAt}ms: ${error?.message ?? error}`);
    throw error;
  }
}

function resolveStartAtMs(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const ms = Date.parse(String(value));
  if (Number.isNaN(ms)) {
    throw new Error(
      `startAt must be a valid UTC ISO-8601 timestamp (e.g. 2026-07-16T20:00:00Z), got: ${value}`,
    );
  }
  return ms;
}

/**
 * Sleep until targetUtcMs. If the time is already past, returns immediately.
 * @returns {Promise<number>} milliseconds actually waited
 */
async function waitUntil(targetUtcMs) {
  const begin = Date.now();
  while (true) {
    const remaining = targetUtcMs - Date.now();
    if (remaining <= 0) {
      return Math.max(0, Date.now() - begin);
    }
    await sleep(Math.min(remaining, WAIT_CHUNK_MS));
  }
}

function resolveRegisterWaitMs(override) {
  if (override === undefined || override === null || override === "") {
    return DEFAULT_REGISTER_WAIT_MS;
  }
  const value = Number(override);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`registerWaitMs must be a non-negative number, got: ${override}`);
  }
  return value;
}

function resolveSkipUserCreation(override) {
  if (override === undefined || override === null || override === "") {
    return DEFAULT_SKIP_USER_CREATION;
  }
  return parseBool(override, DEFAULT_SKIP_USER_CREATION);
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`expected a boolean, got: ${value}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandomPeers(uid, users, count) {
  const pool = [];
  for (let i = 0; i < users; i++) {
    if (i !== uid) pool.push(i);
  }
  shuffleInPlace(pool);
  return pool.slice(0, count).map((id) => `user${id}`);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function register(nickname) {
  const response = await request("POST", "/users", {
    body: { nickname, password: PASSWORD },
  });

  // Idempotent enough for re-runs: treat conflict as success.
  if (response.status === 409) {
    log("register: nickname already exists (409)");
    return 409;
  }
  if (response.status !== 201) {
    throw await httpError("register", response);
  }
  return 201;
}

async function authenticate(nickname) {
  const response = await request("POST", "/authentications", {
    body: { nickname, password: PASSWORD },
  });
  if (response.status !== 200) {
    throw await httpError("authenticate", response);
  }
  return response.json();
}

async function ensureDirectChat(token, peerNickname) {
  const response = await request("POST", "/chats", {
    token,
    body: { member_nicknames: [peerNickname] },
  });

  if (response.status === 201) {
    const chat = await response.json();
    log(`createChat created new chat with ${peerNickname}`, { chatId: chat.id });
    return chat.id;
  }

  // Peer already created this 1:1 chat — resolve id via list.
  if (response.status === 409) {
    log(`createChat conflict with ${peerNickname}; looking up existing chat`);
    const chatId = await findDirectChatId(token, peerNickname);
    if (!chatId) {
      throw new Error(
        `createChat returned 409 for peer ${peerNickname}, but no matching direct chat was found`,
      );
    }
    log(`resolved existing chat with ${peerNickname}`, { chatId });
    return chatId;
  }

  throw await httpError("createChat", response);
}

async function findDirectChatId(token, peerNickname) {
  // Load-test users only create a few chats; one page is enough.
  const response = await request("GET", "/chats?limit=100", { token });
  if (response.status !== 200) {
    throw await httpError("listChats", response);
  }

  const { chats } = await response.json();
  const match = (chats ?? []).find(
    (chat) =>
      Array.isArray(chat.members) &&
      chat.members.length === 2 &&
      chat.members.some((member) => member.nickname === peerNickname),
  );
  return match?.id ?? null;
}

async function sendMessage(token, chatId, text) {
  const response = await request("POST", `/chats/${chatId}/messages`, {
    token,
    body: { text },
  });
  if (response.status !== 201) {
    throw await httpError("sendMessage", response);
  }
}

async function listMessages(token, chatId) {
  const response = await request("GET", `/chats/${chatId}/messages?limit=50`, {
    token,
  });
  if (response.status !== 200) {
    throw await httpError("listMessages", response);
  }
  return response.json();
}

async function request(method, path, { token, body } = {}) {
  const url = `${API_BASE_URL}${path}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const began = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    log(`HTTP ${method} ${path} → ${response.status} (${Date.now() - began}ms)`);
    return response;
  } catch (error) {
    const cause = error?.cause;
    logError(`HTTP ${method} ${path} network error after ${Date.now() - began}ms`, {
      message: error?.message ?? String(error),
      name: error?.name,
      cause: cause
        ? {
            message: cause.message,
            code: cause.code,
            errno: cause.errno,
            syscall: cause.syscall,
            address: cause.address,
            port: cause.port,
          }
        : null,
      url,
    });
    throw error;
  }
}

async function httpError(action, response) {
  const text = await response.text().catch(() => "");
  const message = `${action} failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`;
  logError(message);
  return new Error(message);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--uid") out.uid = argv[++i];
    else if (arg === "--users") out.users = argv[++i];
    else if (arg === "--register-wait-ms") out.registerWaitMs = argv[++i];
    else if (arg === "--start-at") out.startAt = argv[++i];
    else if (arg === "--skip-user-creation") out.skipUserCreation = true;
    else if (arg === "--no-skip-user-creation") out.skipUserCreation = false;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.uid === undefined || args.users === undefined) {
    console.log(`Usage:
  API_BASE_URL=http://api.localhost node infra/load-test/simulate-user.mjs \\
    --uid <n> --users <n> [--start-at <UTC ISO-8601>] [--register-wait-ms <n>] [--skip-user-creation]

Env:
  API_BASE_URL          default http://api.localhost
  LOAD_TEST_PASSWORD    default load-test-password
  START_AT_UTC          optional hold-until time, e.g. 2026-07-16T20:00:00Z
  REGISTER_WAIT_MS      soft barrier after register (default 10000); use 0 to skip
  SKIP_USER_CREATION    skip POST /users when true (default false)`);
    process.exit(args.help ? 0 : 1);
  }

  const result = await handler({
    uid: args.uid,
    users: args.users,
    registerWaitMs: args.registerWaitMs,
    startAt: args.startAt,
    skipUserCreation: args.skipUserCreation,
  });
  console.log(JSON.stringify(result, null, 2));
}

import { pathToFileURL } from "node:url";

const isCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
