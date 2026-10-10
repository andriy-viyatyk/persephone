import type { MenuItem } from "../core/events/context-menu";
import { app } from "../api/app";
import { ui } from "../api/ui";
import { pagesModel } from "../api/pages";
import { getFileOpenEditorOptions } from "../editors/base/editor-switch-options";
import { parseBoardEditorId } from "../editors/board/custom-editor-registry";
import { createBoardGlyphElement } from "../editors/board/board-glyph-element";
import { ArchiveIcon, type SvgIconComponent } from "../theme/icons";
import { DefaultIcon, GridIcon, LinkIcon, NotebookIcon } from "../theme/language-icons";
import { openWithDefaultApp } from "./open-with-default-app";
import { t } from "../../shared/i18n/t";

/** Built-in editors with a recognisable icon; every other built-in (the Text Editor included)
 *  gets the generic file icon. */
const BUILT_IN_EDITOR_ICONS: Record<string, SvgIconComponent> = {
    "grid-json": GridIcon,
    "grid-csv": GridIcon,
    "grid-jsonl": GridIcon,
    "notebook-view": NotebookIcon,
    "link-view": LinkIcon,
    "archive-view": ArchiveIcon,
};

function editorOptionIcon(editorId: string): Element {
    const boardRoot = parseBoardEditorId(editorId);
    if (boardRoot !== null) return createBoardGlyphElement(boardRoot, 16);
    return (BUILT_IN_EDITOR_ICONS[editorId] ?? DefaultIcon).createElement({ width: 16, height: 16 });
}

/** Create the shared Open with submenu used by file trees and Recent Files. */
export function createOpenWithMenuItem(path: string): MenuItem {
    const options = getFileOpenEditorOptions(path);
    return {
        label: "Open with",
        icon: "open-link",
        items: [
            ...options.map(({ id, label, labelKey, labelParams }): MenuItem => ({
                id: `open-with:${id}`,
                label: labelKey ? t(labelKey, labelParams as never) : label,
                icon: editorOptionIcon(id),
                onClick: () => openWithEditor(path, id),
            })),
            {
                id: "open-with:default-app",
                label: "Default App",
                icon: "open-link",
                onClick: () => openWithDefaultApp(path),
            },
        ],
    };
}

/** Recheck a menu choice immediately before switching or opening the file. */
export async function openWithEditor(path: string, editorId: string): Promise<void> {
    if (!getFileOpenEditorOptions(path).some((option) => option.id === editorId)) {
        void ui.notify("This editor is no longer available for this file.", "warning");
        return;
    }

    const page = pagesModel.query.findPageByFilePath(path);
    if (!page) {
        await app.openRawLink(path, { editor: editorId });
        return;
    }

    pagesModel.navigation.showPage(page.id);
    if (page.mainEditorInstance?.editorId === editorId) return;
    await page.switchMainEditor(editorId);
    if (page.mainEditorInstance?.editorId !== editorId) {
        void ui.notify("The current page remains in its existing editor.", "info");
    }
}
