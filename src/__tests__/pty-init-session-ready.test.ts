/**
 * Tests for the session_ready → task_complete forwarding logic in pty-init.
 *
 * The session_ready handler decides whether to forward the event as
 * task_complete based on:
 *   1. hasActiveTask — is there an active coordinator task for this session?
 *   2. hasTaskActivity — has the task had any decisions (work done)?
 *   3. taskResponseMarkers — optionally captures response text
 *
 * These tests verify the logic directly without starting a real PTY manager.
 */

import { describe, expect, it, jest } from "bun:test";

// ---------------------------------------------------------------------------
// Replicate the exact handler logic from pty-init.ts session_ready callback
// so we can test it in isolation.
// ---------------------------------------------------------------------------

interface MockSession {
  id: string;
  type: string;
  status: string;
}

interface MockCtx {
  hasActiveTask: (sessionId: string) => boolean;
  hasTaskActivity: (sessionId: string) => boolean;
  taskResponseMarkers: Map<string, number>;
  sessionOutputBuffers: Map<string, string[]>;
  emitEvent: (sessionId: string, event: string, data: unknown) => void;
  log: (msg: string) => void;
}

/**
 * Extracted from pty-init.ts session_ready handler (both Bun and Node paths).
 * This is the exact logic we're testing.
 */
function handleSessionReady(ctx: MockCtx, session: MockSession): void {
  ctx.emitEvent(session.id, "ready", { session });

  if (ctx.hasActiveTask(session.id) && ctx.hasTaskActivity(session.id)) {
    const response = ctx.taskResponseMarkers.has(session.id)
      ? captureTaskResponseMock(
          session.id,
          ctx.sessionOutputBuffers,
          ctx.taskResponseMarkers,
        )
      : "";
    ctx.log(
      `session_ready for active task ${session.id} — forwarding as task_complete (stall classifier path, response: ${response.length} chars)`,
    );
    ctx.emitEvent(session.id, "task_complete", { session, response });
  }
}

/** Simplified captureTaskResponse for testing — mirrors ansi-utils.ts */
function captureTaskResponseMock(
  sessionId: string,
  buffers: Map<string, string[]>,
  markers: Map<string, number>,
): string {
  const buffer = buffers.get(sessionId);
  const marker = markers.get(sessionId);
  if (!buffer || marker === undefined) return "";
  const responseLines = buffer.slice(marker);
  markers.delete(sessionId); // consumed
  return responseLines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(overrides: Partial<MockCtx> = {}): MockCtx & {
  emitEvent: ReturnType<typeof jest.fn>;
  log: ReturnType<typeof jest.fn>;
} {
  return {
    hasActiveTask: () => false,
    hasTaskActivity: () => false,
    taskResponseMarkers: new Map(),
    sessionOutputBuffers: new Map(),
    emitEvent: jest.fn(),
    log: jest.fn(),
    ...overrides,
  };
}

const session: MockSession = { id: "s-1", type: "claude", status: "ready" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session_ready → task_complete forwarding", () => {
  it("does NOT forward when no active task", () => {
    const ctx = createMockCtx({
      hasActiveTask: () => false,
      hasTaskActivity: () => true,
    });

    handleSessionReady(ctx, session);

    // Should emit "ready" but NOT "task_complete"
    expect(ctx.emitEvent).toHaveBeenCalledWith("s-1", "ready", { session });
    expect(ctx.emitEvent).not.toHaveBeenCalledWith(
      "s-1",
      "task_complete",
      expect.anything(),
    );
  });

  it("does NOT forward on startup (active task but no activity yet)", () => {
    const ctx = createMockCtx({
      hasActiveTask: () => true,
      hasTaskActivity: () => false, // decisions.length === 0
    });

    handleSessionReady(ctx, session);

    expect(ctx.emitEvent).toHaveBeenCalledWith("s-1", "ready", { session });
    expect(ctx.emitEvent).not.toHaveBeenCalledWith(
      "s-1",
      "task_complete",
      expect.anything(),
    );
  });

  it("forwards task_complete when active task has activity, even WITHOUT marker", () => {
    const ctx = createMockCtx({
      hasActiveTask: () => true,
      hasTaskActivity: () => true, // decisions.length > 0
      // NO taskResponseMarkers entry — marker was consumed by prior cycle
    });

    handleSessionReady(ctx, session);

    // Should emit BOTH "ready" and "task_complete"
    expect(ctx.emitEvent).toHaveBeenCalledWith("s-1", "ready", { session });
    expect(ctx.emitEvent).toHaveBeenCalledWith("s-1", "task_complete", {
      session,
      response: "", // empty because no marker
    });
  });

  it("forwards task_complete WITH response when marker exists", () => {
    const buffers = new Map([["s-1", ["line1", "line2", "response line"]]]);
    const markers = new Map([["s-1", 2]]); // marker at index 2

    const ctx = createMockCtx({
      hasActiveTask: () => true,
      hasTaskActivity: () => true,
      sessionOutputBuffers: buffers,
      taskResponseMarkers: markers,
    });

    handleSessionReady(ctx, session);

    expect(ctx.emitEvent).toHaveBeenCalledWith("s-1", "task_complete", {
      session,
      response: "response line",
    });
    // Marker should be consumed
    expect(markers.has("s-1")).toBe(false);
  });

  it("reproduces the bug: multi-turn task with consumed marker", () => {
    // Scenario: 14 decisions worth of turns, marker consumed by adapter
    // fast-path on the last turn, then session_ready fires.
    // OLD behavior: blocked (marker guard fails)
    // NEW behavior: forwards with empty response

    const ctx = createMockCtx({
      hasActiveTask: () => true,
      hasTaskActivity: () => true, // 14 decisions
      // Marker was consumed by captureTaskResponse in the adapter fast-path
      // or a previous session_ready cycle
    });

    handleSessionReady(ctx, session);

    // With the fix, this should forward as task_complete
    expect(ctx.emitEvent).toHaveBeenCalledWith("s-1", "task_complete", {
      session,
      response: "",
    });
  });
});
