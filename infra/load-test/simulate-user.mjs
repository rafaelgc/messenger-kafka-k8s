#!/usr/bin/env node
/**
 * Simulate one or more users against the public API (Lambda load-test unit).
 *
 * CLI (single user):
 *   node infra/load-test/simulate-user.mjs --uid 42 --users 100 --start-at ...
 *
 * CLI (batch):
 *   node infra/load-test/simulate-user.mjs --uid-start 0 --batch-size 25 --users 1000 --start-at ...
 *
 * Lambda:
 *   handler({ users: 1000, uidStart: 0, batchSize: 25, startAt: "..." })
 *   handler({ users: 100, uid: 42, startAt: "..." })  // single user (batchSize 1)
 *
 * Assumptions:
 *   - Peer nicknames are user0 .. user{users-1} (same password for all).
 *   - Optional startAt (UTC ISO-8601) holds until that wall time so parallel
 *     invocations can begin together.
 *   - Optional skipUserCreation skips POST /users (users already seeded).
 *   - Direct (1:1) chats: one other member each, no chat name required.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://api.localhost";
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? "load-test-password";
/** Soft barrier after register so parallel workers can finish creating users. */
const DEFAULT_REGISTER_WAIT_MS = Number(process.env.REGISTER_WAIT_MS ?? 10_000);
/** When true, skip POST /users (assume nicknames already exist). */
const DEFAULT_SKIP_USER_CREATION = parseBool(process.env.SKIP_USER_CREATION, false);
/** Default users simulated concurrently in one invoke when only batchSize omitted. */
const DEFAULT_BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 1);

const CHATS_PER_USER = 3;
const MESSAGES_PER_CHAT = 10;
/** Max sleep chunk so long waits stay responsive to clock skew / process signals. */
const WAIT_CHUNK_MS = 30_000;

function makeLogger(prefix) {
  return {
    log(message, extra) {
      if (extra !== undefined) {
        console.log(
          `${prefix} ${message}`,
          typeof extra === "string" ? extra : JSON.stringify(extra),
        );
      } else {
        console.log(`${prefix} ${message}`);
      }
    },
    error(message, extra) {
      if (extra !== undefined) {
        console.error(
          `${prefix} ${message}`,
          typeof extra === "string" ? extra : JSON.stringify(extra),
        );
      } else {
        console.error(`${prefix} ${message}`);
      }
    },
  };
}

export async function handler(event = {}) {
  const users = Number(event.users);
  const registerWaitMs = resolveRegisterWaitMs(event.registerWaitMs);
  const startAtMs = resolveStartAtMs(event.startAt ?? event.startAtUtc ?? process.env.START_AT_UTC);
  const skipUserCreation = resolveSkipUserCreation(event.skipUserCreation);
  const uids = resolveUids(event, users);

  const batchLog = makeLogger(
    `[simulate-user batch uidStart=${uids[0]} size=${uids.length}]`,
  );
  batchLog.log("start", {
    event,
    apiBaseUrl: API_BASE_URL,
    uids,
    registerWaitMs,
    skipUserCreation,
    startAt: startAtMs !== null ? new Date(startAtMs).toISOString() : null,
  });

  if (!Number.isInteger(users) || users < CHATS_PER_USER + 1) {
    throw new Error(
      `users must be an integer >= ${CHATS_PER_USER + 1} (self + ${CHATS_PER_USER} peers), got: ${event.users}`,
    );
  }

  const startedAt = Date.now();
  let waitedForStartMs = 0;

  if (startAtMs !== null) {
    const remainingMs = startAtMs - Date.now();
    batchLog.log(
      `waiting for startAt (${remainingMs > 0 ? `${remainingMs}ms remaining` : "already past"})`,
    );
    waitedForStartMs = await waitUntil(startAtMs);
    batchLog.log(`startAt reached; waited ${waitedForStartMs}ms`);
  } else {
    batchLog.log("no startAt; continuing immediately");
  }

  const settled = await Promise.allSettled(
    uids.map((uid) =>
      simulateOneUser({
        uid,
        users,
        registerWaitMs,
        skipUserCreation,
      }),
    ),
  );

  const results = [];
  const errors = [];
  for (let i = 0; i < settled.length; i++) {
    const uid = uids[i];
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      const message = outcome.reason?.message ?? String(outcome.reason);
      errors.push({ uid, error: message });
      makeLogger(`[simulate-user user${uid}]`).error(`batch member failed: ${message}`);
    }
  }

  const summary = {
    ok: errors.length === 0,
    users,
    uidStart: uids[0],
    batchSize: uids.length,
    succeeded: results.length,
    failed: errors.length,
    errors,
    startAt: startAtMs !== null ? new Date(startAtMs).toISOString() : null,
    waitedForStartMs,
    skipUserCreation,
    durationMs: Date.now() - startedAt,
  };
  batchLog.log("complete", summary);

  if (errors.length > 0) {
    const err = new Error(
      `batch finished with ${errors.length}/${uids.length} failures (see CloudWatch / summary.errors)`,
    );
    err.summary = summary;
    throw err;
  }

  return summary;
}

