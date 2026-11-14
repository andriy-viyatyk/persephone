import type { ILink } from "../../api/types/io.tree";
import { TraitKey } from "./traits";

// ── Trait interface ──────────────────────────────────────────────────────────

/** Trait for data that can be represented as ILink items. */
export interface LinkTrait {
    /** Get the draggable ILink items from the source data. */
    getItems(data: unknown): ILink[];
    /** Optional source identifier for same-source detection. */
    getSourceId?(data: unknown): string | undefined;
}

/** Trait key for link data. */
export const LINK = new TraitKey<LinkTrait>("Link");

/** Data shape for ILink drag payload. */
export interface LinkDragData {
    items: ILink[];
    sourceId?: string;
}
