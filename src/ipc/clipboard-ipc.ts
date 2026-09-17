// Clipboard IPC data types (US-807) — plain data crossing the main↔renderer
// boundary for Windows file-clipboard (CF_HDROP) interop. No main-only
// dependencies live here so both api-types.ts (renderer-facing) and
// clip-service.ts (main) can import them.

/** "Preferred DropEffect" semantics of the clipboard's file list.
 *  "cut" ⇒ paste should MOVE the files; "none" ⇒ no files on the clipboard. */
export type ClipboardDropEffect = "copy" | "cut" | "none";

/** Result of reading the OS file clipboard (what Windows Explorer puts there
 *  on Ctrl+C / Ctrl+X over files). */
export interface ClipboardFileList {
    /** Absolute file/folder paths; empty when the clipboard holds no files. */
    paths: string[];
    dropEffect: ClipboardDropEffect;
}

export type ClipboardFlavor = "text" | "html" | "image" | "files";

export interface ClipboardHistoryItem {
    id: string;
    capturedAt: number;
    primary: ClipboardFlavor;
    preview: string;
    payloads: Partial<Record<ClipboardFlavor, string>>;
    /** Only on a `files` item: its payload holds the paths alone, one per line, so the
     *  copy/cut distinction needed to put the list back on the clipboard is carried here. */
    dropEffect?: ClipboardDropEffect;
}

export interface ClipboardHistorySnapshot {
    revision: number;
    items: ClipboardHistoryItem[];
}

export interface ClipboardHistoryChanged {
    revision: number;
    reason: "captured" | "removed" | "cleared" | "reconciled";
}

export type ClipboardHealth = "disabled" | "starting" | "running" | "healthy" | "deaf" | "error";

export interface ClipboardStatus {
    enabled: boolean;
    running: boolean;
    health: ClipboardHealth;
    monitoring: boolean;
    error?: string;
}
