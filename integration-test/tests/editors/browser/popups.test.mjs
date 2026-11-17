import { createServer } from "node:http";
import { test } from "../../../lib/context.mjs";
import { closePage } from "../helpers.mjs";

const pageText = "US-2055 popup fixture";
let lastPopupOpenedAt = 0;

function browserRoot(pageId) {
    return `pages[${JSON.stringify(pageId)}].editor`;
}

async function startServer() {
    let releaseSlow;
    let slowRequest;
    const slowRequestReady = new Promise((resolve) => { slowRequest = resolve; });
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname === "/echo") {
            response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
            response.end("popup response body");
            return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        if (url.pathname === "/parent") {
            response.end(`<!doctype html><title>US-2055 Parent</title><body>${pageText}<button id="open" onclick="window.open('/popup','_blank','width=640,height=520')">Open popup</button><button id="oauth" onclick="window.open('/oauth','us2055-oauth','width=640,height=520')">Open OAuth</button><button id="slow" onclick="window.open('/slow-popup','us2055-slow','width=640,height=520')">Open slow popup</button><a id="tab-disposition" href="/tab-disposition" target="_blank">Open tab</a><output id="message"></output><script>window.addEventListener('message', event => { document.querySelector('#message').textContent = event.data; });</script></body>`);
            return;
        }
        if (url.pathname === "/popup") {
            response.end(`<!doctype html><title>US-2055 Popup</title><body><h1 id="heading">Popup ready</h1><label>Name <input id="name"></label><label><input id="agree" type="checkbox">Agree</label><select id="flavor"><option value="">Choose</option><option value="vanilla">Vanilla</option></select><input id="upload" type="file"><button id="action" onclick="window.__clicked = (window.__clicked || 0) + 1; console.log('us2055-clicked', window.__clicked); console.warn('us2055-warning');">Run</button><button id="nested" onclick="window.open('/leaf','us2055-leaf','width=520,height=420')">Open nested</button><div id="drag-source" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','drag payload')">Drag</div><div id="drop-target">Drop target</div><output id="drop-result"></output><a id="go" href="/destination">Navigate</a><button id="fetch" onclick="fetch('/echo?from=popup').then(r => r.text()).then(text => document.querySelector('#heading').textContent = text)">Fetch</button><script>document.querySelector('#drop-target').ondragover = event => event.preventDefault(); document.querySelector('#drop-target').ondrop = event => { event.preventDefault(); document.querySelector('#drop-result').textContent = event.dataTransfer.getData('text/plain'); };</script></body>`);
            return;
        }
        if (url.pathname === "/oauth") {
            response.end(`<!doctype html><title>US-2055 OAuth</title><body><label>Email <input id="email"></label><button id="finish" onclick="window.opener.postMessage('oauth-complete','*'); window.close()">Finish</button></body>`);
            return;
        }
        if (url.pathname === "/leaf") {
            response.end("<!doctype html><title>US-2055 Nested</title><body>Nested popup</body>");
            return;
        }
        if (url.pathname === "/slow-popup") {
            releaseSlow = () => {
                response.end("<!doctype html><title>US-2055 Slow</title><body>Slow popup loaded</body>");
            };
            slowRequest();
            return;
        }
        if (url.pathname === "/destination") {
            response.end("<!doctype html><title>US-2055 Destination</title><body>Navigation completed</body>");
            return;
        }
        if (url.pathname === "/next-navigation") {
            response.end("<!doctype html><title>US-2055 Next Navigation</title><body>Next navigation completed</body>");
            return;
        }
        response.end(`<!doctype html><title>${pageText}</title><body>${pageText}</body>`);
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    return {
        url: `http://127.0.0.1:${address.port}`,
        waitForSlowRequest: () => slowRequestReady,
        releaseSlow: () => releaseSlow?.(),
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections?.();
        }),
    };
}