/**
 * Resolve which uids this invoke owns.
 * - { uid } => [uid]
 * - { uidStart, batchSize } => contiguous range
 * - batchSize defaults to 1 (or BATCH_SIZE env)
 */
function resolveUids(event, users) {
  if (event.uid !== undefined && event.uid !== null && event.uid !== "") {
    const uid = Number(event.uid);
    if (!Number.isInteger(uid) || uid < 0) {
      throw new Error(`uid must be a non-negative integer, got: ${event.uid}`);
    }
    if (uid >= users) {
      throw new Error(`uid ${uid} is out of range for users=${users}`);
    }
    return [uid];
  }

  const uidStart = Number(event.uidStart ?? 0);
  const batchSize = Number(
    event.batchSize ?? event.usersPerInvoke ?? DEFAULT_BATCH_SIZE,
  );

  if (!Number.isInteger(uidStart) || uidStart < 0) {
    throw new Error(`uidStart must be a non-negative integer, got: ${event.uidStart}`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batchSize must be a positive integer, got: ${event.batchSize}`);
  }
  if (uidStart >= users) {
    throw new Error(`uidStart ${uidStart} is out of range for users=${users}`);
  }

  const end = Math.min(uidStart + batchSize, users);
  const uids = [];
  for (let uid = uidStart; uid < end; uid++) {
    uids.push(uid);
  }
  return uids;
}

async function simulateOneUser({ uid, users, registerWaitMs, skipUserCreation }) {
  const nickname = `user${uid}`;
  const log = makeLogger(`[simulate-user ${nickname}]`);
  const startedAt = Date.now();

  try {
    if (skipUserCreation) {
      log.log("skipping user creation (skipUserCreation=true)");
    } else {
      log.log("registering");
      const registerStatus = await register(nickname, log);
      log.log(`register done (status=${registerStatus})`);

      if (registerWaitMs > 0) {
        log.log(`register soft-barrier sleep ${registerWaitMs}ms`);
        await sleep(registerWaitMs);
        log.log("register soft-barrier done");
      }
    }

    log.log("authenticating");
    const { token } = await authenticate(nickname, log);
    log.log("authenticate done");

    const peers = pickRandomPeers(uid, users, CHATS_PER_USER);
    log.log("peers selected", { peers });
    const chatIds = [];
    let messagesSent = 0;
    let messagesFailed = 0;

    for (const peer of peers) {
      log.log(`ensureDirectChat with ${peer}`);
      const chatId = await ensureDirectChat(token, peer, log);
      chatIds.push(chatId);
      log.log(`chat ready with ${peer}`, { chatId });

      let sentInChat = 0;
      for (let i = 0; i < MESSAGES_PER_CHAT; i++) {
        try {
          await sendMessage(
            token,
            chatId,
            `load-test msg ${i + 1} from ${nickname} to ${peer}`,
            log,
          );
          messagesSent += 1;
          sentInChat += 1;
        } catch (error) {
          messagesFailed += 1;
          log.error(
            `sendMessage ${i + 1}/${MESSAGES_PER_CHAT} to chat ${chatId} failed; continuing: ${error?.message ?? error}`,
          );
        }
      }
      log.log(`chat ${chatId}: sent ${sentInChat}/${MESSAGES_PER_CHAT} messages`);

      const listed = await listMessages(token, chatId, log);
      log.log(`listMessages done for chat ${chatId}`, {
        count: listed?.messages?.length ?? 0,
      });
    }

    const result = {
      ok: messagesFailed === 0,
      uid,
      nickname,
      peers,
      chatIds,
      messagesSent,
      messagesFailed,
      durationMs: Date.now() - startedAt,
    };
    log.log("complete", result);
    if (messagesFailed > 0) {
      throw new Error(
        `${nickname}: ${messagesFailed} message send(s) failed (${messagesSent} succeeded)`,
      );
    }
    return result;
  } catch (error) {
    log.error(`failed after ${Date.now() - startedAt}ms: ${error?.message ?? error}`);
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

async function register(nickname, log) {
  const response = await request("POST", "/users", {
    body: { nickname, password: PASSWORD },
    log,
  });

  if (response.status === 409) {
    log.log("register: nickname already exists (409)");
    return 409;
  }
  if (response.status !== 201) {
    throw await httpError("register", response, log);
  }
  return 201;
}

async function authenticate(nickname, log) {
  const response = await request("POST", "/authentications", {
    body: { nickname, password: PASSWORD },
    log,
  });
  if (response.status !== 200) {
    throw await httpError("authenticate", response, log);
  }
  return response.json();
}

async function ensureDirectChat(token, peerNickname, log) {
  const response = await request("POST", "/chats", {
    token,
    body: { member_nicknames: [peerNickname] },
    log,
  });

  if (response.status === 201) {
    const chat = await response.json();
    log.log(`createChat created new chat with ${peerNickname}`, { chatId: chat.id });
    return chat.id;
  }

  if (response.status === 409) {
    log.log(`createChat conflict with ${peerNickname}; looking up existing chat`);
    const chatId = await findDirectChatId(token, peerNickname, log);
    if (!chatId) {
      throw new Error(
        `createChat returned 409 for peer ${peerNickname}, but no matching direct chat was found`,
      );
    }
    log.log(`resolved existing chat with ${peerNickname}`, { chatId });
    return chatId;
  }

  throw await httpError("createChat", response, log);
}

async function findDirectChatId(token, peerNickname, log) {
  const response = await request("GET", "/chats?limit=100", { token, log });
  if (response.status !== 200) {
    throw await httpError("listChats", response, log);
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

async function sendMessage(token, chatId, text, log) {
  const response = await request("POST", `/chats/${chatId}/messages`, {
    token,
    body: { text },
    log,
  });
  if (response.status !== 201) {
    throw await httpError("sendMessage", response, log);
  }
}

async function listMessages(token, chatId, log) {
  const response = await request("GET", `/chats/${chatId}/messages?limit=50`, {
    token,
    log,
  });
  if (response.status !== 200) {
    throw await httpError("listMessages", response, log);
  }
  return response.json();
}

async function request(method, path, { token, body, log } = {}) {
  const logger = log ?? makeLogger("[simulate-user]");
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
    logger.log(`HTTP ${method} ${path} → ${response.status} (${Date.now() - began}ms)`);
    return response;
  } catch (error) {
    const cause = error?.cause;
    logger.error(`HTTP ${method} ${path} network error after ${Date.now() - began}ms`, {
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

async function httpError(action, response, log) {
  const logger = log ?? makeLogger("[simulate-user]");
  const text = await response.text().catch(() => "");
  const message = `${action} failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`;
  logger.error(message);
  return new Error(message);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--uid") out.uid = argv[++i];
    else if (arg === "--uid-start") out.uidStart = argv[++i];
    else if (arg === "--batch-size") out.batchSize = argv[++i];
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
  const hasBatch = args.uidStart !== undefined || args.batchSize !== undefined;
  const hasSingle = args.uid !== undefined;

  if (args.help || args.users === undefined || (!hasBatch && !hasSingle)) {
    console.log(`Usage:
  node infra/load-test/simulate-user.mjs --users <N> --uid <n> [options]
  node infra/load-test/simulate-user.mjs --users <N> --uid-start <n> --batch-size <n> [options]

Options:
  --start-at <UTC ISO-8601>
  --register-wait-ms <n>
  --skip-user-creation / --no-skip-user-creation

Env:
  API_BASE_URL          default http://api.localhost
  LOAD_TEST_PASSWORD    default load-test-password
  START_AT_UTC          optional hold-until time
  REGISTER_WAIT_MS      soft barrier after register (default 10000)
  SKIP_USER_CREATION    skip POST /users when true (default false)
  BATCH_SIZE            default batch size when uidStart set without batchSize (default 1)`);
    process.exit(args.help ? 0 : 1);
  }

  const result = await handler({
    uid: args.uid,
    uidStart: args.uidStart,
    batchSize: args.batchSize,
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
