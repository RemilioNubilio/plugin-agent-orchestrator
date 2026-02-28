/**
 * Lightweight per-agent-type metrics for observability.
 *
 * Self-contained tracker — no dependencies on PTYService state.
 *
 * @module services/agent-metrics
 */
export interface AgentMetrics {
    spawned: number;
    completed: number;
    completedViaFastPath: number;
    completedViaClassifier: number;
    stallCount: number;
    avgCompletionMs: number;
    totalCompletionMs: number;
}
export declare class AgentMetricsTracker {
    private metrics;
    /** Get (or lazily initialize) metrics for a given agent type. */
    get(agentType: string): AgentMetrics;
    /** Record a task completion and update rolling average duration. */
    recordCompletion(agentType: string, method: "fast-path" | "classifier", durationMs: number): void;
    /** Increment the stall counter for an agent type. */
    incrementStalls(agentType: string): void;
    /** Return a serializable copy of all metrics (for API endpoints). */
    getAll(): Record<string, Omit<AgentMetrics, "totalCompletionMs">>;
}
//# sourceMappingURL=agent-metrics.d.ts.map