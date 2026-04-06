import { afterEach, describe, expect, it } from "bun:test";
import { buildSanitizedBaseEnv } from "../services/pty-spawn.js";

const ORIGINAL_TERM = process.env.TERM;
const ORIGINAL_COLORTERM = process.env.COLORTERM;

describe("buildSanitizedBaseEnv", () => {
  afterEach(() => {
    if (ORIGINAL_TERM === undefined) {
      delete process.env.TERM;
    } else {
      process.env.TERM = ORIGINAL_TERM;
    }

    if (ORIGINAL_COLORTERM === undefined) {
      delete process.env.COLORTERM;
    } else {
      process.env.COLORTERM = ORIGINAL_COLORTERM;
    }
  });

  it("upgrades TERM when the parent shell reports dumb", () => {
    process.env.TERM = "dumb";
    delete process.env.COLORTERM;

    const env = buildSanitizedBaseEnv();

    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
  });

  it("preserves an existing non-dumb TERM value", () => {
    process.env.TERM = "screen-256color";
    process.env.COLORTERM = "24bit";

    const env = buildSanitizedBaseEnv();

    expect(env.TERM).toBe("screen-256color");
    expect(env.COLORTERM).toBe("24bit");
  });
});
