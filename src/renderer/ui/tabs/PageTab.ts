import type { PageModel } from "../../api/pages/PageModel";

export const minTabWidth = 80;
const ICON_SLOT = 20;
const TAB_PADDING = 4;
// Mirrors the locked tab's 200px content width in PageTab.css plus its horizontal padding,
// borders, and the 2px tab gap in PageTabs.css.
export const LOCKED_TAB_WIDTH = 200 + TAB_PADDING + 2 + 2;
export const pinnedTabWidth = 2 * ICON_SLOT + TAB_PADDING;
export const pinnedTabEncryptedWidth = 3 * ICON_SLOT + TAB_PADDING;

export interface PageTabProps {
    model: PageModel;
    mode: "main" | "right";
    pinnedLeft?: number;
}
