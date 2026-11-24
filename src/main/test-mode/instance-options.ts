import path from "node:path";
import { isTestInstanceOption } from "../../ipc/test-host-protocol";

export interface TestInstanceOptions { port: number; logDirectory?: string; desktop?: string; }

export function parseTestInstanceOptions(args: string[]): { options?: TestInstanceOptions; remaining: string[] } {
    let found = false;
    let port: number | undefined;
    let logDirectory: string | undefined;
    let desktop: string | undefined;
    const remaining: string[] = [];
    for (const argument of args) {
        if (argument === "--test-instance") {
            if (found) throw new Error("Duplicate --test-instance option.");
            found = true;
        } else if (argument.startsWith("--test-mcp-port")) {
            if (port !== undefined || !argument.startsWith("--test-mcp-port=")) throw new Error("Invalid or duplicate --test-mcp-port option.");
            const value = argument.slice("--test-mcp-port=".length);
            port = Number(value);
            if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--test-mcp-port must be an integer from 1024 to 65535.");
        } else if (argument.startsWith("--test-log-dir")) {
            if (logDirectory !== undefined || !argument.startsWith("--test-log-dir=")) throw new Error("Invalid or duplicate --test-log-dir option.");
            const value = argument.slice("--test-log-dir=".length);
            if (!value || !path.isAbsolute(value)) throw new Error("--test-log-dir must contain an absolute folder path.");
            logDirectory = value;
        } else if (argument.startsWith("--test-desktop")) {
            if (desktop !== undefined || !argument.startsWith("--test-desktop=")) throw new Error("Invalid or duplicate --test-desktop option.");
            desktop = argument.slice("--test-desktop=".length);
            if (!desktop) throw new Error("--test-desktop requires a virtual desktop selector.");
        } else remaining.push(argument);
    }
    if (found !== (port !== undefined)) throw new Error("--test-instance and --test-mcp-port must be provided together.");
    if (logDirectory !== undefined && !found) throw new Error("--test-log-dir requires --test-instance.");
    if (desktop !== undefined && !found) throw new Error("--test-desktop requires --test-instance.");
    if (!found) return { remaining };
    if (port === undefined) throw new Error("--test-instance requires --test-mcp-port.");
    return { options: { port, ...(logDirectory === undefined ? {} : { logDirectory }), ...(desktop === undefined ? {} : { desktop }) }, remaining };
}

/** Remove test-instance options without validating them. Launch operands are read at module load
 *  (`launch-inputs.ts`), where a throw would abort the app with a load-error dialog; validation
 *  happens in `setupMainProcess`, which reports and exits cleanly. */
export function stripTestInstanceOptions(args: string[]): string[] {
    return args.filter((argument) => !isTestInstanceOption(argument));
}

export function hasTestInstanceOptions(args: string[]): boolean {
    return args.some(isTestInstanceOption);
}

/** A test instance quits when its last window closes, whatever the profile's close-to-tray
 *  setting, so the runner's graceful `window.close` lets the app save its session and exit. */
export function isTestInstance(): boolean {
    return hasTestInstanceOptions(process.argv);
}
