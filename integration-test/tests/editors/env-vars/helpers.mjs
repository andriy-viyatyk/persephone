import { closeOwnedPages } from "../../helpers/shell-helpers.mjs";

export async function createStore(ctx, folder, filename, content = "{}\n") {
    const filePath = ctx.fixture(`${folder}/${filename}`);
    let originalPath = await ctx.call("settings.get", ["board-vars.file"]);
    if (typeof originalPath === "string" && originalPath.toLowerCase().includes("\\integration-test\\.profile\\work\\us-2052\\")) {
        await ctx.call("settings.set", ["board-vars.file", ""]);
        originalPath = "";
    }
    const existing = await ctx.call("pages.all");
    const stalePageIds = existing.filter((page) => page.filePath === filePath).map((page) => page.id);
    await closeOwnedPages(ctx, stalePageIds);
    await ctx.call("fs.write", [filePath, content]);
    await ctx.call("settings.set", ["board-vars.file", filePath]);
    return { filePath, originalPath };
}

export async function openEnvVarsFromSettings(ctx) {
    const before = await ctx.call("pages.all");
    const existingIds = new Set(before.map((page) => page.id));
    const hadSettingsPage = before.some((page) => page.editor === "settings-view");
    await ctx.call("pages.showSettingsPage", []);
    await ctx.waitFor("pages.all", (pages) => pages.some((page) => page.editor === "settings-view"));
    await ctx.call("window.screen.click", ['[data-name="settings-section-board-vars"]']);
    await ctx.call("window.screen.click", ['text="Open Environment Variables"']);
    const page = await ctx.waitFor("pages.all", (pages) => pages.find((entry) => !existingIds.has(entry.id) && entry.editor === "env-vars-view"));
    const envPage = page.find((entry) => !existingIds.has(entry.id) && entry.editor === "env-vars-view");
    const settingsPage = page.find((entry) => entry.editor === "settings-view");
    return {
        id: envPage.id,
        root: `pages[${JSON.stringify(envPage.id)}]`,
        settingsPageId: !hadSettingsPage ? settingsPage?.id : undefined,
    };
}

export async function closeEnvPage(ctx, page) {
    if (page?.id) await closeOwnedPages(ctx, [page.id]);
}

export async function restoreStore(ctx, store, page) {
    await ctx.call("dialogs[0].cancel", [], { dialog: true }).catch(() => {});
    await closeEnvPage(ctx, page);
    if (page?.settingsPageId) await closeOwnedPages(ctx, [page.settingsPageId]);
    if (store?.originalPath !== undefined) await ctx.call("settings.set", ["board-vars.file", store.originalPath]);
}

export async function screenSnapshot(ctx) {
    return ctx.callText("window.screen.snapshot", [{ maxChars: 16000 }]);
}
