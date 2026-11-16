import { test } from "../../../lib/context.mjs";

const builtInThemeIds = [
    "persephone",
    "default-dark",
    "solarized-dark",
    "monokai",
    "persephone-light",
    "light-modern",
    "solarized-light",
    "quiet-light",
];

async function restoreSettings(ctx, values) {
    for (const [key, value] of values) {
        await ctx.call("settings.set", [key, value]);
    }
}

function escapedRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function savedSettingText(ctx, key, value) {
    const paths = await ctx.call("main.runtime.paths");
    const settingsPath = `${paths.userData}\\data\\appSettings.json`;
    const text = await ctx.callText("fs.read", [settingsPath], { maxLength: 12000 });
    const encodedValue = JSON.stringify(value);
    const entry = new RegExp(`"${escapedRegExp(key)}"\\s*:\\s*${escapedRegExp(encodedValue)}(?:[,\\n])`);
    return entry.test(text);
}

export default [
    test("settings round-trip boolean, number, string, and enum values", async (ctx) => {
        const original = [
            ["window.close-to-tray", await ctx.call("settings.get", ["window.close-to-tray"])],
            ["clipboard.max-items", await ctx.call("settings.get", ["clipboard.max-items"])],
            ["terminal.command", await ctx.call("settings.get", ["terminal.command"])],
            ["link-open-behavior", await ctx.call("settings.get", ["link-open-behavior"])],
        ];
        const changed = new Map([
            ["window.close-to-tray", !original[0][1]],
            ["clipboard.max-items", original[1][1] === 999 ? 998 : 999],
            ["terminal.command", original[2][1] === "uitest-shell-probe" ? "uitest-shell-probe-2" : "uitest-shell-probe"],
            ["link-open-behavior", original[3][1] === "internal-browser" ? "default-browser" : "internal-browser"],
        ]);

        try {
            for (const [key, value] of changed) {
                await ctx.call("settings.set", [key, value]);
                ctx.expect(await ctx.call("settings.get", [key])).toBe(value);
            }
        } finally {
            await restoreSettings(ctx, original);
        }
    }),

    test("clipboard item limit rejects or normalizes an invalid value", async (ctx) => {
        const original = await ctx.call("settings.get", ["clipboard.max-items"]);
        try {
            await ctx.call("settings.set", ["clipboard.max-items", 333]);
            ctx.expect(await ctx.call("settings.get", ["clipboard.max-items"])).toBe(333);

            let rejected = false;
            try {
                await ctx.call("settings.set", ["clipboard.max-items", 0]);
            } catch {
                rejected = true;
            }

            if (rejected) {
                ctx.expect(await ctx.call("settings.get", ["clipboard.max-items"])).toBe(333);
            } else {
                ctx.expect(await ctx.call("settings.get", ["clipboard.max-items"])).toBe(100);
            }
        } finally {
            await ctx.call("settings.set", ["clipboard.max-items", original]);
        }
    }),

    test("settings persist through an app restart", async (ctx) => {
        const key = "agent-tips.enabled";
        const original = await ctx.call("settings.get", [key]);
        const changed = !original;
        try {
            await ctx.call("settings.set", [key, changed]);
            ctx.expect(await ctx.waitFor((activeContext) => savedSettingText(activeContext, key, changed), Boolean)).toBe(true);

            await ctx.restartApp();
            ctx.expect(await ctx.call("settings.get", [key])).toBe(changed);
        } finally {
            await ctx.call("settings.set", [key, original]);
            await ctx.waitFor((activeContext) => savedSettingText(activeContext, key, original), Boolean);
        }
    }, { requires: ["launch"] }),

    test("built-in themes apply and custom themes can be created, applied, and deleted", async (ctx) => {
        const originalTheme = (await ctx.call("themes.current")).id;
        let customThemeId;
        try {
            const startingTheme = originalTheme === "default-dark" ? "persephone" : "default-dark";
            await ctx.call("themes.apply", [startingTheme]);
            ctx.expect((await ctx.call("themes.current")).id).toBe(startingTheme);

            for (const themeId of builtInThemeIds) {
                await ctx.call("themes.apply", [themeId]);
                ctx.expect((await ctx.call("themes.current")).id).toBe(themeId);
                ctx.expect(await ctx.call("settings.get", ["theme"])).toBe(themeId);

                if (themeId === "persephone" || themeId === "persephone-light") {
                    const definition = await ctx.call("themes.current");
                    const rendered = await ctx.call("window.screen.evaluate", [
                        "() => ({ background: getComputedStyle(document.documentElement).getPropertyValue('--color-bg-default').trim(), text: getComputedStyle(document.documentElement).getPropertyValue('--color-text-default').trim() })",
                    ]);
                    ctx.expect(definition.isDark).toBe(themeId === "persephone");
                    ctx.expect(rendered.background).toBe(definition.colors["--color-bg-default"]);
                    ctx.expect(rendered.text).toBe(definition.colors["--color-text-default"]);
                }
            }

            const draft = await ctx.call("themes.fork", ["persephone"]);
            draft.name = "US-2029 custom theme";
            draft.base.accent = "#4169e1";
            const saved = await ctx.call("themes.save", [draft]);
            customThemeId = saved.id;
            ctx.expect(typeof customThemeId).toBe("string");

            await ctx.call("themes.apply", [customThemeId]);
            ctx.expect((await ctx.call("themes.current")).id).toBe(customThemeId);

            await ctx.call("themes.delete", [customThemeId]);
            ctx.expect(await ctx.call("themes.file", [customThemeId])).toBe(null);
            ctx.expect(await ctx.call("settings.get", ["theme"])).toBe("persephone");
            customThemeId = undefined;
        } finally {
            if (customThemeId) {
                try { await ctx.call("themes.delete", [customThemeId]); } catch { /* Preserve the assertion that exposed cleanup failure. */ }
            }
            await ctx.call("themes.apply", [originalTheme]);
        }
    }),

    test("UI language changes to a shipped pack and returns to the previous language", async (ctx) => {
        const originalLanguage = await ctx.call("languages.current");
        const pagesBefore = await ctx.call("pages.all");
        const hadSettingsPage = pagesBefore.some((page) => page.editor === "settings-view");
        let openedSettingsPageId;
        const targetCode = originalLanguage.code.toLowerCase() === "uk" ? "en" : "uk";
        const targetDarkLabel = targetCode === "uk" ? "Темна" : "Dark";

        try {
            await ctx.call("pages.showSettingsPage", []);
            const settingsPages = await ctx.waitFor(
                "pages.all",
                (pages) => pages.filter((page) => page.editor === "settings-view").length > 0,
            );
            if (!hadSettingsPage) {
                openedSettingsPageId = settingsPages.find((page) => page.editor === "settings-view").id;
            }
            const beforeSnapshot = await ctx.callText("window.screen.snapshot", []);
            // The theme group heading is upper-cased by CSS, so compare case-insensitively.
            const hasLabel = (snapshot) => snapshot.toLocaleLowerCase().includes(targetDarkLabel.toLocaleLowerCase());
            ctx.expect(hasLabel(beforeSnapshot)).toBe(false);

            ctx.expect(await ctx.call("languages.apply", [targetCode])).toEqual({ code: targetCode, scheduled: true });
            await ctx.restartApp();
            await ctx.waitFor("languages.current", (locale) => locale.code.toLowerCase() === targetCode);
            await ctx.call("pages.showSettingsPage", []);
            const translatedSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", []),
                hasLabel,
            );
            ctx.expect(hasLabel(translatedSnapshot)).toBe(true);

            ctx.expect(await ctx.call("languages.apply", [originalLanguage.requested])).toEqual({
                code: originalLanguage.requested,
                scheduled: true,
            });
            await ctx.restartApp();
            const restoredLanguage = await ctx.waitFor(
                "languages.current",
                (locale) => locale.code === originalLanguage.code && locale.requested === originalLanguage.requested,
            );
            ctx.expect(restoredLanguage.code).toBe(originalLanguage.code);
        } finally {
            const currentLanguage = await ctx.call("settings.get", ["language"]);
            if (currentLanguage !== originalLanguage.requested) {
                await ctx.call("languages.apply", [originalLanguage.requested]);
                await ctx.restartApp();
                await ctx.waitFor("languages.current", (locale) => locale.requested === originalLanguage.requested);
            }
            if (openedSettingsPageId) {
                const pages = await ctx.call("pages.all");
                const openedPage = pages.find((page) => page.id === openedSettingsPageId);
                if (openedPage) await ctx.call("pages.closePage", [openedPage.id]);
            }
        }
    }, { requires: ["launch"] }),

    test("word wrap setting initializes a newly opened text page", async (ctx) => {
        const key = "editor.word-wrap";
        const original = await ctx.call("settings.get", [key]);
        const expected = !original;
        const title = "us-2029-word-wrap-probe";
        let createdPageId;
        try {
            await ctx.call("settings.set", [key, expected]);
            ctx.expect(await ctx.call("settings.get", [key])).toBe(expected);

            await ctx.call("pages.addEditorPage", ["monaco", "plaintext", title, "Word wrap setting probe.\n"]);
            const createdPages = await ctx.waitFor(
                "pages.all",
                (pages) => pages.filter((page) => page.title === title).length > 0,
            );
            const createdPage = createdPages.find((page) => page.title === title);
            createdPageId = createdPage.id;
            ctx.expect(await ctx.call(`pages[${JSON.stringify(createdPageId)}].editor.wordWrap`)).toBe(expected);
        } finally {
            const pages = await ctx.call("pages.all");
            const createdPage = pages.find((page) => page.id === createdPageId || page.title === title);
            if (createdPage) await ctx.call("pages.closePage", [createdPage.id]);
            await ctx.call("settings.set", [key, original]);
        }
    }),
];
