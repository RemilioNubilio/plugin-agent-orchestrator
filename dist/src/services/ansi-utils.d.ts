/**
 * ANSI/terminal utility functions for processing PTY output.
 *
 * Pure functions — no state, no dependencies beyond the standard library.
 *
 * @module services/ansi-utils
 */
/**
 * Strip ANSI escape sequences from raw terminal output for readable text.
 * Replaces cursor-forward codes with spaces (TUI uses these instead of actual spaces).
 */
export declare function stripAnsi(raw: string): string;
/**
 * Clean terminal output for display in chat messages.
 *
 * Goes beyond {@link stripAnsi} by also removing:
 * - Unicode spinner/box-drawing/decorative characters from CLI TUIs
 * - Lines that are only loading/thinking status text
 * - Spinner status bar metadata (token counts, timing)
 * - Consecutive blank lines (collapsed to one)
 */
export declare function cleanForChat(raw: string): string;
/**
 * Extract meaningful artifacts (PR URLs, commit hashes, key results) from raw
 * terminal output.  Returns a compact summary suitable for chat messages,
 * without dumping raw TUI output.
 */
export declare function extractCompletionSummary(raw: string): string;
/**
 * Extract a dev server URL from recent terminal output, if present.
 *
 * Looks for common patterns like:
 *   - http://localhost:3000
 *   - http://127.0.0.1:8080
 *   - http://0.0.0.0:5173
 *   - https://localhost:4200
 *
 * Returns the first match, or null if no dev server URL is found.
 */
export declare function extractDevServerUrl(raw: string): string | null;
/**
 * Capture the agent's output since the last task was sent, cleaned for chat display.
 * Returns readable text with TUI noise removed, or empty string if no marker exists.
 *
 * Mutates `markers` by deleting the entry for `sessionId` after capture.
 */
export declare function captureTaskResponse(sessionId: string, buffers: Map<string, string[]>, markers: Map<string, number>): string;
//# sourceMappingURL=ansi-utils.d.ts.map