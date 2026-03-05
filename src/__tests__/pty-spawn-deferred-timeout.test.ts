/**
 * Tests for the ready-event timeout in setupDeferredTaskDelivery.
 *
 * Verifies that when session_ready never fires, the 30s timeout
 * forces task delivery as a fallback.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import type { SpawnContext } from "../services/pty-spawn.js";
import { setupDeferredTaskDelivery } from "../services/pty-spawn.js";

// ---------------------------------------------------------------------------
// Mock manager — captures on/removeListener calls
// ---------------------------------------------------------------------------

type ListenerFn = (...args: unknown[]) => void;

/** Create a mock PTY manager that captures event listener registrations. */
function createMockManager() {
  const listeners = new Map<string, ListenerFn[]>();
  return {
    on: jest.fn((event: string, fn: ListenerFn) => {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    }),
    removeListener: jest.fn((event: string, fn: ListenerFn) => {
      const list = listeners.get(event) ?? [];
      listeners.set(
        event,
        list.filter((f) => f !== fn),
      );
    }),
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    onSessionData: jest.fn(() => () => {}),
    _listeners: listeners,
  };
}

// ---------------------------------------------------------------------------
// Mock context
// ---------------------------------------------------------------------------

/** Create a mock SpawnContext wired to the given mock manager. */
function createMockCtx(
  manager: ReturnType<typeof createMockManager>,
): SpawnContext {
  return {
    manager: manager as unknown as SpawnContext["manager"],
    usingBunWorker: true,
    serviceConfig: {},
    sessionMetadata: new Map(),
    sessionWorkdirs: new Map(),
    sessionOutputBuffers: new Map(),
    outputUnsubscribers: new Map(),
    taskResponseMarkers: new Map(),
    getAdapter: jest.fn() as unknown as SpawnContext["getAdapter"],
    sendToSession: jest.fn().mockResolvedValue(undefined),
    sendKeysToSession: jest.fn().mockResolvedValue(undefined),
    pushDefaultRules: jest.fn().mockResolvedValue(undefined),
    toSessionInfo: jest.fn() as unknown as SpawnContext["toSessionInfo"],
    log: jest.fn(),
    markTaskDelivered: jest.fn(),
  } as unknown as SpawnContext;
}

const mockSession = {
  id: "s-timeout-1",
  status: "starting" as string,
  type: "claude",
  name: "test",
  createdAt: new Date(),
  write: jest.fn(),
  resize: jest.fn(),
  kill: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupDeferredTaskDelivery ready-event timeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("forces task delivery after 30s if session_ready never fires", () => {
    const manager = createMockManager();
    const ctx = createMockCtx(manager);

    setupDeferredTaskDelivery(ctx, mockSession as any, "Fix the bug", "claude");

    // Listener should be registered
    expect(manager.on).toHaveBeenCalledWith(
      "session_ready",
      expect.any(Function),
    );

    // sendToSession should NOT have been called yet
    expect(ctx.sendToSession).not.toHaveBeenCalled();

    // Advance past the 30s timeout
    jest.advanceTimersByTime(30_000);

    // Should log a warning about timeout
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining("ready event not received within 30000ms"),
    );

    // Advance past the settle delay (800ms for claude)
    jest.advanceTimersByTime(800);

    // Now sendToSession should have been called with the task
    expect(ctx.sendToSession).toHaveBeenCalledWith("s-timeout-1", "Fix the bug");
  });

  it("does NOT double-deliver if session_ready fires before timeout", () => {
    const manager = createMockManager();
    const ctx = createMockCtx(manager);

    // Pre-populate buffer so retry logic considers the task accepted
    const buffer: string[] = [];
    ctx.sessionOutputBuffers.set("s-timeout-1", buffer);

    setupDeferredTaskDelivery(ctx, mockSession as any, "Fix the bug", "claude");

    // Fire session_ready immediately
    manager.emit("session_ready", mockSession);

    // Advance past settle delay
    jest.advanceTimersByTime(800);

    expect(ctx.sendToSession).toHaveBeenCalledTimes(1);

    // Simulate agent producing output so retry logic considers it accepted
    for (let i = 0; i < 20; i++) buffer.push(`output line ${i}`);

    // Advance past the verify delay (5s) and timeout (30s)
    jest.advanceTimersByTime(30_000);

    // Still only one call — retries didn't fire, timeout didn't fire
    expect(ctx.sendToSession).toHaveBeenCalledTimes(1);

    // No timeout warning logged
    const logCalls = (ctx.log as ReturnType<typeof jest.fn>).mock.calls;
    const timeoutLogs = logCalls.filter((c: unknown[]) =>
      String(c[0]).includes("ready event not received"),
    );
    expect(timeoutLogs).toHaveLength(0);
  });

  it("does NOT set timeout if session is already ready", () => {
    const manager = createMockManager();
    const ctx = createMockCtx(manager);

    const readySession = { ...mockSession, status: "ready" };

    setupDeferredTaskDelivery(
      ctx,
      readySession as any,
      "Fix the bug",
      "claude",
    );

    // Should NOT register a listener (session is already ready)
    expect(manager.on).not.toHaveBeenCalled();

    // Advance past settle delay
    jest.advanceTimersByTime(800);

    // Task sent immediately via the ready branch
    expect(ctx.sendToSession).toHaveBeenCalledWith("s-timeout-1", "Fix the bug");

    // No timeout warning should appear
    jest.advanceTimersByTime(30_000);
    const logCalls = (ctx.log as ReturnType<typeof jest.fn>).mock.calls;
    const timeoutLogs = logCalls.filter((c: unknown[]) =>
      String(c[0]).includes("ready event not received"),
    );
    expect(timeoutLogs).toHaveLength(0);
  });

  it("cleans up listener after timeout fires", () => {
    const manager = createMockManager();
    const ctx = createMockCtx(manager);

    setupDeferredTaskDelivery(ctx, mockSession as any, "Fix the bug", "gemini");

    // Advance past timeout
    jest.advanceTimersByTime(30_000);

    // removeListener should have been called
    expect(manager.removeListener).toHaveBeenCalledWith(
      "session_ready",
      expect.any(Function),
    );
  });

  it("ignores session_ready events for other sessions", () => {
    const manager = createMockManager();
    const ctx = createMockCtx(manager);

    setupDeferredTaskDelivery(ctx, mockSession as any, "Fix the bug", "claude");

    // Fire session_ready for a different session
    manager.emit("session_ready", { ...mockSession, id: "s-other" });

    // Advance past settle delay — should NOT have sent
    jest.advanceTimersByTime(800);
    expect(ctx.sendToSession).not.toHaveBeenCalled();

    // The 30s timeout should still fire and deliver
    jest.advanceTimersByTime(30_000);
    jest.advanceTimersByTime(800);
    expect(ctx.sendToSession).toHaveBeenCalledWith("s-timeout-1", "Fix the bug");
  });
});
