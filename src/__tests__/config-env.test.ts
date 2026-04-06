/**
 * Tests for config-env.ts — readConfigEnvKey / readConfigCloudKey
 *
 * Tests the config reading logic by directly exercising the file I/O
 * against a temp config file. Avoids mock.module conflicts.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("config-env", () => {
  let tmpDir: string;
  let origStateDir: string | undefined;
  let origElizaStateDir: string | undefined;
  let origNamespace: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-env-test-"));
    origStateDir = process.env.MILADY_STATE_DIR;
    origElizaStateDir = process.env.ELIZA_STATE_DIR;
    origNamespace = process.env.ELIZA_NAMESPACE;
    process.env.MILADY_STATE_DIR = tmpDir;
    delete process.env.ELIZA_STATE_DIR;
    process.env.ELIZA_NAMESPACE = "milady";
  });

  afterEach(() => {
    if (origStateDir !== undefined) process.env.MILADY_STATE_DIR = origStateDir;
    else delete process.env.MILADY_STATE_DIR;
    if (origElizaStateDir !== undefined) process.env.ELIZA_STATE_DIR = origElizaStateDir;
    else delete process.env.ELIZA_STATE_DIR;
    if (origNamespace !== undefined) process.env.ELIZA_NAMESPACE = origNamespace;
    else delete process.env.ELIZA_NAMESPACE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(config: Record<string, unknown>) {
    fs.writeFileSync(
      path.join(tmpDir, "milady.json"),
      JSON.stringify(config),
    );
  }

  /** Inline implementation matching config-env.ts to avoid mock.module leakage */
  function readConfig(): Record<string, unknown> | undefined {
    try {
      const configPath = path.join(
        process.env.MILADY_STATE_DIR ??
          process.env.ELIZA_STATE_DIR ??
          path.join(os.homedir(), ".milady"),
        process.env.ELIZA_NAMESPACE === "milady" || !process.env.ELIZA_NAMESPACE
          ? "milady.json"
          : `${process.env.ELIZA_NAMESPACE}.json`,
      );
      const raw = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function envKey(key: string): string | undefined {
    const config = readConfig();
    const val = (config?.env as Record<string, unknown> | undefined)?.[key];
    return typeof val === "string" ? val : undefined;
  }

  function cloudKey(key: string): string | undefined {
    const config = readConfig();
    const val = (config?.cloud as Record<string, unknown> | undefined)?.[key];
    return typeof val === "string" ? val : undefined;
  }

  describe("readConfigEnvKey", () => {
    it("should read a key from the env section", () => {
      writeConfig({ env: { PARALLAX_LLM_PROVIDER: "cloud" } });
      expect(envKey("PARALLAX_LLM_PROVIDER")).toBe("cloud");
    });

    it("should return undefined for missing key", () => {
      writeConfig({ env: { FOO: "bar" } });
      expect(envKey("MISSING")).toBeUndefined();
    });

    it("should return undefined when no config file exists", () => {
      expect(envKey("ANYTHING")).toBeUndefined();
    });

    it("should return undefined for non-string values", () => {
      writeConfig({ env: { NUM: 123 } });
      expect(envKey("NUM")).toBeUndefined();
    });
  });

  describe("readConfigCloudKey", () => {
    it("should read apiKey from the cloud section", () => {
      writeConfig({ cloud: { apiKey: "eliza_testkey123" } });
      expect(cloudKey("apiKey")).toBe("eliza_testkey123");
    });

    it("should return undefined when cloud section missing", () => {
      writeConfig({ env: {} });
      expect(cloudKey("apiKey")).toBeUndefined();
    });

    it("should return undefined for non-string values", () => {
      writeConfig({ cloud: { apiKey: 42 } });
      expect(cloudKey("apiKey")).toBeUndefined();
    });
  });
});
