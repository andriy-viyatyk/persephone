import { InternalEditorIds } from "../../editors/base/editor-ids";
import type { EditorDescriptor, PageDescriptor, PageHistoryEntry } from "../../../shared/persistence";
import { EditorId } from "../../../shared/editor-ids";
import {
    decodePersephoneBoardLink,
    encodePersephoneBoardLink,
} from "../../content/persephone-board-link";
import { boardRegistry } from "../boards/board-registry";
import { resolveBoardEditorId } from "../boards/custom-editor-registry";
import { isFileUrl, normalizeFileUrl } from "../../content/link-utils";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Added 2026-09-20: follow persisted board roots and editor IDs to current registrations. */
export async function migratePersistedBoardRootsAndIds(
    descriptor: EditorDescriptor,
): Promise<EditorDescriptor> {
    const state = { ...descriptor.state };
    const persistedBoardRoot = typeof state.boardRoot === "string" ? state.boardRoot : undefined;
    const currentBoardRoot = persistedBoardRoot === undefined
        ? undefined
        : await boardRegistry.resolvePersistedRoot(persistedBoardRoot);
    if (currentBoardRoot !== undefined) state.boardRoot = currentBoardRoot;
    if (typeof state.editor === "string") state.editor = await resolveBoardEditorId(state.editor);
    return {
        ...descriptor,
        editorId: await resolveBoardEditorId(descriptor.editorId),
        state,
    };
}

async function repairBoardLink(value: unknown): Promise<unknown> {
    if (typeof value !== "string") return value;
    const decoded = decodePersephoneBoardLink(value);
    if (!decoded) return value;
    const currentRoot = await boardRegistry.resolvePersistedRoot(decoded.boardRoot);
    return currentRoot === undefined ? value : encodePersephoneBoardLink(currentRoot);
}

/** Added 2026-09-20: repair board links stored in editor state and page navigation history. */
export async function migratePersistedBoardLinks(desc: PageDescriptor): Promise<PageDescriptor> {
    const editors = await Promise.all(desc.editors.map(async (descriptor) => {
        const sourceLink = descriptor.state.sourceLink;
        const state = { ...descriptor.state };
        if (isRecord(sourceLink)) state.sourceLink = await repairStoredSourceLink(sourceLink);
        const host = descriptor.host
            ? { ...descriptor.host, ...(descriptor.host.pipe ? { pipe: await repairPipePath(descriptor.host.pipe) } : {}) }
            : undefined;
        return { ...descriptor, state, ...(host ? { host } : {}) };
    }));
    const repairStack = async (entries: PageHistoryEntry[] | undefined) => entries
        ? Promise.all(entries.map(async (entry) => ({
            ...entry,
            filePath: String(await repairBoardLink(entry.filePath)),
            target: await resolveBoardEditorId(entry.target),
            ...(entry.sourceLink ? { sourceLink: await repairStoredSourceLink(entry.sourceLink) } : {}),
        })))
        : undefined;
    const historyBack = await repairStack(desc.historyBack);
    const historyForward = await repairStack(desc.historyForward);
    const { navBack: _legacyNavBack, ...normalized } = desc;
    return { ...normalized, editors, historyBack, historyForward };
}

async function repairPipePath<T extends { provider: { config: Record<string, unknown> } }>(pipe: T): Promise<T> {
    const path = pipe.provider.config.path;
    if (typeof path !== "string") return pipe;
    const repairedPath = await repairBoardLink(path);
    return repairedPath === path ? pipe : {
        ...pipe,
        provider: { ...pipe.provider, config: { ...pipe.provider.config, path: repairedPath } },
    };
}

async function repairStoredSourceLink<T extends object>(sourceLink: T): Promise<T> {
    const values = sourceLink as Record<string, unknown>;
    const repaired = { ...values };
    if ("href" in values) repaired.href = await repairBoardLink(values.href);
    if ("url" in values) repaired.url = await repairBoardLink(values.url);
    const pipeDescriptor = values.pipeDescriptor;
    if (isRecord(pipeDescriptor) && isRecord(pipeDescriptor.provider) && isRecord(pipeDescriptor.provider.config)) {
        repaired.pipeDescriptor = await repairPipePath(pipeDescriptor as {
            provider: { config: Record<string, unknown> };
        });
    }
    return repaired as T;
}

/** Added 2026-11-15: migrate the old Markdown-only stack into the page history shape. */
export function migrateLegacyPageHistory(desc: PageDescriptor): PageDescriptor {
    const historyBack = desc.historyBack ?? desc.navBack?.map((entry) => {
        const filePath = isFileUrl(entry.href) ? normalizeFileUrl(entry.href) : entry.href;
        return { filePath, target: EditorId.mdView, title: entry.title ?? entry.href };
    });
    const { navBack: _legacyNavBack, ...normalized } = desc;
    return {
        ...normalized,
        historyBack,
        historyForward: desc.historyForward ?? [],
    };
}

/** Added 2026-10-24: preserve legacy left pins and discard unsupported pin values. */
export function normalizePinSide(desc: Pick<PageDescriptor, "pinSide" | "pinned">): "left" | "right" | undefined {
    if (desc.pinSide === "left" || desc.pinSide === "right") return desc.pinSide;
    return desc.pinned ? "left" : undefined;
}

