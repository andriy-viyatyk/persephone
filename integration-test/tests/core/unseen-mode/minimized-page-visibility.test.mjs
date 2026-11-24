import { test } from "../../../lib/context.mjs";
import { closeBrowserPage, fixturePage, openBrowserPage } from "../../browser/helpers.mjs";

const modePath = "main.unseenMode";

async function readVisibility(ctx, page) {
    return await ctx.app.pages[page.id].editor.evaluate(`() => {
        const read = (doc) => ({ state: doc.visibilityState, hidden: doc.hidden, changes: [...(doc.defaultView.visibilityChanges || [])] });
        const frame = document.querySelector("iframe");
        return {
            first: { state: window.firstVisibilityState, hidden: window.firstHidden },
            top: read(document),
            frame: frame?.contentDocument ? {
                first: { state: frame.contentWindow.firstVisibilityState, hidden: frame.contentWindow.firstHidden },
                ...read(frame.contentDocument),
            } : null,
        };
    }`);
}

async function waitForState(ctx, page, state, hidden) {
    return await ctx.waitFor(
        async () => readVisibility(ctx, page),
        (value) => value.top.state === state && value.top.hidden === hidden
            && value.frame?.state === state && value.frame.hidden === hidden,
    );
}

export default test("minimized browser pages expose unseen-mode visibility in every frame", async (ctx) => {
    const originalMode = await ctx.call(`${modePath}.enabled`);
    let page;
    let minimized = false;

    try {
        if (originalMode) await ctx.call(`${modePath}.disable`, []);
        page = await openBrowserPage(ctx, fixturePage(ctx, "unseen-mode", "index.html"));
        await ctx.waitFor(async () => readVisibility(ctx, page), (value) => value.frame !== null);

        await ctx.app.window.minimize();
        minimized = true;
        let state = await waitForState(ctx, page, "hidden", true);
        ctx.expect(state.top.changes.at(-1)).toMatchObject({ state: "hidden", hidden: true });
        ctx.expect(state.frame.changes.at(-1)).toMatchObject({ state: "hidden", hidden: true });

        await ctx.app.window.restore();
        minimized = false;
        await waitForState(ctx, page, "visible", false);
        await ctx.call(`${modePath}.enable`, []);
        await ctx.app.window.minimize();
        minimized = true;
        state = await waitForState(ctx, page, "visible", false);
        ctx.expect(state.top.changes.at(-1)).toMatchObject({ state: "visible", hidden: false });
        ctx.expect(state.frame.changes.at(-1)).toMatchObject({ state: "visible", hidden: false });

        await page.editor.evaluate(`window.location.href = ${JSON.stringify(fixturePage(ctx, "unseen-mode", "index.html?fresh=enabled"))}`);
        await ctx.waitFor(async () => readVisibility(ctx, page), (value) => value.frame !== null);
        state = await waitForState(ctx, page, "visible", false);
        // Electron's document-start visibility message is rewritten in the main process, so a new top
        // document's first script already reads visible; a subframe's first read may still be stale.
        ctx.expect(state.first.state).toBe("visible");
        ctx.expect(["visible", "hidden"]).toContain(state.frame.first.state);

        await ctx.call(`${modePath}.disable`, []);
        state = await waitForState(ctx, page, "hidden", true);
        ctx.expect(state.top.changes.filter((change) => change.state === "hidden")).toHaveLength(1);
        ctx.expect(state.frame.changes.filter((change) => change.state === "hidden")).toHaveLength(1);

        await page.editor.evaluate(`window.location.href = ${JSON.stringify(fixturePage(ctx, "unseen-mode", "index.html?fresh=disabled"))}`);
        await ctx.waitFor(async () => readVisibility(ctx, page), (value) => value.frame !== null);
        state = await waitForState(ctx, page, "hidden", true);
        // Electron starts a new webview top document as visible until its next visibility message, so
        // only the settled state is asserted for the top; the subframe reads Chromium's state directly.
        ctx.expect(["visible", "hidden"]).toContain(state.first.state);
        ctx.expect(state.frame.first.state).toBe("hidden");

        await ctx.app.window.restore();
        minimized = false;
        state = await waitForState(ctx, page, "visible", false);
        ctx.expect(state.top.changes.at(-1)).toMatchObject({ state: "visible", hidden: false });
        ctx.expect(state.frame.changes.at(-1)).toMatchObject({ state: "visible", hidden: false });
    } finally {
        if (minimized) await ctx.app.window.restore().catch(() => {});
        await closeBrowserPage(ctx, page);
        await ctx.call(originalMode ? `${modePath}.enable` : `${modePath}.disable`, []).catch(() => {});
    }
// The mode-off steps need real minimize/restore transitions of a window the user can see; on a
// locked screen or another virtual desktop the window is already occluded.
}, { requires: ["desktop"] });
