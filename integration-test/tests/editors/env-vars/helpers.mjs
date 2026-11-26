import path from "node:path";
import { closeOwnedPages } from "../../helpers/shell-helpers.mjs";
import { comparablePath } from "../../helpers/path-comparison.mjs";

export async function createStore(ctx, folder, filename, content = "{}\n") {
    const filePath = ctx.fixture(`${folder}/${filename}`);
    let originalPath = await ctx.app.settings.get("board-vars.file");
    const originalPathComparison = typeof originalPath === "string" ? comparablePath(originalPath) : "";
    const fixturePathPrefix = comparablePath(path.join("integration-test", ".profile", "work", "us-2052", "_")).slice(0, -1);
    if (originalPathComparison.includes(fixturePathPrefix)) {
        await ctx.app.settings.set("board-vars.file", "");
        originalPath = "";
    }
    const existing = await ctx.app.pages.all;
    const stalePageIds = existing.filter((page) => page.filePath === filePath).map((page) => page.id);
    await closeOwnedPages(ctx, stalePageIds);
    await ctx.app.fs.write(filePath, content);
    await ctx.app.settings.set("board-vars.file", filePath);
    return { filePath, originalPath };
}

export async function openEnvVarsFromSettings(ctx) {
    const before = await ctx.app.pages.all;
    const existingIds = new Set(before.map((page) => page.id));
    const hadSettingsPage = before.some((page) => page.editor === "settings-view");
    await ctx.app.pages.showSettingsPage();
    await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.some((page) => page.editor === "settings-view"));
    await ctx.app.window.screen.click('[data-name="settings-section-board-vars"]');
    await ctx.app.window.screen.click('text="Open Environment Variables"');
    const page = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.find((entry) => !existingIds.has(entry.id) && entry.editor === "env-vars-view"));
    const envPage = page.find((entry) => !existingIds.has(entry.id) && entry.editor === "env-vars-view");
    const settingsPage = page.find((entry) => entry.editor === "settings-view");
    return {
        id: envPage.id,
        node: ctx.handle(ctx.app.pages[envPage.id]),
        settingsPageId: !hadSettingsPage ? settingsPage?.id : undefined,
    };
}

export async function closeEnvPage(ctx, page) {
    if (page?.id) await closeOwnedPages(ctx, [page.id]);
}

export async function restoreStore(ctx, store, page) {
    await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("dialogs[0].cancel", [], { dialog: true }).catch(() => {});
    await closeEnvPage(ctx, page);
    if (page?.settingsPageId) await closeOwnedPages(ctx, [page.settingsPageId]);
    if (store?.originalPath !== undefined) await ctx.app.settings.set("board-vars.file", store.originalPath);
}

export async function screenSnapshot(ctx) {
    return ctx.callText("window.screen.snapshot", [{ maxChars: 16000 }]);
}
