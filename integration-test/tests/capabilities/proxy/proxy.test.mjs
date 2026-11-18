import { test } from "../../../lib/context.mjs";
import { reserveClosedPort, startHttpConnectProxy, startSocks5Proxy } from "./helpers.mjs";

const PROXY_USER = "proxy-user";
const PROXY_PASS = "proxy-pass";

function fixtureTarget(ctx, path, hostname = undefined) {
    const url = new URL(ctx.httpUrl(path));
    if (hostname) url.hostname = hostname;
    return url.href;
}

async function fetchProjection(ctx, url, proxy) {
    const code = `const response = await app.fetch(${JSON.stringify(url)}, { proxy: ${JSON.stringify(proxy)}, timeout: 5000 });\nreturn JSON.stringify({ status: response.status, body: await response.text() });`;
    return JSON.parse(await ctx.script(code));
}

async function fetchError(ctx, url, proxy) {
    const code = `try { await app.fetch(${JSON.stringify(url)}, { proxy: ${JSON.stringify(proxy)}, timeout: 5000 }); return JSON.stringify({ rejected: false }); } catch (error) { return JSON.stringify({ rejected: true, name: error.name, message: error.message }); }`;
    return JSON.parse(await ctx.script(code));
}

function assertEchoResponse(ctx, response, path) {
    ctx.expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    ctx.expect(body.method).toBe("GET");
    ctx.expect(body.url).toBe(path);
    ctx.expect(body.body).toBe("");
}

async function openBlankBrowser(ctx) {
    const before = new Set((await ctx.app.pages.all).map((page) => page.id));
    try {
        await ctx.openBrowser("about:blank");
        const pages = await ctx.waitFor(
            (active) => active.app.pages.all,
            (all) => all.some((page) => !before.has(page.id) && page.editor === "browser-view"),
        );
        const page = pages.find((entry) => !before.has(entry.id) && entry.editor === "browser-view");
        ctx.expect(page).toBeTruthy();
        return { id: page.id, editor: ctx.handle(ctx.app.pages[page.id].editor) };
    } catch (error) {
        try {
            const pages = await ctx.app.pages.all;
            for (const page of pages) {
                if (!before.has(page.id) && page.editor === "browser-view") await ctx.app.pages.closePage(page.id).catch(() => {});
            }
        } catch { /* The runner's per-test cleanup remains a final safety net. */ }
        throw error;
    }
}

async function restoreBrowserTest(ctx, page, settings, proxy) {
    try {
        if (page?.id) await ctx.app.pages.closePage(page.id);
    } catch { /* Continue restoring settings and proxy resources. */ }
    try { await ctx.app.settings.set("browser-default-network", settings.network); }
    catch { /* Cleanup must not hide the test result. */ }
    try { await ctx.app.settings.set("browser-default-profile", settings.profile); }
    catch { /* Cleanup must not hide the test result. */ }
    await proxy.close();
}

