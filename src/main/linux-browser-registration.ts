import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { applicationProfileName } from "./application-profile";
import { findLinuxExecutable } from "./linux-executable-lookup";
import { linuxDesktopInvocation, serializeDesktopEntryValue, serializeDesktopExec } from "./linux-desktop-entry";
import { t } from "../shared/i18n/t";
import { errMessage } from "../shared/utils";

const execFile = promisify(execFileCallback);
export const LINUX_BROWSER_HANDLER_ID = "com.viyatyk.persephone-url-handler.desktop";
const BROWSER_MIME_TYPES = ["x-scheme-handler/http", "x-scheme-handler/https", "text/html"] as const;

function absoluteXdgDirectory(variable: string, fallback: string): string {
    const configured = process.env[variable];
    if (!configured) return fallback;
    if (!path.isAbsolute(configured)) throw new Error(`${variable} must be an absolute path.`);
    return configured;
}

function applicationsDirectory(): string {
    return path.join(absoluteXdgDirectory("XDG_DATA_HOME", path.join(app.getPath("home"), ".local", "share")), "applications");
}

function configDirectory(): string {
    return absoluteXdgDirectory("XDG_CONFIG_HOME", path.join(os.homedir(), ".config"));
}

function requiredExecutable(name: string): string {
    const executable = findLinuxExecutable(name);
    if (!executable) throw new Error(`Required Linux command was not found on PATH: ${name}`);
    return executable;
}

async function run(name: string, args: string[]): Promise<string> {
    try {
        const result = await execFile(requiredExecutable(name), args, { encoding: "utf8", windowsHide: true });
        return result.stdout.trim();
    } catch (error) {
        throw new Error(`Linux command ${name} failed: ${errMessage(error)}`, { cause: error });
    }
}

async function writeHandlerEntry(): Promise<void> {
    const directory = applicationsDirectory();
    await fs.mkdir(directory, { recursive: true });
    const exec = serializeDesktopExec(linuxDesktopInvocation());
    const content = [
        "[Desktop Entry]",
        "Type=Application",
        "NoDisplay=true",
        `Name=${serializeDesktopEntryValue("Persephone")}`,
        `Exec=${exec} %u`,
        `MimeType=${BROWSER_MIME_TYPES.join(";")};`,
        "",
    ].join("\n");
    await fs.writeFile(path.join(directory, LINUX_BROWSER_HANDLER_ID), content, "utf8");
}

export async function registerLinuxDefaultBrowser(): Promise<void> {
    if (applicationProfileName()) throw new Error(t("settings.profileBrowserRegistration"));
    await writeHandlerEntry();
    await run("xdg-settings", ["set", "default-web-browser", LINUX_BROWSER_HANDLER_ID]);
    for (const mimeType of BROWSER_MIME_TYPES) {
        await run("xdg-mime", ["default", LINUX_BROWSER_HANDLER_ID, mimeType]);
    }
}

function removeHandlerFromMimeApps(text: string): string {
    let section = "";
    return text.split(/(?<=\n)/).map((line) => {
        const sectionMatch = /^\[([^\]]+)\]\s*(?:\r?\n)?$/.exec(line);
        if (sectionMatch) {
            section = sectionMatch[1];
            return line;
        }
        if (section !== "Default Applications" && section !== "Added Associations") return line;
        const entryMatch = /^([^#=\r\n]+)=(.*?)(\r?\n)?$/.exec(line);
        if (!entryMatch) return line;
        const values = entryMatch[2].split(";");
        if (!values.includes(LINUX_BROWSER_HANDLER_ID)) return line;
        const remaining = values.filter((value) => value !== LINUX_BROWSER_HANDLER_ID);
        if (remaining.every((value) => value === "")) return "";
        return `${entryMatch[1]}=${remaining.join(";")}${entryMatch[3] ?? ""}`;
    }).join("");
}

export async function unregisterLinuxDefaultBrowser(): Promise<void> {
    if (applicationProfileName()) throw new Error(t("settings.profileBrowserRegistration"));
    const entryPath = path.join(applicationsDirectory(), LINUX_BROWSER_HANDLER_ID);
    await fs.rm(entryPath, { force: true });
    const mimeAppsPath = path.join(configDirectory(), "mimeapps.list");
    try {
        const original = await fs.readFile(mimeAppsPath, "utf8");
        const updated = removeHandlerFromMimeApps(original);
        if (updated !== original) await fs.writeFile(mimeAppsPath, updated, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const updateDatabase = findLinuxExecutable("update-desktop-database");
    if (updateDatabase) await run("update-desktop-database", [applicationsDirectory()]);
}

export async function isLinuxDefaultBrowserSelected(): Promise<boolean> {
    const selected = await run("xdg-settings", ["get", "default-web-browser"]);
    const check = findLinuxExecutable("xdg-settings");
    if (!check) throw new Error("Required Linux command was not found on PATH: xdg-settings");
    try {
        await execFile(check, ["check", "default-web-browser", LINUX_BROWSER_HANDLER_ID], { encoding: "utf8", windowsHide: true });
        return selected === LINUX_BROWSER_HANDLER_ID;
    } catch (error) {
        const code: unknown = (error as NodeJS.ErrnoException).code;
        if (code === 1 || code === "1") return false;
        throw new Error(`Linux command xdg-settings failed: ${errMessage(error)}`, { cause: error });
    }
}
