import * as fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { isTestInstance } from "./instance-options";
import { TEST_LOCAL_APP_DATA_FOLDER } from "./local-app-data";

const TEST_HOME_FOLDER = "test-home";
const TEST_BIN_FOLDER = "test-bin";

/**
 * Board fixtures run `node <script>` through `persephone.execute()`. The sandboxed PATH drops the
 * user's folders, so `test-bin` gets a `node.cmd` that calls the host's real `node.exe` by absolute
 * path. Only `node` is forwarded: the folder that holds it may also hold user CLIs (npm globals,
 * `claude`, `codex`), which must stay unreachable.
 */
function writeNodeShim(testBin: string): void {
    const shim = path.join(testBin, "node.cmd");
    if (fs.existsSync(shim)) return;
    const searchPath = process.env.PATH ?? process.env.Path ?? "";
    const node = searchPath.split(path.delimiter)
        .filter((folder) => folder.length > 0)
        .map((folder) => path.join(folder, "node.exe"))
        .find((candidate) => fs.existsSync(candidate));
    if (!node) return;
    fs.writeFileSync(shim, `@"${node}" %*\r\n`, "utf8");
}

/** Apply profile and PATH isolation to board-owned processes in an owned test instance. */
export function applyBoardProcessSandbox(environment: NodeJS.ProcessEnv): void {
    if (!isTestInstance()) return;

    const userData = app.getPath("userData");
    const testHome = path.join(userData, TEST_HOME_FOLDER);
    const testLocalAppData = path.join(userData, TEST_LOCAL_APP_DATA_FOLDER);
    const testBin = path.join(userData, TEST_BIN_FOLDER);
    const appData = path.join(testHome, "AppData", "Roaming");
    const claudeConfig = path.join(testHome, ".claude");
    const codexHome = path.join(testHome, ".codex");

    for (const folder of [testHome, appData, claudeConfig, codexHome, testLocalAppData, testBin]) {
        fs.mkdirSync(folder, { recursive: true });
    }
    writeNodeShim(testBin);

    const { root } = path.parse(testHome);
    environment.USERPROFILE = testHome;
    environment.HOMEDRIVE = root.replace(/[\\/]+$/, "");
    environment.HOMEPATH = path.relative(root, testHome).replace(/^/, path.sep);
    environment.APPDATA = appData;
    environment.LOCALAPPDATA = testLocalAppData;
    environment.CLAUDE_CONFIG_DIR = claudeConfig;
    environment.CODEX_HOME = codexHome;

    for (const key of Object.keys(environment)) {
        const lower = key.toLowerCase();
        // An agent CLI that launched the suite leaves its own session variables (executable path,
        // messaging socket and token); a board process must not see the outer session.
        if (lower === "path" || lower === "claudecode" || lower.startsWith("claude_code_")) delete environment[key];
    }

    // A plain-object copy of process.env keeps whatever casing Windows reported (`SystemRoot` or
    // `SYSTEMROOT`), so look the key up case-insensitively; process.env itself is case-insensitive.
    const systemRootKey = Object.keys(environment).find((key) => key.toLowerCase() === "systemroot");
    const systemRoot = (systemRootKey ? environment[systemRootKey] : undefined) ?? process.env.SystemRoot;
    const systemPaths = systemRoot ? [
        path.join(systemRoot, "System32"),
        systemRoot,
        path.join(systemRoot, "System32", "Wbem"),
        path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
    ] : [];
    environment.PATH = [testBin, ...systemPaths].join(path.delimiter);
}
