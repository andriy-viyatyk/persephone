import { IpcMainEvent } from "electron";
import type { ShellApi } from "../contracts/shell";
import { bindDomain } from "./endpoint-registry";
import { detectTerminal, openTerminalAt } from "../../main/terminal-launcher";

export function initShellHandlers(): void {
    bindDomain<ShellApi>({
        openTerminal: async (_event: IpcMainEvent, path: string, command: string) =>
            openTerminalAt(path, command),
        detectTerminal: async () => detectTerminal()
    });
}

