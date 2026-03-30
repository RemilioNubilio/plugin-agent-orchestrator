import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export type HistoryEntryType =
	| "task_registered"
	| "task_completed"
	| "task_stopped"
	| "task_error"
	| "key_decision";

export interface HistoryEntry {
	timestamp: number;
	type: HistoryEntryType;
	sessionId: string;
	label: string;
	agentType: string;
	repo?: string;
	workdir: string;
	originalTask?: string;
	completionSummary?: string;
	reasoning?: string;
}

const MAX_ENTRIES = 150;
const TRUNCATE_TO = 100;

/**
 * Simple async mutex — serializes all file mutations so concurrent
 * append() and truncate() calls don't interleave reads and writes.
 */
class WriteMutex {
	private queue: Array<() => void> = [];
	private locked = false;

	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.locked = false;
		}
	}
}

export class SwarmHistory {
	private filePath: string;
	/** In-memory counter to avoid reading the file on every append. */
	private appendCount = 0;
	/** Serializes all file mutations. */
	private mutex = new WriteMutex();

	constructor(stateDir?: string) {
		const dir =
			stateDir ||
			process.env.MILADY_STATE_DIR ||
			process.env.ELIZA_STATE_DIR ||
			path.join(os.homedir(), ".milady");
		this.filePath = path.join(dir, "swarm-history.jsonl");
	}

	async append(entry: HistoryEntry): Promise<void> {
		await this.mutex.acquire();
		try {
			const dir = path.dirname(this.filePath);
			await fs.mkdir(dir, { recursive: true });
			await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf-8");
			this.appendCount++;

			// Only check truncation after enough appends to potentially exceed MAX_ENTRIES
			if (this.appendCount >= MAX_ENTRIES - TRUNCATE_TO) {
				const content = await fs.readFile(this.filePath, "utf-8");
				const lineCount = content.split("\n").filter((l) => l.trim() !== "").length;
				if (lineCount > MAX_ENTRIES) {
					await this.truncateInner(TRUNCATE_TO);
				}
			}
		} catch (err) {
			console.error("[swarm-history] append failed:", err);
			throw err;
		} finally {
			this.mutex.release();
		}
	}

	async readAll(): Promise<HistoryEntry[]> {
		try {
			const content = await fs.readFile(this.filePath, "utf-8");
			const entries: HistoryEntry[] = [];
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].trim() === "") continue;
				try {
					entries.push(JSON.parse(lines[i]) as HistoryEntry);
				} catch {
					console.warn(`[swarm-history] skipping corrupted line at index ${i} (length=${lines[i].length})`);
				}
			}
			return entries;
		} catch (err: unknown) {
			if (
				err instanceof Error &&
				"code" in err &&
				(err as NodeJS.ErrnoException).code === "ENOENT"
			) {
				return [];
			}
			console.error("[swarm-history] readAll failed:", err);
			return [];
		}
	}

	async getLastUsedRepo(): Promise<string | undefined> {
		const entries = await this.readAll();
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i].repo) {
				return entries[i].repo;
			}
		}
		return undefined;
	}

	/** Called while holding the mutex — no external callers. */
	private async truncateInner(maxEntries: number): Promise<void> {
		const entries = await this.readAll();
		// If readAll returned empty but the file exists, a read error occurred —
		// don't overwrite the file or we'd erase valid history.
		if (entries.length === 0) {
			try {
				await fs.stat(this.filePath);
				// File exists but readAll returned [] — read error, bail
				console.error("[swarm-history] truncate aborted: file exists but readAll returned empty");
				return;
			} catch {
				// File doesn't exist — nothing to truncate
				return;
			}
		}
		const kept = entries.slice(-maxEntries);
		const content = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";
		await fs.writeFile(this.filePath, content, "utf-8");
		this.appendCount = 0;
	}
}
