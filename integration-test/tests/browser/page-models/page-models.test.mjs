import { test } from "../../../lib/context.mjs";
import { closeBrowserPage, fixturePage, openBrowserPage } from "../helpers.mjs";

function pageModelFixtureUrl(ctx, file) {
    return fixturePage(ctx, "page-models", file);
}

function editorDescribePath(pageId) {
    return `pages[${JSON.stringify(pageId)}].editor.$describe`;
}

function findAppMember(descriptor) {
    return descriptor.members.find((member) => member.name === "app");
}

function hasMember(descriptor, name) {
    return descriptor?.members?.some((member) => member.name === name) || false;
}

async function waitForAppDescribe(ctx, pageId, predicate) {
    return ctx.waitFor(async (activeContext) => {
        try {
            return await activeContext.app.pages[pageId].editor.app.$describe;
        } catch {
            return undefined;
        }
    }, (descriptor) => Boolean(descriptor && predicate(descriptor)), { timeout: 10000 });
}

async function waitForWebMcpDescribe(ctx, pageId, predicate) {
    return ctx.waitFor(async (activeContext) => {
        try {
            return await activeContext.app.pages[pageId].editor.app.webmcp.$describe;
        } catch {
            return undefined;
        }
    }, (descriptor) => Boolean(descriptor && predicate(descriptor)), { timeout: 10000 });
}

function helpListsApp(help) {
    return /^\s*app(?:\s|$)/m.test(help);
}

async function openToolsPage(ctx, options) {
    const page = await openBrowserPage(ctx, pageModelFixtureUrl(ctx, "tools.html"), options);
    await page.editor.waitFor({ selector: "#register" });
    return page;
}

