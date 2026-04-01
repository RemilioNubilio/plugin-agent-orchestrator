import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createScratchDir } from "../actions/coding-task-helpers";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-dir-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const mockRuntime = (codingDir?: string) =>
	({
		getSetting: (key: string) =>
			key === "PARALLAX_CODING_DIRECTORY" ? codingDir : undefined,
	}) as unknown as import("@elizaos/core").IAgentRuntime;

describe("createScratchDir", () => {
	it("creates UUID-based dir without coding dir", () => {
		// Explicitly pass empty string to override any config file setting
		const runtime = mockRuntime("");
		const dir = createScratchDir(runtime);
		expect(dir).toContain(path.join(".milady", "workspaces"));
		expect(fs.existsSync(dir)).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("creates named dir under coding directory when set", () => {
		const runtime = mockRuntime(tmpDir);
		const dir = createScratchDir(runtime, "my-todo-app");
		expect(dir).toBe(path.join(tmpDir, "my-todo-app"));
		expect(fs.existsSync(dir)).toBe(true);
	});

	it("sanitizes label to safe dirname", () => {
		const runtime = mockRuntime(tmpDir);
		const dir = createScratchDir(runtime, "Build a Todo App!!!");
		expect(path.basename(dir)).toBe("build-a-todo-app");
		expect(fs.existsSync(dir)).toBe(true);
	});

	it("handles collision by appending -2", () => {
		const runtime = mockRuntime(tmpDir);
		// Create the first one
		createScratchDir(runtime, "my-app");
		// Second should get -2
		const dir2 = createScratchDir(runtime, "my-app");
		expect(path.basename(dir2)).toBe("my-app-2");
		expect(fs.existsSync(dir2)).toBe(true);
	});

	it("falls back to scratch-{shortid} without label", () => {
		const runtime = mockRuntime(tmpDir);
		const dir = createScratchDir(runtime, undefined);
		expect(path.basename(dir)).toMatch(/^scratch-[a-f0-9]{8}$/);
	});

	it("falls back to UUID dir when coding dir is empty string", () => {
		const runtime = mockRuntime("");
		const dir = createScratchDir(runtime, "some-label");
		expect(dir).toContain(path.join(".milady", "workspaces"));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("expands ~ in coding directory path", () => {
		const runtime = mockRuntime(`~/test-scratch-${Date.now()}`);
		const dir = createScratchDir(runtime, "tilde-test");
		expect(dir).toContain(os.homedir());
		expect(dir).not.toContain("~");
		expect(fs.existsSync(dir)).toBe(true);
		fs.rmSync(path.dirname(dir), { recursive: true, force: true });
	});
});
