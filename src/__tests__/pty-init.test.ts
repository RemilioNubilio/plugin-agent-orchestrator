import { beforeEach, describe, expect, it, jest, mock } from "bun:test";

const constructorOptions: Array<Record<string, unknown>> = [];
const mockBunManager = {
  on: jest.fn(),
  waitForReady: jest.fn().mockResolvedValue(undefined),
};

mock.module("pty-manager", () => ({
  PTYManager: class {},
  ShellAdapter: class {},
  BunCompatiblePTYManager: class {
    constructor(options: Record<string, unknown> = {}) {
      constructorOptions.push(options);
      Object.assign(this, mockBunManager);
    }
  },
  isBun: () => true,
}));

mock.module("coding-agent-adapters", () => ({
  createAllAdapters: () => [],
}));

const { initializePTYManager } = await import("../services/pty-init.js");

function createContext() {
  return {
    serviceConfig: {},
    classifyStall: async () => null,
    emitEvent: jest.fn(),
    handleGeminiAuth: jest.fn(),
    sessionOutputBuffers: new Map(),
    taskResponseMarkers: new Map(),
    metricsTracker: {
      recordCompletion: jest.fn(),
    },
    traceEntries: [],
    maxTraceEntries: 20,
    log: jest.fn(),
  };
}

describe("initializePTYManager", () => {
  beforeEach(() => {
    constructorOptions.length = 0;
    jest.clearAllMocks();
    mockBunManager.waitForReady.mockResolvedValue(undefined);
  });

  it("passes an explicit nodePath to the Bun worker manager", async () => {
    const result = await initializePTYManager(createContext());

    expect(result.usingBunWorker).toBe(true);
    expect(constructorOptions).toHaveLength(1);
    expect(constructorOptions[0]?.nodePath).toEqual(expect.any(String));
    expect(String(constructorOptions[0]?.nodePath)).not.toBe("");
  });
});