/** Added 2026-11-12: move legacy editor/host state types to descriptor identity, then discard them. */
export function migrateLegacyEditorStateType(descriptor: EditorDescriptor): EditorDescriptor {
    const state = { ...descriptor.state };
    const legacyType = state.type;
    delete state.type;

    const host = descriptor.host
        ? { ...descriptor.host, state: { ...descriptor.host.state } }
        : undefined;
    if (host) delete host.state.type;

    const editorId = !descriptor.host && descriptor.editorId !== InternalEditorIds.explorer && legacyType === "fileExplorer"
        ? InternalEditorIds.explorer
        : descriptor.editorId;
    return { ...descriptor, editorId, state, ...(host ? { host } : {}) };
}

/** Move pre-HS1 Grid settings into the host-owned editor settings slot. */
export function promoteLegacyGridSettings(descriptor: EditorDescriptor): EditorDescriptor {
    const editorId = descriptor.editorId;
    if (editorId !== EditorId.gridJson && editorId !== EditorId.gridCsv && editorId !== EditorId.gridJsonl) {
        return descriptor;
    }
    if (!descriptor.host) return descriptor;

    const legacyKeys = ["columns", "filters", "search", "sortColumn", "csvDelimiter", "csvWithColumns", "focus"] as const;
    const state = { ...descriptor.state };
    if (!legacyKeys.some((key) => state[key] !== undefined)) return descriptor;

    const hostState = { ...descriptor.host.state };
    const editorSettings = isRecord(hostState.editorSettings) ? { ...hostState.editorSettings } : {};
    if (editorSettings[editorId] === undefined) {
        editorSettings[editorId] = {
            columns: state.columns ?? [],
            filters: state.filters ?? [],
            search: state.search ?? "",
            sortColumn: state.sortColumn,
            csvDelimiter: state.csvDelimiter ?? ",",
            csvWithColumns: state.csvWithColumns ?? false,
            focus: state.focus,
        };
    }
    for (const key of legacyKeys) delete state[key];
    hostState.editorSettings = editorSettings;
    return { ...descriptor, state, host: { ...descriptor.host, state: hostState } };
}

/** Move legacy Explorer-owned Boards and Clipboard panels to their own editors. */
export function migrateLegacyExplorerPanels(desc: PageDescriptor): PageDescriptor {
    const legacyExplorer = desc.editors.filter(descriptor =>
        descriptor.editorId === InternalEditorIds.explorer
        && ("boardsOpen" in descriptor.state || "clipboardOpen" in descriptor.state || "hideExplorer" in descriptor.state),
    );
    if (!legacyExplorer.length) return desc;

    const editors = [...desc.editors];
    let activePanel = desc.sidebar?.activePanel;
    for (const legacy of legacyExplorer) {
        const state = { ...legacy.state };
        const boardsOpen = state.boardsOpen === true;
        const clipboardOpen = state.clipboardOpen === true;
        const hideExplorer = state.hideExplorer === true;
        delete state.boardsOpen;
        delete state.clipboardOpen;
        delete state.hideExplorer;

        const legacyIndex = editors.indexOf(legacy);
        editors.splice(legacyIndex, 1);
        if (!hideExplorer) {
            state.secondaryView = ["explorer", ...(state.searchState ? ["search"] : [])];
            editors.splice(legacyIndex, 0, { ...legacy, state });
        }

        const existingBoards = editors.find(descriptor => descriptor.editorId === InternalEditorIds.boards
            && Array.isArray(descriptor.state.secondaryView)
            && descriptor.state.secondaryView.includes("boards"));
        const boards = !hideExplorer && boardsOpen
            ? existingBoards ?? {
                editorId: InternalEditorIds.boards,
                id: crypto.randomUUID(),
                state: { secondaryView: ["boards"] },
            }
            : undefined;
        if (boards && !existingBoards) editors.splice(Math.min(legacyIndex + 1, editors.length), 0, boards);

        const existingClipboard = editors.find(descriptor => descriptor.editorId === InternalEditorIds.clipboard
            && Array.isArray(descriptor.state.secondaryView)
            && descriptor.state.secondaryView.includes("clipboard"));
        const clipboard = clipboardOpen
            ? existingClipboard ?? {
                editorId: InternalEditorIds.clipboard,
                id: crypto.randomUUID(),
                state: { secondaryView: ["clipboard"] },
            }
            : undefined;
        if (clipboard && !existingClipboard) {
            const insertionIndex = !hideExplorer && boards ? legacyIndex + 2 : legacyIndex;
            editors.splice(Math.min(insertionIndex, editors.length), 0, clipboard);
        }

        if (activePanel?.startsWith(`${legacy.id}::`)) {
            const panelId = activePanel.slice(legacy.id.length + 2);
            if (panelId === "boards" && boards) activePanel = `${boards.id}::boards`;
            else if (panelId === "clipboard" && clipboard) activePanel = `${clipboard.id}::clipboard`;
        }
    }

    return {
        ...desc,
        editors,
        ...(desc.sidebar && activePanel !== desc.sidebar.activePanel
            ? { sidebar: { ...desc.sidebar, activePanel: activePanel! } }
            : {}),
    };
}

export async function normalizePageDescriptor(desc: PageDescriptor): Promise<PageDescriptor> {
    const withBoardIds = (await Promise.all(desc.editors.map(migratePersistedBoardRootsAndIds)))
        .map(migrateLegacyEditorStateType)
        .map(promoteLegacyGridSettings);
    const withEditorMigrations = migrateLegacyExplorerPanels({ ...desc, editors: withBoardIds });
    return migratePersistedBoardLinks(migrateLegacyPageHistory(withEditorMigrations));
}
