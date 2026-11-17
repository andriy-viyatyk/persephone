import { test } from "../../../lib/context.mjs";
import { closeShellPage } from "../../helpers/shell-helpers.mjs";

const settingsPageId = "settings-page";
const settingsEditorId = "settings-view";

async function openSettingsFromMenu(ctx) {
    const before = await ctx.app.pages.all;
    const beforeIds = new Set(before.map((page) => page.id));

    await ctx.app.window.openMenuBar();
    await ctx.waitFor(
        (active) => active.app.window.screen.evaluate("() => { const node = document.querySelector('[data-name=\\\"menubar-settings\\\"]'); return Boolean(node && node.getBoundingClientRect().width && node.getBoundingClientRect().height); }"),
        Boolean,
    );
    await ctx.app.window.screen.click('[data-name="menubar-settings"]');
    await ctx.waitFor(
        (active) => active.app.pages.all,
        (pages) => pages.some((page) => page.id === settingsPageId && page.editor === settingsEditorId),
    );
    await ctx.waitFor(
        (active) => active.app.window.screen.evaluate("() => Boolean(document.querySelector('[data-name=\\\"settings-root\\\"]'))"),
        Boolean,
    );

    return beforeIds;
}

async function closeCreatedSettingsPage(ctx, beforeIds) {
    if (beforeIds.has(settingsPageId)) return;
    const pages = await ctx.app.pages.all;
    if (!pages.some((page) => page.id === settingsPageId)) return;

    await closeShellPage(ctx, settingsPageId);
    await ctx.waitFor((active) => active.app.pages.all, (current) => !current.some((page) => page.id === settingsPageId));
}

async function settingsSectionIntersectsPanels(ctx, selector) {
    return ctx.app.window.screen.evaluate(`() => {
        const section = document.querySelector(${JSON.stringify(selector)});
        const panels = document.querySelector('[data-name="settings-panels"]');
        if (!section || !panels) return false;
        const sectionRect = section.getBoundingClientRect();
        const panelsRect = panels.getBoundingClientRect();
        return sectionRect.bottom > panelsRect.top && sectionRect.top < panelsRect.bottom;
    }`);
}

async function selectedTreeSection(ctx, sectionId) {
    const name = `settings-content-section-${sectionId}`;
    return ctx.app.window.screen.evaluate(`() => {
        const item = Array.from(document.querySelectorAll('[role="treeitem"]'))
            .find((node) => node.dataset.name === ${JSON.stringify(name)});
        return item?.getAttribute('aria-selected') === 'true';
    }`);
}

