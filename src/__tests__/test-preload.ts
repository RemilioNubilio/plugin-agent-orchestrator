/**
 * Shared test preload — mocks external modules that bun cannot parse or
 * that leak across test files via bun's global mock.module() behavior.
 *
 * This file is loaded via bunfig.toml [test].preload before every test file,
 * ensuring consistent module mocking regardless of test execution order.
 */

import { jest, mock } from "bun:test";

const _noop = () => {};
const RUN_LIVE = process.env.ORCHESTRATOR_LIVE === "1";

if (!RUN_LIVE) {
  mock.module("@elizaos/core", () => ({
    ModelType: { TEXT_SMALL: "text-small" },
    logger: { info: _noop, warn: _noop, error: _noop, debug: _noop },
  }));

  mock.module("pty-manager", () => ({
    PTYManager: class {},
    ShellAdapter: class {},
    BunCompatiblePTYManager: class {},
    isBun: () => false,
    extractTaskCompletionTraceRecords: () => [],
    buildTaskCompletionTimeline: () => ({}),
  }));

  mock.module("coding-agent-adapters", () => ({
    createAllAdapters: () => [],
    checkAdapters: jest.fn().mockResolvedValue([]),
    createAdapter: jest.fn(),
    generateApprovalConfig: jest.fn(),
  }));
}
