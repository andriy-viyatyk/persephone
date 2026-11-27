import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";
import { registerPublishedBoard } from "../../helpers/published-boards.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };
const savedThemeName = "US-2105 Synthetic Theme";

async function readThemeState(ctx) {
    const originalTheme = await ctx.app.settings.theme;
    const themes = await ctx.call("themes.list", [], { maxLength: 1000000 });
    const originalCustomIds = new Set(themes.filter(({ id }) => id.startsWith("custom-")).map(({ id }) => id));
    return { originalTheme, originalCustomIds };
}

async function waitForThemeEditor(ctx, id) {
    return ctx.waitFor(
        async (active) => {
            try {
                const editor = active.app.pages[id].editor.app;
                return { draft: await editor.draft, derived: await editor.derived };
            } catch {
                return null;
            }
        },
        (state) => state?.draft != null && state.derived != null,
    );
}

async function waitForPreview(ctx, id) {
    return ctx.waitFor(
        async (active) => {
            try {
                return await active.app.pages[id].editor.app.previewStatus;
            } catch {
                return null;
            }
        },
        (value) => value?.pending === false,
    );
}

async function waitForDerivedBackground(ctx, id) {
    return ctx.waitFor(
        async (active) => {
            try {
                const editor = active.app.pages[id].editor.app;
                return {
                    background: await editor.derived.colors["--color-bg-default"],
                    busy: await editor.busy,
                };
            } catch {
                return null;
            }
        },
        (value) => value?.background === "#101820" && value.busy === false,
    );
}

async function waitForLowContrast(ctx, id) {
    return ctx.waitFor(
        async (active) => {
            try {
                return await active.app.pages[id].editor.app.contrast["text-default/bg-default"];
            } catch {
                return null;
            }
        },
        (value) => value?.meetsAA === false,
    );
}

async function setBaseColors(editor) {
    await editor.app.setBaseColor("background", "#101820");
    await editor.app.setBaseColor("text", "#f0f0f0");
    await editor.app.setBaseColor("accent", "#4a90e2");
}

async function cleanupThemeEditor(ctx, handle, root, originalTheme, originalCustomIds, createdIds = new Set()) {
    let cleanupError;
    const attempt = async (action) => {
        try {
            await action();
        } catch (error) {
            cleanupError ??= error;
        }
    };

    if (handle?.id) {
        // Best effort: discard an unsaved draft before its source theme is deleted. Closing the page ends the
        // preview anyway, and revert refuses once the draft's saved theme was removed by the test.
        try {
            const editor = handle.editor ?? ctx.app.pages[handle.id].editor;
            // The board rejects revert while it is still loading or generating; an unreverted new draft
            // leaves the page modified, and closing it then opens an Unsaved Changes dialog.
            await ctx.waitFor(async () => {
                try { return await editor.app.busy; } catch { return null; }
            }, (busy) => busy === false);
            const draft = await editor.app.draft;
            if (draft != null) await editor.app.revert();
        } catch { /* see above */ }
    }
    if (originalCustomIds) {
        await attempt(async () => {
            const themes = await ctx.call("themes.list", [], { maxLength: 1000000 });
            const listed = new Set(themes.map(({ id }) => id));
            const idsToDelete = new Set([
                ...themes.filter(({ id }) => id.startsWith("custom-") && !originalCustomIds.has(id)).map(({ id }) => id),
                ...[...createdIds].filter((id) => listed.has(id)),
            ]);
            for (const id of idsToDelete) {
                await attempt(() => ctx.app.themes.delete(id));
            }
        });
    }
    if (originalTheme !== undefined) {
        await attempt(() => ctx.app.themes.apply(originalTheme));
    }
    await attempt(() => closePublishedSample(ctx, handle ?? { root }));

    if (cleanupError) throw cleanupError;
}

