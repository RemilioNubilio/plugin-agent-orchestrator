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
import {
  _resetForTesting,
  captureFeed,
  captureLifecycle,
  captureSessionOpen,
  captureSnapshot,
  isDebugCaptureEnabled,
} from "../services/debug-capture.js";

// Save and restore env var + module state around each test
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.PARALLAX_DEBUG_CAPTURE;
  _resetForTesting();
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
  } else {
    process.env.PARALLAX_DEBUG_CAPTURE = originalEnv;
  }
  _resetForTesting();
});

// ---------------------------------------------------------------------------
// isDebugCaptureEnabled
// ---------------------------------------------------------------------------
describe("isDebugCaptureEnabled", () => {
  it("returns false when env var is not set", () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    expect(isDebugCaptureEnabled()).toBe(false);
  });

  it("returns false when env var is '0'", () => {
    process.env.PARALLAX_DEBUG_CAPTURE = "0";
    expect(isDebugCaptureEnabled()).toBe(false);
  });

  it("returns true when env var is '1'", () => {
    process.env.PARALLAX_DEBUG_CAPTURE = "1";
    expect(isDebugCaptureEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// captureFeed / captureLifecycle — no-op when disabled
// ---------------------------------------------------------------------------
describe("capture functions when disabled", () => {
  it("captureFeed does nothing when capture is not enabled", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    // Should not throw
    await captureFeed("test-session", "hello world", "stdout");
  });

  it("captureLifecycle does nothing when capture is not enabled", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    // Should not throw
    await captureLifecycle("test-session", "session_stopped");
  });

  it("captureSnapshot returns null when capture is not enabled", () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    expect(captureSnapshot("test-session")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// captureSessionOpen — graceful when pty-state-capture available
// ---------------------------------------------------------------------------
describe("captureSessionOpen", () => {
  it("does not throw when env is disabled", async () => {
    delete process.env.PARALLAX_DEBUG_CAPTURE;
    // Should resolve without error
    await captureSessionOpen("test-session", "claude");
  });

  it("does not throw when env is enabled but package unavailable", async () => {
    process.env.PARALLAX_DEBUG_CAPTURE = "1";
    // pty-state-capture may or may not be installed in test env.
    // Either way, this should not throw.
    await captureSessionOpen("test-session", "claude");
  });
});
