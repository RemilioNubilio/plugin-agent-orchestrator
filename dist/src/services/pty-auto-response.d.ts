/**
 * Auto-response rule management for PTY sessions.
 *
 * Contains logic for pushing default auto-response rules per agent type
 * and handling Gemini authentication flow.
 *
 * @module services/pty-auto-response
 */
import type { IAgentRuntime } from "@elizaos/core";
import type { BunCompatiblePTYManager, PTYManager } from "pty-manager";
export interface AutoResponseContext {
    manager: PTYManager | BunCompatiblePTYManager;
    usingBunWorker: boolean;
    runtime: IAgentRuntime;
    log: (msg: string) => void;
}
/**
 * Push session-specific auto-response rules that depend on runtime config.
 * Trust prompts, update notices, and other static rules are handled by
 * adapter built-in rules (coding-agent-adapters). This only pushes rules
 * that need runtime values (e.g. API keys).
 */
export declare function pushDefaultRules(ctx: AutoResponseContext, sessionId: string, agentType: string): Promise<void>;
/**
 * Handle Gemini authentication when login_required fires.
 * Sends /auth to start the auth flow — auto-response rules
 * then handle menu selection and API key input.
 */
export declare function handleGeminiAuth(ctx: AutoResponseContext, sessionId: string, sendKeysToSession: (sessionId: string, keys: string | string[]) => Promise<void>): Promise<void>;
//# sourceMappingURL=pty-auto-response.d.ts.map