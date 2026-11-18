import { createServer } from "node:http";
import { test } from "../../../lib/context.mjs";
import { closePage } from "../helpers.mjs";

const pageText = "US-2054 browser fixture";

function browserRoot(ctx, pageId) {
    return ctx.handle(ctx.app.pages[pageId].editor);
}

async function startServer() {
    const server = createServer((request, response) => {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        if (pathname === "/links") {
            response.end(`<!doctype html><title>${pageText}</title><body>${pageText}<a id="new-tab" href="/opened" target="_blank">Open internal tab</a><button id="window-open" onclick="window.open('/window-opened', '_blank')">Open with window.open</button></body>`);
            return;
        }
        response.end(`<!doctype html><title>${pageText}</title><body>${pageText}:${pathname}</body>`);
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    return {
        url: `http://127.0.0.1:${address.port}`,
        host: `127.0.0.1:${address.port}`,
        close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
}

async function openBrowser(ctx, url, options) {
    const pageId = await ctx.app.pages.openUrlInBrowserTab(...(options === undefined ? [url] : [url, options]));
    ctx.expect(pageId).toBeTruthy();
    const root = browserRoot(ctx, pageId);
    await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.id, (id) => id === "browser-view");
    await root.waitFor({ text: pageText, timeout: 10000 });
    return { id: pageId, node: root };
}

async function closeBrowser(ctx, page) {
    if (page?.id) await closePage(ctx, page.id);
}

async function detachIfAttached(ctx, page, host) {
    if (!page) return;
    await ctx.app.pages[page.id].editor.detachTestExtension(host).catch(() => {});
}

async function dismissTorSetupNotifications(ctx) {
    const message = "Browser (Tor) requires tor.exe path";
    for (let attempt = 0; attempt < 5; attempt += 1) {
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
    test("inline extension exposes params, publishes actions, and cleans up on detach", async (ctx) => {
        const server = await startServer();
        let page;
        const source = [
            "window.__us2054Value = window.__persephoneSiteRuntime.params.value;",
            "window.__us2054Fetch = window.__persephoneSiteRuntime.fetchText('https://example.invalid/secret').then(() => 'resolved', error => error.message);",
            "window.__persephoneSiteRuntime.onDispose(() => { window.__us2054Disposed = true; });",
            "window.__persephoneSiteRuntime.setActions([{ id: 'us2054-run', label: 'US-2054 action', run: () => ({ kind: 'message', text: 'action ran' }) }]);",
        ].join("\n");
        try {
            page = await openBrowser(ctx, `${server.url}/inline`, undefined);
            const attached = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: server.host,
                name: "US-2054 inline",
                source,
                params: { value: "params reached runtime" },
            });
            ctx.expect(attached.host).toBe(server.host);
            ctx.expect(attached.targets.length).toBe(1);
            ctx.expect(attached.targets[0].status).toBe("injected");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate("window.__us2054Value"),
                (value) => value === "params reached runtime",
            )).toBe("params reached runtime");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate("window.__us2054Fetch"),
                (value) => typeof value === "string",
            )).toBe("Fetch is unavailable for temporary site extensions");
            const entries = await ctx.app.pages[page.id].editor.testExtensions;
            ctx.expect(entries.length).toBe(1);
            ctx.expect(entries[0].name).toBe("US-2054 inline");
            ctx.expect(entries[0].inline).toBe(true);
            ctx.expect(entries[0].injectedTabs.length).toBe(1);
            ctx.expect(Object.keys(entries[0]).includes("source")).toBe(false);
            ctx.expect(Object.keys(entries[0]).includes("params")).toBe(false);
            const actions = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteActions, (items) => items.some((item) => item.id === "us2054-run"));
            ctx.expect(actions[0].label).toBe("US-2054 action");
            ctx.expect(await ctx.app.pages[page.id].editor.runSiteAction("us2054-run")).toEqual({ status: "message", text: "action ran" });

            const help = await ctx.callText(`pages[${JSON.stringify(page.id)}].editor.$help`);
            ctx.expect(help).toContain("attachTestExtension");
            ctx.expect(help).toContain("no privileged fetch broker");
            await ctx.app.pages[page.id].editor.detachTestExtension(server.host);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.testExtensions, (items) => items.length === 0)).toEqual([]);
            ctx.expect(await ctx.app.pages[page.id].editor.siteActions).toEqual([]);
            ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054Disposed === true && window.__persephoneSiteRuntime === undefined")).toBe(true);
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("absolute script paths are read at attach and again after reload", async (ctx) => {
        const server = await startServer();
        const folder = "us-2054/temporary-site-extensions/script-reread";
        const scriptPath = ctx.fixture(`${folder}/extension.js`);
        let page;
        const firstSource = "window.__us2054FileValue = 'first file read';\n";
        const secondSource = "window.__us2054FileValue = 'second file read';\n";
        try {
            await ctx.app.fs.write(scriptPath, firstSource);
            page = await openBrowser(ctx, `${server.url}/file`, undefined);
            const result = await ctx.app.pages[page.id].editor.attachTestExtension({ host: server.host, scriptPath });
            ctx.expect(result.targets[0].status).toBe("injected");
            ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054FileValue")).toBe("first file read");
            ctx.expect((await ctx.app.pages[page.id].editor.testExtensions)[0].scriptPath).toBe(scriptPath);

            await ctx.app.fs.write(scriptPath, secondSource);
            await ctx.app.pages[page.id].editor.reload();
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate("window.__us2054FileValue"),
                (value) => value === "second file read",
            )).toBe("second file read");
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("a later scriptPath read failure stays registered and is visible per target", async (ctx) => {
        const server = await startServer();
        const scriptPath = ctx.fixture("us-2054/temporary-site-extensions/later-read-failure/extension.js");
        let page;
        try {
            await ctx.app.fs.write(scriptPath, "window.__us2054BeforeReadFailure = true;\n");
            page = await openBrowser(ctx, `${server.url}/later-read-failure`, undefined);
            const result = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: server.host,
                name: "Later read failure",
                scriptPath,
            });
            ctx.expect(result.targets[0].status).toBe("injected");
            ctx.expect((await ctx.app.pages[page.id].editor.testExtensions)[0].injectedTabs.length).toBe(1);

            await ctx.app.fs.delete(scriptPath);
            await ctx.app.pages[page.id].editor.reload();
            ctx.expect((await ctx.app.pages[page.id].editor.testExtensions).length).toBe(1);
            ctx.expect((await ctx.app.pages[page.id].editor.testExtensions)[0].injectedTabs).toEqual([]);
            const failed = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.testExtensions, (items) => items[0]?.failedTabs?.length === 1);
            ctx.expect(failed[0].name).toBe("Later read failure");
            ctx.expect(typeof failed[0].failedTabs[0].error).toBe("string");
            ctx.expect(await ctx.app.pages[page.id].editor.siteActions).toEqual([]);
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("invalid sources, paths, hosts, and params do not register or replace a rule", async (ctx) => {
        const server = await startServer();
        const folder = "us-2054/temporary-site-extensions/validation";
        const scriptPath = ctx.fixture(`${folder}/available.js`);
        const missingPath = ctx.fixture(`${folder}/missing.js`);
        let page;
        try {
            await ctx.app.fs.write(scriptPath, "window.__us2054Stable = true;\n");
            page = await openBrowser(ctx, `${server.url}/validation`, undefined);
            const initial = await ctx.app.pages[page.id].editor.attachTestExtension({ host: server.host, name: "stable", source: "window.__us2054Stable = true;" });
            ctx.expect(initial.targets[0].status).toBe("injected");

            const invalidOptions = [
                { host: server.host },
                { host: server.host, source: "", scriptPath },
                { host: server.host, source: "x", scriptPath },
                { host: server.host, scriptPath: "relative.js" },
                { host: server.host, scriptPath: missingPath },
                { host: "https://example.test/path", source: "x" },
                { host: "*.example.test", source: "x" },
                { host: server.host, source: "x", params: [] },
                { host: server.host, source: "x", params: "not an object" },
                { host: server.host, source: "x", params: { bad: "x".repeat(17 * 1024) } },
                { host: server.host, source: "x".repeat(1024 * 1024 + 1) },
            ];
            for (const options of invalidOptions) {
                let error;
                try { await ctx.app.pages[page.id].editor.attachTestExtension(options); }
                catch (caught) { error = caught; }
                ctx.expect(error).toBeTruthy();
            }
            const current = await ctx.app.pages[page.id].editor.testExtensions;
            ctx.expect(current.length).toBe(1);
            ctx.expect(current[0].name).toBe("stable");
            ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054Stable")).toBe(true);
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("attach and replacement inject matching background tabs immediately", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, `${server.url}/first`, undefined);
            const firstTab = await ctx.app.pages[page.id].editor.activeTab;
            const secondTabId = await ctx.app.pages[page.id].editor.addTab(`${server.url}/second`);
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.tabs, (tabs) => tabs.some((tab) => tab.id === secondTabId && tab.url.includes("/second")));
            await ctx.app.pages[page.id].editor.waitFor({ text: pageText, tabId: secondTabId });
            await ctx.app.pages[page.id].editor.switchTab(firstTab.id);
            const first = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: server.host,
                source: "window.__us2054Revision = 'first';",
            });
            ctx.expect(first.targets.length).toBe(2);
            ctx.expect(first.targets.every((target) => target.status === "injected")).toBe(true);
            ctx.expect((await ctx.app.pages[page.id].editor.testExtensions)[0].injectedTabs.length).toBe(2);

            const replacement = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: server.host,
                source: "window.__us2054Revision = 'replacement';",
            });
            ctx.expect(replacement.targets.length).toBe(2);
            ctx.expect(replacement.targets.every((target) => target.status === "injected")).toBe(true);
            for (const tab of await ctx.app.pages[page.id].editor.tabs) {
                ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054Revision", { tabId: tab.id })).toBe("replacement");
            }
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("matching rules follow internal links and stay scoped to their browser page", async (ctx) => {
        const server = await startServer();
        let page;
        let otherPage;
        try {
            page = await openBrowser(ctx, `${server.url}/links`, undefined);
            const sourceTab = await ctx.app.pages[page.id].editor.activeTab;
            const rule = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: server.host,
                source: "window.__us2054PageScoped = true;",
            });
            ctx.expect(rule.targets[0].status).toBe("injected");
            await ctx.app.pages[page.id].editor.waitFor({ selector: "#new-tab", timeout: 10000 });
            await ctx.app.pages[page.id].editor.evaluate("document.querySelector('#new-tab').click()");
            const openedTab = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.tabs, (tabs) => tabs.length === 2 && tabs.some((tab) => tab.url.includes("/opened")));
            const linkedTab = openedTab.find((tab) => tab.url.includes("/opened"));
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate("window.__us2054PageScoped === true", { tabId: linkedTab.id }),
                Boolean,
            )).toBe(true);

            await ctx.app.pages[page.id].editor.switchTab(sourceTab.id);
            await ctx.app.pages[page.id].editor.waitFor({ selector: "#window-open", timeout: 10000 });
            await ctx.app.pages[page.id].editor.evaluate("document.querySelector('#window-open').click()");
            const tabsAfterWindowOpen = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.tabs, (tabs) => tabs.length === 3 && tabs.some((tab) => tab.url.includes("/window-opened")));
            const windowTab = tabsAfterWindowOpen.find((tab) => tab.url.includes("/window-opened"));
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate("window.__us2054PageScoped === true", { tabId: windowTab.id }),
                Boolean,
            )).toBe(true);

            const priorIds = new Set((await ctx.app.pages.all).map((item) => item.id));
            await ctx.app.pages.showBrowserPage({ url: `${server.url}/other-page` });
            const pages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (items) => items.some((item) => !priorIds.has(item.id) && item.editor === "browser-view"));
            otherPage = pages.find((item) => !priorIds.has(item.id) && item.editor === "browser-view");
            const otherRoot = browserRoot(ctx, otherPage.id);
            await otherRoot.waitFor({ text: pageText, timeout: 10000 });
            ctx.expect(await otherRoot.testExtensions).toEqual([]);
            ctx.expect(await otherRoot.evaluate("window.__us2054PageScoped === true")).toBe(false);
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, otherPage);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("agent-opened Incognito browser pages accept temporary extensions", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, `${server.url}/incognito`, { incognito: true });
            const result = await ctx.app.pages[page.id].editor.attachTestExtension({ host: server.host, source: "window.__us2054Incognito = true;" });
            ctx.expect(result.targets[0].status).toBe("injected");
            ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054Incognito")).toBe(true);
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("closing a browser page drops its in-memory temporary registry", async (ctx) => {
        const server = await startServer();
        let page;
        let reopened;
        try {
            page = await openBrowser(ctx, `${server.url}/lifetime`, undefined);
            const result = await ctx.app.pages[page.id].editor.attachTestExtension({ host: server.host, source: "window.__us2054Lifetime = true;" });
            ctx.expect(result.targets[0].status).toBe("injected");
            await closeBrowser(ctx, page);
            page = undefined;
            reopened = await openBrowser(ctx, `${server.url}/lifetime-again`, undefined);
            ctx.expect(await ctx.app.pages[reopened.id].editor.testExtensions).toEqual([]);
            ctx.expect(await ctx.app.pages[reopened.id].editor.evaluate("window.__us2054Lifetime === true")).toBe(false);
        } finally {
            await detachIfAttached(ctx, reopened, server.host);
            await closeBrowser(ctx, reopened);
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("authority matching uses the exact host and port", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, `${server.url}/exact-authority`, undefined);
            const port = server.host.split(":").at(-1);
            const otherHost = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: `localhost:${port}`,
                source: "window.__us2054WrongHost = true;",
            });
            ctx.expect(otherHost.targets.length).toBe(0);
            const defaultPort = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: "127.0.0.1",
                source: "window.__us2054DefaultPort = true;",
            });
            ctx.expect(defaultPort.targets.length).toBe(0);
            ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054WrongHost === true || window.__us2054DefaultPort === true")).toBe(false);

            const exact = await ctx.app.pages[page.id].editor.attachTestExtension({
                host: server.host.toUpperCase(),
                source: "window.__us2054ExactAuthority = location.port;",
            });
            ctx.expect(exact.targets[0].status).toBe("injected");
            ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054ExactAuthority")).toBe(Number(port));
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await detachIfAttached(ctx, page, `localhost:${server.host.split(":").at(-1)}`);
            await detachIfAttached(ctx, page, "127.0.0.1");
            await closeBrowser(ctx, page);
            await server.close();
        }
    }),

    test("temporary extensions inject into an agent-opened Tor page", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            await dismissTorSetupNotifications(ctx);
            const existingIds = new Set((await ctx.app.pages.all).map((item) => item.id));
            await ctx.app.pages.showBrowserPage({ tor: true, url: `${server.url}/tor` });
            const pages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (items) => items.some((item) => !existingIds.has(item.id) && item.editor === "browser-view"));
            page = { id: pages.find((item) => !existingIds.has(item.id) && item.editor === "browser-view").id };
            page.node = browserRoot(ctx, page.id);
            await ctx.app.pages[page.id].editor.waitFor({ text: pageText, timeout: 20000 });
            const result = await ctx.app.pages[page.id].editor.attachTestExtension({ host: server.host, source: "window.__us2054Tor = true;" });
            ctx.expect(result.targets[0].status).toBe("injected");
            ctx.expect(await ctx.app.pages[page.id].editor.evaluate("window.__us2054Tor")).toBe(true);
        } finally {
            await detachIfAttached(ctx, page, server.host);
            await closeBrowser(ctx, page);
            await dismissTorSetupNotifications(ctx);
            await server.close();
        }
    }, { requires: ["tor"] }),

    test("temporary extensions do not survive an app restart", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, `${server.url}/restart`, undefined);
            const result = await ctx.app.pages[page.id].editor.attachTestExtension({ host: server.host, source: "window.__us2054BeforeRestart = true;" });
            ctx.expect(result.targets[0].status).toBe("injected");
            await ctx.restartApp();
            const pages = await ctx.app.pages.all;
            const restored = pages.find((item) => item.id === page.id && item.editor === "browser-view");
            if (restored) ctx.expect(await browserRoot(ctx, restored.id).testExtensions).toEqual([]);
            else ctx.expect(pages.some((item) => item.id === page.id)).toBe(false);
        } finally {
            await closeBrowser(ctx, page);
            await server.close();
        }
    }, { requires: ["launch"] }),
];
