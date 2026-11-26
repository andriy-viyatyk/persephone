import { spawn } from "child_process";
import { getSnipToolPath } from "./snip-service";
import type { ClipboardFileList } from "../ipc/clipboard-ipc";

const EMPTY: ClipboardFileList = { paths: [], dropEffect: "none" };

/** Read Windows file clipboard data through the native helper. */
export async function readWindowsClipboardFiles(): Promise<ClipboardFileList> {
    return new Promise((resolve) => {
        const child = spawn(getSnipToolPath(), ["clipboard-read"], {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const chunks: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => { chunks.push(chunk); });
        child.stderr.on("data", (chunk: Buffer) => console.error("clip-tool:", chunk.toString()));
        child.on("close", (code) => {
            if (code !== 0 || chunks.length === 0) {
                resolve(EMPTY);
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (Array.isArray(parsed?.paths)) {
                    resolve({
                        paths: parsed.paths.filter((p: unknown) => typeof p === "string"),
                        dropEffect: parsed.dropEffect === "cut" ? "cut"
                            : parsed.paths.length ? "copy" : "none",
                    });
                    return;
                }
            } catch (err) {
                console.error("clip-tool: bad clipboard-read output:", err);
            }
            resolve(EMPTY);
        });
        child.on("error", (err) => {
            console.error("Failed to start clip tool:", err);
            resolve(EMPTY);
        });
    });
}

/** Write Windows CF_HDROP data through the native helper. */
export async function writeWindowsClipboardFiles(paths: string[], cut: boolean): Promise<boolean> {
    return new Promise((resolve) => {
        const args = cut ? ["clipboard-write", "--cut"] : ["clipboard-write"];
        const child = spawn(getSnipToolPath(), args, {
            stdio: ["pipe", "ignore", "pipe"],
            windowsHide: true,
        });
        child.stderr.on("data", (chunk: Buffer) => console.error("clip-tool:", chunk.toString()));
        child.on("close", (code) => resolve(code === 0));
        child.on("error", (err) => {
            console.error("Failed to start clip tool:", err);
            resolve(false);
        });
        child.stdin.on("error", (err) => {
            console.error("Failed to write clip tool input:", err);
            resolve(false);
        });
        if (paths.length) child.stdin.write(paths.join("\r\n") + "\r\n", "utf8");
        child.stdin.end();
    });
}
