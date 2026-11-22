import { formatPath, parsePath, type PathSegment } from "ai-vision";
import type { McpClient, McpImage } from "./client.js";
import { errMessage } from "../shared/utils.js";
import { EnvironmentStopError } from "./attention-policy.js";

export type TestWindowMode = "owned" | "attached-created" | "attached-selected";
type RawCallOptions = { timeout?: number; maxLength?: number; allowNavigation?: boolean; hints?: "always" | "never"; value?: unknown };

interface WindowIdentity { index: number; windowId: number; }

export { EnvironmentStopError } from "./attention-policy.js";

/** Owns test-window selection, identity checks, and every path scoped by the runner. */
export class TestWindowOwner {
    private constructor(readonly mode: TestWindowMode, private readonly identity?: WindowIdentity) {}
    get index(): number | undefined { return this.identity?.index; }

    static async start(client: McpClient, attach: boolean, selector?: string): Promise<TestWindowOwner> {
        if (!attach) {
            const windowId = await client.call("windows[0].windowId");
            if (!Number.isSafeInteger(windowId)) throw new Error("The owned test window did not return a valid live identity.");
            return new TestWindowOwner("owned", { index: 0, windowId: windowId as number });
        }
        if (selector === undefined) {
            const identity = await client.call("windows.createTestWindow", []) as WindowIdentity;
            assertIdentityShape(identity);
            return new TestWindowOwner("attached-created", identity);
        }
        const result = await client.call("windows.selectTestWindow", [selector]) as WindowIdentity | { count: number };
        if (result && typeof result === "object" && "count" in result && typeof result.count === "number") {
            if (result.count === 0) throw new Error("--window matched 0 open windows.");
            throw new Error(`--window matched ${result.count} open windows; specify an index or a more specific title.`);
        }
        assertIdentityShape(result);
        return new TestWindowOwner("attached-selected", result);
    }

    scope(apiPath?: string): string | undefined {
        if (this.mode === "owned") return apiPath;
        const index = this.requireIdentity().index;
        const prefix: PathSegment[] = [{ type: "member", name: "windows" }, { type: "index", key: index }];
        if (!apiPath) return formatPath(prefix);
        const segments = parsePath(apiPath);
        const first = segments[0];
        if (first?.type === "member" && ["windows", "main", "guides"].includes(first.name)) return apiPath;
        return formatPath([...prefix, ...segments]);
    }

    async call(client: McpClient, apiPath?: string, args?: unknown, timeout?: number, maxLength?: number, dialog = false, allowNavigation = false): Promise<unknown> {
        return client.call(this.scope(apiPath), args, timeout, maxLength, dialog, allowNavigation, this.index);
    }

    async callText(client: McpClient, apiPath?: string, args?: unknown, timeout?: number, maxLength?: number, dialog = false, allowNavigation = false): Promise<string> {
        return client.callText(this.scope(apiPath), args, timeout, maxLength, dialog, allowNavigation, this.index);
    }

    async set(client: McpClient, apiPath: string, value: unknown, timeout?: number): Promise<unknown> {
        return client.set(this.scope(apiPath) ?? apiPath, value, timeout, this.index);
    }

    async image(client: McpClient, apiPath: string, args?: unknown, timeout?: number): Promise<McpImage | undefined> {
        return client.image(this.scope(apiPath) ?? apiPath, args, timeout);
    }

    async rawCall(client: McpClient, apiPath?: string, args?: unknown, options: RawCallOptions = {}) {
        return client.rawCall(this.scope(apiPath), args, options);
    }

    async assertIdentity(client: McpClient): Promise<void> {
        if (this.mode === "owned") return;
        const identity = this.requireIdentity();
        let current: unknown;
        try { current = await client.call(`windows[${identity.index}].windowId`); }
        catch (error) {
            const message = errMessage(error);
            if (message.includes("No item") || message.includes("does not exist")) throw new EnvironmentStopError("The test window was closed or replaced; the run stopped.");
            throw error;
        }
        if (current !== identity.windowId) throw new EnvironmentStopError("The test window was closed or replaced; the run stopped.");
    }

    async disposeCreatedWindow(client: McpClient): Promise<void> {
        if (this.mode !== "attached-created") return;
        const identity = this.requireIdentity();
        await this.assertIdentity(client);
        await client.call("windows.disposeTestWindow", [identity.index, identity.windowId]);
    }

    private requireIdentity(): WindowIdentity {
        if (!this.identity) throw new Error("The attached test window has not been selected.");
        return this.identity;
    }
}

function assertIdentityShape(value: unknown): asserts value is WindowIdentity {
    if (!value || typeof value !== "object" || !("index" in value) || !Number.isSafeInteger(value.index)
        || !("windowId" in value) || !Number.isSafeInteger(value.windowId)) {
        throw new Error("The selected test window did not return a valid live identity.");
    }
}
