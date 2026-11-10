import { boardCatalog } from "../i18n/en/board";
import { editorsCatalog } from "../i18n/en/editors";
import { menusCatalog } from "../i18n/en/menus";

export const BOARD_HOST_TEXT_CATALOG = {
    openLink: { key: "board.openLink", message: boardCatalog.openLink.message },
    copyLink: { key: "editors.copyLink", message: editorsCatalog.copyLink.message },
    openImageInNewTab: { key: "board.openImageInNewTab", message: boardCatalog.openImageInNewTab.message },
    copyImage: { key: "board.copyImage", message: boardCatalog.copyImage.message },
    saveImageAs: { key: "board.saveImageAs", message: boardCatalog.saveImageAs.message },
    imageFileFilter: { key: "board.imageFileFilter", message: boardCatalog.imageFileFilter.message },
    allFilesFileFilter: { key: "board.allFilesFileFilter", message: boardCatalog.allFilesFileFilter.message },
    cut: { key: "menus.cut", message: menusCatalog.cut.message },
    copy: { key: "menus.copy", message: menusCatalog.copy.message },
    paste: { key: "menus.paste", message: menusCatalog.paste.message },
    saveImageDialogTitle: { key: "board.saveImageDialogTitle", message: boardCatalog.saveImageDialogTitle.message },
    failedToOpenImage: { key: "board.failedToOpenImage", message: boardCatalog.failedToOpenImage.message },
    failedToCopyImage: { key: "board.failedToCopyImage", message: boardCatalog.failedToCopyImage.message },
    imageSaved: { key: "board.imageSaved", message: boardCatalog.imageSaved.message },
    failedToSaveImage: { key: "board.failedToSaveImage", message: boardCatalog.failedToSaveImage.message },
    pasteFailed: { key: "board.pasteFailed", message: boardCatalog.pasteFailed.message },
} as const;

export type BoardHostTextId = keyof typeof BOARD_HOST_TEXT_CATALOG;
export const ENGLISH_BOARD_HOST_TEXT = Object.fromEntries(
    Object.entries(BOARD_HOST_TEXT_CATALOG).map(([id, entry]) => [id, entry.message]),
) as Record<BoardHostTextId, string>;
