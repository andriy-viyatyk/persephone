import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage, fixturePage, openBrowserPage } from "../helpers.mjs";

const permissionsButton = '[data-name="url-site-permissions"]';
const certificateButton = '[data-name="site-certificate-view"]';

async function openSitePermissions(ctx, page) {
    await activatePage(ctx, page.id);
    await ctx.app.window.screen.click(permissionsButton);
    await ctx.app.window.screen.waitFor({ selector: '[data-type="browser-site-permissions"]' });
}

async function closeFullscreen(ctx, page) {
    if (!page) return;
    try { await ctx.app.pages[page.id].editor.exitFullscreen(); } catch { /* Preserve the test result. */ }
}

export default [
    test("HTTPS certificate access exposes the chain and opens the PEM fallback", async (ctx) => {
        const url = ctx.httpsUrl("/browser/page-tools/certificate.html");
        const page = await openBrowserPage(ctx, url);
        let pemPage;
        try {
            await page.editor.waitFor({ selector: "#certificate-fixture" });
            const certificate = await page.editor.getCertificate();
            ctx.expect(certificate.url).toBe(url);
            ctx.expect(certificate.certificates.length > 0).toBe(true);
            ctx.expect(certificate.certificates.every((item) => typeof item === "string" && item.length > 0)).toBe(true);

            await openSitePermissions(ctx, page);
            const buttonVisible = await ctx.app.window.screen.evaluate(`() => {
                const button = document.querySelector(${JSON.stringify(certificateButton)});
                return Boolean(button && !button.hidden && button.getClientRects().length);
            }`);
            ctx.expect(buttonVisible).toBe(true);

            await ctx.app.window.screen.hover(certificateButton);
            const tooltip = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(
                    '() => document.querySelector("[data-type=tooltip]")?.textContent?.trim() || ""',
                ),
                (value) => value.length > 0,
            );
            ctx.expect(tooltip.toLowerCase()).toContain("viewer");
            ctx.expect(tooltip.toLowerCase()).toContain("install");

            const priorPageIds = new Set((await ctx.app.pages.all).map((item) => item.id));
            await ctx.app.window.screen.click(certificateButton);
            const openedPages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (items) => items.some((item) => !priorPageIds.has(item.id) && item.editor === "monaco"),
            );
            pemPage = openedPages.find((item) => !priorPageIds.has(item.id) && item.editor === "monaco");
            await activatePage(ctx, pemPage.id);
            ctx.expect(await ctx.app.pages[pemPage.id].title).toBe("127.0.0.1");
            const pem = await ctx.app.pages[pemPage.id].content;
            ctx.expect(pem).toContain("-----BEGIN CERTIFICATE-----");
            ctx.expect(pem.split("-----BEGIN CERTIFICATE-----")[1].trim().length > 0).toBe(true);
        } finally {
            await closeBrowserPage(ctx, { id: pemPage?.id });
            await closeBrowserPage(ctx, page);
        }
    }),

    test("HTTP pages do not expose certificate access", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "page-tools", "certificate.html"));
        try {
            await page.editor.waitFor({ selector: "#certificate-fixture" });
            // undefined crosses the call boundary as null.
            ctx.expect(await page.editor.getCertificate()).toBe(null);
            await openSitePermissions(ctx, page);
            const buttonVisible = await ctx.app.window.screen.evaluate(`() => {
                const button = document.querySelector(${JSON.stringify(certificateButton)});
                return Boolean(button && !button.hidden && button.getClientRects().length);
            }`);
            ctx.expect(buttonVisible).toBe(false);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("Show Resources opens a Links page with DOM and fetched resources", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "page-tools", "resources.html"));
        let linksPage;
        try {
            await page.editor.waitFor({ selector: "#resources-ready" });
            await page.editor.waitFor({ text: "resource fetch complete" });
            const fetchedUrl = fixturePage(ctx, "page-tools", "resources.svg") + "?from=fetch";
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.networkRequests({ includeBodies: true }),
                (requests) => requests.some((request) => request.url === fetchedUrl && request.statusCode === 200),
            );

            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="toolbar-more"]');
            await ctx.app.window.screen.waitFor({ selector: '[data-name="page-menu"]' });
            await ctx.app.window.screen.click('text="Show Resources"');

            const pages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (items) => items.some((item) => item.editor === "link-view" && item.title.includes("Resources")),
            );
            linksPage = pages.find((item) => item.editor === "link-view" && item.title.includes("Resources"));
            await activatePage(ctx, linksPage.id);
            ctx.expect(await ctx.app.pages[linksPage.id].title).toBe("US-2090 Resources — Resources.link.json"); // openLinks names the page as a .link.json file
            const links = await ctx.app.pages[linksPage.id].editor.links;
            ctx.expect(links.some((link) => link.url.endsWith("/browser/page-tools/resources.css"))).toBe(true);
            ctx.expect(links.some((link) => link.url.endsWith("/browser/page-tools/resources.js"))).toBe(true);
            ctx.expect(links.some((link) => link.url.endsWith("/browser/page-tools/resources.svg"))).toBe(true);
            const fetched = links.find((link) => link.category === "Network/GET" && link.url.startsWith(`curl '${fetchedUrl}'`)); // the cURL line continues with -H headers
            ctx.expect(fetched).toBeTruthy();
            ctx.expect(fetched.title).toBe("resources.svg?from=fetch");
        } finally {
            await closeBrowserPage(ctx, { id: linksPage?.id });
            await closeBrowserPage(ctx, page);
        }
    }),

    test("cinema mode button appears over an attached video", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "page-tools", "cinema.html"));
        try {
            await page.editor.waitFor({ selector: "video[data-cinema-attached]", timeout: 10000 });
            await page.editor.hover("video");
            await page.editor.waitFor({ selector: 'div[title="Cinema Mode"]' });
            ctx.expect(await page.editor.exists('div[title="Cinema Mode"]')).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("cinema mode expands a video and Escape restores its original state", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "page-tools", "cinema.html"));
        try {
            await page.editor.waitFor({ selector: "video[data-cinema-attached]", timeout: 10000 });
            const original = await page.editor.evaluate(`() => {
                const video = document.querySelector("video");
                const rect = video.getBoundingClientRect();
                return { width: rect.width, height: rect.height, controls: video.controls, style: video.style.cssText };
            }`);
            await page.editor.hover("video");
            await page.editor.waitFor({ selector: 'div[title="Cinema Mode"]' });
            await page.editor.click('div[title="Cinema Mode"]');
            const expanded = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate(`() => {
                    const video = document.querySelector("video");
                    const rect = video.getBoundingClientRect();
                    return {
                        active: document.documentElement.dataset.cinemaActive === "1",
                        controls: video.controls,
                        width: rect.width,
                        height: rect.height,
                    };
                }`),
                (state) => state.active && state.controls && (state.width > original.width || state.height > original.height),
            );
            ctx.expect(expanded.active).toBe(true);
            ctx.expect(expanded.controls).toBe(true);

            await page.editor.pressKey("Escape");
            const restored = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.evaluate(`() => {
                    const video = document.querySelector("video");
                    const rect = video.getBoundingClientRect();
                    return {
                        active: document.documentElement.dataset.cinemaActive === "1",
                        controls: video.controls,
                        width: rect.width,
                        height: rect.height,
                        style: video.style.cssText,
                    };
                }`),
                (state) => !state.active && !state.controls && state.width === original.width && state.height === original.height,
            );
            ctx.expect(restored.style).toBe(original.style);
        } finally {
            try { await page.editor.pressKey("Escape"); } catch { /* Preserve the test result. */ }
            await closeBrowserPage(ctx, page);
        }
    }),

    test("fullscreen without a selector chooses the visible fixture video", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "page-tools", "fullscreen.html"));
        try {
            await page.editor.waitFor({ selector: "#fullscreen-video" });
            await activatePage(ctx, page.id);
            const result = await page.editor.fullscreen();
            ctx.expect(result).toEqual({ fullscreen: true });
            ctx.expect(await page.editor.evaluate("() => document.fullscreenElement?.id")).toBe("large-video");
            const exit = await page.editor.exitFullscreen();
            ctx.expect(exit).toEqual({ fullscreen: false });
            ctx.expect(await page.editor.evaluate("() => document.fullscreenElement === null")).toBe(true);
        } finally {
            await closeFullscreen(ctx, page);
            await closeBrowserPage(ctx, page);
        }
    }),

    test("fullscreen selector chooses the largest visible matching video", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "page-tools", "fullscreen.html"));
        try {
            await page.editor.waitFor({ selector: "#large-video" });
            await activatePage(ctx, page.id);
            const result = await page.editor.fullscreen(".fullscreen-target");
            ctx.expect(result).toEqual({ fullscreen: true });
            ctx.expect(await page.editor.evaluate("() => document.fullscreenElement?.id")).toBe("large-video");
            ctx.expect(await page.editor.exitFullscreen()).toEqual({ fullscreen: false });
        } finally {
            await closeFullscreen(ctx, page);
            await closeBrowserPage(ctx, page);
        }
    }),
];
