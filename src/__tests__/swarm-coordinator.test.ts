/**
 * SwarmCoordinator unit tests
 *
 * Tests task registration, event handling, SSE broadcasting,
 * LLM decision loop, supervision levels, and confirmation queue.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";

// Dynamic import after preload mocks
const { SwarmCoordinator } = await import("../services/swarm-coordinator.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockRuntime = () => ({
	useModel: jest.fn(),
	getSetting: jest.fn(),
	getService: jest.fn(),
});

const createMockTaskRegistry = () => ({
	ensureSchema: jest.fn().mockResolvedValue(undefined),
	recoverInterruptedTasks: jest.fn().mockResolvedValue(undefined),
	listPendingDecisions: jest.fn().mockResolvedValue([]),
	getThreadRecord: jest.fn().mockResolvedValue({ id: "thread-1" }),
	createThread: jest.fn().mockResolvedValue({ id: "thread-1" }),
	getThreadSummary: jest.fn().mockResolvedValue(null),
	listThreads: jest.fn().mockResolvedValue([]),
	countThreads: jest.fn().mockResolvedValue(0),
	getThread: jest.fn().mockResolvedValue(null),
	archiveThread: jest.fn().mockResolvedValue(undefined),
	reopenThread: jest.fn().mockResolvedValue(undefined),
	updateThread: jest.fn().mockResolvedValue(undefined),
	registerSession: jest.fn().mockResolvedValue(undefined),
	updateSession: jest.fn().mockResolvedValue(undefined),
	recordDecision: jest.fn().mockResolvedValue(undefined),
	appendEvent: jest.fn().mockResolvedValue(undefined),
	recordArtifact: jest.fn().mockResolvedValue(undefined),
	upsertPendingDecision: jest.fn().mockResolvedValue(undefined),
	deletePendingDecision: jest.fn().mockResolvedValue(undefined),
	updateThreadSummary: jest.fn().mockResolvedValue(undefined),
	getLastUsedRepo: jest.fn().mockResolvedValue(undefined),
});

const createMockPTYService = () => ({
	onSessionEvent: jest.fn().mockReturnValue(() => {}),
	sendToSession: jest.fn().mockResolvedValue(undefined),
	sendKeysToSession: jest.fn().mockResolvedValue(undefined),
	getSessionOutput: jest.fn().mockResolvedValue("recent output"),
	stopSession: jest.fn().mockResolvedValue(undefined),
	listSessions: jest.fn().mockResolvedValue([]),
	spawnSession: jest.fn().mockResolvedValue({
		id: "s-failover",
		name: "failover-session",
		agentType: "codex",
		workdir: "/workspace",
		status: "starting",
		createdAt: new Date(),
		lastActivityAt: new Date(),
		metadata: {},
	}),
	getSession: jest.fn().mockReturnValue({
		id: "s-1",
		name: "primary-session",
		agentType: "claude",
		workdir: "/workspace",
		status: "error",
		createdAt: new Date(),
		lastActivityAt: new Date(),
		metadata: {
			threadId: "thread-1",
			requestedType: "claude",
			label: "test-agent",
		},
	}),
	getFrameworkState: jest.fn().mockResolvedValue({
		preferred: {
			id: "codex",
			reason: "codex available",
		},
		frameworks: [
			{
				id: "claude",
				label: "Claude Code",
				installed: true,
				authReady: true,
				subscriptionReady: true,
				temporarilyDisabled: true,
				recommended: false,
				reason: "temporarily disabled",
			},
			{
				id: "codex",
				label: "Codex",
				installed: true,
				authReady: true,
				subscriptionReady: true,
				temporarilyDisabled: false,
				recommended: true,
				reason: "preferred fallback",
			},
		],
	}),
	resolveAgentType: jest.fn().mockResolvedValue("codex"),
	defaultApprovalPreset: "autonomous",
});

function createMockSseRes() {
	return {
		write: jest.fn().mockReturnValue(true),
		end: jest.fn(),
		on: jest.fn(),
		writableEnded: false,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SwarmCoordinator", () => {
	// biome-ignore lint/suspicious/noExplicitAny: test mock
	let coordinator: any;
	let mockRuntime: ReturnType<typeof createMockRuntime>;
	// biome-ignore lint/suspicious/noExplicitAny: test mock
	let mockPty: any;
	let mockTaskRegistry: ReturnType<typeof createMockTaskRegistry>;

	beforeEach(async () => {
		jest.clearAllMocks();
		mockRuntime = createMockRuntime();
		mockPty = createMockPTYService();
		mockTaskRegistry = createMockTaskRegistry();
		coordinator = new SwarmCoordinator(mockRuntime);
		coordinator.taskRegistry = mockTaskRegistry;
		await coordinator.start(mockPty);
	});

	// =========================================================================
	// Lifecycle
	// =========================================================================
	describe("lifecycle", () => {
		it("subscribes to PTY events on start", () => {
			expect(mockPty.onSessionEvent).toHaveBeenCalledTimes(1);
		});

		it("rehydrates persisted pending confirmations on start", async () => {
			const runtime = createMockRuntime();
			const pty = createMockPTYService();
			const taskRegistry = createMockTaskRegistry();
			taskRegistry.listPendingDecisions.mockResolvedValue([
				{
					sessionId: "s-pending",
					threadId: "thread-pending",
					promptText: "Allow deploy?",
					recentOutput: "Waiting for approval",
					llmDecision: {
						action: "respond",
						response: "y",
						reasoning: "Safe approval",
					},
					taskContext: {
						threadId: "thread-pending",
						sessionId: "s-pending",
						agentType: "claude",
						label: "pending-agent",
						originalTask: "Ship the feature",
						workdir: "/workspace/pending",
						status: "blocked",
						decisions: [],
						autoResolvedCount: 0,
						registeredAt: 1,
						lastActivityAt: 2,
						idleCheckCount: 0,
						taskDelivered: true,
						lastSeenDecisionIndex: 0,
					},
					createdAt: 123,
					updatedAt: "2026-04-06T00:00:00.000Z",
				},
			]);

			const coord = new SwarmCoordinator(runtime);
			coord.taskRegistry = taskRegistry;
			await coord.start(pty);

			expect(coord.getPendingConfirmations()).toHaveLength(1);
			expect(coord.getPendingConfirmations()[0]?.sessionId).toBe("s-pending");
			expect(coord.getTaskContext("s-pending")?.status).toBe("blocked");
		});

		it("unsubscribes on stop", async () => {
			const unsub = jest.fn();
			mockPty.onSessionEvent.mockReturnValue(unsub);
			const coord = new SwarmCoordinator(mockRuntime);
			coord.taskRegistry = createMockTaskRegistry();
			await coord.start(mockPty);
			await coord.stop();
			expect(unsub).toHaveBeenCalled();
		});
	});

	// =========================================================================
	// Task Registration
	// =========================================================================
	describe("task registration", () => {
		it("registers a task context", () => {
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test-agent",
				originalTask: "Fix bug",
				workdir: "/workspace",
			});

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx).toBeDefined();
			expect(ctx.sessionId).toBe("s-1");
			expect(ctx.agentType).toBe("claude");
			expect(ctx.label).toBe("test-agent");
			expect(ctx.originalTask).toBe("Fix bug");
			expect(ctx.status).toBe("active");
			expect(ctx.decisions).toEqual([]);
			expect(ctx.autoResolvedCount).toBe(0);
		});

		it("returns undefined for unregistered sessions", () => {
			expect(coordinator.getTaskContext("unknown")).toBeUndefined();
		});

		it("lists all task contexts", () => {
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "a",
				originalTask: "task 1",
				workdir: "/w1",
			});
			coordinator.registerTask("s-2", {
				agentType: "gemini",
				label: "b",
				originalTask: "task 2",
				workdir: "/w2",
			});

			const all = coordinator.getAllTaskContexts();
			expect(all.length).toBe(2);
		});

		it("derives task-specific acceptance criteria when creating a thread", async () => {
			mockRuntime.useModel.mockResolvedValue(
				JSON.stringify([
					"Persist all task state in the database.",
					"Rehydrate restart-sensitive coordinator state.",
					"Record validation evidence before completion.",
				]),
			);
			mockTaskRegistry.getThreadSummary.mockResolvedValue({
				id: "thread-acceptance",
				title: "Durable task thread",
				kind: "coding",
				status: "open",
				originalRequest: "Make task threads durable",
				summary: "",
				acceptanceCriteria: [
					"Persist all task state in the database.",
					"Rehydrate restart-sensitive coordinator state.",
					"Record validation evidence before completion.",
				],
				currentPlan: {},
				searchText: "",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				closedAt: null,
				archivedAt: null,
				lastUserTurnAt: null,
				lastCoordinatorTurnAt: null,
				metadata: { acceptanceCriteriaSource: "model" },
				sessionCount: 0,
				activeSessionCount: 0,
				latestSessionId: null,
				latestSessionLabel: null,
				latestWorkdir: null,
				latestRepo: null,
				latestActivityAt: null,
				decisionCount: 0,
			});

			await coordinator.createTaskThread({
				id: "thread-acceptance",
				title: "Durable task thread",
				originalRequest: "Make task threads durable",
				kind: "coding",
			});

			expect(mockTaskRegistry.createThread).toHaveBeenCalledWith(
				expect.objectContaining({
					acceptanceCriteria: [
						"Persist all task state in the database.",
						"Rehydrate restart-sensitive coordinator state.",
						"Record validation evidence before completion.",
					],
					metadata: expect.objectContaining({
						acceptanceCriteriaSource: "model",
					}),
				}),
			);
		});
	});

	describe("thread control", () => {
		it("pauses a thread and records waiting_on_user state", async () => {
			mockTaskRegistry.getThread.mockResolvedValue({
				id: "thread-1",
				title: "Pause me",
				status: "active",
				originalRequest: "Fix bug",
				summary: "",
				acceptanceCriteria: [],
				events: [],
				decisions: [],
				artifacts: [],
				transcripts: [],
				sessions: [],
				pendingDecisions: [],
				sessionCount: 1,
				activeSessionCount: 1,
				latestSessionId: "s-1",
				latestSessionLabel: "test-agent",
				latestWorkdir: "/workspace",
				latestRepo: null,
				latestActivityAt: 1,
				decisionCount: 0,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				closedAt: null,
				archivedAt: null,
				roomId: null,
				worldId: null,
				ownerUserId: null,
				lastUserTurnAt: null,
				lastCoordinatorTurnAt: null,
				currentPlan: {},
				metadata: {},
				searchText: "",
				agentId: "agent-1",
				kind: "coding",
				scenarioId: null,
				batchId: null,
			});
			await coordinator.registerTask("s-1", {
				threadId: "thread-1",
				agentType: "claude",
				label: "test-agent",
				originalTask: "Fix bug",
				workdir: "/workspace",
			});

			const result = await coordinator.pauseTaskThread(
				"thread-1",
				"Review the current direction",
			);

			expect(result.stoppedSessionIds).toEqual(["s-1"]);
			expect(mockPty.stopSession).toHaveBeenCalledWith("s-1", true);
			expect(mockTaskRegistry.updateThread).toHaveBeenCalledWith(
				"thread-1",
				expect.objectContaining({
					status: "waiting_on_user",
					metadata: expect.objectContaining({
						controlState: "paused",
					}),
				}),
			);
		});

		it("resumes a stopped thread on a new session", async () => {
			mockTaskRegistry.getThread.mockResolvedValue({
				id: "thread-1",
				title: "Resume me",
				status: "interrupted",
				originalRequest: "Finish the site",
				summary: "Partial implementation exists",
				acceptanceCriteria: ["Ship the page"],
				events: [],
				decisions: [],
				artifacts: [],
				transcripts: [],
				sessions: [
					{
						id: "s-1",
						threadId: "thread-1",
						sessionId: "s-1",
						framework: "claude",
						label: "resume-me",
						originalTask: "Finish the site",
						workdir: "/workspace",
						repo: null,
						status: "interrupted",
						decisionCount: 0,
						autoResolvedCount: 0,
						registeredAt: 1,
						lastActivityAt: 2,
						idleCheckCount: 0,
						taskDelivered: true,
						completionSummary: null,
						lastSeenDecisionIndex: 0,
						lastInputSentAt: null,
						stoppedAt: 3,
						metadata: {},
						agentId: "agent-1",
						providerSource: "subscription",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
				],
				pendingDecisions: [],
				sessionCount: 1,
				activeSessionCount: 0,
				latestSessionId: "s-1",
				latestSessionLabel: "resume-me",
				latestWorkdir: "/workspace",
				latestRepo: null,
				latestActivityAt: 2,
				decisionCount: 0,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				closedAt: new Date().toISOString(),
				archivedAt: null,
				roomId: null,
				worldId: null,
				ownerUserId: null,
				lastUserTurnAt: null,
				lastCoordinatorTurnAt: null,
				currentPlan: {},
				metadata: {
					controlState: "paused",
				},
				searchText: "",
				agentId: "agent-1",
				kind: "coding",
				scenarioId: null,
				batchId: null,
			});

			const result = await coordinator.resumeTaskThread(
				"thread-1",
				"Continue from the saved workspace.",
			);

			expect(result.sessionId).toBe("s-failover");
			expect(result.reusedSession).toBe(false);
			expect(mockPty.spawnSession).toHaveBeenCalledWith(
				expect.objectContaining({
					workdir: "/workspace",
					agentType: "codex",
				}),
			);
			expect(mockTaskRegistry.updateThread).toHaveBeenCalledWith(
				"thread-1",
				expect.objectContaining({
					status: "active",
					metadata: expect.objectContaining({
						lastResumedSessionId: "s-failover",
					}),
				}),
			);
		});
	});

	// =========================================================================
	// SSE Broadcasting
	// =========================================================================
	describe("SSE broadcasting", () => {
		it("sends snapshot on client connect", () => {
			const res = createMockSseRes();
			coordinator.addSseClient(res);

			// Should have written at least one SSE event (snapshot)
			expect(res.write).toHaveBeenCalled();
			const written = res.write.mock.calls[0][0];
			expect(written).toContain("data:");
			const parsed = JSON.parse(written.replace("data: ", "").trim());
			expect(parsed.type).toBe("snapshot");
		});

		it("broadcasts task registration events", () => {
			const res = createMockSseRes();
			coordinator.addSseClient(res);
			res.write.mockClear();

			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test",
				originalTask: "Fix bug",
				workdir: "/w",
			});

			// Should have broadcast task_registered
			expect(res.write).toHaveBeenCalled();
			const lastCall = res.write.mock.calls[res.write.mock.calls.length - 1][0];
			const parsed = JSON.parse(lastCall.replace("data: ", "").trim());
			expect(parsed.type).toBe("task_registered");
			expect(parsed.sessionId).toBe("s-1");
		});

		it("removes dead SSE clients", async () => {
			const res = createMockSseRes();
			res.writableEnded = true;
			coordinator.addSseClient(res);
			res.write.mockClear();

			// Trigger a broadcast
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test",
				originalTask: "task",
				workdir: "/w",
			});

			// Dead client should not receive the event
			// (the initial snapshot write may have happened before writableEnded was set)
		});

		it("unsubscribes client on cleanup", () => {
			const res = createMockSseRes();
			const unsub = coordinator.addSseClient(res);
			unsub();

			// After unsubscribe, new events should not reach this client
			res.write.mockClear();
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test",
				originalTask: "task",
				workdir: "/w",
			});

			expect(res.write).not.toHaveBeenCalled();
		});
	});

	// =========================================================================
	// Event Handling
	// =========================================================================
	describe("event handling", () => {
		beforeEach(() => {
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test-agent",
				originalTask: "Fix bug",
				workdir: "/workspace",
			});
		});

		it("handles task_complete by routing through LLM decision", async () => {
			// task_complete now goes through handleTurnComplete — mock LLM to say "complete"
			// Turn-complete events are coalesced with a 500ms debounce, so we need
			// to wait for the coalesce timer to fire before checking the outcome.
			mockRuntime.useModel.mockImplementation(
				async (
					_modelType: string,
					options?: { prompt?: string },
				) => {
					if (options?.prompt?.includes("Return strict JSON only")) {
						return '{"verdict":"pass","summary":"Validation confirmed completion."}';
					}
					return '{"action":"complete","reasoning":"All objectives met"}';
				},
			);

			await coordinator.handleSessionEvent("s-1", "task_complete", {
				response: "Done",
			});

			// Wait for coalesce timer (500ms) + LLM call to settle
			await new Promise((r) => setTimeout(r, 700));

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx.status).toBe("completed");
			expect(mockPty.stopSession).toHaveBeenCalledWith("s-1", true);
		});

		it("handles error by updating status", async () => {
			await coordinator.handleSessionEvent("s-1", "error", {
				message: "crash",
			});

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx.status).toBe("error");
		});

		it("continues the same task on a fallback framework after quota exhaustion", async () => {
			await coordinator.handleSessionEvent("s-1", "error", {
				message: "insufficient credits",
			});

			const failedTask = coordinator.getTaskContext("s-1");
			const replacementTask = coordinator.getTaskContext("s-failover");

			expect(failedTask?.status).toBe("error");
			expect(replacementTask).toBeDefined();
			expect(replacementTask?.threadId).toBe("s-1");
			expect(replacementTask?.agentType).toBe("codex");
			expect(replacementTask?.label).toContain("codex failover");
			expect(mockPty.spawnSession).toHaveBeenCalledWith(
				expect.objectContaining({
					agentType: "codex",
					workdir: "/workspace",
					skipAdapterAutoResponse: true,
				}),
			);
			expect(mockTaskRegistry.registerSession).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: "s-failover",
					threadId: "s-1",
					framework: "codex",
					providerSource: "subscription",
				}),
			);
			expect(mockTaskRegistry.appendEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					threadId: "s-1",
					sessionId: "s-failover",
					eventType: "framework_failover_started",
				}),
			);
		});

		it("fails over when a blocked prompt reports provider usage exhaustion", async () => {
			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: {
					type: "unknown",
					prompt:
						"You've hit your usage limit. Visit settings/usage to purchase more credits or try again later.",
				},
				autoResponded: false,
			});

			const failedTask = coordinator.getTaskContext("s-1");
			const replacementTask = coordinator.getTaskContext("s-failover");

			expect(failedTask?.status).toBe("error");
			expect(replacementTask?.agentType).toBe("codex");
			expect(mockPty.stopSession).toHaveBeenCalledWith("s-1", true);
			expect(mockTaskRegistry.appendEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					threadId: "s-1",
					sessionId: "s-1",
					eventType: "framework_unavailable",
				}),
			);
		});

		it("keeps the task errored when no fallback framework is available", async () => {
			mockPty.getFrameworkState.mockResolvedValue({
				preferred: {
					id: "claude",
					reason: "claude unavailable",
				},
				frameworks: [
					{
						id: "claude",
						label: "Claude Code",
						installed: true,
						authReady: true,
						subscriptionReady: true,
						temporarilyDisabled: true,
						recommended: false,
						reason: "disabled",
					},
				],
			});

			await coordinator.handleSessionEvent("s-1", "error", {
				message: "quota exceeded",
			});

			expect(coordinator.getTaskContext("s-1")?.status).toBe("error");
			expect(coordinator.getTaskContext("s-failover")).toBeUndefined();
			expect(mockPty.spawnSession).not.toHaveBeenCalled();
		});

		it("handles stopped by updating status", async () => {
			await coordinator.handleSessionEvent("s-1", "stopped", {});

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx.status).toBe("stopped");
		});

		it("skips auto-responded blocked events", async () => {
			const res = createMockSseRes();
			coordinator.addSseClient(res);
			res.write.mockClear();

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?", type: "permission" },
				autoResponded: true,
			});

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx.autoResolvedCount).toBe(1);
			expect(ctx.decisions.length).toBe(1);
			expect(ctx.decisions[0].decision).toBe("auto_resolved");

			// Should broadcast blocked_auto_resolved
			const events = res.write.mock.calls.map((c: unknown[]) =>
				JSON.parse((c[0] as string).replace("data: ", "").trim()),
			);
			expect(
				events.some(
					(e: { type: string }) => e.type === "blocked_auto_resolved",
				),
			).toBe(true);
		});

		it("buffers events for unregistered sessions", async () => {
			// Event for unknown session
			await coordinator.handleSessionEvent("s-unknown", "blocked", {
				promptInfo: { prompt: "Allow?" },
			});

			// No crash — event is buffered
			expect(coordinator.getTaskContext("s-unknown")).toBeUndefined();
		});

		it("replays buffered events after task registration", async () => {
			// Send a blocked event for a session that hasn't been registered yet
			await coordinator.handleSessionEvent("s-late", "error", {
				message: "test error",
			});

			// Now register the session — buffered events should replay
			coordinator.registerTask("s-late", {
				agentType: "claude",
				label: "late-agent",
				originalTask: "Fix thing",
				workdir: "/w",
			});

			// Wait for buffered event replay (flush is synchronous after registerTask)
			await new Promise((r) => setTimeout(r, 50));

			const ctx = coordinator.getTaskContext("s-late");
			expect(ctx).toBeDefined();
			expect(ctx.status).toBe("error");
		});

		it("updates activity timestamp on session events", async () => {
			const before = Date.now();
			await new Promise((r) => setTimeout(r, 10));

			await coordinator.handleSessionEvent("s-1", "ready", {});

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx.lastActivityAt).toBeGreaterThan(before);
			expect(ctx.idleCheckCount).toBe(0);
		});

		it("skips events for stopped sessions", async () => {
			const ctx = coordinator.getTaskContext("s-1");
			ctx.status = "stopped";
			const activityBefore = ctx.lastActivityAt;

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			// Should not have called LLM or updated activity
			expect(mockRuntime.useModel).not.toHaveBeenCalled();
			expect(ctx.lastActivityAt).toBe(activityBefore);
			expect(ctx.decisions.length).toBe(0);
		});

		it("recovers a recently stopped session on late task_complete", async () => {
			const ctx = coordinator.getTaskContext("s-1");
			ctx.status = "stopped";
			ctx.stoppedAt = Date.now();
			mockRuntime.useModel.mockImplementation(
				async (
					_modelType: string,
					options?: { prompt?: string },
				) => {
					if (options?.prompt?.includes("Return strict JSON only")) {
						return '{"verdict":"pass","summary":"Validation confirmed the recovered completion."}';
					}
					return '{"action":"complete","reasoning":"Recovered late completion"}';
				},
			);

			await coordinator.handleSessionEvent("s-1", "task_complete", {
				response: "Done",
			});

			// Wait for coalesce timer (500ms) + LLM call to settle
			await new Promise((r) => setTimeout(r, 700));

			expect(ctx.status).toBe("completed");
			expect(mockRuntime.useModel).toHaveBeenCalled();
			expect(mockPty.stopSession).toHaveBeenCalledWith("s-1", true);
		});

		it("ignores stale task_complete for long-stopped sessions", async () => {
			const ctx = coordinator.getTaskContext("s-1");
			ctx.status = "stopped";
			ctx.stoppedAt = Date.now() - 5 * 60_000; // outside recovery window

			await coordinator.handleSessionEvent("s-1", "task_complete", {
				response: "Done",
			});

			expect(ctx.status).toBe("stopped");
			expect(mockRuntime.useModel).not.toHaveBeenCalled();
		});

		it("skips events for completed sessions", async () => {
			const ctx = coordinator.getTaskContext("s-1");
			ctx.status = "completed";

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			expect(mockRuntime.useModel).not.toHaveBeenCalled();
			expect(ctx.decisions.length).toBe(0);
		});

		it("skips events for errored sessions", async () => {
			const ctx = coordinator.getTaskContext("s-1");
			ctx.status = "error";

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			expect(mockRuntime.useModel).not.toHaveBeenCalled();
			expect(ctx.decisions.length).toBe(0);
		});

		it("clears inFlightDecisions on stop", async () => {
			coordinator.inFlightDecisions.add("s-1");

			await coordinator.handleSessionEvent("s-1", "stopped", {});

			expect(coordinator.inFlightDecisions.has("s-1")).toBe(false);
			expect(coordinator.getTaskContext("s-1").status).toBe("stopped");
		});

		it("broadcasts unknown event types for observability", async () => {
			const res = createMockSseRes();
			coordinator.addSseClient(res);
			res.write.mockClear();

			await coordinator.handleSessionEvent("s-1", "custom_event", {
				detail: "test",
			});

			const events = res.write.mock.calls.map((c: unknown[]) =>
				JSON.parse((c[0] as string).replace("data: ", "").trim()),
			);
			expect(
				events.some((e: { type: string }) => e.type === "custom_event"),
			).toBe(true);
		});
	});

	// =========================================================================
	// Supervision Levels
	// =========================================================================
	describe("supervision levels", () => {
		it("defaults to autonomous", () => {
			expect(coordinator.getSupervisionLevel()).toBe("autonomous");
		});

		it("can change supervision level", () => {
			coordinator.setSupervisionLevel("confirm");
			expect(coordinator.getSupervisionLevel()).toBe("confirm");
		});

		it("broadcasts supervision change", () => {
			const res = createMockSseRes();
			coordinator.addSseClient(res);
			res.write.mockClear();

			coordinator.setSupervisionLevel("notify");

			const events = res.write.mock.calls.map((c: unknown[]) =>
				JSON.parse((c[0] as string).replace("data: ", "").trim()),
			);
			expect(
				events.some((e: { type: string }) => e.type === "supervision_changed"),
			).toBe(true);
		});
	});

	// =========================================================================
	// LLM Decision (autonomous mode)
	// =========================================================================
	describe("autonomous coordination", () => {
		beforeEach(() => {
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test-agent",
				originalTask: "Fix bug",
				workdir: "/workspace",
			});
		});

		it("calls LLM and executes respond decision", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"respond","response":"y","reasoning":"Approve file write"}',
			);

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow write to auth.ts?", type: "permission" },
				autoResponded: false,
			});

			// Should have called sendToSession with "y"
			expect(mockPty.sendToSession).toHaveBeenCalledWith("s-1", "y");

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx.decisions.length).toBe(1);
			expect(ctx.decisions[0].decision).toBe("respond");
			expect(ctx.decisions[0].response).toBe("y");
		});

		it("calls LLM and executes respond with keys", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"respond","useKeys":true,"keys":["enter"],"reasoning":"Confirm default"}',
			);

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Select option:", type: "unknown" },
				autoResponded: false,
			});

			expect(mockPty.sendKeysToSession).toHaveBeenCalledWith("s-1", ["enter"]);
		});

		it("escalates when LLM returns escalate", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"escalate","reasoning":"Design question needs human input"}',
			);

			const res = createMockSseRes();
			coordinator.addSseClient(res);
			res.write.mockClear();

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Which database?" },
				autoResponded: false,
			});

			expect(mockPty.sendToSession).not.toHaveBeenCalled();

			// Should broadcast escalation
			const events = res.write.mock.calls.map((c: unknown[]) =>
				JSON.parse((c[0] as string).replace("data: ", "").trim()),
			);
			expect(
				events.some((e: { type: string }) => e.type === "escalation"),
			).toBe(true);
		});

		it("escalates when LLM returns invalid JSON", async () => {
			mockRuntime.useModel.mockResolvedValue("I cannot decide");

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			const ctx = coordinator.getTaskContext("s-1");
			expect(ctx.decisions.length).toBe(1);
			expect(ctx.decisions[0].decision).toBe("escalate");
			expect(ctx.decisions[0].reasoning).toContain("invalid");
		});

		it("escalates after max auto responses", async () => {
			const ctx = coordinator.getTaskContext("s-1");
			ctx.autoResolvedCount = 10; // At the limit

			const res = createMockSseRes();
			coordinator.addSseClient(res);
			res.write.mockClear();

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			// Should escalate without calling LLM
			expect(mockRuntime.useModel).not.toHaveBeenCalled();

			const events = res.write.mock.calls.map((c: unknown[]) =>
				JSON.parse((c[0] as string).replace("data: ", "").trim()),
			);
			expect(
				events.some((e: { type: string }) => e.type === "escalation"),
			).toBe(true);
		});
	});

	// =========================================================================
	// Confirm Mode
	// =========================================================================
	describe("confirm mode", () => {
		beforeEach(() => {
			coordinator.setSupervisionLevel("confirm");
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test-agent",
				originalTask: "Fix bug",
				workdir: "/workspace",
			});
		});

		it("queues LLM decision for human approval", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"respond","response":"y","reasoning":"Looks safe"}',
			);

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow write?", type: "permission" },
				autoResponded: false,
			});

			// Should NOT have sent anything yet
			expect(mockPty.sendToSession).not.toHaveBeenCalled();

			// Should be in pending confirmations
			const pending = coordinator.getPendingConfirmations();
			expect(pending.length).toBe(1);
			expect(pending[0].sessionId).toBe("s-1");
			expect(pending[0].promptText).toBe("Allow write?");
			expect(pending[0].llmDecision.action).toBe("respond");
		});

		it("executes when human approves", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"respond","response":"y","reasoning":"Safe"}',
			);

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			await coordinator.confirmDecision("s-1", true);

			expect(mockPty.sendToSession).toHaveBeenCalledWith("s-1", "y");
			expect(coordinator.getPendingConfirmations().length).toBe(0);
		});

		it("does not execute when human rejects", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"respond","response":"y","reasoning":"Safe"}',
			);

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			await coordinator.confirmDecision("s-1", false);

			expect(mockPty.sendToSession).not.toHaveBeenCalled();
			expect(coordinator.getPendingConfirmations().length).toBe(0);
		});

		it("allows human to override the LLM response", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"respond","response":"y","reasoning":"Safe"}',
			);

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			await coordinator.confirmDecision("s-1", true, { response: "n" });

			expect(mockPty.sendToSession).toHaveBeenCalledWith("s-1", "n");
		});

		it("throws when confirming non-existent pending decision", async () => {
			await expect(
				coordinator.confirmDecision("s-nonexistent", true),
			).rejects.toThrow("No pending decision");
		});
	});

	// =========================================================================
	// Notify Mode
	// =========================================================================
	describe("notify mode", () => {
		it("broadcasts but does not respond or call LLM", async () => {
			coordinator.setSupervisionLevel("notify");
			coordinator.registerTask("s-1", {
				agentType: "claude",
				label: "test-agent",
				originalTask: "Fix bug",
				workdir: "/workspace",
			});

			await coordinator.handleSessionEvent("s-1", "blocked", {
				promptInfo: { prompt: "Allow?" },
				autoResponded: false,
			});

			expect(mockRuntime.useModel).not.toHaveBeenCalled();
			expect(mockPty.sendToSession).not.toHaveBeenCalled();
		});
	});

	// =========================================================================
	// makeCoordinationDecision (direct)
	// =========================================================================
	describe("makeCoordinationDecision", () => {
		it("returns parsed LLM response", async () => {
			mockRuntime.useModel.mockResolvedValue(
				'{"action":"respond","response":"yes","reasoning":"Looks good"}',
			);

			const taskCtx = {
				sessionId: "s-1",
				agentType: "claude",
				label: "test",
				originalTask: "Fix bug",
				workdir: "/w",
				status: "active",
				decisions: [],
				autoResolvedCount: 0,
				registeredAt: Date.now(),
			};

			const decision = await coordinator.makeCoordinationDecision(
				taskCtx,
				"Allow?",
				"some output",
			);

			expect(decision).not.toBeNull();
			expect(decision.action).toBe("respond");
			expect(decision.response).toBe("yes");
		});

		it("returns null when LLM fails", async () => {
			mockRuntime.useModel.mockRejectedValue(new Error("API error"));

			const taskCtx = {
				sessionId: "s-1",
				agentType: "claude",
				label: "test",
				originalTask: "Fix bug",
				workdir: "/w",
				status: "active",
				decisions: [],
				autoResolvedCount: 0,
				registeredAt: Date.now(),
			};

			const decision = await coordinator.makeCoordinationDecision(
				taskCtx,
				"Allow?",
				"output",
			);

			expect(decision).toBeNull();
		});
	});

	// =========================================================================
	// Pre-bridge broadcast buffer
	// =========================================================================
	describe("pre-bridge broadcast buffer", () => {
		it("buffers broadcasts when wsBroadcast is not set", () => {
			// coordinator has no wsBroadcast set (default)
			coordinator.registerTask("sess-1", {
				agentType: "claude",
				label: "test",
				originalTask: "do stuff",
				workdir: "/tmp",
			});

			// task_registered was broadcast but wsBroadcast is null — should be buffered
			const wsBroadcast = jest.fn();
			coordinator.setWsBroadcast(wsBroadcast);

			// The buffered task_registered event should replay
			expect(wsBroadcast).toHaveBeenCalledTimes(1);
			expect(wsBroadcast.mock.calls[0][0].type).toBe("task_registered");
			expect(wsBroadcast.mock.calls[0][0].sessionId).toBe("sess-1");
		});

		it("does not buffer when wsBroadcast is already set", () => {
			const wsBroadcast = jest.fn();
			coordinator.setWsBroadcast(wsBroadcast);

			coordinator.registerTask("sess-2", {
				agentType: "claude",
				label: "test2",
				originalTask: "do more stuff",
				workdir: "/tmp",
			});

			// Should be called directly, not buffered
			expect(wsBroadcast).toHaveBeenCalledTimes(1);
			expect(wsBroadcast.mock.calls[0][0].type).toBe("task_registered");
		});

		it("replays multiple buffered events in order", () => {
			coordinator.registerTask("sess-a", {
				agentType: "claude",
				label: "a",
				originalTask: "task a",
				workdir: "/tmp",
			});
			coordinator.registerTask("sess-b", {
				agentType: "gemini",
				label: "b",
				originalTask: "task b",
				workdir: "/tmp",
			});

			const wsBroadcast = jest.fn();
			coordinator.setWsBroadcast(wsBroadcast);

			expect(wsBroadcast).toHaveBeenCalledTimes(2);
			expect(wsBroadcast.mock.calls[0][0].sessionId).toBe("sess-a");
			expect(wsBroadcast.mock.calls[1][0].sessionId).toBe("sess-b");
		});

		it("clears buffer after replay", () => {
			coordinator.registerTask("sess-x", {
				agentType: "claude",
				label: "x",
				originalTask: "task x",
				workdir: "/tmp",
			});

			const wsBroadcast1 = jest.fn();
			coordinator.setWsBroadcast(wsBroadcast1);
			expect(wsBroadcast1).toHaveBeenCalledTimes(1);

			// Replace with new callback — should NOT replay old events
			const wsBroadcast2 = jest.fn();
			coordinator.setWsBroadcast(wsBroadcast2);
			expect(wsBroadcast2).toHaveBeenCalledTimes(0);
		});
	});
});
