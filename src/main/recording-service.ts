import { BrowserWindow, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDataFolder, preparePath } from "./utils";
import { armRecordingMediaGrant, clearRecordingMediaGrant } from "./permission-policy-service";
import type { RecordingRegion } from "../ipc/api-param-types";

interface RecordingEntry {
    id: string;
    ownerId: number;
    partialPath: string;
    finalPath: string | undefined;
    handle: fs.promises.FileHandle;
    writeChain: Promise<void>;
}

const directory = () => path.join(getDataFolder(), "recordings");
const byId = new Map<string, RecordingEntry>();
const byOwner = new Map<number, string>();
const completedPattern = /^persephone-recording-[0-9a-f-]{36}\.(?:mp4|webm)$/i;

function ownedEntry(ownerId: number, recordingId: string): RecordingEntry {
    const entry = byId.get(recordingId);
    if (!entry || entry.ownerId !== ownerId) throw new Error("Recording session was not found for this window.");
    return entry;
}

async function removePartial(entry: RecordingEntry): Promise<void> {
    byId.delete(entry.id);
    byOwner.delete(entry.ownerId);
    clearRecordingMediaGrant(entry.ownerId);
    try { await entry.writeChain; } catch { /* A failed chunk still requires cleanup. */ }
    try { await entry.handle.close(); } catch { /* The handle may already be closed. */ }
    try { await fs.promises.rm(entry.partialPath, { force: true }); } catch { /* Best effort cleanup. */ }
}

export async function initializeRecordingService(): Promise<void> {
    const folder = directory();
    preparePath(folder);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const name of await fs.promises.readdir(folder)) {
        const filePath = path.join(folder, name);
        const partial = /^persephone-recording-[0-9a-f-]{36}\.partial$/i.test(name);
        if (!partial && !completedPattern.test(name)) continue;
        try {
            const stat = await fs.promises.stat(filePath);
            if (partial || stat.mtimeMs < cutoff) await fs.promises.rm(filePath, { force: true });
        } catch { /* A file may disappear during startup cleanup. */ }
    }
}

export async function startRecording(owner: WebContents, region: RecordingRegion) {
    if (region !== "window" && region !== "page" && region !== "editor") throw new Error("Invalid recording region.");
    if (byOwner.has(owner.id)) throw new Error("A recording is already active in this window.");
    const browserWindow = BrowserWindow.fromWebContents(owner);
    if (!browserWindow || browserWindow.isDestroyed()) throw new Error("The Persephone window is unavailable.");
    const id = randomUUID();
    const partialPath = path.join(directory(), `persephone-recording-${id}.partial`);
    preparePath(directory());
    // Reserve synchronously so concurrent start requests cannot both pass the owner check.
    byOwner.set(owner.id, id);
    let handle: fs.promises.FileHandle;
    try {
        handle = await fs.promises.open(partialPath, "wx");
    } catch (error: unknown) {
        if (byOwner.get(owner.id) === id) byOwner.delete(owner.id);
        throw error;
    }
    if (owner.isDestroyed()) {
        await handle.close();
        await fs.promises.rm(partialPath, { force: true });
        if (byOwner.get(owner.id) === id) byOwner.delete(owner.id);
        throw new Error("The Persephone window is unavailable.");
    }
    const entry: RecordingEntry = { id, ownerId: owner.id, partialPath, finalPath: undefined, handle, writeChain: Promise.resolve() };
    byId.set(id, entry);
    owner.once("destroyed", () => { void cancelRecordingsForOwner(owner.id); });
    owner.once("render-process-gone", () => { void cancelRecordingsForOwner(owner.id); });
    armRecordingMediaGrant(owner.id);
    return { recordingId: id, chromeMediaSourceId: browserWindow.getMediaSourceId(), path: partialPath };
}

export async function appendRecordingChunk(ownerId: number, recordingId: string, chunk: Uint8Array): Promise<void> {
    const entry = ownedEntry(ownerId, recordingId);
    if (entry.finalPath) throw new Error("Recording has already been finalized.");
    entry.writeChain = entry.writeChain.then(async () => { await entry.handle.writeFile(Buffer.from(chunk)); });
    await entry.writeChain;
}

export async function finalizeRecording(ownerId: number, recordingId: string, extension: "mp4" | "webm"): Promise<string> {
    const entry = ownedEntry(ownerId, recordingId);
    if (extension !== "mp4" && extension !== "webm") throw new Error("Invalid recording format.");
    await entry.writeChain;
    await entry.handle.sync();
    await entry.handle.close();
    entry.finalPath = path.join(directory(), `persephone-recording-${entry.id}.${extension}`);
    await fs.promises.rename(entry.partialPath, entry.finalPath);
    byId.delete(entry.id);
    byOwner.delete(ownerId);
    return entry.finalPath;
}

export async function cancelRecording(ownerId: number, recordingId: string): Promise<void> {
    await removePartial(ownedEntry(ownerId, recordingId));
}

export async function cancelRecordingsForOwner(ownerId: number): Promise<void> {
    const id = byOwner.get(ownerId);
    if (id) {
        const entry = byId.get(id);
        if (entry) await removePartial(entry);
        else byOwner.delete(ownerId);
    }
    clearRecordingMediaGrant(ownerId);
}
