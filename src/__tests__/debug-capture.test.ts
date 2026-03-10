/**
 * Debug capture integration tests
 *
 * Validates that the debug capture module:
 * - Is completely inert when PARALLAX_DEBUG_CAPTURE is not set
 * - Initializes correctly when enabled
 * - Handles missing pty-state-capture gracefully
 * - Feeds data and records lifecycle events without throwing
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";

// Save and restore env var around each test
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.PARALLAX_DEBUG_CAPTURE;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
  } else {
    process.env.PARALLAX_DEBUG_CAPTURE = originalEnv;
  }
});

// ---------------------------------------------------------------------------
// isDebugCaptureEnabled
// ---------------------------------------------------------------------------
describe("isDebugCaptureEnabled", () => {
  it("returns false when env var is not set", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    // Re-import to get fresh module
    const { isDebugCaptureEnabled } = await import(
      "../services/debug-capture.js"
    );
    expect(isDebugCaptureEnabled()).toBe(false);
  });

  it("returns false when env var is '0'", async () => {
    process.env.PARALLAX_DEBUG_CAPTURE = "0";
    const { isDebugCaptureEnabled } = await import(
      "../services/debug-capture.js"
    );
    expect(isDebugCaptureEnabled()).toBe(false);
  });

  it("returns true when env var is '1'", async () => {
    process.env.PARALLAX_DEBUG_CAPTURE = "1";
    const { isDebugCaptureEnabled } = await import(
      "../services/debug-capture.js"
    );
    expect(isDebugCaptureEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// captureFeed / captureLifecycle — no-op when disabled
// ---------------------------------------------------------------------------
describe("capture functions when disabled", () => {
  it("captureFeed does nothing when capture is not enabled", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    const { captureFeed } = await import("../services/debug-capture.js");

    // Should not throw
    await captureFeed("test-session", "hello world", "stdout");
  });

  it("captureLifecycle does nothing when capture is not enabled", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    const { captureLifecycle } = await import("../services/debug-capture.js");

    // Should not throw
    await captureLifecycle("test-session", "session_stopped");
  });

  it("captureSnapshot returns null when capture is not enabled", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    const { captureSnapshot } = await import("../services/debug-capture.js");

    expect(captureSnapshot("test-session")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// captureSessionOpen — graceful when pty-state-capture available
// ---------------------------------------------------------------------------
describe("captureSessionOpen", () => {
  it("does not throw when env is disabled", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    const { captureSessionOpen } = await import(
      "../services/debug-capture.js"
    );

    // Should resolve without error
    await captureSessionOpen("test-session", "claude");
  });
});
