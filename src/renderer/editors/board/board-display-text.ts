import { EventChannel } from "../../api/events/EventChannel";
import { fpNormalizeForCompare } from "../../core/utils/file-path";
import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { pseudoText } from "../../../shared/i18n/pseudo-text";
import type { BoardI18nContext } from "../../../ipc/board-bridge-channels";
import type { NormalizedBoardManifest } from "./board-manifest";
import { loadBoardI18n } from "./board-i18n";

interface BoardDisplayTextChangedEvent {
    root: string;
    reason: "resolve" | "refresh" | "invalidate";
    handled?: boolean;
}

type BoardDisplayTable = Record<string, string>;

const changed = new EventChannel<BoardDisplayTextChangedEvent>({ name: "board-display-text" });
const pendingTables = new Map<string, Promise<BoardDisplayTable>>();
const resolvedTables = new Map<string, BoardDisplayTable>();

function rootKey(root: string): string {
    return fpNormalizeForCompare(root);
}

function mergeManifestTables(context: BoardI18nContext): BoardDisplayTable {
    const merged: BoardDisplayTable = {};
    for (const table of context.tables) {
        for (const [key, value] of Object.entries(table)) {
            if (key.startsWith("manifest.") && typeof value === "string" && merged[key] === undefined) {
                merged[key] = value;
            }
        }
    }
    return merged;
}

function publish(root: string, reason: BoardDisplayTextChangedEvent["reason"]): void {
    changed.send({ root, reason });
}

/** Load the board metadata table before a view builds its first presentation. */
export async function ensureBoardDisplayText(root: string, manifest: NormalizedBoardManifest): Promise<void> {
    if (getActiveLocale() === "en-XA") return;
    const key = rootKey(root);
    if (resolvedTables.has(key)) return;
    const pending = pendingTables.get(key);
    if (pending) {
        await pending;
        return;
    }

    const request = loadBoardI18n(root, manifest.languages).then(({ context }) => mergeManifestTables(context));
    pendingTables.set(key, request);
    try {
        const table = await request;
        if (pendingTables.get(key) !== request) return;
        pendingTables.delete(key);
        resolvedTables.set(key, table);
        publish(root, "resolve");
    } catch (error) {
        if (pendingTables.get(key) === request) pendingTables.delete(key);
        throw error;
    }
}

/** Replace a board's cached table with the packs already loaded for its registration. */
export function refreshBoardDisplayText(root: string, context: BoardI18nContext): void {
    const key = rootKey(root);
    pendingTables.delete(key);
    resolvedTables.set(key, mergeManifestTables(context));
    publish(root, "refresh");
}

/** Resolve a manifest value for UI display, retaining English as the nonlocalized fallback. */
export function boardDisplayText(
    root: string,
    _manifest: NormalizedBoardManifest | null | undefined,
    key: string,
    english: string,
): string {
    if (getActiveLocale() === "en-XA") return pseudoText(english);
    return resolvedTables.get(rootKey(root))?.[key] ?? english;
}

export const boardMetadataKeys = {
    name: "manifest.name",
    description: "manifest.description",
    editorName: "manifest.editorName",
    viewTitle: (id: string) => `manifest.views.${id}.title`,
    settingLabel: (id: string) => `manifest.settings.${id}.label`,
    settingDescription: (id: string) => `manifest.settings.${id}.description`,
    capabilityTitle: (id: string) => `manifest.capabilities.${id}.title`,
};

/** Subscribe to metadata cache changes. The listener receives the original board root. */
export function onBoardDisplayTextChanged(
    listener: (root: string, reason: BoardDisplayTextChangedEvent["reason"]) => void,
): () => void {
    return changed.subscribe(({ root, reason }) => listener(root, reason));
}

/** Invalidate one root or the entire presentation cache. */
export function invalidateBoardDisplayText(root?: string): void {
    if (root !== undefined) {
        const key = rootKey(root);
        pendingTables.delete(key);
        resolvedTables.delete(key);
        publish(root, "invalidate");
        return;
    }
    const roots = new Set([...pendingTables.keys(), ...resolvedTables.keys()]);
    pendingTables.clear();
    resolvedTables.clear();
    for (const key of roots) publish(key, "invalidate");
}