export default [
    test("Settings page opens from the Menu Bar gear", async (ctx) => {
        const beforeIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        try {
            await ctx.app.window.openMenuBar();
            await ctx.waitFor(
                (active) => active.app.window.screen.evaluate("() => Boolean(document.querySelector('[data-name=\\\"menubar-settings\\\"]'))"),
                Boolean,
            );
            await ctx.app.window.screen.click('[data-name="menubar-settings"]');
            const settingsPage = await ctx.waitFor(
                (active) => active.app.pages.all,
                (pages) => pages.find((page) => page.id === settingsPageId && page.editor === settingsEditorId),
            );
            ctx.expect(settingsPage.some((page) => page.id === settingsPageId && page.editor === settingsEditorId)).toBe(true);

            const structure = await ctx.waitFor(
                (active) => active.app.window.screen.evaluate("() => ['settings-root', 'settings-content', 'settings-content-tree', 'settings-panels'].every((name) => document.querySelector(`[data-name=\"${name}\"]`))"),
                Boolean,
            );
            ctx.expect(structure).toBe(true);
        } finally {
            await closeCreatedSettingsPage(ctx, beforeIds);
        }
    }),

    test("Every built-in Settings section has a rendered panel", async (ctx) => {
        const sections = await ctx.app.settings.sections;
        const beforeIds = await openSettingsFromMenu(ctx);
        try {
            const expectedNames = sections.map((section) => section.panelName);
            const missingNames = await ctx.waitFor(
                (active) => active.app.window.screen.evaluate(`() => {
                    const expected = ${JSON.stringify(expectedNames)};
                    const rendered = new Set(Array.from(document.querySelectorAll('[data-name="settings-panels"] [data-part="section-panel"]'))
                        .map((node) => node.dataset.name));
                    return expected.filter((name) => !rendered.has(name));
                }`),
                (missing) => missing.length === 0,
            );
            ctx.expect(missingNames).toEqual([]);
        } finally {
            await closeCreatedSettingsPage(ctx, beforeIds);
        }
    }),

    test("Settings Content tree navigation and panel scroll-spy stay in sync", async (ctx) => {
        const sections = await ctx.app.settings.sections;
        const beforeIds = await openSettingsFromMenu(ctx);
        try {
            await ctx.app.window.screen.click('[data-name="settings-content-section-theme"]');
            const themeSelectedAndVisible = await ctx.waitFor(
                async (active) => ({
                    visible: await settingsSectionIntersectsPanels(active, '[data-name="settings-section-theme"]'),
                    selected: await selectedTreeSection(active, "theme"),
                }),
                (state) => state.visible && state.selected,
            );
            ctx.expect(themeSelectedAndVisible.visible).toBe(true);
            ctx.expect(themeSelectedAndVisible.selected).toBe(true);

            const lastSection = sections.at(-1);
            ctx.expect(lastSection).toBeTruthy();
            await ctx.app.window.screen.evaluate("() => { const panels = document.querySelector('[data-name=\"settings-panels\"]'); panels.scrollTop = panels.scrollHeight; }");
            const lastSelected = await ctx.waitFor(
                (active) => selectedTreeSection(active, lastSection.id),
                Boolean,
            );
            ctx.expect(lastSelected).toBe(true);
        } finally {
            await closeCreatedSettingsPage(ctx, beforeIds);
        }
    }),

    test("settings.highlight points to the setting's section", async (ctx) => {
        const beforeIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        try {
            await ctx.app.settings.highlight("window.close-to-tray");
            await ctx.waitFor(
                (active) => active.app.pages.all,
                (pages) => pages.some((page) => page.id === settingsPageId && page.editor === settingsEditorId),
            );
            const sectionVisible = await ctx.waitFor(
                (active) => settingsSectionIntersectsPanels(active, '[data-name="settings-section-window-behavior"]'),
                Boolean,
            );
            ctx.expect(sectionVisible).toBe(true);
        } finally {
            await closeCreatedSettingsPage(ctx, beforeIds);
        }
    }),

    test("Settings page checkbox and app.settings stay synchronized", async (ctx) => {
        const key = "window.close-to-tray";
        const original = await ctx.app.settings.get(key);
        const beforeIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        let settingTouched = false;
        try {
            ctx.expect(typeof original).toBe("boolean");
            await openSettingsFromMenu(ctx);
            settingTouched = true;
            await ctx.app.window.screen.click('[data-name="settings-section-window-behavior"] [data-type="checkbox"]');
            const uiValue = await ctx.waitFor(
                (active) => active.app.settings.get(key),
                (value) => value === !original,
            );
            ctx.expect(uiValue).toBe(!original);

            await ctx.app.settings.set(key, original);
            const reflectedValue = await ctx.waitFor(
                (active) => active.app.window.screen.evaluate("() => document.querySelector('[data-name=\\\"settings-section-window-behavior\\\"] [data-type=\\\"checkbox\\\"]')?.getAttribute('data-checked')"),
                (value) => String(value) === String(original),
            );
            // A string result that is valid JSON text ("true") arrives parsed (true).
            ctx.expect(String(reflectedValue)).toBe(String(original));
        } finally {
            try {
                if (settingTouched) {
                    await ctx.app.settings.set(key, original);
                    await ctx.waitFor((active) => active.app.settings.get(key), (value) => value === original);
                }
            } finally {
                await closeCreatedSettingsPage(ctx, beforeIds);
            }
        }
    }),

    test("View Settings File opens appSettings.json", async (ctx) => {
        const beforeIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        let settingsFilePageId;
        try {
            await openSettingsFromMenu(ctx);
            await ctx.app.window.screen.click('[data-name="settings-view-file"]');
            const pages = await ctx.waitFor(
                (active) => active.app.pages.all,
                (current) => current.find((page) => !beforeIds.has(page.id) && page.filePath?.endsWith("appSettings.json")),
            );
            const settingsFilePage = pages.find((page) => !beforeIds.has(page.id) && page.filePath?.endsWith("appSettings.json"));
            settingsFilePageId = settingsFilePage?.id;
            ctx.expect(settingsFilePageId).toBeTruthy();
        } finally {
            try {
                if (settingsFilePageId) {
                    await closeShellPage(ctx, settingsFilePageId);
                    await ctx.waitFor((active) => active.app.pages.all, (pages) => !pages.some((page) => page.id === settingsFilePageId));
                }
            } finally {
                await closeCreatedSettingsPage(ctx, beforeIds);
            }
        }
    }),

    test("Window Behavior help control exposes its description", async (ctx) => {
        const beforeIds = await openSettingsFromMenu(ctx);
        try {
            const description = await ctx.waitFor(
                (active) => active.app.window.screen.evaluate("() => document.querySelector('[data-name=\\\"settings-section-window-behavior\\\"] [data-type=\\\"help-icon\\\"]')?.getAttribute('aria-description')"),
                (value) => typeof value === "string" && value.trim().length > 0,
            );
            ctx.expect(description.trim().length > 0).toBe(true);
        } finally {
            await closeCreatedSettingsPage(ctx, beforeIds);
        }
    }),
];
