import { describe, expect, it } from "bun:test";
import {
  clearTrajectoryContext,
  readTrajectoryContext,
  setTrajectoryContext,
  withTrajectoryContext,
  type OrchestratorTrajectoryContext,
} from "../services/trajectory-context.js";

function makeRuntime(): Record<string, unknown> {
  return {};
}

const CTX: OrchestratorTrajectoryContext = {
  source: "orchestrator",
  decisionType: "coordination",
  sessionId: "sess-1",
  taskLabel: "Fix bug",
};

describe("trajectory-context", () => {
  describe("set / read / clear", () => {
    it("reads back what was set", () => {
      const rt = makeRuntime();
      setTrajectoryContext(rt, CTX);
      expect(readTrajectoryContext(rt)).toEqual(CTX);
    });

    it("returns undefined after clear", () => {
      const rt = makeRuntime();
      setTrajectoryContext(rt, CTX);
      clearTrajectoryContext(rt);
      expect(readTrajectoryContext(rt)).toBeUndefined();
    });

    it("returns undefined when nothing was set", () => {
      expect(readTrajectoryContext(makeRuntime())).toBeUndefined();
    });

    it("returns undefined for null / non-object runtime", () => {
      expect(readTrajectoryContext(null)).toBeUndefined();
      expect(readTrajectoryContext(undefined)).toBeUndefined();
      expect(readTrajectoryContext("string")).toBeUndefined();
    });

    it("rejects context missing source field", () => {
      const rt = makeRuntime();
      (rt as Record<string, unknown>).__orchestratorTrajectoryCtx = {
        decisionType: "coordination",
      };
      expect(readTrajectoryContext(rt)).toBeUndefined();
    });

    it("rejects context with wrong source", () => {
      const rt = makeRuntime();
      (rt as Record<string, unknown>).__orchestratorTrajectoryCtx = {
        source: "other",
        decisionType: "coordination",
      };
      expect(readTrajectoryContext(rt)).toBeUndefined();
    });

    it("works with optional fields omitted", () => {
      const rt = makeRuntime();
      const minimal: OrchestratorTrajectoryContext = {
        source: "orchestrator",
        decisionType: "event-triage",
      };
      setTrajectoryContext(rt, minimal);
      const result = readTrajectoryContext(rt);
      expect(result).toEqual(minimal);
      expect(result?.sessionId).toBeUndefined();
      expect(result?.taskLabel).toBeUndefined();
    });
  });

  describe("withTrajectoryContext", () => {
    it("sets context during fn execution and clears after", async () => {
      const rt = makeRuntime();
      let captured: OrchestratorTrajectoryContext | undefined;

      await withTrajectoryContext(rt, CTX, async () => {
        captured = readTrajectoryContext(rt);
        return "result";
      });

      expect(captured).toEqual(CTX);
      expect(readTrajectoryContext(rt)).toBeUndefined();
    });

    it("returns the fn result", async () => {
      const rt = makeRuntime();
      const result = await withTrajectoryContext(rt, CTX, async () => 42);
      expect(result).toBe(42);
    });

    it("clears context even when fn throws", async () => {
      const rt = makeRuntime();
      try {
        await withTrajectoryContext(rt, CTX, async () => {
          throw new Error("boom");
        });
      } catch {
        // expected
      }
      expect(readTrajectoryContext(rt)).toBeUndefined();
    });

    it("propagates the error from fn", async () => {
      const rt = makeRuntime();
      await expect(
        withTrajectoryContext(rt, CTX, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    });
  });
});
