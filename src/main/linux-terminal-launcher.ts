import { spawn } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { findLinuxExecutable } from "./linux-executable-lookup";

const TERMINAL_CANDIDATES = [
    "x-terminal-emulator",
    "ptyxis",
    "gnome-terminal",
    "kgx",
    "konsole",
    "xfce4-terminal",
    "xterm",
] as const;

function terminalArguments(kind: string, dirPath: string): string[] {
    if (kind === "ptyxis") return ["--new-window", "-d", dirPath];
    if (kind === "gnome-terminal" || kind === "kgx" || kind === "xfce4-terminal") {
        return [`--working-directory=${dirPath}`];
    }
    if (kind === "konsole") return ["--workdir", dirPath];
    return [];
}

function commandKind(executable: string): string {
    return path.basename(executable).toLowerCase().replace(/\.exe$/, "");
}

export function detectLinuxTerminal(): string {
    return TERMINAL_CANDIDATES.find((candidate) => findLinuxExecutable(candidate)) ?? "";
}

export function openLinuxTerminalAt(dirPath: string, command: string): Promise<void> {
    if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return Promise.reject(new Error(`Not a folder: ${dirPath}`));
    }
    const executable = findLinuxExecutable(command);
    if (!executable) return Promise.reject(new Error(`Terminal executable not found or not executable: ${command || "(empty)"}`));
    const proc = spawn(executable, terminalArguments(commandKind(executable), dirPath), {
        cwd: dirPath,
        detached: true,
        stdio: "ignore",
    });
    return new Promise((resolve, reject) => {
        proc.once("spawn", () => {
            proc.unref();
            resolve();
        });
        proc.once("error", reject);
    });
}