export default [
    test("WebMCP tools appear in the browser page model with help and annotations", async (ctx) => {
        const page = await openToolsPage(ctx);
        try {
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            ctx.expect(await page.editor.evaluate("() => typeof document.modelContext")).toBe("object");
            await page.editor.click("#register");
            await ctx.waitFor(editorDescribePath(page.id), (descriptor) => Boolean(findAppMember(descriptor)), { timeout: 10000 });
            await waitForAppDescribe(ctx, page.id, (descriptor) =>
                ["confirm_order", "read_status", "search_products"].every((name) => hasMember(descriptor, name)));

            const app = ctx.app.pages[page.id].editor.app;
            const [help, descriptor] = await Promise.all([app.$help, app.$describe]);
            ctx.expect(help).toContain("confirm_order");
            ctx.expect(help).toContain("confirm-order");
            ctx.expect(help).toContain("read_status");
            ctx.expect(help).toContain("search_products");
            ctx.expect(help).toContain("search-products");
            ctx.expect(descriptor.kind).toBe("page:WebMCP");

            const confirm = descriptor.members.find((member) => member.name === "confirm_order");
            const status = descriptor.members.find((member) => member.name === "read_status");
            const search = descriptor.members.find((member) => member.name === "search_products");
            ctx.expect(confirm.summary).toContain("confirm-order");
            ctx.expect(confirm.caution).toContain("side effects");
            ctx.expect(status.caution).toBe(undefined);
            ctx.expect(search.summary).toContain("search-products");
            ctx.expect(search.caution).toContain("untrusted site data");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("confirm_order forwards one object argument and returns its exact confirmation", async (ctx) => {
        const page = await openToolsPage(ctx);
        try {
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            await page.editor.click("#register");
            await ctx.waitFor(editorDescribePath(page.id), (descriptor) => Boolean(findAppMember(descriptor)), { timeout: 10000 });
            await waitForAppDescribe(ctx, page.id, (descriptor) => hasMember(descriptor, "confirm_order"));

            const result = await ctx.callText(
                `pages[${JSON.stringify(page.id)}].editor.app.confirm_order`,
                [{ item: "sample item" }],
            );
            ctx.expect(result).toBe("Confirmed: sample item.");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("hyphenated WebMCP names map to callable methods and retain structured results", async (ctx) => {
        const page = await openToolsPage(ctx);
        try {
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            await page.editor.click("#register");
            await ctx.waitFor(editorDescribePath(page.id), (descriptor) => Boolean(findAppMember(descriptor)), { timeout: 10000 });
            await waitForAppDescribe(ctx, page.id, (descriptor) => hasMember(descriptor, "search_products"));

            const app = ctx.app.pages[page.id].editor.app;
            const [help, descriptor, result] = await Promise.all([
                app.$help,
                app.$describe,
                app.search_products({ query: "tea" }),
            ]);
            ctx.expect(help).toContain("search-products");
            ctx.expect(descriptor.members.some((member) => member.name === "search_products")).toBe(true);
            ctx.expect(result).toEqual({ query: "tea", products: ["sample product"] });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("a tool registered after page load appears in the live descriptor", async (ctx) => {
        const page = await openToolsPage(ctx);
        try {
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            await page.editor.click("#register-late");
            await waitForAppDescribe(ctx, page.id, (descriptor) => hasMember(descriptor, "late_tool"));
            const descriptor = await ctx.app.pages[page.id].editor.app.$describe;
            ctx.expect(descriptor.members.some((member) => member.name === "late_tool" && member.kind === "method")).toBe(true);
            ctx.expect(await ctx.app.pages[page.id].editor.app.late_tool()).toBe("Registered late.");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("removing tools updates the model and removing the last tool removes app", async (ctx) => {
        const page = await openToolsPage(ctx);
        try {
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            await page.editor.click("#register");
            await ctx.waitFor(editorDescribePath(page.id), (descriptor) => Boolean(findAppMember(descriptor)), { timeout: 10000 });
            await page.editor.click("#register-late");
            await waitForAppDescribe(ctx, page.id, (descriptor) => hasMember(descriptor, "late_tool"));

            await page.editor.click("#remove-late");
            const withoutLate = await waitForAppDescribe(ctx, page.id, (descriptor) => !hasMember(descriptor, "late_tool"));
            ctx.expect(hasMember(withoutLate, "late_tool")).toBe(false);
            const editorAfterLateRemoval = await ctx.app.pages[page.id].editor.$describe;
            ctx.expect(Boolean(findAppMember(editorAfterLateRemoval))).toBe(true);

            await page.editor.click("#remove-base");
            const empty = await ctx.waitFor(
                editorDescribePath(page.id),
                (descriptor) => !descriptor.members.some((member) => member.name === "app"),
                { timeout: 10000 },
            );
            ctx.expect(empty.members.some((member) => member.name === "app")).toBe(false);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("WebMCP is grouped beside a page-published model", async (ctx) => {
        const page = await openBrowserPage(ctx, pageModelFixtureUrl(ctx, "page-model.html"));
        try {
            await page.editor.waitFor({ selector: "#fixture-ready" });
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            await ctx.waitFor(
                editorDescribePath(page.id),
                (descriptor) => Boolean(findAppMember(descriptor)),
                { timeout: 10000 },
            );
            await waitForAppDescribe(ctx, page.id, (descriptor) => hasMember(descriptor, "greeting") && hasMember(descriptor, "webmcp"));
            await waitForWebMcpDescribe(ctx, page.id, (descriptor) => hasMember(descriptor, "search_products"));

            const app = ctx.app.pages[page.id].editor.app;
            const [help, descriptor] = await Promise.all([app.$help, app.$describe]);
            const members = descriptor.members;
            ctx.expect(members.some((member) => member.name === "greeting" && member.kind === "method")).toBe(true);
            ctx.expect(hasMember(descriptor, "webmcp")).toBe(true);
            const webMcpDescriptor = await app.webmcp.$describe;
            ctx.expect(hasMember(webMcpDescriptor, "search_products")).toBe(true);
            ctx.expect(help).toContain("greeting");
            ctx.expect(help).toContain("webmcp");
            ctx.expect(await app.greeting()).toBe("Hello, fixture.");
            ctx.expect(await app.webmcp.search_products({ query: "tea" })).toEqual({ query: "tea", products: ["sample product"] });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("unknown page model members suggest declaration without invoking getters", async (ctx) => {
        const page = await openBrowserPage(ctx, pageModelFixtureUrl(ctx, "page-model.html"));
        try {
            await page.editor.waitFor({ selector: "#fixture-ready" });
            await waitForAppDescribe(ctx, page.id, (descriptor) => hasMember(descriptor, "greeting"));
            for (const member of ["undocumentedOwnMember", "undocumentedPrototypeMember", "unknownTypo"]) {
                let error;
                try { await ctx.call(`pages[${JSON.stringify(page.id)}].editor.app.${member}`); }
                catch (failure) { error = failure; }
                ctx.expect(error.message).toContain("not a member of page:");
                ctx.expect(error.message).toContain("add it to aiVision.members");
            }
            ctx.expect(await page.editor.evaluate("() => window.__fixtureGetterReads()" )).toBe(0);
            ctx.expect(await ctx.app.pages[page.id].editor.app.greeting()).toBe("Hello, fixture.");
        } finally { await closeBrowserPage(ctx, page); }
    }),

    test("Incognito pages do not receive the Persephone WebMCP model", async (ctx) => {
        const page = await openToolsPage(ctx, { incognito: true });
        try {
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            const modelContextType = await page.editor.evaluate("() => typeof document.modelContext");
            ctx.expect(modelContextType === "undefined" || modelContextType === "object").toBe(true);
            await page.editor.click("#register");
            const help = await page.editor.$help;
            ctx.expect(helpListsApp(help)).toBe(false);
            const descriptor = await ctx.app.pages[page.id].editor.$describe;
            ctx.expect(descriptor.members.some((member) => member.name === "app")).toBe(false);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("an empty regular page has no empty app model", async (ctx) => {
        const page = await openToolsPage(ctx);
        try {
            ctx.expect(await page.editor.evaluate("() => window.isSecureContext")).toBe(true);
            ctx.expect(await page.editor.evaluate("() => typeof document.modelContext")).toBe("object");
            const help = await page.editor.$help;
            ctx.expect(helpListsApp(help)).toBe(false);
            const descriptor = await ctx.app.pages[page.id].editor.$describe;
            ctx.expect(descriptor.members.some((member) => member.name === "app")).toBe(false);

            await page.editor.click("#register");
            await ctx.waitFor(editorDescribePath(page.id), (next) => Boolean(findAppMember(next)), { timeout: 10000 });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),
];
