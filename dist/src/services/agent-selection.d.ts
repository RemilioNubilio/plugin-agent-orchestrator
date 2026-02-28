/**
 * Dynamic agent selection strategy.
 *
 * Chooses which coding-agent CLI to spawn when the caller does not
 * specify an explicit `agentType`.
 *
 *   - **fixed**  — always returns `config.fixedAgentType`
 *   - **ranked** — scores each installed agent on success rate,
 *                  stall frequency, and completion speed, then
 *                  returns the highest-scoring one
 *
 * @module services/agent-selection
 */
import type { AdapterType, PreflightResult } from "coding-agent-adapters";
export type AgentSelectionStrategy = "fixed" | "ranked";
/** Subset of AgentMetrics fields used for scoring. */
export interface AgentScoreInput {
    spawned: number;
    completed: number;
    stallCount: number;
    avgCompletionMs: number;
}
export interface AgentSelectionConfig {
    strategy: AgentSelectionStrategy;
    fixedAgentType: AdapterType;
}
export interface AgentSelectionContext {
    config: AgentSelectionConfig;
    /** Per-agent-type metrics snapshot (may be empty). */
    metrics: Record<string, AgentScoreInput>;
    /** Preflight results — only the `installed` ones are candidates. */
    installedAgents: PreflightResult[];
}
/**
 * Compute a 0–1 score for a single agent based on its metrics.
 *
 * - `successRate`  = completed / spawned  (0.5 neutral prior when no data)
 * - `volumeWeight` = min(1, spawned / 5)  — blends toward neutral at low N
 * - `stallPenalty`  = (stallCount / spawned) * 0.3
 * - `speedPenalty`  = min(avgCompletionMs / 300_000, 1) * 0.1  — weak tiebreaker
 *
 * Cold-start (no spawns): returns 0.5 so all agents are equal.
 */
export declare function computeAgentScore(metrics: AgentScoreInput | undefined): number;
/**
 * Select the best agent type given the current strategy, metrics, and
 * installed agents.
 *
 * Explicit user choice (`params.agentType`) should be resolved by the
 * caller *before* reaching this function.
 */
export declare function selectAgentType(ctx: AgentSelectionContext): AdapterType;
//# sourceMappingURL=agent-selection.d.ts.map