async function openBrowser(ctx, server, folder, options) {
    ctx.fixture(`us-2055/${folder}/`);
    const pageId = await ctx.call("pages.openUrlInBrowserTab", options === undefined
        ? [`${server.url}/parent`]
        : [`${server.url}/parent`, options]);
    ctx.expect(pageId).toBeTruthy();
    const root = browserRoot(pageId);
    await ctx.waitFor(`${root}.id`, (id) => id === "browser-view");
    await ctx.call(`${root}.waitFor`, [{ text: pageText, timeout: 10000 }]);
    return { id: pageId, root };
}

async function openSeparateBrowser(ctx, server, folder) {
    ctx.fixture(`us-2055/${folder}/`);
    const previousIds = new Set((await ctx.call("pages.all")).map((item) => item.id));
    await ctx.call("pages.showBrowserPage", [{ url: `${server.url}/parent` }]);
    const items = await ctx.waitFor("pages.all", (pages) => pages.some((item) => !previousIds.has(item.id) && item.editor === "browser-view"));
    const entry = items.find((item) => !previousIds.has(item.id) && item.editor === "browser-view");
    const page = { id: entry.id, root: browserRoot(entry.id) };
    await ctx.call(`${page.root}.waitFor`, [{ text: pageText, timeout: 10000 }]);
    return page;
}

async function waitForPopupRateWindow(ctx, page) {
    if (!lastPopupOpenedAt) return;
    const readyAt = lastPopupOpenedAt + 2100;
    await ctx.waitFor(
        (activeContext) => activeContext.call(`${page.root}.evaluate`, ["Date.now()"]),
        (now) => now >= readyAt,
        { timeout: 5000 },
    );
}

async function openPopup(ctx, page, selector = "#open", pathname = "/popup") {
    await waitForPopupRateWindow(ctx, page);
    await ctx.call(`${page.root}.click`, [selector]);
    const popups = await ctx.waitFor(`${page.root}.popups`, (items) => items.some((item) => item.url.includes(pathname) && !item.loading));
    lastPopupOpenedAt = Date.now();
    return popups.find((item) => item.url.includes(pathname));
}

async function closePopups(ctx, page) {
    if (!page?.id) return;
    const root = browserRoot(page.id);
    const popups = await ctx.call(`${root}.popups`).catch(() => []);
    for (const popup of popups) await ctx.call(`${root}.closePopup`, [popup.id]).catch(() => {});
}

async function closeBrowser(ctx, page) {
    if (page?.id) await closePage(ctx, page.id);
}

async function cleanup(ctx, server, ...pages) {
    let cleanupError;
    try {
        for (const page of pages) {
            try { await closePopups(ctx, page); }
            catch (error) { cleanupError ??= error; }
            try { await closeBrowser(ctx, page); }
            catch (error) { cleanupError ??= error; }
        }
    } finally {
        await server.close();
    }
    if (cleanupError) throw cleanupError;
}

async function captureError(operation) {
    try { await operation(); }
    catch (error) { return error; }
    return undefined;
}

