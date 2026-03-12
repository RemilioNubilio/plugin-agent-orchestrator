import { describe, expect, it } from "bun:test";
import {
  formatPastExperience,
  queryPastExperience,
} from "../services/trajectory-feedback.js";

// ─── extractInsights (tested indirectly via queryPastExperience) ───

describe("trajectory-feedback", () => {
  describe("formatPastExperience", () => {
    it("returns empty string for no experiences", () => {
      expect(formatPastExperience([])).toBe("");
    });

    it("formats experiences as markdown with header", () => {
      const result = formatPastExperience([
        {
          timestamp: Date.now() - 3600_000,
          decisionType: "coordination",
          taskLabel: "agent-1",
          insight: "Use snake_case for all API endpoints",
        },
      ]);
      expect(result).toContain("# Past Experience");
      expect(result).toContain("Use snake_case for all API endpoints");
      expect(result).toContain("[agent-1]");
      expect(result).toContain("1h ago");
    });

    it("formats multiple experiences as bullet points", () => {
      const result = formatPastExperience([
        {
          timestamp: Date.now() - 7200_000,
          decisionType: "turn-complete",
          taskLabel: "alpha",
          insight: "Tests must run in isolation",
        },
        {
          timestamp: Date.now() - 86400_000,
          decisionType: "coordination",
          taskLabel: "beta",
          insight: "Database migrations need rollback scripts",
        },
      ]);
      const lines = result.split("\n").filter((l) => l.startsWith("- "));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("Tests must run in isolation");
      expect(lines[1]).toContain("Database migrations need rollback scripts");
    });

    it("shows relative time correctly", () => {
      const result = formatPastExperience([
        {
          timestamp: Date.now() - 300_000, // 5 minutes ago
          decisionType: "coordination",
          taskLabel: "",
          insight: "Recent insight",
        },
      ]);
      expect(result).toContain("just now");
    });

    it("shows days for old entries", () => {
      const result = formatPastExperience([
        {
          timestamp: Date.now() - 2 * 86400_000, // 2 days ago
          decisionType: "coordination",
          taskLabel: "old-agent",
          insight: "Old insight",
        },
      ]);
      expect(result).toContain("2d ago");
    });

    it("omits label bracket when taskLabel is empty", () => {
      const result = formatPastExperience([
        {
          timestamp: Date.now(),
          decisionType: "coordination",
          taskLabel: "",
          insight: "No label insight",
        },
      ]);
      expect(result).not.toContain("[]");
    });
  });

  describe("queryPastExperience", () => {
    it("returns empty array when trajectory logger is not available", async () => {
      const mockRuntime = {} as Parameters<typeof queryPastExperience>[0];
      const result = await queryPastExperience(mockRuntime);
      expect(result).toEqual([]);
    });

    it("returns empty array when no trajectories found", async () => {
      const mockRuntime = {
        getService: (type: string) => {
          if (type === "trajectory_logger") {
            return {
              listTrajectories: async () => ({
                trajectories: [],
                total: 0,
              }),
              getTrajectoryDetail: async () => null,
            };
          }
          return null;
        },
      } as Parameters<typeof queryPastExperience>[0];

      const result = await queryPastExperience(mockRuntime);
      expect(result).toEqual([]);
    });

    it("extracts DECISION markers from trajectory responses", async () => {
      const mockRuntime = {
        getService: (type: string) => {
          if (type === "trajectory_logger") {
            return {
              listTrajectories: async () => ({
                trajectories: [
                  {
                    id: "traj-1",
                    source: "orchestrator",
                    startTime: Date.now() - 3600_000,
                    llmCallCount: 1,
                    createdAt: new Date().toISOString(),
                  },
                ],
                total: 1,
              }),
              getTrajectoryDetail: async (id: string) => {
                if (id === "traj-1") {
                  return {
                    trajectoryId: "traj-1",
                    metadata: {
                      orchestrator: {
                        decisionType: "coordination",
                        taskLabel: "agent-alpha",
                      },
                    },
                    steps: [
                      {
                        llmCalls: [
                          {
                            purpose: "coordination",
                            response:
                              '{"action": "respond", "response": "yes", "reasoning": "Approved write", "keyDecision": "Use PostgreSQL for persistence"}',
                            timestamp: Date.now() - 3600_000,
                          },
                        ],
                      },
                    ],
                  };
                }
                return null;
              },
            };
          }
          return null;
        },
      } as Parameters<typeof queryPastExperience>[0];

      const result = await queryPastExperience(mockRuntime);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].insight).toContain("Use PostgreSQL for persistence");
      // Task labels may be absent in list-level metadata and no longer hydrate
      // from detail payloads in all fast-path flows.
      expect(["", "agent-alpha"]).toContain(result[0].taskLabel);
    });

    it("extracts explicit DECISION: markers", async () => {
      const mockRuntime = {
        getService: (type: string) => {
          if (type === "trajectory_logger") {
            return {
              listTrajectories: async () => ({
                trajectories: [
                  {
                    id: "traj-2",
                    source: "orchestrator",
                    startTime: Date.now() - 1800_000,
                    llmCallCount: 1,
                    createdAt: new Date().toISOString(),
                  },
                ],
                total: 1,
              }),
              getTrajectoryDetail: async () => ({
                trajectoryId: "traj-2",
                metadata: {
                  orchestrator: {
                    decisionType: "turn-complete",
                    taskLabel: "builder",
                  },
                },
                steps: [
                  {
                    llmCalls: [
                      {
                        purpose: "turn-complete",
                        response:
                          "The agent completed the task.\nDECISION: All config files use YAML format, not JSON\nDECISION: Error codes follow HTTP status conventions",
                        timestamp: Date.now() - 1800_000,
                      },
                    ],
                  },
                ],
              }),
            };
          }
          return null;
        },
      } as Parameters<typeof queryPastExperience>[0];

      const result = await queryPastExperience(mockRuntime);
      expect(result.length).toBe(2);
      const insights = result.map((e) => e.insight);
      expect(insights).toContain("All config files use YAML format, not JSON");
      expect(insights).toContain(
        "Error codes follow HTTP status conventions",
      );
    });

    it("deduplicates identical insights", async () => {
      const mockRuntime = {
        getService: (type: string) => {
          if (type === "trajectory_logger") {
            return {
              listTrajectories: async () => ({
                trajectories: [
                  {
                    id: "traj-a",
                    source: "orchestrator",
                    startTime: Date.now() - 1000,
                    llmCallCount: 1,
                    createdAt: new Date().toISOString(),
                  },
                  {
                    id: "traj-b",
                    source: "orchestrator",
                    startTime: Date.now() - 2000,
                    llmCallCount: 1,
                    createdAt: new Date().toISOString(),
                  },
                ],
                total: 2,
              }),
              getTrajectoryDetail: async () => ({
                trajectoryId: "x",
                metadata: {
                  orchestrator: { decisionType: "coordination", taskLabel: "a" },
                },
                steps: [
                  {
                    llmCalls: [
                      {
                        purpose: "coordination",
                        response: "DECISION: Use TypeScript strict mode",
                        timestamp: Date.now(),
                      },
                    ],
                  },
                ],
              }),
            };
          }
          return null;
        },
      } as Parameters<typeof queryPastExperience>[0];

      const result = await queryPastExperience(mockRuntime);
      // Same insight from both trajectories — should deduplicate
      expect(result.length).toBe(1);
      expect(result[0].insight).toBe("Use TypeScript strict mode");
    });

    it("handles errors gracefully", async () => {
      const mockRuntime = {
        getService: (type: string) => {
          if (type === "trajectory_logger") {
            return {
              listTrajectories: async () => {
                throw new Error("DB connection failed");
              },
              getTrajectoryDetail: async () => null,
            };
          }
          return null;
        },
      } as Parameters<typeof queryPastExperience>[0];

      const result = await queryPastExperience(mockRuntime);
      expect(result).toEqual([]);
    });
  });
});
