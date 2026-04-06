/**
 * Tests for config-env.ts — readConfigEnvKey / readConfigCloudKey
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readConfigCloudKey,
  readConfigEnvKey,
} from "../services/config-env.js";

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
    if (origElizaStateDir !== undefined)
      process.env.ELIZA_STATE_DIR = origElizaStateDir;
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

  describe("readConfigEnvKey", () => {
    it("should read a key from the env section", () => {
      writeConfig({ env: { PARALLAX_LLM_PROVIDER: "cloud" } });
      expect(readConfigEnvKey("PARALLAX_LLM_PROVIDER")).toBe("cloud");
    });

    it("should return undefined for missing key", () => {
      writeConfig({ env: { FOO: "bar" } });
      expect(readConfigEnvKey("MISSING")).toBeUndefined();
    });

    it("should return undefined when no config file exists", () => {
      expect(readConfigEnvKey("ANYTHING")).toBeUndefined();
    });

    it("should return undefined for non-string values", () => {
      writeConfig({ env: { NUM: 123 } });
      expect(readConfigEnvKey("NUM")).toBeUndefined();
    });
  });

  describe("readConfigCloudKey", () => {
    it("should read apiKey from the cloud section", () => {
      writeConfig({ cloud: { apiKey: "eliza_testkey123" } });
      expect(readConfigCloudKey("apiKey")).toBe("eliza_testkey123");
    });

    it("should return undefined when cloud section missing", () => {
      writeConfig({ env: {} });
      expect(readConfigCloudKey("apiKey")).toBeUndefined();
    });

    it("should return undefined for non-string values", () => {
      writeConfig({ cloud: { apiKey: 42 } });
      expect(readConfigCloudKey("apiKey")).toBeUndefined();
    });
  });
});
