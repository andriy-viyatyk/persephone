import type { IContentPipe } from "../types/io.pipe";
import { pages } from "../pages";
import { asBoardHostEditor } from "./board-host-editor";

export async function resolveBoardPagePipe(pageId: string): Promise<IContentPipe | undefined> {
    const editor = asBoardHostEditor(pages.query.findPage(pageId)?.mainEditor);
    if (typeof editor?.resolveStreamPipe !== "function") return undefined;
    if (editor.pipeUrlEnabled !== true) throw new Error("The board pipe page is unavailable.");
    return editor.resolveStreamPipe();
}