export default [
    test("shorthand SOCKS5 proxy routes an app.fetch request", async (ctx) => {
        const path = "/echo?source=us-2119-socks-shorthand";
        const url = ctx.httpUrl(path);
        const proxy = await startSocks5Proxy({ fixtureUrl: url });
        try {
            const response = await fetchProjection(ctx, url, `127.0.0.1:${proxy.port}`);
            assertEchoResponse(ctx, response, path);
            ctx.expect(proxy.record.connectionCount).toBe(1);
            ctx.expect(proxy.record.connections[0]).toEqual({ protocol: "socks5", host: "127.0.0.1", port: Number(new URL(url).port), credentials: null });
        } finally {
            await proxy.close();
        }
    }),

    test("SOCKS5 URL authenticates for one app.fetch request", async (ctx) => {
        const path = "/echo?source=us-2119-socks-auth";
        const url = ctx.httpUrl(path);
        const proxy = await startSocks5Proxy({ fixtureUrl: url, credentials: { username: PROXY_USER, password: PROXY_PASS } });
        try {
            const response = await fetchProjection(ctx, url, `socks5://${PROXY_USER}:${PROXY_PASS}@127.0.0.1:${proxy.port}`);
            assertEchoResponse(ctx, response, path);
            ctx.expect(proxy.record.connectionCount).toBe(1);
            ctx.expect(proxy.record.connections[0].host).toBe("127.0.0.1");
            ctx.expect(proxy.record.connections[0].port).toBe(Number(new URL(url).port));
            ctx.expect(proxy.record.connections[0].credentials).toEqual({ username: PROXY_USER, password: PROXY_PASS });
        } finally {
            await proxy.close();
        }
    }),

    test("SOCKS5h sends the fixture host name to the proxy", async (ctx) => {
        const path = "/echo?source=us-2119-socks5h";
        const url = fixtureTarget(ctx, path, "fixture.invalid");
        const proxy = await startSocks5Proxy({ fixtureUrl: url });
        try {
            const response = await fetchProjection(ctx, url, `socks5h://127.0.0.1:${proxy.port}`);
            assertEchoResponse(ctx, response, path);
            ctx.expect(proxy.record.connectionCount).toBe(1);
            ctx.expect(proxy.record.connections[0].host).toBe("fixture.invalid");
            ctx.expect(proxy.record.connections[0].port).toBe(Number(new URL(url).port));
        } finally {
            await proxy.close();
        }
    }),

    test("HTTP CONNECT carries the HTTP target and proxy credentials", async (ctx) => {
        const path = "/echo?source=us-2119-http-connect";
        const url = ctx.httpUrl(path);
        const target = new URL(url);
        const proxy = await startHttpConnectProxy({ fixtureUrl: url, credentials: { username: PROXY_USER, password: PROXY_PASS } });
        try {
            const response = await fetchProjection(ctx, url, `http://${PROXY_USER}:${PROXY_PASS}@127.0.0.1:${proxy.port}`);
            assertEchoResponse(ctx, response, path);
            ctx.expect(proxy.record.connectionCount).toBe(1);
            ctx.expect(proxy.record.connections[0]).toEqual({
                protocol: "http-connect",
                host: target.hostname,
                port: Number(target.port),
                authority: `${target.hostname}:${target.port}`,
                credentials: { username: PROXY_USER, password: PROXY_PASS },
            });
        } finally {
            await proxy.close();
        }
    }),

    test("an unreachable proxy fails closed", async (ctx) => {
        const url = ctx.httpUrl("/echo?source=us-2119-unreachable-proxy");
        const closedPort = await reserveClosedPort();
        const outcome = await fetchError(ctx, url, `socks5://127.0.0.1:${closedPort}`);
        ctx.expect(outcome.rejected).toBe(true);
        ctx.expect(outcome.message).toContain("ECONNREFUSED");
    }),

    test("an invalid proxy string has the documented TypeError", async (ctx) => {
        const code = `try { await app.fetch(${JSON.stringify(ctx.httpUrl("/echo?source=us-2119-invalid-proxy"))}, { proxy: "ftp://127.0.0.1:9", timeout: 5000 }); return JSON.stringify({ error: null }); } catch (error) { return JSON.stringify({ name: error.name, message: error.message }); }`;
        const outcome = JSON.parse(await ctx.script(code));
        ctx.expect(outcome.name).toBe("TypeError");
        ctx.expect(outcome.message).toBe("fetch: invalid proxy scheme (use socks5://, socks5h://, or http://).");
    }),

    test("the default browser profile routes a non-loopback target through SOCKS5", async (ctx) => {
        const settings = {
            network: await ctx.app.settings.get("browser-default-network"),
            profile: await ctx.app.settings.get("browser-default-profile"),
        };
        const path = "/echo?source=us-2119-browser-default-profile";
        const fixtureUrl = ctx.httpUrl(path);
        const targetUrl = fixtureTarget(ctx, path, "fixture.invalid");
        const proxy = await startSocks5Proxy({ fixtureUrl });
        let page;
        try {
            await ctx.app.settings.set("browser-default-profile", "");
            await ctx.app.settings.set("browser-default-network", { kind: "proxy", protocol: "socks5", host: "127.0.0.1", port: proxy.port });
            page = await openBlankBrowser(ctx);
            await page.editor.navigateAndWait(targetUrl);
            ctx.expect(await page.editor.evaluate("JSON.parse(document.body.textContent).url")).toContain("us-2119-browser-default-profile");
            ctx.expect(proxy.record.connections.some((entry) => entry.host === "fixture.invalid" && entry.port === Number(new URL(fixtureUrl).port))).toBe(true);
            ctx.expect(proxy.record.connections.length).toBe(1);
        } finally {
            await restoreBrowserTest(ctx, page, settings, proxy);
        }
    }, { requires: ["launch"] }),

    test("a stopped browser proxy makes navigation fail", async (ctx) => {
        const settings = {
            network: await ctx.app.settings.get("browser-default-network"),
            profile: await ctx.app.settings.get("browser-default-profile"),
        };
        const path = "/echo?source=us-2119-browser-stopped-proxy";
        const fixtureUrl = ctx.httpUrl(path);
        const targetUrl = fixtureTarget(ctx, path, "fixture.invalid");
        const proxy = await startSocks5Proxy({ fixtureUrl });
        let page;
        try {
            await ctx.app.settings.set("browser-default-profile", "");
            await ctx.app.settings.set("browser-default-network", { kind: "proxy", protocol: "socks5", host: "127.0.0.1", port: proxy.port });
            page = await openBlankBrowser(ctx);
            await proxy.close();
            const connectionCountBeforeNavigation = proxy.record.connectionCount;
            let navigationError;
            try {
                await page.editor.navigateAndWait(targetUrl);
            } catch (error) {
                navigationError = error;
            }
            ctx.expect(navigationError).toBeTruthy();
            // This cannot prove there is no direct fallback: direct DNS for fixture.invalid also fails.
            ctx.expect(proxy.record.connectionCount).toBe(connectionCountBeforeNavigation);
        } finally {
            await restoreBrowserTest(ctx, page, settings, proxy);
        }
    }, { requires: ["launch"] }),
];
