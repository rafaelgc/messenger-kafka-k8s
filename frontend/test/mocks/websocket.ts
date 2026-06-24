import type { MessageSentEvent } from "@/lib/message-delivery";
import { vi } from "vitest";

const instances: MockWebSocket[] = [];

export class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sentMessages: string[] = [];

  readyState = MockWebSocket.OPEN;

  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string) {
    this.url = url;
    instances.push(this);

    queueMicrotask(() => {
      this.emit("open", new Event("open"));
    });
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const handler =
      typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);

    const handlers = this.listeners.get(type) ?? new Set<EventListener>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const handler =
      typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);

    this.listeners.get(type)?.delete(handler);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", new CloseEvent("close"));
  }

  simulateIncoming(data: MessageSentEvent): void {
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }

  private emit(type: string, event: Event): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

export function installMockWebSocket(): void {
  instances.length = 0;
  vi.stubGlobal("WebSocket", MockWebSocket);
}

export function getLatestMockWebSocket(): MockWebSocket | null {
  return instances.at(-1) ?? null;
}

export function resetMockWebSocket(): void {
  instances.length = 0;
  vi.unstubAllGlobals();
}
