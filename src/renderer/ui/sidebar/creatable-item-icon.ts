import type { CreatableItem } from "../../api/creatable-items";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";

/** A fresh icon node for a creatable item: its own factory, or the bundled-board glyph. */
export function createCreatableItemIcon(item: CreatableItem): Node | undefined {
    return item.boardRoot ? createBoardGlyphElement(item.boardRoot) : item.createIcon?.();
}
