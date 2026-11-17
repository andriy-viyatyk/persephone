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
    const page = await ctx.call("pages.openFile", [filePath]);
    const root = `pages[${JSON.stringify(page.id)}]`;
    await ctx.waitFor(`${root}.editor.id`, (editor) => editor === "link-view");
    return { ...page, root, filePath };
}

export async function closeLinksPage(ctx, page) {
    if (!page) return;
    if (await ctx.call(`${page.root}.modified`)) {
        await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
        await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "monaco");
        await ctx.call(`${page.root}.editor.saveFile`, []);
        await ctx.waitFor(`${page.root}.modified`, (modified) => modified === false);
    }
    await close(ctx, page.id);
}

export async function screenSnapshot(ctx) {
    return ctx.callText("window.screen.snapshot", [{ maxChars: 16000 }]);
}