export default [
    test("opens and derives a draft from base colors", async (ctx) => {
        let handle;
        let originalTheme;
        let originalCustomIds;
        try {
            handle = await openPublishedBoard(ctx, "theme-editor");
            ({ originalTheme, originalCustomIds } = await readThemeState(ctx));
            await waitForThemeEditor(ctx, handle.id);
            const editor = handle.editor;
            await setBaseColors(editor);
            await waitForDerivedBackground(ctx, handle.id);

            const derived = await editor.app.derived;
            const contrast = await editor.app.contrast;
            ctx.expect(derived.colors["--color-bg-default"]).toBe("#101820");
            ctx.expect(derived.colors["--color-text-default"]).toBe("#f0f0f0");
            ctx.expect(typeof contrast["text-default/bg-default"].ratio).toBe("number");
            ctx.expect(typeof contrast["text-default/bg-default"].meetsAA).toBe("boolean");
            await waitForPreview(ctx, handle.id);
        } finally {
            await cleanupThemeEditor(ctx, handle, undefined, originalTheme, originalCustomIds);
        }
    }, requiresPublishedBoard),

    test("saves and lists a selectable custom theme", async (ctx) => {
        let handle;
        let originalTheme;
        let originalCustomIds;
        const createdIds = new Set();
        try {
            handle = await openPublishedBoard(ctx, "theme-editor");
            ({ originalTheme, originalCustomIds } = await readThemeState(ctx));
            await waitForThemeEditor(ctx, handle.id);
            const editor = handle.editor;
            await setBaseColors(editor);
            await waitForDerivedBackground(ctx, handle.id);

            ctx.expect(await editor.app.saveAs(savedThemeName)).toBe(true);
            const id = await editor.app.sourceId;
            createdIds.add(id);
            ctx.expect((await ctx.app.themes.get(id)).name).toBe(savedThemeName);
            const listed = await ctx.waitFor(
                async (active) => {
                    try {
                        return {
                            editorThemes: await active.app.pages[handle.id].editor.app.themes,
                            appThemes: await active.call("themes.list", [], { maxLength: 1000000 }),
                        };
                    } catch {
                        return null;
                    }
                },
                (value) => value?.editorThemes.some((theme) => theme.id === id && theme.name === savedThemeName && theme.kind === "custom")
                    && value.appThemes.some((theme) => theme.id === id && theme.name === savedThemeName && theme.colors),
            );
            ctx.expect(listed.editorThemes.some((theme) => theme.id === id && theme.kind === "custom")).toBe(true);
            ctx.expect(listed.appThemes.some((theme) => theme.id === id && theme.name === savedThemeName)).toBe(true);
            await ctx.app.themes.apply(id);
            ctx.expect(await ctx.app.settings.theme).toBe(id);
        } finally {
            await cleanupThemeEditor(ctx, handle, undefined, originalTheme, originalCustomIds, createdIds);
        }
    }, requiresPublishedBoard),

    test("renames then deletes a saved theme", async (ctx) => {
        let handle;
        let originalTheme;
        let originalCustomIds;
        const createdIds = new Set();
        try {
            handle = await openPublishedBoard(ctx, "theme-editor");
            ({ originalTheme, originalCustomIds } = await readThemeState(ctx));
            await waitForThemeEditor(ctx, handle.id);
            const editor = handle.editor;
            await setBaseColors(editor);
            await waitForDerivedBackground(ctx, handle.id);

            ctx.expect(await editor.app.saveAs(savedThemeName)).toBe(true);
            const id = await editor.app.sourceId;
            createdIds.add(id);
            const renamed = await editor.app.rename("US-2105 Renamed Theme");
            ctx.expect(renamed.id).toBe(id);
            ctx.expect(renamed.name).toBe("US-2105 Renamed Theme");
            ctx.expect((await ctx.app.themes.get(id)).name).toBe("US-2105 Renamed Theme");

            const deleted = await editor.app.deleteThemeCore();
            ctx.expect(deleted.nextSourceId).toBe("persephone");
            ctx.expect(await ctx.app.themes.file(id)).toBe(null);
        } finally {
            await cleanupThemeEditor(ctx, handle, undefined, originalTheme, originalCustomIds, createdIds);
        }
    }, requiresPublishedBoard),

    test("reports a low contrast pair", async (ctx) => {
        let handle;
        let originalTheme;
        let originalCustomIds;
        try {
            handle = await openPublishedBoard(ctx, "theme-editor");
            ({ originalTheme, originalCustomIds } = await readThemeState(ctx));
            await waitForThemeEditor(ctx, handle.id);
            const editor = handle.editor;
            await editor.app.setOverride("--color-text-default", "#111111");
            await editor.app.setOverride("--color-bg-default", "#111111");
            await waitForLowContrast(ctx, handle.id);

            const pair = (await editor.app.contrast)["text-default/bg-default"];
            ctx.expect(pair.meetsAA).toBe(false);
            ctx.expect(pair.ratio < 4.5).toBe(true);
        } finally {
            await cleanupThemeEditor(ctx, handle, undefined, originalTheme, originalCustomIds);
        }
    }, requiresPublishedBoard),

    test("opens from the theme.edit capability", async (ctx) => {
        let handle;
        let root;
        let originalTheme;
        let originalCustomIds;
        try {
            root = await registerPublishedBoard(ctx, "theme-editor");
            ({ originalTheme, originalCustomIds } = await readThemeState(ctx));

            const opened = await ctx.app.capabilities["theme.edit"].open({ mode: "new" });
            ctx.expect(opened.result.accepted).toBe(true);
            handle = { id: opened.pageId, root };
            // The draft appears before the board finishes loading; wait until it is also idle.
            const ready = await ctx.waitFor(
                async (active) => {
                    try {
                        const editorApp = active.app.pages[opened.pageId].editor.app;
                        return { draft: await editorApp.draft, busy: await editorApp.busy };
                    } catch {
                        return null;
                    }
                },
                (value) => value?.draft != null && value.busy === false,
            );
            ctx.expect(ready.draft).toBeTruthy();
        } finally {
            await cleanupThemeEditor(ctx, handle, root, originalTheme, originalCustomIds);
        }
    }, requiresPublishedBoard),
];
