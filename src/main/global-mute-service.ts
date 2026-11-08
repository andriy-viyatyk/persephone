import type { WebContents } from "electron";
import { GLOBAL_MUTE_CHANGED, GLOBAL_MUTE_RELEASE_ALL, GLOBAL_MUTE_SNAPSHOT, type GlobalMuteSnapshot } from "../ipc/global-mute-channels";
import { guardedIpcHandle } from "./ipc-sender-guard";

class GlobalMuteService {
    private readonly contents = new Map<WebContents, { local: boolean; type: string }>();
    private readonly windows = new Set<WebContents>();
    private readonly leases = new Map<string, { label: string; close: () => void }>();
    private revision = 0;

    initialize(): void {
        guardedIpcHandle(GLOBAL_MUTE_SNAPSHOT, () => this.snapshot());
        guardedIpcHandle(GLOBAL_MUTE_RELEASE_ALL, () => { this.releaseAll(); return this.snapshot(); });
    }

    register(contents: WebContents, type: string): void {
        if (contents.isDestroyed() || this.contents.has(contents)) return;
        this.contents.set(contents, { local: false, type });
        if (type === "window") this.windows.add(contents);
        contents.once("destroyed", () => { this.contents.delete(contents); this.windows.delete(contents); this.changed(); });
        this.changed();
    }

    setLocalMuted(contents: WebContents, local: boolean): void {
        const entry = this.contents.get(contents);
        if (!entry) return;
        if (entry.local === local) return;
        entry.local = local;
        this.changed();
    }

    acquire(label: string, close: () => void): () => void {
        const id = crypto.randomUUID();
        this.leases.set(id, { label, close });
        this.changed();
        return () => { if (this.leases.delete(id)) this.changed(); };
    }

    releaseAll(): void {
        const leases = [...this.leases.values()];
        this.leases.clear();
        if (leases.length) this.changed();
        for (const lease of leases) lease.close();
    }

    snapshot(): GlobalMuteSnapshot {
        return { revision: this.revision, active: this.leases.size > 0,
            holders: [...this.leases.values()].map((lease) => lease.label).sort(),
            contents: [...this.contents].filter(([contents]) => !contents.isDestroyed()).map(([contents, entry]) => ({
                id: contents.id, type: entry.type, localMuted: entry.local, effectiveMuted: contents.isAudioMuted(),
            })) };
    }

    private apply(contents: WebContents): void {
        const entry = this.contents.get(contents);
        if (entry && !contents.isDestroyed()) contents.setAudioMuted(entry.local || this.leases.size > 0);
    }

    private changed(): void {
        this.revision++;
        for (const [contents, entry] of this.contents) if (entry.type === "window") this.apply(contents);
        for (const [contents, entry] of this.contents) if (entry.type !== "window") this.apply(contents);
        const snapshot = this.snapshot();
        for (const window of this.windows) {
            if (!window.isDestroyed()) {
                try { window.send(GLOBAL_MUTE_CHANGED, snapshot); } catch { /* Window closed during notification. */ }
            }
        }
    }
}

export const globalMuteService = new GlobalMuteService();
