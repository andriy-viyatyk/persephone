import * as fs from "node:fs";
import path from "node:path";

const TEST_HOME_FOLDER = "test-home";
const TEST_BIN_FOLDER = "test-bin";

function findHostNode(): string {
    const searchPath = process.env.PATH ?? "";
    for (const folder of searchPath.split(path.delimiter)) {
        if (!folder || !path.isAbsolute(folder)) continue;
        const candidate = path.join(folder, "node");
        try {
            if (fs.statSync(candidate).isFile()) {
                fs.accessSync(candidate, fs.constants.X_OK);
                return fs.realpathSync(candidate);
            }
        } catch {
            // Keep looking through the inherited absolute PATH entries.
        }
    }
    throw new Error("Cannot create the Linux test sandbox: no executable host Node was found on the inherited PATH.");
}

function refreshNodeLink(testBin: string): void {
    const nodeLink = path.join(testBin, "node");
    const hostNode = findHostNode();
    try {
        if (!fs.lstatSync(nodeLink).isSymbolicLink()) {
            throw new Error(`Cannot create the Linux test sandbox: ${nodeLink} exists and is not a symbolic link.`);
        }
        fs.unlinkSync(nodeLink);
    } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    fs.symlinkSync(hostNode, nodeLink);
}

/** Apply profile-local home directories and a restricted PATH to Linux test processes. */
export function applyLinuxBoardProcessSandbox(environment: NodeJS.ProcessEnv, userData: string): void {
    const testHome = path.join(userData, TEST_HOME_FOLDER);
    const testBin = path.join(userData, TEST_BIN_FOLDER);
    const configHome = path.join(testHome, ".config");
    const dataHome = path.join(testHome, ".local", "share");
    const cacheHome = path.join(testHome, ".cache");
    const stateHome = path.join(testHome, ".local", "state");
    const claudeConfig = path.join(testHome, ".claude");
    const codexHome = path.join(testHome, ".codex");

    for (const folder of [testHome, testBin, configHome, dataHome, cacheHome, stateHome, claudeConfig, codexHome]) {
        fs.mkdirSync(folder, { recursive: true });
    }
    refreshNodeLink(testBin);

    for (const key of Object.keys(environment)) {
        const lower = key.toLowerCase();
        if (lower.startsWith("xdg_") || lower === "path" || lower === "claudecode" || lower.startsWith("claude_code_")) {
            delete environment[key];
        }
    }

    environment.HOME = testHome;
    environment.XDG_CONFIG_HOME = configHome;
    environment.XDG_DATA_HOME = dataHome;
    environment.XDG_CACHE_HOME = cacheHome;
    environment.XDG_STATE_HOME = stateHome;
    environment.CLAUDE_CONFIG_DIR = claudeConfig;
    environment.CODEX_HOME = codexHome;
    environment.PATH = [testBin, "/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter);
}
