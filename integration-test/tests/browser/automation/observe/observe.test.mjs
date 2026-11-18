import { test } from "../../../../lib/context.mjs";
import { closeBrowserPage, fixturePage, openBrowserPage } from "../../helpers.mjs";

async function captureError(operation) {
    try { await operation(); }
    catch (error) { return error; }
    return undefined;
}

export default [
    test("waitFor selector states track attachment and visibility", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            await page.editor.waitFor({ selector: "#added", state: "detached" });
            await page.editor.click("#add");
            await page.editor.waitFor({ selector: "#added", state: "attached" });
            await page.editor.click("#remove");
            await page.editor.waitFor({ selector: "#added", state: "detached" });

            await page.editor.waitFor({ selector: "#visibility", state: "visible" });
            await page.editor.click("#hide");
            await page.editor.waitFor({ selector: "#visibility", state: "hidden" });
            ctx.expect(await page.editor.evaluate("Boolean(document.querySelector('#visibility'))")).toBe(true);
            await page.editor.click("#show");
            await page.editor.waitFor({ selector: "#visibility", state: "visible" });
            await page.editor.click("#remove-visibility");
            await page.editor.waitFor({ selector: "#visibility", state: "detached" });
            await page.editor.click("#restore-visibility");
            await page.editor.waitFor({ selector: "#visibility", state: "visible" });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitFor text and textGone observe page content", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            await page.editor.waitFor({ text: "observe-text-marker" });
            await page.editor.click("#change-text");
            await page.editor.waitFor({ text: "observe-finished" });
            await page.editor.waitFor({ textGone: "observe-text-marker" });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitFor time and wait complete using their documented units", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            await page.editor.waitFor({ time: 0.05 });
            await page.editor.wait(100);
            ctx.expect(await page.editor.evaluate("document.querySelector('#status').textContent")).toBe("observe-status-ready");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitForSelector waits for attached and hidden states", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            await page.editor.click("#add");
            await page.editor.waitForSelector("#added", { state: "attached", timeout: 1000 });
            await page.editor.click("#hide");
            await page.editor.waitForSelector("#visibility", { state: "hidden", timeout: 1000 });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waits reject after their timeout", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            const waitForError = await captureError(() => page.editor.waitFor({ selector: "#never", timeout: 100 }));
            ctx.expect(waitForError?.message).toContain("#never");
            const selectorError = await captureError(() => page.editor.waitForSelector("#never", { timeout: 100 }));
            ctx.expect(selectorError?.message).toContain("#never");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitForURL matches exact and regex URLs and rejects invalid patterns", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            const destinationUrl = ctx.httpUrl("/browser/automation/observe-destination.html");
            const exactWait = page.editor.waitForURL(destinationUrl, { timeout: 5000 });
            const regexWait = page.editor.waitForURL({ regex: "observe-destination\\.html$" }, { timeout: 5000 });
            await page.editor.click("#navigate");
            const [exact, regex] = await Promise.all([exactWait, regexWait]);
            ctx.expect(exact.url).toBe(destinationUrl);
            ctx.expect(exact.status).toBe(200);
            ctx.expect(regex.url).toBe(destinationUrl);
            ctx.expect(await page.editor.evaluate("document.querySelector('#destination').textContent")).toBe("observe-destination-loaded");

            const invalidPattern = await captureError(() => page.editor.waitForURL({ regex: "(" }, { timeout: 1000 }));
            ctx.expect(invalidPattern).toBeTruthy();
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitForNavigation observes the next document", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            const navigation = page.editor.waitForNavigation({ timeout: 5000 });
            await page.editor.click("#navigate");
            const result = await navigation;
            ctx.expect(result.url).toBe(ctx.httpUrl("/browser/automation/observe-destination.html"));
            ctx.expect(result.status).toBe(200);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("networkRequests omits response bodies by default", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-network.html"));
        try {
            await page.editor.networkRequests();
            await page.editor.click("#post-exact");
            const requests = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.networkRequests(),
                (items) => items.some((item) => item.url.endsWith("/echo") && item.statusCode === 200),
            );
            const request = requests.find((item) => item.url.endsWith("/echo"));
            ctx.expect(request.method).toBe("POST");
            ctx.expect(request.statusCode).toBe(200);
            ctx.expect(request.responseBody).toBe(undefined);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("networkRequests includes request and capped response bodies when requested", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-network.html"));
        try {
            await page.editor.networkRequests();
            await page.editor.click("#post-exact");
            const requests = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.networkRequests({ includeBodies: true, maxBodyBytes: 32 }),
                (items) => items.some((item) => item.url.endsWith("/echo") && item.statusCode === 200 && item.responseBody !== undefined),
            );
            const request = requests.find((item) => item.url.endsWith("/echo"));
            ctx.expect(request.requestBody).toBe("observe-fake-request-body");
            ctx.log(`Capped response body length: ${request.responseBody.length} bytes (maximum 32).`);
            ctx.expect(request.responseBody.length <= 32).toBeTruthy();
            ctx.expect(request.responseBodyTruncated).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitForResponse matches an exact URL and includes its body", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-network.html"));
        try {
            const responseWait = page.editor.waitForResponse(ctx.httpUrl("/echo"), { timeout: 5000, includeBody: true, maxBodyBytes: 16384 });
            await page.editor.click("#post-exact");
            const response = await responseWait;
            ctx.expect(response.url).toBe(ctx.httpUrl("/echo"));
            ctx.expect(response.status).toBe(200);
            ctx.expect(JSON.parse(response.body).body).toBe("observe-fake-request-body");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitForResponse matches regex URLs with varying queries and rejects invalid patterns", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-network.html"));
        try {
            const responseWait = page.editor.waitForResponse({ regex: "/echo\\?n=\\d+$" }, { timeout: 5000, includeBody: true });
            await page.editor.click("#post-varying");
            const response = await responseWait;
            ctx.expect(/\/echo\?n=\d+$/.test(response.url)).toBe(true);
            ctx.expect(response.status).toBe(200);
            ctx.expect(response.body).toContain("observe-fake-varying-request");

            const invalidPattern = await captureError(() => page.editor.waitForResponse({ regex: "(" }, { timeout: 1000 }));
            ctx.expect(invalidPattern).toBeTruthy();
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("waitForResponse resolves HTTP error responses", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-network.html"));
        try {
            const responseWait = page.editor.waitForResponse(ctx.httpUrl("/status?code=503"), { timeout: 5000 });
            await page.editor.click("#status-error");
            const response = await responseWait;
            ctx.expect(response.status).toBe(503);
            ctx.expect(response.body).toBe(undefined);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("consoleMessages and pageErrors return captured page diagnostics", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-dialogs.html"));
        try {
            await page.editor.evaluate("document.title");
            await page.editor.evaluate("console.log('observe-fake-log'); console.warn('observe-fake-warning'); setTimeout(() => { throw new Error('observe-fake-error') }, 0)");
            const messages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.consoleMessages(),
                (items) => items.some((item) => item.args.join(" ").includes("observe-fake-log")) && items.some((item) => item.args.join(" ").includes("observe-fake-warning")),
            );
            const errors = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.pageErrors(),
                (items) => items.some((item) => item.text.includes("observe-fake-error")),
            );
            ctx.expect(messages.some((item) => item.type === "log" && item.args.join(" ").includes("observe-fake-log"))).toBe(true);
            ctx.expect(messages.some((item) => item.type === "warning" && item.args.join(" ").includes("observe-fake-warning"))).toBe(true);
            ctx.expect(errors.some((item) => item.text.includes("observe-fake-error"))).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("default dialog policy dismisses automation dialogs", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-dialogs.html"));
        try {
            await page.editor.click("#confirm");
            const state = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.dialogs(),
                (value) => value.dialogs.some((dialog) => dialog.type === "confirm" && dialog.disposition === "dismissed"),
            );
            ctx.expect(state.policy).toBe("dismiss");
            ctx.expect(await page.editor.evaluate("document.querySelector('#result').textContent")).toBe(false);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("dialog policies accept, dismiss, and manual handling", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-dialogs.html"));
        try {
            await page.editor.dialogs({ policy: "accept" });
            await page.editor.click("#confirm");
            ctx.expect(await page.editor.evaluate("document.querySelector('#result').textContent")).toBe(true);

            await page.editor.dialogs({ policy: "dismiss" });
            await page.editor.click("#confirm");
            ctx.expect(await page.editor.evaluate("document.querySelector('#result').textContent")).toBe(false);

            const policyState = await page.editor.dialogs({ policy: "manual" });
            ctx.expect(policyState.policy).toBe("manual");
            // window.prompt() is not available in Electron guest pages (it throws), so the manual
            // policy is checked with a confirm dialog; promptText stays uncovered.
            const click = page.editor.click("#confirm");
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.dialogs(),
                (value) => value.dialogs.some((dialog) => dialog.type === "confirm" && dialog.disposition === "pending"),
            );
            await page.editor.handleDialog(true);
            await click;
            ctx.expect(await page.editor.evaluate("document.querySelector('#result').textContent")).toBe(true);
            const finalState = await page.editor.dialogs();
            ctx.expect(finalState.dialogs.filter((dialog) => dialog.type === "confirm").at(-1).disposition).toBe("accepted");
        } finally {
            try { await page.editor.dialogs({ policy: "dismiss" }); } catch { /* restore the default before closing */ }
            await closeBrowserPage(ctx, page);
        }
    }),

    test("viewport emulation changes and restores innerWidth", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "automation", "observe-waits.html"));
        try {
            const originalWidth = await page.editor.evaluate("window.innerWidth");
            await page.editor.setViewport({ width: 640, height: 480 });
            ctx.expect(await page.editor.evaluate("window.innerWidth")).toBe(640);
            await page.editor.clearViewport();
            ctx.expect(await page.editor.evaluate("window.innerWidth")).toBe(originalWidth);
        } finally {
            try { await page.editor.clearViewport(); } catch { /* make sure the page has no viewport override */ }
            await closeBrowserPage(ctx, page);
        }
    }),
];
