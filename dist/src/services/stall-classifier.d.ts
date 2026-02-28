/**
 * Stall classification subsystem — determines what a "stalled" coding agent
 * session is doing (finished, waiting for input, still working, or errored).
 *
 * Extracted as standalone functions that receive dependencies as parameters,
 * making them easy to test without coupling to PTYService.
 *
 * @module services/stall-classifier
 */
import { type IAgentRuntime } from "@elizaos/core";
import { type StallClassification } from "pty-manager";
import type { AgentMetricsTracker } from "./agent-metrics.js";
/** Everything the classifier needs, passed in from PTYService. */
export interface StallClassifierContext {
    sessionId: string;
    recentOutput: string;
    agentType: string;
    buffers: Map<string, string[]>;
    traceEntries: Array<string | Record<string, unknown>>;
    runtime: IAgentRuntime;
    manager: {
        get(id: string): {
            startedAt?: string | Date;
        } | null | undefined;
    } | null;
    metricsTracker: AgentMetricsTracker;
    /** Write debug snapshots to ~/.milady/debug/ on stall (default: false) */
    debugSnapshots?: boolean;
    log: (msg: string) => void;
}
/**
 * Build the LLM system prompt used to classify stalled output.
 */
export declare function buildStallClassificationPrompt(agentType: string, sessionId: string, output: string): string;
/**
 * Write a debug snapshot to ~/.milady/debug/ for offline stall analysis.
 */
export declare function writeStallSnapshot(sessionId: string, agentType: string, recentOutput: string, effectiveOutput: string, buffers: Map<string, string[]>, traceEntries: Array<string | Record<string, unknown>>, log: (msg: string) => void): Promise<void>;
/**
 * Main stall classification logic. Determines what a stalled session is doing
 * by checking the buffer, building a prompt, and asking the LLM.
 */
export declare function classifyStallOutput(ctx: StallClassifierContext): Promise<StallClassification | null>;
//# sourceMappingURL=stall-classifier.d.ts.map