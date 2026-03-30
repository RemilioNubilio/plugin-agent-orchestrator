import { describe, expect, it, jest, beforeEach } from "bun:test";
import {
	SessionEventQueue,
	type QueuedEvent,
} from "../services/session-event-queue";

function makeEvent(
	sessionId: string,
	type: "blocked" | "turn_complete" = "turn_complete",
	data: unknown = null,
): QueuedEvent {
	return { sessionId, type, data, enqueuedAt: Date.now() };
}

/** Small delay helper for async assertions. */
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));

describe("SessionEventQueue", () => {
	let order: string[];
	let logger: { warn: jest.Mock };

	beforeEach(() => {
		order = [];
		logger = { warn: jest.fn() };
	});

	it("processes events sequentially for the same session", async () => {
		const handler = async (event: QueuedEvent) => {
			order.push(`start-${event.data}`);
			await tick(20);
			order.push(`end-${event.data}`);
		};

		const queue = new SessionEventQueue(handler, logger);

		queue.enqueue(makeEvent("s1", "turn_complete", "a"));
		queue.enqueue(makeEvent("s1", "turn_complete", "b"));
		queue.enqueue(makeEvent("s1", "turn_complete", "c"));

		// Wait for all to finish
		await tick(200);

		expect(order).toEqual([
			"start-a",
			"end-a",
			"start-b",
			"end-b",
			"start-c",
			"end-c",
		]);
	});

	it("processes events concurrently for different sessions", async () => {
		const handler = async (event: QueuedEvent) => {
			order.push(`start-${event.sessionId}-${event.data}`);
			await tick(30);
			order.push(`end-${event.sessionId}-${event.data}`);
		};

		const queue = new SessionEventQueue(handler, logger);

		queue.enqueue(makeEvent("s1", "turn_complete", "x"));
		queue.enqueue(makeEvent("s2", "turn_complete", "y"));

		await tick(100);

		// Both should have started before either finished
		const startS1 = order.indexOf("start-s1-x");
		const startS2 = order.indexOf("start-s2-y");
		const endS1 = order.indexOf("end-s1-x");
		const endS2 = order.indexOf("end-s2-y");

		expect(startS1).toBeLessThan(endS1);
		expect(startS2).toBeLessThan(endS2);
		// Both started before either ended (concurrent)
		expect(startS1).toBeLessThan(endS2);
		expect(startS2).toBeLessThan(endS1);
	});

	it("handler error doesn't block subsequent events", async () => {
		let callCount = 0;
		const handler = async (event: QueuedEvent) => {
			callCount++;
			if (event.data === "fail") {
				throw new Error("boom");
			}
			order.push(`ok-${event.data}`);
		};

		const queue = new SessionEventQueue(handler, logger);

		queue.enqueue(makeEvent("s1", "turn_complete", "fail"));
		queue.enqueue(makeEvent("s1", "turn_complete", "after"));

		await tick(50);

		expect(callCount).toBe(2);
		expect(order).toEqual(["ok-after"]);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn.mock.calls[0][0]).toContain("boom");
	});

	it("clear() stops processing of pending events", async () => {
		const handler = async (event: QueuedEvent) => {
			order.push(String(event.data));
			await tick(30);
		};

		const queue = new SessionEventQueue(handler, logger);

		queue.enqueue(makeEvent("s1", "turn_complete", "first"));
		queue.enqueue(makeEvent("s1", "turn_complete", "second"));
		queue.enqueue(makeEvent("s1", "turn_complete", "third"));

		// Clear after a very short delay — first event is already being processed,
		// but second and third should be dropped.
		await tick(5);
		queue.clear("s1");

		await tick(100);

		expect(order).toEqual(["first"]);
	});

	it("isProcessing returns correct state", async () => {
		const handler = async (_event: QueuedEvent) => {
			await tick(40);
		};

		const queue = new SessionEventQueue(handler, logger);

		expect(queue.isProcessing("s1")).toBe(false);

		queue.enqueue(makeEvent("s1", "blocked"));

		// Processing should be true immediately
		expect(queue.isProcessing("s1")).toBe(true);

		await tick(80);

		expect(queue.isProcessing("s1")).toBe(false);
	});

	it("pendingCount returns correct count", async () => {
		const handler = async (_event: QueuedEvent) => {
			await tick(50);
		};

		const queue = new SessionEventQueue(handler, logger);

		expect(queue.pendingCount("s1")).toBe(0);

		queue.enqueue(makeEvent("s1", "turn_complete", "a"));
		queue.enqueue(makeEvent("s1", "turn_complete", "b"));
		queue.enqueue(makeEvent("s1", "turn_complete", "c"));

		// First event is already shifted out and being processed.
		// Two remain in the queue.
		await tick(5);
		expect(queue.pendingCount("s1")).toBe(2);

		await tick(200);
		expect(queue.pendingCount("s1")).toBe(0);
	});
});
