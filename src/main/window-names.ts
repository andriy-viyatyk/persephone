import type { BrowserWindow } from "electron";

export interface WindowNameRecord {
    index: number;
    name?: string;
    boardRoot?: string;
    window?: { window: BrowserWindow };
}

export interface WindowNameOwner {
    allWindowData(): WindowNameRecord[];
    findWindowDataByIndex(index: number): WindowNameRecord | undefined;
    saveWindowNames(): void;
    doQuit: boolean;
}

export function normalizeWindowName(value: unknown): string {
    if (typeof value !== "string") throw new Error("Window name must be a string.");
    const name = value.trim();
    if (name.length < 1 || name.length > 64 || !/^[A-Za-z0-9 ._-]+$/.test(name)) {
        throw new Error("Window name must contain 1 to 64 ASCII letters, digits, spaces, dots, underscores, or hyphens.");
    }
    return name;
}

export function normalizePersistedWindowNames(raw: unknown[]): Array<{ index: number; name?: string }> {
    const names = new Set<string>();
    return raw.map((entry) => {
        const window = entry as { index: number; name?: unknown };
        if (typeof window.name !== "string") return { index: window.index };
        try {
            const name = normalizeWindowName(window.name);
            const key = name.toLowerCase();
            if (names.has(key)) return { index: window.index };
            names.add(key);
            return { index: window.index, name };
        } catch {
            return { index: window.index };
        }
    });
}

export class WindowNames {
    private readonly baseTitles = new Map<number, string>();
    private readonly titleListeners = new Map<number, (event: Electron.Event, title: string) => void>();
    private readonly closedListeners = new Map<number, () => void>();

    constructor(private readonly owner: WindowNameOwner) {}

    setName(index: number, value: unknown): void {
        const record = this.owner.findWindowDataByIndex(index);
        if (!record || record.boardRoot) throw new Error("A name can only be assigned to an existing normal window.");
        let name: string | undefined;
        if (value !== null) name = normalizeWindowName(value);
        if (name && !record.window) throw new Error("A name cannot be assigned to a closed window.");
        const duplicate = name && this.owner.allWindowData().some((other) => other !== record && !other.boardRoot
            && other.name?.toLowerCase() === name?.toLowerCase());
        if (duplicate) throw new Error(`The window name \"${name}\" is already in use.`);
        record.name = name;
        this.applyTitle(record);
        this.owner.saveWindowNames();
    }

    applyTitle(record: WindowNameRecord): void {
        const browserWindow = record.window?.window;
        if (!browserWindow || browserWindow.isDestroyed() || record.boardRoot) return;
        if (!this.baseTitles.has(record.index)) this.baseTitles.set(record.index, browserWindow.getTitle());
        const baseTitle = this.baseTitles.get(record.index) ?? "";
        browserWindow.setTitle(record.name ? `${baseTitle} — ${record.name}` : baseTitle);
        const previousTitleListener = this.titleListeners.get(record.index);
        if (previousTitleListener) browserWindow.removeListener("page-title-updated", previousTitleListener);
        const titleListener = (event: Electron.Event, title: string): void => {
            event.preventDefault();
            const base = title;
            this.baseTitles.set(record.index, base);
            browserWindow.setTitle(record.name ? `${base} — ${record.name}` : base);
        };
        this.titleListeners.set(record.index, titleListener);
        browserWindow.on("page-title-updated", titleListener);
        const previousClosedListener = this.closedListeners.get(record.index);
        if (previousClosedListener) browserWindow.removeListener("closed", previousClosedListener);
        const closedListener = (): void => {
            this.baseTitles.delete(record.index);
            this.titleListeners.delete(record.index);
            this.closedListeners.delete(record.index);
            if (this.owner.doQuit) return;
            const current = this.owner.findWindowDataByIndex(record.index);
            if (current === record && current.name) {
                current.name = undefined;
                this.owner.saveWindowNames();
            }
        };
        this.closedListeners.set(record.index, closedListener);
        browserWindow.once("closed", closedListener);
    }
}
