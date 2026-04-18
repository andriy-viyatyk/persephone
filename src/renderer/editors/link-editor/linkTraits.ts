import type { ILink } from "../../api/types/io.tree";
import { TraitKey, TraitSet, TraitTypeId, traitRegistry } from "../../core/traits";

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

// ── ILink trait registration ─────────────────────────────────────────────────

/** Data shape for ILink drag payload. */
export interface LinkDragData {
    items: ILink[];
    sourceId?: string;
}

const linkTraits = new TraitSet()
    .add(LINK, {
        getItems: (data: unknown) => (data as LinkDragData).items,
        getSourceId: (data: unknown) => (data as LinkDragData).sourceId,
    });

traitRegistry.register(TraitTypeId.ILink, linkTraits);
