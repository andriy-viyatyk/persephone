import { getLanguageByExtension } from "../core/utils/language-mapping";
import { fpExtname } from "../core/utils/file-path";
import { resolveEditorIdForFile } from "../api/boards/custom-editor-registry";

/**
 * Whether Persephone has its own editor or board for this local file: a dedicated built-in editor
 * (image, video, archive, Markdown, a `.note.json`…), an installed board that claims the file, or a
 * text language Monaco knows by extension. A file with none of these (an `.exe`, a `.docx`, a file
 * with no extension) belongs to the operating system's default application.
 *
 * Used by the browser Downloads popup to choose between opening a download in a tab and handing
 * it to Windows.
 */
export function canOpenInPersephone(filePath: string): boolean {
    const editorId = resolveEditorIdForFile(filePath);
    if (editorId && editorId !== "monaco") return true;
    const extension = fpExtname(filePath);
    return !!extension && !!getLanguageByExtension(extension);
}

/** Open a local file in a Persephone tab with its default editor or board, or show the tab that
 *  already has it open. */
export async function openInPersephone(filePath: string): Promise<void> {
    const { pagesModel } = await import("../api/pages");
    const page = pagesModel.query.findPageByFilePath(filePath);
    if (page) {
        pagesModel.navigation.showPage(page.id);
        return;
    }
    const { app } = await import("../api/app");
    await app.openRawLink(filePath);
}
