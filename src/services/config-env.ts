/**
 * Read settings from the eliza/milady config file's env section.
 *
 * runtime.getSetting() checks character.settings but NOT the config's env
 * section which is where the UI writes settings. This reads the config
 * file directly so settings take effect without restart.
 *
 * @module services/config-env
 */

import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function readConfigEnvKey(key: string): string | undefined {
  try {
    const configPath = path.join(
      process.env.MILADY_STATE_DIR ??
        process.env.ELIZA_STATE_DIR ??
        path.join(os.homedir(), ".milady"),
      process.env.ELIZA_NAMESPACE === "milady" || !process.env.ELIZA_NAMESPACE
        ? "milady.json"
        : `${process.env.ELIZA_NAMESPACE}.json`,
    );
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const val = config?.env?.[key];
    return typeof val === "string" ? val : undefined;
  } catch {
    return undefined;
  }
}
