import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import JSON5 from "json5";
import { profileDefaultPort } from "../../shared/application-profile";
import type { ApplicationProfileArguments } from "../application-profile";
import { getPipePath } from "../pipe-server";
import { errMessage } from "../../shared/utils";

export function resolveProfileDirectory(profile: ApplicationProfileArguments, defaultDirectory: string): string {
    if (profile.directory) return profile.directory;
    if (profile.name) return path.join(path.dirname(defaultDirectory), "persephone-profiles", profile.name);
    return defaultDirectory;
}

export async function probeProfile(profileName: string | undefined, timeoutMs = 500): Promise<boolean> {
    const pipePath = getPipePath(profileName);
    if (!pipePath) throw new Error("cannot probe profile: XDG_RUNTIME_DIR is not set");
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(pipePath);
        const timer = setTimeout(() => { socket.destroy(); reject(new Error("Timed out probing the profile pipe.")); }, timeoutMs);
        socket.once("connect", () => { clearTimeout(timer); socket.end(); resolve(true); });
        socket.once("error", (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            if (error.code === "ENOENT" || error.code === "ECONNREFUSED") resolve(false);
            else reject(new Error(`Could not safely probe profile pipe: ${error.message}`));
        });
    });
}

export async function readProfileMcp(directory: string, profileName: string | undefined): Promise<{ port: number }> {
    let settings: Record<string, unknown>;
    try {
        const parsed: unknown = JSON5.parse(await fs.readFile(path.join(directory, "data", "appSettings.json"), "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Settings must be a JSON object.");
        settings = parsed as Record<string, unknown>;
    } catch (error) { throw new Error(`Cannot read MCP settings for attach: ${errMessage(error)}`, { cause: error }); }
    if (settings["mcp.enabled"] !== true) throw new Error("Cannot attach: MCP is disabled in this profile.");
    const port = settings["mcp.port"] ?? profileDefaultPort(7865, profileName);
    if (!Number.isInteger(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Cannot attach: profile MCP port is malformed.");
    return { port: Number(port) };
}
