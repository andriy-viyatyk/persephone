import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

let siteExtensionRuntime: string | null = null;

/** Serves the generated runtime, refreshing it in development where the watcher rebuilds it. */
export async function getSiteExtensionRuntime(): Promise<string> {
    if (siteExtensionRuntime === null || !app.isPackaged) {
        siteExtensionRuntime = await fs.readFile(path.join(__dirname, "site-extension-runtime.js"), "utf8");
    }
    return siteExtensionRuntime;
}
