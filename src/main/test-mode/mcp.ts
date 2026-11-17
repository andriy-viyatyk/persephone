import { setMcpEnabled } from "../mcp-http-server";
import type { TestInstanceOptions } from "./instance-options";

export class TestModeMcp {
    private forcedPort?: number;

    constructor(options?: TestInstanceOptions) { this.forcedPort = options?.port; }

    configure(options?: TestInstanceOptions): void { this.forcedPort = options?.port; }

    async start(): Promise<void> {
        if (this.forcedPort !== undefined) await setMcpEnabled(true, this.forcedPort);
    }

    async apply(enabled: boolean, port?: number): Promise<void> {
        await setMcpEnabled(this.forcedPort === undefined ? enabled : true, this.forcedPort ?? port);
    }
}

const activeTestModeMcp = new TestModeMcp();

export function configureTestModeMcp(options?: TestInstanceOptions): void {
    activeTestModeMcp.configure(options);
}

export function startTestModeMcp(): Promise<void> {
    return activeTestModeMcp.start();
}

export function applyTestModeMcp(enabled: boolean, port?: number): Promise<void> {
    return activeTestModeMcp.apply(enabled, port);
}
