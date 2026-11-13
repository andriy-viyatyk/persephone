import type { TimeoutExemptions } from "../timeout-exemptions";
import type { EventObject } from "./event-object";

export interface McpMnemeApi {
    setMcpEnabled: (enabled: boolean, port?: number) => Promise<void>;
    setMainScriptsEnabled: (enabled: boolean) => Promise<void>;
    setWindowsSsoEnabled: (enabled: boolean) => Promise<void>;
    getMcpStatus: () => Promise<McpStatus>;
    setMnemeEnabled: (enabled: boolean, port?: number) => Promise<MnemeStatus>;
    restartMneme: (port?: number) => Promise<MnemeStatus>;
    getMnemeStatus: () => Promise<MnemeStatus>;
}

export interface McpMnemeEvents {
    eMcpStatusChanged: EventObject<McpStatus>;
    eMnemeStatusChanged: EventObject<MnemeStatus>;
}

export interface McpStatus {
    running: boolean;
    url: string;
    clientCount: number;
    inAppAgentCount: number;
}

export interface MnemeStatus {
    running: boolean;
    url: string;
    /** Set only on a failed start or an unexpected exit; drives the error toast. */
    error?: string;
}


export const mcpMnemeTimeoutExemptions = {
    setMcpEnabled: "MCP server lifecycle has no request-level bound.",
    restartMneme: "Restart waits for the prior process exit and sidecar readiness.",
    setMnemeEnabled: "Sidecar readiness can take up to 20 seconds plus queue work.",
} satisfies TimeoutExemptions<McpMnemeApi>;
