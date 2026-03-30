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

export class SwarmHistory {
	private filePath: string;
	private pendingTruncation = false;
	/** In-memory counter to avoid reading the file on every append. */
	private appendCount = 0;
	/** Entries buffered during truncation to prevent data loss. */
	private truncationBuffer: HistoryEntry[] = [];

	constructor(stateDir?: string) {
		const dir =
			stateDir ||
			process.env.MILADY_STATE_DIR ||
			process.env.ELIZA_STATE_DIR ||
			path.join(os.homedir(), ".milady");
		this.filePath = path.join(dir, "swarm-history.jsonl");
	}

	async append(entry: HistoryEntry): Promise<void> {
		try {
			// If truncation is in progress, buffer the entry to avoid race
			if (this.pendingTruncation) {
				this.truncationBuffer.push(entry);
				return;
			}

			const dir = path.dirname(this.filePath);
			await fs.mkdir(dir, { recursive: true });
			await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf-8");
			this.appendCount++;

			// Only check truncation after enough appends to potentially exceed MAX_ENTRIES
			if (this.appendCount >= MAX_ENTRIES - TRUNCATE_TO) {
				const content = await fs.readFile(this.filePath, "utf-8");
				const lineCount = content.split("\n").filter((l) => l.trim() !== "").length;
				if (lineCount > MAX_ENTRIES) {
					await this.truncate(TRUNCATE_TO);
				}
			}
		} catch {
			// Fire-and-forget: never throw from append
		}
	}

	async readAll(): Promise<HistoryEntry[]> {
		try {
			const content = await fs.readFile(this.filePath, "utf-8");
			const entries: HistoryEntry[] = [];
			for (const line of content.split("\n")) {
				if (line.trim() === "") continue;
				try {
					entries.push(JSON.parse(line) as HistoryEntry);
				} catch {
					console.warn(`[swarm-history] skipping corrupted line: ${line.slice(0, 80)}`);
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

	private async truncate(maxEntries: number): Promise<void> {
		this.pendingTruncation = true;
		try {
			const entries = await this.readAll();
			const kept = entries.slice(-maxEntries);
			const content = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";
			await fs.writeFile(this.filePath, content, "utf-8");
			this.appendCount = 0;

			// Flush any entries that were buffered during truncation
			if (this.truncationBuffer.length > 0) {
				const buffered = this.truncationBuffer.splice(0);
				const lines = buffered.map((e) => JSON.stringify(e)).join("\n") + "\n";
				await fs.appendFile(this.filePath, lines, "utf-8");
				this.appendCount = buffered.length;
			}
		} finally {
			this.pendingTruncation = false;
		}
	}
}
