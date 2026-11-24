import { test } from "../../../lib/context.mjs";
import { closeBrowserPage, fixturePage, openBrowserPage } from "../../browser/helpers.mjs";
import { untrustBoard } from "../../helpers/boards.mjs";

const closePages = async (ctx, pageIds) => {
    for (const pageId of pageIds) {
        try {
            await ctx.call("pages.closePage", [pageId], { dialog: true });
            const buttons = await ctx.call("dialogs[0].buttons", undefined, { dialog: true }).catch(() => undefined);
            const discard = buttons?.find((button) => /don't save|discard/i.test(button));
            if (discard) await ctx.call("dialogs[0].click", [discard], { dialog: true });
        } catch {
            // Cleanup must not hide the original test failure.
        }
    }
};

export default [
    test("the MCP call description and root help expose the live object-model namespaces", async (ctx) => {
        const { tools } = await ctx._getClient().client.listTools();
        const callTool = tools.find((tool) => tool.name === "call");
        ctx.expect(Boolean(callTool)).toBe(true);
        ctx.expect(callTool.description).toContain("live object model by PATH");
        ctx.expect(callTool.description).toContain("Start with no path to see the overview");
        ctx.expect(JSON.stringify(callTool.inputSchema)).toContain("maxLength");

        const rootText = await ctx.callText("$help", []);
        for (const namespace of ["pages", "settings", "fs", "ui", "script", "guides", "main", "windows"]) {
            ctx.expect(rootText).toContain(namespace);
        }

        const scriptHelp = await ctx.callText("script.$help", []);
        for (const contract of ["JavaScript or TypeScript", "transpiled without type checking", "app, page, and io", "runId", "pending", "maxLength"]) {
            ctx.expect(scriptHelp).toContain(contract);
        }
    }),

    test("an invalid MCP path reports a useful member hint", async (ctx) => {
        let message;
        try {
            const result = await ctx.app.pages.us2032DefinitelyUnknownMember;
            message = typeof result === "string" ? result : JSON.stringify(result);
        } catch (error) {
            message = error.message;
        }
        const normalized = message.toLowerCase();
        ctx.expect(normalized).toContain("us2032definitelyunknownmember");
        ctx.expect(normalized).toContain("not a member of pages");
        ctx.expect(normalized).toContain("resolved up to");
        ctx.expect(normalized).not.toContain("aivision.members");
    }),

    test("maxLength truncation returns a bounded body and an explicit marker", async (ctx) => {
        const pageIds = [];
        try {
            const page = await ctx.app.pages.addEmptyPage();
            pageIds.push(page.id);
            await ctx.app.pages.showPage(page.id);
            const longText = "us2032-truncation-marker-".repeat(40);
            const setValue = await ctx.app.script.execute(`page.data.us2032Long = ${JSON.stringify(longText)}`, page.id, "javascript");
            ctx.expect(setValue.isError).toBe(false);

            const raw = await ctx._getClient().rawCall(`pages[${JSON.stringify(page.id)}].data.us2032Long`, undefined, { maxLength: 120 });
            const blocks = raw.content.filter((block) => block.type === "text").map((block) => block.text);
            const marker = blocks.find((value) => value.startsWith("[truncated:"));
            ctx.expect(Boolean(marker)).toBe(true);
            ctx.expect(marker.toLowerCase()).toContain("chars");
            ctx.expect(blocks[0].length <= 120).toBe(true);
            ctx.expect(blocks[0].length > 0).toBe(true);

            const standInValue = await ctx.app.withOptions({ maxLength: 120 }).pages[page.id].data.us2032Long;
            ctx.expect(typeof standInValue).toBe("string");
            ctx.expect(standInValue.length).toBeLessThanOrEqual(120);
            const polledValue = await ctx.waitFor(`pages[${JSON.stringify(page.id)}].data.us2032Long`, (value) => typeof value === "string", { maxLength: 120 });
            ctx.expect(polledValue.length).toBeLessThanOrEqual(120);
        } finally {
            await closePages(ctx, pageIds);
        }
    }),

    test("call preserves string and JSON value types and raw text", async (ctx) => {
        const page = await ctx.app.pages.addEditorPage("monaco", "plaintext", "us2125-value-fidelity", "true");
        try {
            const stringPath = `pages[${JSON.stringify(page.id)}].content`;
            const raw = await ctx._getClient().rawCall(stringPath);
            ctx.expect(raw.content.find((block) => block.type === "text").text).toBe("true");
            ctx.expect(await ctx.call(stringPath)).toBe("true");

            await ctx.set(stringPath, '{"name":"Ada"}');
            const jsonText = await ctx.call(stringPath);
            const boolean = await ctx.call(`pages[${JSON.stringify(page.id)}].pinned`);
            ctx.expect(jsonText).toBe('{"name":"Ada"}');
            ctx.expect(typeof jsonText).toBe("string");
            ctx.expect(boolean).toBe(false);
            ctx.expect(typeof boolean).toBe("boolean");
        } finally {
            await closePages(ctx, [page.id]);
        }
    }),

    test("normal windows accept unique names and exact name selection", async (ctx) => {
        const firstName = "us2189-main-window";
        const duplicateName = "us2189-duplicate-window";
        await ctx.set("windows[0].name", firstName);
        let created;
        try {
            const selected = await ctx.call("windows.selectTestWindow", [`name:${firstName}`]);
            ctx.expect(selected.index).toBe(0);
            ctx.expect(selected.name).toBe(firstName);
            const titled = await ctx.call("windows.selectTestWindow", [firstName]);
            ctx.expect(titled.index).toBe(0);
            const missing = await ctx.call("windows.selectTestWindow", ["name:us2189-missing"]);
            ctx.expect(missing.count).toBe(0);

            for (const invalid of ["", "  ", "bad/name", "x".repeat(65)]) {
                let failure;
                try { await ctx.set("windows[0].name", invalid); } catch (error) { failure = error; }
                ctx.expect(Boolean(failure)).toBe(true);
            }

            created = await ctx.call("windows.createTestWindow", []);
            await ctx.set(`windows[${created.index}].name`, duplicateName);
            let duplicateFailure;
            try { await ctx.set(`windows[${created.index}].name`, firstName.toUpperCase()); } catch (error) { duplicateFailure = error; }
            ctx.expect(duplicateFailure.message).toContain("already in use");
            let malformedFailure;
            try { await ctx.call("windows.selectTestWindow", ["name:bad/name"]); } catch (error) { malformedFailure = error; }
            ctx.expect(malformedFailure.message).toContain("Window name");
        } finally {
            await ctx.set("windows[0].name", null);
            if (created) {
                await ctx.set(`windows[${created.index}].name`, null);
                await ctx.call("windows.disposeTestWindow", [created.index, created.windowId]);
            }
        }
    }),

    test("named test-window creation reuses the same live identity", async (ctx) => {
        const name = "us2189-create-reuse";
        let created;
        try {
            created = await ctx.call("windows.createOrSelectNamedTestWindow", [name]);
            ctx.expect(created.name).toBe(name);
            ctx.expect(created.created).toBe(true);
            const reused = await ctx.call("windows.createOrSelectNamedTestWindow", [name]);
            ctx.expect(reused.index).toBe(created.index);
            ctx.expect(reused.windowId).toBe(created.windowId);
            ctx.expect(reused.created).toBe(false);
        } finally {
            if (created) {
                await ctx.call(`windows[${created.index}].window.close`, []);
                await ctx.waitFor(() => ctx.call("windows.selectTestWindow", [`name:${name}`]), (result) => result.count === 0);
            }
        }
    }),

    test("board windows cannot be named", async (ctx) => {
        const directory = ctx.fixture("us2189-board-name");
        await ctx.app.fs.mkdir(directory);
        let root;
        let boardWindowIndex;
        try {
            root = await ctx.app.boards.createBoard("NamedWindow", directory);
            const priorOpen = new Set((await ctx.call("windows")).open);
            await ctx.app.boards.openBoardWindow(root);
            const current = await ctx.waitFor("windows", (summary) => summary.open.some((index) => !priorOpen.has(index)));
            boardWindowIndex = current.open.find((index) => !priorOpen.has(index));
            let failure;
            try { await ctx.set(`windows[${boardWindowIndex}].name`, "us2189-board"); } catch (error) { failure = error; }
            ctx.expect(failure.message).toContain("normal window");
        } finally {
            if (boardWindowIndex !== undefined) {
                try { await ctx.call(`windows[${boardWindowIndex}].window.close`, []); } catch { /* Already closed. */ }
            }
            await untrustBoard(ctx, root);
            try { await ctx.app.fs.removeDir(directory, true); } catch { /* Work folder is already gone. */ }
        }
    }),

    test("method calls require an argument array and assertion helpers cover comparisons", async (ctx) => {
        let failure;
        try { await ctx.call("ui.alerts.list"); } catch (error) { failure = error; }
        ctx.expect(failure).toBeTruthy();
        ctx.expect(failure.message).toContain('ctx.call("ui.alerts.list", [])');
        ctx.expect(5).toBeGreaterThan(4);
        ctx.expect(5).toBeLessThanOrEqual(5);
        ctx.expect("US-2125").toMatch(/^US-\d+$/);
    }),

    test("a bounded automation wait returns a timeout error", async (ctx) => {
        let failure;
        try {
            await ctx.app.window.screen.waitFor({ selector: "[data-us2032-never-present]", timeout: 150 });
        } catch (error) {
            failure = error;
        }

        ctx.expect(Boolean(failure)).toBe(true);
        ctx.expect(/timed?\s*out|timeout/i.test(failure.message)).toBe(true);
    }),

    test("waitFor retries read errors only when opted in and reports the last read error", async (ctx) => {
        let reads = 0;
        const settled = await ctx.waitFor(() => {
            reads += 1;
            if (reads === 1) throw new Error("temporary read failure");
            return "settled";
        }, (value) => value === "settled", { retryErrors: true, timeout: 1000 });
        ctx.expect(settled).toBe("settled");
        ctx.expect(reads).toBe(2);

        let defaultReads = 0;
        let defaultError;
        try {
            await ctx.waitFor(() => { defaultReads += 1; throw new Error("immediate read failure"); }, () => true);
        } catch (error) { defaultError = error; }
        ctx.expect(defaultError.message).toContain("immediate read failure");
        ctx.expect(defaultReads).toBe(1);

        let predicateError;
        try { await ctx.waitFor(() => "value", () => { throw new Error("predicate failure"); }, { retryErrors: true }); }
        catch (error) { predicateError = error; }
        ctx.expect(predicateError.message).toContain("predicate failure");

        let timeoutError;
        try {
            await ctx.waitFor(() => { throw new Error("last read failure"); }, () => false, { retryErrors: true, timeout: 100 });
        } catch (error) { timeoutError = error; }
        ctx.expect(timeoutError.message).toContain("Last error:");
        ctx.expect(timeoutError.message).toContain("last read failure");

        const page = await openBrowserPage(ctx, fixturePage(ctx, "page-models", "page-model.html"));
        const secret = "us2190-redaction-secret";
        try {
            await page.editor.evaluate(`() => localStorage.setItem("redaction", ${JSON.stringify(secret)})`);
            await ctx.call(`pages[${JSON.stringify(page.id)}].editor.storageState`, []);
            let redactedTimeout;
            try {
                await ctx.waitFor(() => { throw new Error(secret); }, () => false, { retryErrors: true, timeout: 100 });
            } catch (error) { redactedTimeout = error; }
            ctx.expect(redactedTimeout.message).not.toContain(secret);
            ctx.expect(redactedTimeout.message).toContain("[redacted]");
        } finally { await closeBrowserPage(ctx, page); }
    }),
];
