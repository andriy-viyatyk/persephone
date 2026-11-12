import type { EditorDescriptor, PageDescriptor } from "../../../shared/persistence";
import {
    decodePersephoneBoardLink,
    encodePersephoneBoardLink,
} from "../../content/persephone-board-link";
import { boardRegistry } from "../boards/board-registry";
import { resolveBoardEditorId } from "../boards/custom-editor-registry";

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
        if (!isRecord(sourceLink)) return descriptor;
        const normalizedSourceLink = { ...sourceLink };
        if ("href" in sourceLink) normalizedSourceLink.href = await repairBoardLink(sourceLink.href);
        if ("url" in sourceLink) normalizedSourceLink.url = await repairBoardLink(sourceLink.url);
        return { ...descriptor, state: { ...descriptor.state, sourceLink: normalizedSourceLink } };
    }));
    const navBack = desc.navBack
        ? await Promise.all(desc.navBack.map(async (entry) => ({
            ...entry,
            href: String(await repairBoardLink(entry.href)),
        })))
        : undefined;
    return { ...desc, editors, navBack };
}

/** Added 2026-10-24: preserve legacy left pins and discard unsupported pin values. */
export function normalizePinSide(desc: Pick<PageDescriptor, "pinSide" | "pinned">): "left" | "right" | undefined {
    if (desc.pinSide === "left" || desc.pinSide === "right") return desc.pinSide;
    return desc.pinned ? "left" : undefined;
}

/** Added 2026-04-03: a host-less descriptor marked `type: "fileExplorer"` is the Explorer editor. */
export function migrateLegacyExplorerId(descriptor: EditorDescriptor): EditorDescriptor {
    if (descriptor.host || descriptor.editorId === "explorer" || descriptor.state.type !== "fileExplorer") {
        return descriptor;
    }
    return { ...descriptor, editorId: "explorer" };
}

export async function normalizePageDescriptor(desc: PageDescriptor): Promise<PageDescriptor> {
    const withBoardIds = (await Promise.all(desc.editors.map(migratePersistedBoardRootsAndIds)))
        .map(migrateLegacyExplorerId);
    const withEditorMigrations = { ...desc, editors: withBoardIds };
    return migratePersistedBoardLinks(withEditorMigrations);
}
