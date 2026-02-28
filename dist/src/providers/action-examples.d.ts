/**
 * Provider that injects structured action call examples into the prompt context.
 *
 * ElizaOS core only shows exampleCalls from its static action-docs registry,
 * which doesn't include custom plugin actions. This provider bridges the gap
 * by formatting our coding agent action examples in the same structured format
 * the model sees for core actions.
 *
 * @module providers/action-examples
 */
import type { Provider } from "@elizaos/core";
export declare const codingAgentExamplesProvider: Provider;
//# sourceMappingURL=action-examples.d.ts.map