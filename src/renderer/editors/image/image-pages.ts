import { editorRegistry } from "../base/editorRegistry";
import { ContentPipe } from "../../content/ContentPipe";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { ImageEditor } from "./ImageEditor";
import type { PagesModel } from "../../api/pages/PagesModel";

/** Open an image in a fresh page, preserving browser-session access when supplied. */
export async function openImageInNewTab(
    model: PagesModel,
    imageUrl: string,
    title?: string,
    sessionHandle?: string,
): Promise<void> {
    const editor = await editorRegistry.createEditor("image-view");
    if (!(editor instanceof ImageEditor)) throw new Error("Image editor was not created");
    editor.state.update((state) => {
        state.title = title || imageUrl.split("/").pop()?.split("?")[0] || "Image";
        if (!sessionHandle) state.url = imageUrl;
    });
    if (/^https?:\/\//i.test(imageUrl)) {
        editor.pipe = new ContentPipe(
            new HttpProvider(imageUrl, sessionHandle ? { sessionHandle } : undefined),
        );
    }
    await editor.restore();
    model.addPage(editor);

    if (imageUrl.startsWith("blob:")) void editor.cacheBlobUrl(imageUrl);
}
