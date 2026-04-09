import { ClaudeSession } from "./ClaudeSession";

/**
 * Create the `ai` namespace object exposed to scripts.
 *
 * Provides AI model integration constructors.
 * Future: may also expose ClaudeAgent (agent SDK wrapper).
 */
export function createAiNamespace() {
    return {
        ClaudeSession,
    };
}
