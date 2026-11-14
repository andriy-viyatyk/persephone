import { TraitKey } from "./traits";
import { TraitTypeId } from "./TraitRegistry";
import type { TraitDragPayload } from "./dnd";
import type { IFileLink } from "../../api/types/io.tree";

// ── Trait interface ──────────────────────────────────────────────────────────

// `IFileLink` (the item shape) lives in `api/types/io.tree.d.ts` alongside `ILink`
// so the script-API type bundle stays a self-contained leaf. Re-exported here for
// convenience so trait consumers can import it next to FILE_LINK.
export type { IFileLink };

/** Trait for a dragged object that can yield file-like items. */
export interface FileLinkTrait {
    getFiles(data: unknown): IFileLink[];
}

/** Trait key for droppable file content. */
export const FILE_LINK = new TraitKey<FileLinkTrait>("FileLink");

/** Serializable descriptor data for an OS file drop ({ typeId: OsFile, data }). */
export interface OsFileData {
    files: { name: string; path: string }[];
}

/**
 * Build the OsFile trait descriptor from resolved { name, path } entries. The global
 * capture-phase drop handler resolves the paths (`getPathForFile`) and attaches the
 * result to the drop event (see GlobalEventService). The descriptor is the same
 * serializable `{ typeId, data }` shape every trait drag uses.
 */
export function makeOsFileDescriptor(files: OsFileData["files"]): TraitDragPayload {
    return { typeId: TraitTypeId.OsFile, data: { files } };
}
