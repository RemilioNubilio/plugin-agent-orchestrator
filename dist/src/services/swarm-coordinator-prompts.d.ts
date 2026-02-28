/**
 * Prompt construction and response parsing for the Swarm Coordinator's
 * LLM-driven coordination decisions.
 *
 * Pure functions — no side effects, easy to test.
 * Pattern follows stall-classifier.ts:buildStallClassificationPrompt().
 *
 * @module services/swarm-coordinator-prompts
 */
/** Per-session task context provided to the LLM for decision-making. */
export interface TaskContextSummary {
    sessionId: string;
    agentType: string;
    label: string;
    originalTask: string;
    workdir: string;
    repo?: string;
}
/** A previous coordination decision, included for context continuity. */
export interface DecisionHistoryEntry {
    event: string;
    promptText: string;
    action: string;
    response?: string;
    reasoning: string;
}
/** Parsed LLM response for a coordination decision. */
export interface CoordinationLLMResponse {
    action: "respond" | "escalate" | "ignore" | "complete";
    /** Text to send (for action=respond with plain text input). */
    response?: string;
    /** Whether to use sendKeysToSession instead of sendToSession. */
    useKeys?: boolean;
    /** Key sequence to send (for TUI interactions). e.g. ["enter"] or ["down","enter"]. */
    keys?: string[];
    /** LLM's reasoning for the decision. */
    reasoning: string;
}
/**
 * Build the LLM prompt for making a coordination decision about a blocked agent.
 */
export declare function buildCoordinationPrompt(taskCtx: TaskContextSummary, promptText: string, recentOutput: string, decisionHistory: DecisionHistoryEntry[]): string;
/**
 * Build the LLM prompt for checking on an idle session that hasn't
 * produced any events for a while.
 */
export declare function buildIdleCheckPrompt(taskCtx: TaskContextSummary, recentOutput: string, idleMinutes: number, idleCheckNumber: number, maxIdleChecks: number, decisionHistory: DecisionHistoryEntry[]): string;
/**
 * Build the LLM prompt for assessing whether a completed turn means the
 * overall task is done, or if the agent needs more turns.
 *
 * Called when the adapter detects "task_complete" (agent finished a turn and
 * returned to the idle prompt). The LLM decides whether to stop the session
 * or send a follow-up instruction.
 */
export declare function buildTurnCompletePrompt(taskCtx: TaskContextSummary, turnOutput: string, decisionHistory: DecisionHistoryEntry[]): string;
/**
 * Parse the LLM's coordination response from raw text output.
 * Returns null if the response is invalid or unparseable.
 */
export declare function parseCoordinationResponse(llmOutput: string): CoordinationLLMResponse | null;
//# sourceMappingURL=swarm-coordinator-prompts.d.ts.map