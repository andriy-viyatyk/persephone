import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage } from "../helpers.mjs";

async function dismissTorSetupNotifications(ctx) {
    const message = "Browser (Tor) requires tor.exe path";
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const activePageId = await ctx.app.pages.activePage.id;
        if (activePageId) await activatePage(ctx, activePageId);
        const snapshot = await ctx.callText("window.screen.snapshot", []).catch(() => "");
        const blocks = snapshot.split(/(?=- alert )/u);
        const block = blocks.find((item) => item.includes(message));
        if (!block) return;
        const button = block.match(/button \[ref=(e\d+)\]/u);
        if (!button) return;
        const currentCount = blocks.filter((item) => item.includes(message)).length;
        await ctx.app.window.screen.click({ ref: button[1] });
        await ctx.waitFor(
            (activeContext) => activeContext.callText("window.screen.snapshot", []),
            (value) => value.split(/(?=- alert )/u).filter((item) => item.includes(message)).length < currentCount,
        );
    }
}

export default [
    test("Tor page without tor.exe is refused and reports the setup notice", async (ctx) => {
        const setting = "tor.exe-path";
        const previousPath = await ctx.app.settings.get(setting);
        const priorPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        try {
            await ctx.app.settings.set(setting, "");
            await ctx.app.pages.showBrowserPage({ tor: true, url: ctx.httpUrl("/browser/page-tools/certificate.html") });
            const snapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", []),
                (value) => value.includes("Browser (Tor) requires tor.exe path"),
            );
            ctx.expect(snapshot).toContain("Configure it in Settings");
            const pages = await ctx.app.pages.all;
            ctx.expect(pages.some((page) => !priorPageIds.has(page.id) && page.editor === "browser-view")).toBe(false);
        } finally {
            await dismissTorSetupNotifications(ctx);
            try { await ctx.app.settings.set(setting, previousPath); } catch { /* Preserve the test result. */ }
        }
    }),

    test("Tor check page reports a Tor exit", async (ctx) => {
        const torPath = process.env.PERSEPHONE_TEST_TOR_EXE;
        if (!torPath) throw new Error("PERSEPHONE_TEST_TOR_EXE must name a usable tor.exe for this requires: [network, tor] test.");

        const setting = "tor.exe-path";
        const previousPath = await ctx.app.settings.get(setting);
        const priorPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        let page;
        try {
            await ctx.app.settings.set(setting, torPath);
            await ctx.app.pages.showBrowserPage({ tor: true, url: "https://check.torproject.org/api/ip" });
            const pages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (items) => items.some((item) => !priorPageIds.has(item.id) && item.editor === "browser-view"),
                { timeout: 90000 },
            );
            page = { id: pages.find((item) => !priorPageIds.has(item.id) && item.editor === "browser-view").id };
            const bodyText = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate("() => document.body.innerText"),
                (value) => typeof value === "string" && value.includes("IsTor"),
                { timeout: 90000 },
            );
            const result = JSON.parse(bodyText);
            ctx.expect(result.IsTor).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
            try { await ctx.app.settings.set(setting, previousPath); } catch { /* Preserve the test result. */ }
        }
    }, { requires: ["network", "tor"] }),
];
