import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * Manages Windows browser registration in HKCU (no admin required).
 *
 * Registry keys mirror those written by the NSIS installer (build/installer.nsh, section 5).
 * Uses reg.exe for simplicity — no npm packages needed.
 */

function getLauncherPath(): string {
    // In production: js-notepad-launcher.exe sits next to js-notepad.exe
    const exeDir = path.dirname(app.getPath("exe"));
    const launcherPath = path.join(exeDir, "js-notepad-launcher.exe");
    if (fs.existsSync(launcherPath)) {
        return launcherPath;
    }
    return app.getPath("exe");
}

function regAdd(keyPath: string, valueName: string | null, data: string, type = "REG_SZ"): void {
    const parts = ["reg", "add", `"HKCU\\${keyPath}"`, "/f"];
    if (valueName === null) {
        parts.push("/ve"); // default value
    } else {
        parts.push("/v", `"${valueName}"`);
    }
    parts.push("/t", type, "/d", `"${data}"`);
    execSync(parts.join(" "), { windowsHide: true, stdio: "ignore" });
}

function regDelete(keyPath: string, tree = true): void {
    try {
        if (tree) {
            execSync(`reg delete "HKCU\\${keyPath}" /f`, { windowsHide: true, stdio: "ignore" });
        }
    } catch {
        // Key doesn't exist — fine
    }
}

function regDeleteValue(keyPath: string, valueName: string): void {
    try {
        execSync(`reg delete "HKCU\\${keyPath}" /v "${valueName}" /f`, { windowsHide: true, stdio: "ignore" });
    } catch {
        // Value doesn't exist — fine
    }
}

function regQuery(keyPath: string, valueName?: string): string | null {
    try {
        const parts = ["reg", "query", `"HKCU\\${keyPath}"`];
        if (valueName === undefined) {
            parts.push("/ve"); // default value
        } else {
            parts.push("/v", `"${valueName}"`);
        }
        const output = execSync(parts.join(" "), { windowsHide: true, encoding: "utf-8" });
        return output;
    } catch {
        return null;
    }
}

function shellNotify(): void {
    // SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL)
    // Use PowerShell to call the Shell32 API
    try {
        execSync(
            `powershell -NoProfile -Command "[System.Runtime.InteropServices.Marshal]::ReleaseComObject([System.Runtime.InteropServices.Marshal]::GetObjectForIUnknown([System.IntPtr]::Zero)) | Out-Null" 2>$null; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SHChange { [DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2); }'; [SHChange]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)`,
            { windowsHide: true, stdio: "ignore" },
        );
    } catch {
        // Non-critical — Explorer will pick up changes eventually
    }
}

export function registerAsDefaultBrowser(): void {
    const launcher = getLauncherPath();
    const prefix = "SOFTWARE\\Clients\\StartMenuInternet\\js-notepad";

    // --- Internet client registration ---
    regAdd(prefix, null, "JS-Notepad");
    regAdd(`${prefix}\\Capabilities`, "ApplicationName", "JS-Notepad");
    regAdd(`${prefix}\\Capabilities`, "ApplicationDescription", "JS Notepad");
    regAdd(`${prefix}\\Capabilities\\URLAssociations`, "http", "JSNotepadURL");
    regAdd(`${prefix}\\Capabilities\\URLAssociations`, "https", "JSNotepadURL");
    regAdd(`${prefix}\\Capabilities\\FileAssociations`, ".htm", "JSNotepadHTM");
    regAdd(`${prefix}\\Capabilities\\FileAssociations`, ".html", "JSNotepadHTM");
    regAdd(`${prefix}\\DefaultIcon`, null, `${launcher},0`);
    regAdd(`${prefix}\\shell\\open\\command`, null, `"${launcher}"`);

    // --- URL protocol handler ---
    regAdd("SOFTWARE\\Classes\\JSNotepadURL", null, "JS-Notepad URL");
    regAdd("SOFTWARE\\Classes\\JSNotepadURL", "URL Protocol", "");
    regAdd("SOFTWARE\\Classes\\JSNotepadURL\\DefaultIcon", null, `${launcher},0`);
    regAdd("SOFTWARE\\Classes\\JSNotepadURL\\shell\\open\\command", null, `"${launcher}" "%1"`);

    // --- HTML file handler ---
    regAdd("SOFTWARE\\Classes\\JSNotepadHTM", null, "JS-Notepad HTML Document");
    regAdd("SOFTWARE\\Classes\\JSNotepadHTM\\DefaultIcon", null, `${launcher},0`);
    regAdd("SOFTWARE\\Classes\\JSNotepadHTM\\shell\\open\\command", null, `"${launcher}" "%1"`);

    // --- Registered application (makes it appear in Default Apps) ---
    regAdd("SOFTWARE\\RegisteredApplications", "js-notepad",
        "SOFTWARE\\Clients\\StartMenuInternet\\js-notepad\\Capabilities");

    // --- Record in our install registry that browser registration is active ---
    regAdd("SOFTWARE\\js-notepad\\Install", "Browser", "1", "REG_DWORD");

    shellNotify();
}

export function unregisterAsDefaultBrowser(): void {
    regDelete("SOFTWARE\\Clients\\StartMenuInternet\\js-notepad");
    regDelete("SOFTWARE\\Classes\\JSNotepadURL");
    regDelete("SOFTWARE\\Classes\\JSNotepadHTM");
    regDeleteValue("SOFTWARE\\RegisteredApplications", "js-notepad");
    regAdd("SOFTWARE\\js-notepad\\Install", "Browser", "0", "REG_DWORD");

    shellNotify();
}

export function isRegisteredAsDefaultBrowser(): boolean {
    const result = regQuery("SOFTWARE\\Clients\\StartMenuInternet\\js-notepad");
    return result !== null;
}

export function openDefaultAppsSettings(): void {
    try {
        execSync("start ms-settings:defaultapps?registeredAppUser=js-notepad", { windowsHide: true, shell: true, stdio: "ignore" });
    } catch {
        // Ignore
    }
}
