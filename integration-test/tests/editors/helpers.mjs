import { close, open } from "../helpers/pilot-helpers.mjs";

export async function openMermaidPage(ctx, folder, filename, content) {
    return open(ctx, `${folder}/${filename}`, content, "mermaid-view");
}

export async function closeMermaidPage(ctx, page) {
    if (page) await close(ctx, page.id);
}
