import path from "node:path";
import { isTestInstanceOption } from "../../ipc/test-host-protocol";

export interface TestControllerArguments {
    testPath: string;
    attach: boolean;
    cwd: string;
    logFile?: string;
    logDirectory?: string;
    rerunFailed: boolean;
    testSelection?: string;
    testSetup?: string;
    with: string[];
    timeoutScale: number;
    keepOpen: boolean;
    mcpPort?: number;
}

export function hasTestControllerArguments(args: string[]): boolean {
    return args.some((argument) => argument === "--test" || argument.startsWith("--test=") || argument === "--attach"
        || argument === "--with" || argument.startsWith("--with=") || argument === "--keep-open"
        || argument === "--mcp-port" || argument.startsWith("--mcp-port=") || argument === "--timeout-scale"
        || argument.startsWith("--timeout-scale=") || (argument.startsWith("--test-") && !isTestInstanceOption(argument)));
}

export function parseTestControllerArguments(args: string[], cwd = process.cwd()): TestControllerArguments | undefined {
    if (!hasTestControllerArguments(args)) return undefined;
    let testPath: string | undefined;
    let attach = false;
    let logFile: string | undefined;
    let logDirectory: string | undefined;
    let rerunFailed = false;
    let testSelection: string | undefined;
    let testSetup: string | undefined;
    let timeoutScale = 1;
    let keepOpen = false;
    let mcpPort: number | undefined;
    let withTags: string[] = [];
    let withSeen = false;
    let timeoutScaleSeen = false;
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--test" || argument.startsWith("--test=")) {
            if (testPath !== undefined) throw new Error("Duplicate --test option.");
            const value = argument === "--test" ? args[++index] : argument.slice("--test=".length);
            if (!value || value.startsWith("--")) throw new Error("--test requires a file or folder path.");
            testPath = path.resolve(cwd, value);
        } else if (argument === "--attach") {
            if (attach) throw new Error("Duplicate --attach option.");
            attach = true;
        } else if (argument === "--log" || argument.startsWith("--log=")) {
            if (logFile !== undefined) throw new Error("Duplicate --log option.");
            const value = argument === "--log" ? args[++index] : argument.slice("--log=".length);
            if (!value || value.startsWith("--")) throw new Error("--log requires a file path.");
            logFile = path.resolve(cwd, value);
        } else if (argument === "--log-dir" || argument.startsWith("--log-dir=")) {
            if (logDirectory !== undefined) throw new Error("Duplicate --log-dir option.");
            const value = argument === "--log-dir" ? args[++index] : argument.slice("--log-dir=".length);
            if (!value || value.startsWith("--")) throw new Error("--log-dir requires a folder path.");
            logDirectory = path.resolve(cwd, value);
        } else if (argument === "--rerun-failed") {
            if (rerunFailed) throw new Error("Duplicate --rerun-failed option.");
            rerunFailed = true;
        } else if (isTestInstanceOption(argument)) {
            continue;
        } else if (argument === "--test-selection" || argument.startsWith("--test-selection=")) {
            if (testSelection !== undefined) throw new Error("Duplicate --test-selection option.");
            const value = argument === "--test-selection" ? args[++index] : argument.slice("--test-selection=".length);
            if (!value || value.startsWith("--")) throw new Error("--test-selection requires a JSON file path.");
            testSelection = path.resolve(cwd, value);
        } else if (argument === "--test-setup" || argument.startsWith("--test-setup=")) {
            if (testSetup !== undefined) throw new Error("Duplicate --test-setup option.");
            const value = argument === "--test-setup" ? args[++index] : argument.slice("--test-setup=".length);
            if (!value || value.startsWith("--")) throw new Error("--test-setup requires a module path.");
            testSetup = path.resolve(cwd, value);
        } else if (argument === "--with" || argument.startsWith("--with=")) {
            if (withSeen) throw new Error("Duplicate --with option.");
            withSeen = true;
            const value = argument === "--with" ? args[++index] : argument.slice("--with=".length);
            if (!value || value.startsWith("--")) throw new Error("--with requires a comma-separated list of tags.");
            withTags = value.split(",").map((tag) => tag.trim());
            if (withTags.some((tag) => !tag) || new Set(withTags).size !== withTags.length) throw new Error("--with requires unique non-empty comma-separated tags.");
            if (withTags.includes("launch")) throw new Error("--with does not accept the built-in launch requirement tag.");
        } else if (argument === "--timeout-scale" || argument.startsWith("--timeout-scale=")) {
            if (timeoutScaleSeen) throw new Error("Duplicate --timeout-scale option.");
            timeoutScaleSeen = true;
            const value = argument === "--timeout-scale" ? args[++index] : argument.slice("--timeout-scale=".length);
            timeoutScale = Number(value);
            if (!value || !Number.isFinite(timeoutScale) || timeoutScale <= 0) throw new Error("--timeout-scale must be a positive finite number.");
        } else if (argument === "--keep-open") {
            if (keepOpen) throw new Error("Duplicate --keep-open option.");
            keepOpen = true;
        } else if (argument === "--mcp-port" || argument.startsWith("--mcp-port=")) {
            if (mcpPort !== undefined) throw new Error("Duplicate --mcp-port option.");
            const value = argument === "--mcp-port" ? args[++index] : argument.slice("--mcp-port=".length);
            mcpPort = Number(value);
            if (!/^\d+$/.test(value ?? "") || !Number.isInteger(mcpPort) || mcpPort < 1024 || mcpPort > 65535) throw new Error("--mcp-port must be an integer from 1024 to 65535.");
        } else if (argument.startsWith("--test-")) throw new Error(`Unknown test option: ${argument}`);
        else throw new Error(`Unexpected argument in test mode: ${argument}`);
    }
    if (testPath === undefined) throw new Error("Test-mode options require --test <file-or-folder>.");
    if (logFile && logDirectory) throw new Error("--log and --log-dir cannot be combined.");
    if (logFile && rerunFailed) throw new Error("--log cannot be combined with --rerun-failed.");
    if (attach && (keepOpen || mcpPort !== undefined)) throw new Error("--attach cannot be combined with --keep-open or --mcp-port.");
    return { testPath, attach, cwd, logFile, logDirectory, rerunFailed, testSelection, testSetup, with: withTags, timeoutScale, keepOpen, mcpPort };
}
