import { IpcMainEvent } from "electron";
import { setWindowsSsoEnabled } from "../../main/windows-sso";
import { getPrivateMcpClientCount } from "../../main/mcp/private-session-endpoints";
import { setMcpEnabled, isMcpHttpServerRunning, getMcpUrl, getMcpClientCount } from "../../main/mcp-http-server";
import { setMnemeEnabled, restartMneme, getMnemeStatus } from "../../main/mneme-service";
import { setMainScriptsEnabled as updateMainScriptsEnabled } from "../../main/mcp/ai-vision/main-script-gate";
import type { McpMnemeApi } from "../contracts/mcp-mneme";
import { bindDomain } from "./endpoint-registry";

export function initMcpMnemeHandlers(): void {
    bindDomain<McpMnemeApi>({
        setMcpEnabled: async (_event: IpcMainEvent, enabled: boolean, port?: number) => setMcpEnabled(enabled, port),
        setMainScriptsEnabled: async (_event: IpcMainEvent, enabled: boolean) => updateMainScriptsEnabled(enabled),
        setWindowsSsoEnabled: async (_event: IpcMainEvent, enabled: boolean) => setWindowsSsoEnabled(enabled),
        getMcpStatus: async () => ({
            running: isMcpHttpServerRunning(),
            url: getMcpUrl(),
            clientCount: getMcpClientCount(),
            inAppAgentCount: getPrivateMcpClientCount(),
        }),
        setMnemeEnabled: async (_event: IpcMainEvent, enabled: boolean, port?: number) =>
            setMnemeEnabled(enabled, port),
        restartMneme: async (_event: IpcMainEvent, port?: number) => restartMneme(port),
        getMnemeStatus: async () => getMnemeStatus()
    });
}

