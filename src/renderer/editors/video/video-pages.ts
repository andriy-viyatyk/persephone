import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { editorRegistry } from "../base/editorRegistry";
import { VideoEditor } from "./VideoEditor";
import type { PagesModel } from "../../api/pages/PagesModel";

export async function openSiteActionVideo(
    model: PagesModel,
    request: ParsedHttpRequest,
    isCurrent: () => boolean,
): Promise<boolean> {
    const editor = await editorRegistry.createEditor("video-view");
    if (!(editor instanceof VideoEditor)) throw new Error("Video editor was not created");
    if (!isCurrent()) {
        await editor.dispose();
        return false;
    }
    model.lifecycle.addPage(editor);
    await editor.submitValidatedRequest(request);
    return true;
}
