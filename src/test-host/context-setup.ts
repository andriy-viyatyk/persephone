import path from "node:path";
import { pathToFileURL } from "node:url";
import type { McpClient } from "./client.js";
import type { TestContext } from "./context.js";
import type { TestIdentity } from "./test-identity.js";

export interface TestSetupDetails extends TestIdentity { profileDirectory: string; attach: boolean; }
export interface TestMcpAdapter { rawCall(path?: string, args?: unknown, options?: { timeout?: number; maxLength?: number }): Promise<unknown>; listTools(): Promise<unknown>; }
type SetupModule = (input: { context: TestContext; test: TestSetupDetails; getClient(): TestMcpAdapter }) => Record<string, unknown> | Promise<Record<string, unknown>>;

export async function loadContextSetup(modulePath: string | undefined): Promise<((context: TestContext, test: TestSetupDetails, getClient: () => McpClient) => Promise<TestContext>) | undefined> {
    if (!modulePath) return undefined;
    const absolute = path.resolve(modulePath);
    const imported = await import(pathToFileURL(absolute).href) as { default?: unknown; setup?: unknown };
    const setup = imported.default ?? imported.setup;
    if (typeof setup !== "function") throw new TypeError(`Test setup module ${absolute} must export a default function or named setup function.`);
    return async (context, test, getClient) => {
        const adapter = (): TestMcpAdapter => {
            const client = getClient();
            return { rawCall: (apiPath, args, options) => client.rawCall(apiPath, args, options), listTools: () => client.listTools() };
        };
        const extensions = await (setup as SetupModule)({ context, test, getClient: adapter });
        if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) throw new TypeError("Test setup must return an object of context members.");
        for (const key of Object.keys(extensions)) {
            if (key in context || key === "_state") throw new TypeError(`Test setup cannot replace context member ${JSON.stringify(key)}.`);
        }
        return Object.assign(context, extensions);
    };
}
