import { close, open } from "../../helpers/pilot-helpers.mjs";

export const collectionContent = JSON.stringify({
    links: [
        { id: "docs", title: "Documentation", href: "https://example.com/docs", category: "Reference", tags: ["guide", "web"] },
        { id: "tools", title: "Developer Tools", href: "https://tools.example.net/", category: "Reference/Tools", tags: ["cli"] },
        { id: "news", title: "News", href: "https://news.example.org/", category: "Reading", tags: ["web"] },
    ],
    state: {},
}, null, 2) + "\n";

export async function openLinksPage(ctx, folder, filename = "collection.link.json", content = collectionContent) {
    return open(ctx, `${folder}/${filename}`, content, "link-view");
}

export async function reopenLinksPage(ctx, filePath) {
    const page = await ctx.app.pages.openFile(filePath);
    const node = ctx.handle(ctx.app.pages[page.id]);
    await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "link-view");
    return { ...page, node, filePath };
}

export async function closeLinksPage(ctx, page) {
    if (!page) return;
    if (await ctx.app.pages[page.id].modified) {
        await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
        await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
        await ctx.app.pages[page.id].editor.saveFile();
        await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false);
    }
    await close(ctx, page.id);
}

export async function screenSnapshot(ctx) {
    return ctx.callText("window.screen.snapshot", [{ maxChars: 16000 }]);
}