export default [
    test("lists live popups with opener metadata and tracks URL, title, loading, and close", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "listing-metadata");
            const tabId = (await ctx.call(`${page.root}.activeTab`)).id;
            const popup = await openPopup(ctx, page);
            const ready = await ctx.waitFor(`${page.root}.popups`, (items) => items.find((item) => item.id === popup.id && item.loading === false && item.title === "US-2055 Popup"));
            const readyPopup = ready.find((item) => item.id === popup.id);
            ctx.expect(popup.openerId).toBe(tabId);
            ctx.expect(popup.url).toContain("/popup");
            ctx.expect(readyPopup.title).toBe("US-2055 Popup");
            ctx.expect(readyPopup.loading).toBe(false);
            ctx.expect((await ctx.call(`${page.root}.tabs`)).length).toBe(1);

            await ctx.call(`${page.root}.evaluate`, ["document.title = 'US-2055 Popup Renamed'", { tabId: popup.id }]);
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.some((item) => item.id === popup.id && item.title === "US-2055 Popup Renamed"))).toBeTruthy();

            await waitForPopupRateWindow(ctx, page);
            await ctx.call(`${page.root}.click`, ["#slow"]);
            const slowItems = await ctx.waitFor(`${page.root}.popups`, (items) => items.length === 2);
            const slowPopup = slowItems.find((item) => item.id !== popup.id);
            lastPopupOpenedAt = Date.now();
            await server.waitForSlowRequest();
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.some((item) => item.id === slowPopup.id && item.loading))).toBeTruthy();
            server.releaseSlow();
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.some((item) => item.id === slowPopup.id && !item.loading && item.title === "US-2055 Slow"))).toBeTruthy();

            await ctx.call(`${page.root}.closePopup`, [slowPopup.id]);
            await ctx.call(`${page.root}.closePopup`, [popup.id]);
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.length === 0)).toEqual([]);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("tab dispositions add a browser tab without a popup", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "tab-disposition");
            await ctx.call(`${page.root}.click`, ["#tab-disposition"]);
            const tabs = await ctx.waitFor(`${page.root}.tabs`, (items) => items.some((item) => item.url?.includes("/tab-disposition")));
            ctx.expect(tabs.length).toBe(2);
            ctx.expect(await ctx.call(`${page.root}.popups`)).toEqual([]);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("popup content methods target the popup and preserve both CDP and synthetic input", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "content-methods");
            const popup = await openPopup(ctx, page);
            const options = { tabId: popup.id };
            const snapshot = await ctx.call(`${page.root}.snapshot`, [options]);
            ctx.expect(snapshot).toContain("Popup ready");
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#heading').textContent", options])).toBe("Popup ready");
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#heading').id", options])).toBe("heading");
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#heading').outerHTML", options])).toContain("Popup ready");
            await ctx.call(`${page.root}.type`, ["#name", "synthetic input", { ...options, synthetic: true }]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#name').value", options])).toBe("synthetic input");
            await ctx.call(`${page.root}.type`, ["#name", "CDP input", options]);
            await ctx.call(`${page.root}.pressKey`, ["Control+a", { ...options, target: "#name" }]);
            await ctx.call(`${page.root}.type`, ["#name", "typed by CDP", options]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#name').value", options])).toBe("typed by CDP");
            await ctx.call(`${page.root}.hover`, ["#action", options]);
            await ctx.call(`${page.root}.keyDown`, ["Shift", options]);
            await ctx.call(`${page.root}.keyUp`, ["Shift", options]);

            await ctx.call(`${page.root}.select`, ["#flavor", "vanilla", options]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#flavor').value", options])).toBe("vanilla");
            await ctx.call(`${page.root}.fillForm`, [[
                { name: "name", locator: "#name", action: "type", value: "form input", options },
            ]]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#name').value", options])).toBe("form input");
            await ctx.call(`${page.root}.evaluate`, ["console.log('us2055-clicked', 1); console.warn('us2055-warning')", options]);
            ctx.expect((await ctx.call(`${page.root}.consoleMessages`, [options])).some((message) => message.args.join(" ").includes("us2055-clicked"))).toBe(true);
            ctx.expect((await ctx.call(`${page.root}.consoleMessages`, [{ ...options, level: "warning" }])).some((message) => message.args.join(" ").includes("us2055-warning"))).toBe(true);
            ctx.expect((await ctx.call(`${page.root}.pageErrors`, [options])).length).toBe(0);
            ctx.expect((await ctx.call(`${page.root}.dialogs`, [options])).policy).toBeTruthy();

            const filePath = ctx.fixture("us-2055/content-methods/upload.txt");
            await ctx.call("fs.write", [filePath, "popup upload fixture\n"]);
            await ctx.call(`${page.root}.setInputFiles`, ["#upload", [filePath], options]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#upload').files[0].name", options])).toBe("upload.txt");
            await ctx.call(`${page.root}.setViewport`, [{ ...options, width: 800, height: 600 }]);
            await ctx.call(`${page.root}.clearViewport`, [options]);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("popup waits, navigation, response waits, and network history use the popup ID", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "waits-network");
            const popup = await openPopup(ctx, page);
            const options = { tabId: popup.id };
            await ctx.call(`${page.root}.waitForSelector`, ["#fetch", { ...options, timeout: 10000 }]);

            const responsePromise = ctx.call(`${page.root}.waitForResponse`, [`${server.url}/echo?from=popup`, { ...options, timeout: 10000, includeBody: true }]);
            await ctx.call(`${page.root}.evaluate`, ["fetch('/echo?from=popup').then(() => true)", options]);
            const response = await responsePromise;
            ctx.expect(response.status).toBe(200);
            ctx.expect(response.body).toBe("popup response body");
            const requests = await ctx.call(`${page.root}.networkRequests`, [{ ...options, includeBodies: true }]);
            ctx.expect(requests.some((request) => request.url.includes("/echo?from=popup") && request.statusCode === 200)).toBe(true);

            const navigationPromise = ctx.call(`${page.root}.waitForURL`, [`${server.url}/destination`, { ...options, timeout: 10000 }]);
            await ctx.call(`${page.root}.evaluate`, ["location.href = '/destination'", options]);
            const navigation = await navigationPromise;
            ctx.expect(navigation.url).toContain("/destination");
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.body.textContent.trim()", options])).toBe("Navigation completed");

            const lifecyclePromise = ctx.call(`${page.root}.waitForNavigation`, [{ ...options, timeout: 10000 }]);
            await ctx.call(`${page.root}.evaluate`, ["location.href = '/next-navigation'", options]);
            const lifecycle = await lifecyclePromise;
            ctx.expect(lifecycle.url).toContain("/next-navigation");
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.body.textContent.trim()", options])).toBe("Next navigation completed");
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("clear empties an editable field in a popup", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "clear-input");
            const popup = await openPopup(ctx, page);
            const options = { tabId: popup.id };
            await ctx.call(`${page.root}.type`, ["#name", "value to clear", options]);
            await ctx.call(`${page.root}.clear`, ["#name", options]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#name').value", options])).toBe("");
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("trusted click activates a popup button", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "click-action");
            const popup = await openPopup(ctx, page);
            await ctx.call(`${page.root}.click`, ["#action", { tabId: popup.id }]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["window.__clicked", { tabId: popup.id }])).toBe(1);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("check sets a popup checkbox", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "check-input");
            const popup = await openPopup(ctx, page);
            await ctx.call(`${page.root}.check`, ["#agree", { tabId: popup.id }]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#agree').checked", { tabId: popup.id }])).toBe(true);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("uncheck clears an initially checked popup checkbox", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "uncheck-input");
            const popup = await openPopup(ctx, page);
            await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#agree').checked = true", { tabId: popup.id }]);
            await ctx.call(`${page.root}.uncheck`, ["#agree", { tabId: popup.id }]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#agree').checked", { tabId: popup.id }])).toBe(false);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("popup lifecycle events identify the popup and report agent close without its URL", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "popup-events-agent-close");
            const popup = await openPopup(ctx, page);
            const openedEvents = await ctx.waitFor(
                (activeContext) => activeContext.call("events.recent", [50], { maxLength: 8000 }),
                (events) => events.some((event) => event.kind === "popup-opened" && event.text.includes(popup.id)),
            );
            const opened = openedEvents.find((event) => event.kind === "popup-opened" && event.text.includes(popup.id));
            ctx.expect(opened.text.includes(popup.id)).toBe(true);
            ctx.expect(opened.text.includes(popup.openerId)).toBe(true);
            ctx.expect(opened.text.includes(popup.url)).toBe(false);

            await ctx.call(`${page.root}.closePopup`, [popup.id]);
            const closedEvents = await ctx.waitFor(
                (activeContext) => activeContext.call("events.recent", [50], { maxLength: 8000 }),
                (events) => events.some((event) => event.kind === "popup-closed" && event.text.includes(popup.id)),
            );
            const closed = closedEvents.find((event) => event.kind === "popup-closed" && event.text.includes(popup.id));
            ctx.expect(closed.text.includes(popup.url)).toBe(false);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("popup self-close emits a popup-closed event", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "popup-events-self-close");
            const popup = await openPopup(ctx, page);
            await ctx.call(`${page.root}.evaluate`, ["window.close()", { tabId: popup.id }]);
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.length === 0)).toEqual([]);
            const events = await ctx.waitFor(
                (activeContext) => activeContext.call("events.recent", [50], { maxLength: 8000 }),
                (items) => items.some((event) => event.kind === "popup-closed" && event.text.includes(popup.id)),
            );
            const closed = events.find((event) => event.kind === "popup-closed" && event.text.includes(popup.id));
            ctx.expect(closed.text.includes(popup.url)).toBe(false);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("drag moves data from a popup source to its drop target", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "popup-drag");
            const popup = await openPopup(ctx, page);
            const options = { tabId: popup.id, force: true };
            await ctx.call(`${page.root}.drag`, ["#drag-source", "#drop-target", options]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#drop-result').textContent", options])).toBe("drag payload");
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("OAuth popup page code posts to its opener and self-close removes its live target", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "oauth-postback");
            const popup = await openPopup(ctx, page, "#oauth", "/oauth");
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["window.opener !== null", { tabId: popup.id }])).toBe(true);
            await ctx.call(`${page.root}.type`, ["#email", "agent@example.test", { tabId: popup.id }]);
            ctx.expect(await ctx.call(`${page.root}.evaluate`, ["document.querySelector('#email').value", { tabId: popup.id }])).toBe("agent@example.test");
            await ctx.call(`${page.root}.evaluate`, ["window.opener.postMessage('oauth-complete','*')", { tabId: popup.id }]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.call(`${page.root}.evaluate`, ["document.querySelector('#message').textContent"]),
                (value) => value === "oauth-complete",
                { timeout: 10000 },
            )).toBe("oauth-complete");
            await ctx.call(`${page.root}.evaluate`, ["window.close()", { tabId: popup.id }]);
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.length === 0)).toEqual([]);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("OAuth completion button posts and closes its popup", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "oauth-button");
            const popup = await openPopup(ctx, page, "#oauth", "/oauth");
            await ctx.call(`${page.root}.click`, ["#finish", { tabId: popup.id }]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.call(`${page.root}.evaluate`, ["document.querySelector('#message').textContent"]),
                (value) => value === "oauth-complete",
                { timeout: 10000 },
            )).toBe("oauth-complete");
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.length === 0)).toEqual([]);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("nested popup activation through an agent click is observed", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "nested-activation");
            const opener = await openPopup(ctx, page);
            await waitForPopupRateWindow(ctx, page);
            await ctx.call(`${page.root}.click`, ["#nested", { tabId: opener.id }]);
            const outcome = await ctx.waitFor(async (activeContext) => {
                const items = await activeContext.call(`${page.root}.popups`);
                if (items.some((item) => item.url.includes("/leaf"))) return { items, blockedNotice: false };
                const screen = await activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]);
                return { items, blockedNotice: screen.includes("blocked on this page") };
            }, (state) => state.items.some((item) => item.url.includes("/leaf")) || state.blockedNotice, { timeout: 10000 });
            const leafAtOpen = outcome.items.find((item) => item.url.includes("/leaf"));
            if (!leafAtOpen) ctx.expect(outcome.blockedNotice).toBe(false);
            const nested = await ctx.waitFor(`${page.root}.popups`, (items) => items.some((item) => item.url.includes("/leaf") && item.title === "US-2055 Nested"), { timeout: 10000 });
            const leaf = nested.find((item) => item.url.includes("/leaf"));
            ctx.expect(leaf.openerId).toBe(opener.id);
            ctx.expect(leaf.title).toBe("US-2055 Nested");
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("popup rate limiting shows a blocked-window notification during a burst", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "popup-rate-limit");
            await waitForPopupRateWindow(ctx, page);
            for (let attempt = 0; attempt < 4; attempt += 1) {
                await ctx.call(`${page.root}.click`, ["#open"]);
            }
            const screen = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (value) => value.includes("popup") && value.includes("blocked on this page"),
                { timeout: 5000 },
            );
            ctx.expect(screen).toContain("blocked on this page");
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("unknown, foreign, closed, and tab-only popup IDs fail clearly", async (ctx) => {
        const server = await startServer();
        let page;
        let otherPage;
        try {
            page = await openBrowser(ctx, server, "id-errors-primary");
            otherPage = await openSeparateBrowser(ctx, server, "id-errors-foreign");
            const popup = await openPopup(ctx, page);
            const unknown = await captureError(() => ctx.call(`${page.root}.evaluate`, ["document.title", { tabId: "unknown-us2055-popup" }]));
            ctx.expect(unknown?.message.includes("unknown-us2055-popup")).toBe(true);
            const foreign = await captureError(() => ctx.call(`${otherPage.root}.evaluate`, ["document.title", { tabId: popup.id }]));
            ctx.expect(foreign?.message.includes(popup.id)).toBe(true);

            for (const [method, args] of [
                ["closeTab", [popup.id]],
                ["switchTab", [popup.id]],
                ["fullscreen", [undefined, { tabId: popup.id }]],
                ["back", [{ tabId: popup.id }]],
                ["forward", [{ tabId: popup.id }]],
                ["navigateAndWait", [`${server.url}/destination`, { tabId: popup.id }]],
            ]) {
                const error = await captureError(() => ctx.call(`${page.root}.${method}`, args));
                ctx.expect(error).toBeTruthy();
            }
            const activeOnly = await captureError(() => ctx.call(`${page.root}.navigateAndWait`, [`${server.url}/destination`, { tabId: popup.id }]));
            ctx.expect(activeOnly?.message.includes("active tab only")).toBe(true);
            await ctx.call(`${page.root}.closePopup`, [popup.id]);
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.length === 0)).toEqual([]);
            const closed = await captureError(() => ctx.call(`${page.root}.evaluate`, ["document.title", { tabId: popup.id }]));
            ctx.expect(closed?.message.includes(popup.id)).toBe(true);
        } finally {
            await cleanup(ctx, server, otherPage, page);
        }
    }),

    test("closing an opener tab closes its popup descendants", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "tab-descendants");
            const popup = await openPopup(ctx, page);
            await ctx.call(`${page.root}.closeTab`, [popup.openerId]);
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.length === 0)).toEqual([]);
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("a popup close request reports beforeunload refusal and retains the live popup", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "beforeunload-refusal");
            const popup = await openPopup(ctx, page);
            await ctx.call(`${page.root}.evaluate`, ["window.onbeforeunload = () => 'Stay here'", { tabId: popup.id }]);
            const error = await captureError(() => ctx.call(`${page.root}.closePopup`, [popup.id]));
            ctx.expect(error).toBeTruthy();
            ctx.expect(error.message).toContain("refused to close");
            ctx.expect(await ctx.waitFor(`${page.root}.popups`, (items) => items.some((item) => item.id === popup.id))).toBeTruthy();
        } finally {
            await cleanup(ctx, server, page);
        }
    }),

    test("popup state is not restored after app restart", async (ctx) => {
        const server = await startServer();
        let page;
        try {
            page = await openBrowser(ctx, server, "restart-state");
            await openPopup(ctx, page);
            const priorPageId = page.id;
            await ctx.restartApp();
            const pages = await ctx.call("pages.all");
            const restored = pages.find((item) => item.id === priorPageId && item.editor === "browser-view");
            if (restored) ctx.expect(await ctx.call(`${browserRoot(restored.id)}.popups`)).toEqual([]);
            else ctx.expect(pages.some((item) => item.id === priorPageId)).toBe(false);
            page = undefined;
        } finally {
            await cleanup(ctx, server, page);
        }
    }, { requires: ["launch"] }),
];
