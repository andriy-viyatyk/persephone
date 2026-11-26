import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

// "webgl": the game renders with WebGL2, which Linux test machines lack (src/shared/test-requirements.ts).
const requiresPublishedBoard = { requires: ["launch", "published-board-checkout", "webgl"] };

async function getGemKeepReadiness(editor) {
    return editor.evaluate(`() => {
        const canvas = document.querySelector('canvas#view[data-name="game-view"]');
        const bounds = canvas?.getBoundingClientRect();
        const menu = document.querySelector('#menu');
        const menuError = document.querySelector('#menu-error');
        let webglAvailable = false;
        try {
            webglAvailable = Boolean(canvas?.getContext('webgl2'));
        } catch {}
        return {
            canvasPresent: Boolean(canvas),
            width: bounds?.width ?? 0,
            height: bounds?.height ?? 0,
            webglAvailable,
            menuVisible: Boolean(menu && !menu.hidden && getComputedStyle(menu).display !== 'none'),
            menuError: menuError?.textContent?.trim() ?? '',
            menuErrorHidden: Boolean(menuError?.hidden),
        };
    }`);
}

async function waitForGemKeepCanvas(ctx, editor) {
    try {
        return await ctx.waitFor(
            async () => {
                try {
                    return await getGemKeepReadiness(editor);
                } catch {
                    return null;
                }
            },
            (state) => state?.canvasPresent && state.width > 0 && state.height > 0 && state.webglAvailable,
            { timeout: 15000 },
        );
    } catch (error) {
        let diagnostic;
        try {
            diagnostic = await getGemKeepReadiness(editor);
        } catch {
            diagnostic = null;
        }
        throw new Error(
            `Gem Keep WebGL/canvas readiness failed within 15 seconds. Diagnostics: ${JSON.stringify(diagnostic)}. ${error?.message ?? error}`,
        );
    }
}

async function getLevelMenu(ctx, editor) {
    try {
        return await ctx.waitFor(
            async () => {
                try {
                    return await editor.evaluate(`() => Array.from(document.querySelectorAll('#level-list [data-name^="level-"]')).map((card) => ({
                        id: card.dataset.name,
                        name: card.querySelector('b')?.textContent?.trim() ?? '',
                        description: card.querySelector('small')?.textContent?.trim() ?? '',
                        disabled: card.disabled,
                    }))`);
                } catch {
                    return null;
                }
            },
            (entries) => Array.isArray(entries) && entries.length === 3,
            { timeout: 15000 },
        );
    } catch (error) {
        throw new Error(`Gem Keep level menu did not load three entries: ${error?.message ?? error}`);
    }
}

export default [
    test("opens the level menu with a functioning WebGL canvas", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "gem-keep");
            const readiness = await waitForGemKeepCanvas(ctx, handle.editor);
            ctx.expect(readiness.menuVisible).toBe(true);
            ctx.expect(readiness.menuError).toBe("");
            ctx.expect(readiness.menuErrorHidden).toBe(true);
            ctx.expect(readiness.width > 0 && readiness.height > 0).toBe(true);

            const snapshot = await handle.editor.snapshot();
            ctx.expect(snapshot).toContain("Green Meadow");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("loads the level list from levels/index.json", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "gem-keep");
            await waitForGemKeepCanvas(ctx, handle.editor);
            const entries = await getLevelMenu(ctx, handle.editor);
            ctx.expect(entries.map(({ id, name }) => ({ id, name }))).toEqual([
                { id: "level-1", name: "Green Meadow" },
                { id: "level-2", name: "Red Canyon" },
                { id: "level-3", name: "Frost Pass" },
            ]);
            ctx.expect(entries[0].disabled).toBe(false);
            ctx.expect(entries[1].disabled).toBe(true);
            ctx.expect(entries[2].disabled).toBe(true);

            const menuError = await handle.editor.evaluate(
                "() => document.querySelector('#menu-error')?.textContent?.trim() ?? ''",
            );
            ctx.expect(menuError).toBe("");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("starts Green Meadow and renders its initial HUD without starting a wave", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "gem-keep");
            await waitForGemKeepCanvas(ctx, handle.editor);
            await handle.editor.click('[data-name="level-1"]');

            let hud;
            try {
                hud = await ctx.waitFor(
                    async () => {
                        try {
                            return await handle.editor.evaluate(`() => {
                                const hud = document.querySelector('#hud');
                                const menuError = document.querySelector('#menu-error');
                                const canvas = document.querySelector('canvas#view');
                                const bounds = canvas?.getBoundingClientRect();
                                const waveButton = document.querySelector('#wave-button');
                                return {
                                    visible: Boolean(hud && !hud.hidden && getComputedStyle(hud).display !== 'none'),
                                    error: menuError?.textContent?.trim() ?? '',
                                    wave: document.querySelector('#wave')?.textContent?.trim() ?? '',
                                    gold: document.querySelector('#gold')?.textContent?.trim() ?? '',
                                    gems: document.querySelector('#gems')?.textContent?.trim() ?? '',
                                    canvasWidth: bounds?.width ?? 0,
                                    canvasHeight: bounds?.height ?? 0,
                                    waveButtonEnabled: Boolean(waveButton && !waveButton.disabled),
                                };
                            }`);
                        } catch {
                            return null;
                        }
                    },
                    (state) => state?.visible && state.error === "" && state.wave.length > 0,
                    { timeout: 15000 },
                );
            } catch (error) {
                let diagnostic;
                try {
                    diagnostic = await handle.editor.evaluate(
                        "() => ({ hudVisible: Boolean(document.querySelector('#hud') && !document.querySelector('#hud').hidden), menuError: document.querySelector('#menu-error')?.textContent?.trim() ?? '' })",
                    );
                } catch {
                    diagnostic = null;
                }
                throw new Error(
                    `Gem Keep level/WebGL HUD did not become ready within 15 seconds. Diagnostics: ${JSON.stringify(diagnostic)}. ${error?.message ?? error}`,
                );
            }

            ctx.expect(hud.gold).toBe("255");
            ctx.expect(hud.gems).toBe("20");
            ctx.expect(hud.wave.length > 0).toBe(true);
            ctx.expect(hud.canvasWidth > 0 && hud.canvasHeight > 0).toBe(true);
            ctx.expect(hud.waveButtonEnabled).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
