import path from "node:path";
import { isTestInstanceOption } from "../../ipc/test-host-protocol";
import { normalizeWindowName } from "../window-names";
import { errMessage } from "../../shared/utils";

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
    retries: number;
    testTimeout: number;
    grep?: string;
    reporter: "human" | "json-lines";
    summaryOnly: boolean;
    window?: string;
    windowName?: string;
}

export interface InitSuiteArguments {
    destination: string;
}

export function parseInitSuiteArguments(args: string[], cwd = process.cwd()): InitSuiteArguments | undefined {
    let destination: string | undefined;
    let testMarkerSeen = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--init" || argument.startsWith("--init=")) {
            if (destination !== undefined) throw new Error("Duplicate --init option.");
            const value = argument === "--init" ? args[++index] : argument.slice("--init=".length);
            if (!value || value.startsWith("--")) throw new Error("--init requires a destination folder path.");
            destination = path.resolve(cwd, value);
        } else if (argument === "--test") {
            if (testMarkerSeen) throw new Error("Duplicate --test marker with --init.");
            testMarkerSeen = true;
        } else {
            throw new Error(`Unexpected argument with --init: ${argument}`);
        }
    }

    return destination === undefined ? undefined : { destination };
}

export function hasTestControllerArguments(args: string[]): boolean {
    return args.some((argument) => argument === "--test" || argument.startsWith("--test=") || argument === "--attach"
        || argument === "--with" || argument.startsWith("--with=") || argument === "--keep-open"
        || argument === "--mcp-port" || argument.startsWith("--mcp-port=") || argument === "--timeout-scale"
        || argument.startsWith("--timeout-scale=") || argument === "--retries" || argument.startsWith("--retries=")
        || argument === "--test-timeout" || argument.startsWith("--test-timeout=")
        || argument === "--grep" || argument.startsWith("--grep=") || argument === "--window" || argument.startsWith("--window=")
        || argument === "--reporter" || argument.startsWith("--reporter=")
        || argument === "--summary-only"
        || argument === "--window-name" || argument.startsWith("--window-name=")
        || (argument.startsWith("--test-") && !isTestInstanceOption(argument)));
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
    let retries = 0;
    let retriesSeen = false;
    let testTimeout = 300_000;
    let testTimeoutSeen = false;
    let grep: string | undefined;
    let reporter: TestControllerArguments["reporter"] = "human";
    let reporterSeen = false;
    let window: string | undefined;
    let windowName: string | undefined;
    let summaryOnly = false;
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
        } else if (argument === "--retries" || argument.startsWith("--retries=")) {
            if (retriesSeen) throw new Error("Duplicate --retries option.");
            retriesSeen = true;
            const value = argument === "--retries" ? args[++index] : argument.slice("--retries=".length);
            if (!value || value.startsWith("--") || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("--retries requires a non-negative safe integer.");
            retries = Number(value);
        } else if (argument === "--test-timeout" || argument.startsWith("--test-timeout=")) {
            if (testTimeoutSeen) throw new Error("Duplicate --test-timeout option.");
            testTimeoutSeen = true;
            const value = argument === "--test-timeout" ? args[++index] : argument.slice("--test-timeout=".length);
            if (!value || value.startsWith("--") || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("--test-timeout requires a non-negative safe integer.");
            testTimeout = Number(value);
        } else if (argument === "--grep" || argument.startsWith("--grep=")) {
            if (grep !== undefined) throw new Error("Duplicate --grep option.");
            const value = argument === "--grep" ? args[++index] : argument.slice("--grep=".length);
            if (!value || value.startsWith("--")) throw new Error("--grep requires a regular expression.");
            try { new RegExp(value); } catch { throw new Error("--grep requires a valid JavaScript regular expression."); }
            grep = value;
        } else if (argument === "--window" || argument.startsWith("--window=")) {
            if (window !== undefined) throw new Error("Duplicate --window option.");
            const value = argument === "--window" ? args[++index] : argument.slice("--window=".length);
            if (!value || value.startsWith("--")) throw new Error("--window requires a window index or title substring.");
            window = value;
        } else if (argument === "--window-name" || argument.startsWith("--window-name=")) {
            if (windowName !== undefined) throw new Error("Duplicate --window-name option.");
            const value = argument === "--window-name" ? args[++index] : argument.slice("--window-name=".length);
            if (!value || value.startsWith("--")) throw new Error("--window-name requires a name.");
            try { windowName = normalizeWindowName(value); }
            catch (error) { throw new Error(`Invalid --window-name: ${errMessage(error)}`, { cause: error }); }
        } else if (argument === "--reporter" || argument.startsWith("--reporter=")) {
            if (reporterSeen) throw new Error("Duplicate --reporter option.");
            reporterSeen = true;
            const value = argument === "--reporter" ? args[++index] : argument.slice("--reporter=".length);
            if (!value || value.startsWith("--")) throw new Error("--reporter requires a value (human or json-lines).");
            if (value !== "human" && value !== "json-lines") throw new Error(`Unsupported --reporter value: ${value}. Expected human or json-lines.`);
            reporter = value;
        } else if (argument === "--summary-only") {
            if (summaryOnly) throw new Error("Duplicate --summary-only option.");
            summaryOnly = true;
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
    if (window !== undefined && !attach) throw new Error("--window requires --attach.");
    if (windowName !== undefined && !attach) throw new Error("--window-name requires --attach.");
    if (windowName !== undefined && window !== undefined) throw new Error("--window-name cannot be combined with --window.");
    if (summaryOnly && reporter === "json-lines") throw new Error("--summary-only applies only to human output and cannot be combined with --reporter json-lines.");
    return { testPath, attach, cwd, logFile, logDirectory, rerunFailed, testSelection, testSetup, with: withTags, timeoutScale, keepOpen, mcpPort, retries, testTimeout, grep, reporter, window, windowName, summaryOnly };
}
