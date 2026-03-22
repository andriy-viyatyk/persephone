// File Properties
// Shows file information similar to Windows Explorer Properties dialog.
// Opens a new page with file details: type, size, dates, attributes.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function formatSize(bytes: number): string {
    if (bytes === 0) return "0 bytes";
    const units = ["bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    const formatted = i === 0 ? bytes.toString() : value.toFixed(2);
    return `${formatted} ${units[i]} (${bytes.toLocaleString()} bytes)`;
}

function formatDate(date: Date): string {
    const d = date.toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const t = date.toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    return `${d}, ${t}`;
}

function getExtensionType(ext: string): string {
    const types: Record<string, string> = {
        ".txt": "Text Document", ".md": "Markdown Document",
        ".json": "JSON File", ".js": "JavaScript File",
        ".ts": "TypeScript File", ".tsx": "TypeScript React File",
        ".html": "HTML Document", ".css": "CSS Stylesheet",
        ".xml": "XML Document", ".yaml": "YAML File", ".yml": "YAML File",
        ".csv": "CSV File", ".svg": "SVG Image",
        ".png": "PNG Image", ".jpg": "JPEG Image", ".jpeg": "JPEG Image",
        ".gif": "GIF Image", ".pdf": "PDF Document",
        ".zip": "ZIP Archive", ".exe": "Application",
        ".dll": "Dynamic Link Library", ".bat": "Batch File",
        ".ps1": "PowerShell Script", ".sh": "Shell Script",
        ".py": "Python File", ".java": "Java File",
        ".c": "C Source File", ".cpp": "C++ Source File",
        ".cs": "C# Source File", ".go": "Go Source File",
        ".rs": "Rust Source File", ".sql": "SQL File", ".log": "Log File",
    };
    return types[ext.toLowerCase()] || "File";
}

function getWindowsAttributes(filePath: string): { readOnly: boolean; hidden: boolean; system: boolean } {
    try {
        const output = execSync(`attrib "${filePath}"`, { encoding: "utf-8" }).trim();
        const attrs = output.substring(0, output.indexOf(filePath.charAt(0) === "/" ? filePath : filePath)).trim();
        return {
            readOnly: attrs.includes("R"),
            hidden: attrs.includes("H"),
            system: attrs.includes("S"),
        };
    } catch {
        return { readOnly: false, hidden: false, system: false };
    }
}

export function showFileProperties(filePath: string) {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath);
    const typeName = getExtensionType(ext);
    const typeLabel = ext ? `${typeName} (${ext})` : typeName;
    const attrs = getWindowsAttributes(filePath);

    const lines = [
        `═══════════════════════════════════════════`,
        `  ${fileName}`,
        `═══════════════════════════════════════════`,
        ``,
        `  Type:        ${typeLabel}`,
        `  Location:    ${dirName}`,
        `  Size:        ${formatSize(stat.size)}`,
        ``,
        `  Created:     ${formatDate(stat.birthtime)}`,
        `  Modified:    ${formatDate(stat.mtime)}`,
        `  Accessed:    ${formatDate(stat.atime)}`,
        ``,
        `  Read-only:   ${attrs.readOnly ? "Yes" : "No"}`,
        `  Hidden:      ${attrs.hidden ? "Yes" : "No"}`,
        `  System:      ${attrs.system ? "Yes" : "No"}`,
        ``,
        `═══════════════════════════════════════════`,
    ];

    const page = app.pages.addEditorPage("monaco", "plaintext", `${fileName} — Properties`);
    page.content = lines.join("\n");
}
