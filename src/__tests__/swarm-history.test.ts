import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SwarmHistory, type HistoryEntry } from "../services/swarm-history";

let tmpDir: string;

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		timestamp: Date.now(),
		type: "task_registered",
		sessionId: "sess-1",
		label: "test-agent",
		agentType: "claude",
		workdir: "/tmp/test",
		...overrides,
	};
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarm-history-test-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true });
});

describe("SwarmHistory", () => {
	it("append creates file and writes entry", async () => {
		const history = new SwarmHistory(tmpDir);
		const entry = makeEntry();
		await history.append(entry);

		const filePath = path.join(tmpDir, "swarm-history.jsonl");
		const content = await fs.readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0])).toEqual(entry);
	});

	it("readAll returns entries in order", async () => {
		const history = new SwarmHistory(tmpDir);
		const e1 = makeEntry({ sessionId: "a", timestamp: 1 });
		const e2 = makeEntry({ sessionId: "b", timestamp: 2 });
		const e3 = makeEntry({ sessionId: "c", timestamp: 3 });

		await history.append(e1);
		await history.append(e2);
		await history.append(e3);

		const entries = await history.readAll();
		expect(entries).toHaveLength(3);
		expect(entries[0].sessionId).toBe("a");
		expect(entries[1].sessionId).toBe("b");
		expect(entries[2].sessionId).toBe("c");
	});

	it("readAll returns empty array for missing file", async () => {
		const history = new SwarmHistory(path.join(tmpDir, "nonexistent"));
		const entries = await history.readAll();
		expect(entries).toEqual([]);
	});

	it("readAll skips corrupted lines", async () => {
		const filePath = path.join(tmpDir, "swarm-history.jsonl");
		const validEntry = makeEntry({ sessionId: "valid" });
		const content = [
			JSON.stringify(validEntry),
			"not-valid-json{{{",
			"",
			JSON.stringify(makeEntry({ sessionId: "also-valid" })),
		].join("\n");
		await fs.writeFile(filePath, content, "utf-8");

		const history = new SwarmHistory(tmpDir);
		const entries = await history.readAll();
		expect(entries).toHaveLength(2);
		expect(entries[0].sessionId).toBe("valid");
		expect(entries[1].sessionId).toBe("also-valid");
	});

	it("getLastUsedRepo returns most recent repo", async () => {
		const history = new SwarmHistory(tmpDir);
		await history.append(makeEntry({ repo: "repo-a", timestamp: 1 }));
		await history.append(makeEntry({ timestamp: 2 }));
		await history.append(makeEntry({ repo: "repo-b", timestamp: 3 }));
		await history.append(makeEntry({ timestamp: 4 }));

		const repo = await history.getLastUsedRepo();
		expect(repo).toBe("repo-b");
	});

	it("getLastUsedRepo returns undefined when no repo entries", async () => {
		const history = new SwarmHistory(tmpDir);
		await history.append(makeEntry());
		await history.append(makeEntry());

		const repo = await history.getLastUsedRepo();
		expect(repo).toBeUndefined();
	});

	it("truncate keeps only last N entries when file grows large", async () => {
		const history = new SwarmHistory(tmpDir);

		// Write 151 entries to trigger truncation (threshold is >150)
		for (let i = 0; i < 151; i++) {
			await history.append(makeEntry({ sessionId: `sess-${i}`, timestamp: i }));
		}

		const entries = await history.readAll();
		// After truncation, should have 100 entries (the last 100)
		expect(entries.length).toBeLessThanOrEqual(101);
		expect(entries.length).toBeGreaterThanOrEqual(100);

		// The kept entries should be the most recent ones
		const lastEntry = entries[entries.length - 1];
		expect(lastEntry.sessionId).toBe("sess-150");
	});

	it("append is fire-and-forget safe (doesn't throw)", async () => {
		// Use a path that will cause write failures (file inside nonexistent deeply nested path
		// with a file acting as directory)
		const blocker = path.join(tmpDir, "blocker");
		await fs.writeFile(blocker, "I am a file", "utf-8");
		// Now try to use "blocker" as a directory — mkdir should fail
		const history = new SwarmHistory(path.join(blocker, "deep", "nested"));

		// This should not throw
		await history.append(makeEntry());
	});
});
