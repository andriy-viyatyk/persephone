import type { CreatableItem } from "../../api/creatable-items";
import { boardIdentity } from "../../editors/board/board-identity";

/** A fresh icon node for a creatable item: its own factory, or the bundled-board glyph. */
export function createCreatableItemIcon(item: CreatableItem): Node | undefined {
    return item.boardRoot ? boardIdentity.glyph(item.boardRoot) : item.createIcon?.();
}
