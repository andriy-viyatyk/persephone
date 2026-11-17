import { test } from "../../../lib/context.mjs";
import { closeNewManagedLogPage, closePage, openLogViewPage } from "../helpers.mjs";

async function pageIds(ctx) {
    return (await ctx.app.pages.all).map((page) => page.id);
}

async function finishManagedLog(ctx, previousPageIds) {
    await closeNewManagedLogPage(ctx, previousPageIds);
}

async function clickLogControl(ctx, name) {
    await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("window.screen.click", [`[data-page-id="mcp-ui-log"] [data-name="${name}"]`], { dialog: true });
}

async function logSnapshot(ctx) {
    return ctx.callText("window.screen.snapshot", [{ maxChars: 16000 }]);
}

async function pushDialog(ctx, entry) {
    let attention;
    try {
        await ctx.script(`return JSON.stringify(app.pages.logView.push(${JSON.stringify(entry)}));`);
    } catch (error) {
        attention = error.message;
    }
    ctx.expect(attention).toContain("An inline Log View dialog is unanswered");
    const pushed = (await ctx.app.pages.logView.entries).find((item) => item.type === entry.type);
    ctx.expect(pushed).toBeTruthy();
    return { dialogIds: [pushed.id] };
}

export default [
    test("Log View opens marked JSONL files and leaves plain JSONL in Text Editor", async (ctx) => {
        let logPage;
        let plainPage;
        let markedPage;
        try {
            logPage = await openLogViewPage(ctx, "us-2050/open-log", "events.log.jsonl", [
                { id: "fixture-info", type: "log.info", text: "Fixture log entry" },
                { id: "fixture-warn", type: "log.warn", text: "Second fixture entry" },
            ]);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[logPage.id].editor.entryCount, (count) => count === 2)).toBe(2);
            ctx.expect(await ctx.app.pages[logPage.id].editor.error).toBe(null);
            ctx.expect((await ctx.app.pages[logPage.id].editor.entries).some((entry) => entry.type === "log.info" && entry.text === "Fixture log entry")).toBe(true);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (snapshot) => snapshot.includes("Fixture log entry") && snapshot.includes("Second fixture entry"),
            )).toContain("Fixture log entry");

            const plainPath = ctx.fixture("us-2050/open-log/plain.jsonl");
            await ctx.app.fs.write(plainPath, '{"type":"record","value":"plain JSONL"}\n');
            plainPage = await ctx.app.pages.openFile(plainPath);
            const plainRoot = ctx.handle(ctx.app.pages[plainPage.id]);
            await ctx.waitFor((activeContext) => activeContext.app.pages[plainPage.id].editor.id, (editor) => editor === "monaco");
            ctx.expect((await plainRoot.editorSwitches.options).some((option) => option.id === "log-view")).toBe(false);

            const markedPath = ctx.fixture("us-2050/open-log/marked.jsonl");
            await ctx.app.fs.write(markedPath, '{"id":"marked-info","type":"log.info","text":"marked entry"}\n');
            markedPage = await ctx.app.pages.openFile(markedPath);
            const markedRoot = ctx.handle(ctx.app.pages[markedPage.id]);
            await ctx.waitFor((activeContext) => activeContext.app.pages[markedPage.id].editor.id, (editor) => editor === "monaco");
            ctx.expect((await markedRoot.editorSwitches.options).some((option) => option.id === "log-view")).toBe(true);
            await markedRoot.editorSwitches.switchTo("log-view");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[markedPage.id].editor.entryCount, (count) => count === 1)).toBe(1);
            ctx.expect((await markedRoot.editor.entries).some((entry) => entry.type === "log.info" && entry.text === "marked entry")).toBe(true);
        } finally {
            if (markedPage) await closePage(ctx, markedPage.id);
            if (plainPage) await closePage(ctx, plainPage.id);
            if (logPage) await closePage(ctx, logPage.id);
        }
    }),

    test("pages.logView.push creates the managed page and renders each documented output kind", async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        try {
            const result = await ctx.app.pages.logView.push([
                "Plain pushed log line",
                { type: "output.text", title: "Text output", text: "Read-only text payload" },
                { type: "output.markdown", title: "Markdown output", text: "## Markdown payload\n\nRendered paragraph" },
                { type: "output.mermaid", title: "Mermaid output", text: "flowchart TD\n  A[Start] --> B[Finish]" },
                { type: "output.grid", title: "Grid output", content: '[{"name":"Ada","city":"Kyiv"}]' },
            ]);
            ctx.expect(result.entryIds.length).toBe(5);
            ctx.expect(result.dialogIds).toEqual([]);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.logView.entryCount, (count) => count === 5)).toBe(5);
            const entries = await ctx.app.pages.logView.entries;
            ctx.expect(entries.map((entry) => entry.type)).toEqual([
                "log.info", "output.text", "output.markdown", "output.mermaid", "output.grid",
            ]);
            const snapshot = await ctx.waitFor(
                (activeContext) => logSnapshot(activeContext),
                (value) => value.includes("Plain pushed log line")
                    && value.includes("Markdown payload")
                    && value.includes("Grid output"),
            );
            ctx.expect(entries[1].text).toBe("Read-only text payload");
            ctx.expect(snapshot).toContain("Rendered paragraph");
        } finally {
            await finishManagedLog(ctx, previousPageIds);
        }
    }),

    ...[
        { name: "text", type: "output.text", title: "Text action", text: "Text action payload", control: "log-text-open-in-editor", editor: "monaco", content: "Text action payload", panel: "log-text-output" },
        { name: "Markdown", type: "output.markdown", title: "Markdown action", text: "# Markdown action payload", control: "log-markdown-open-in-editor", editor: "md-view", content: "Markdown action payload", panel: "log-markdown-output" },
        { name: "Mermaid", type: "output.mermaid", title: "Mermaid action", text: "flowchart TD\n  A --> B", control: "log-mermaid-open-in-editor", editor: "mermaid-view", content: "flowchart TD", panel: "log-mermaid-output" },
        { name: "grid", type: "output.grid", title: "Grid action", content: '[{"name":"Ada"}]', control: "log-grid-open-in-editor", editor: "grid-json", contentCheck: "Ada", panel: "log-grid-output" },
    ].map((output) => test(`Log View opens ${output.name} output in its editor`, async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        let openedPageId;
        try {
            await ctx.app.pages.logView.push({ type: output.type, title: output.title, text: output.text, content: output.content });
            const panel = `[data-page-id="mcp-ui-log"] [data-name="${output.panel}"]`;
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages.logView.elements,
                (elements) => elements.some((element) => element.name === output.control),
            );
            await ctx.app.window.screen.hover(panel);
            await ctx.app.window.screen.click(`[data-page-id="mcp-ui-log"] [data-name="${output.control}"]`);
            const pages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (current) => current.some((page) => !previousPageIds.includes(page.id) && page.editor === output.editor),
            );
            const opened = pages.find((page) => !previousPageIds.includes(page.id) && page.editor === output.editor);
            openedPageId = opened.id;
            const node = ctx.handle(ctx.app.pages[opened.id]);
            const content = output.contentCheck ?? output.content;
            const openedContent = await ctx.waitFor((activeContext) => activeContext.app.pages[opened.id].content, (value) => JSON.stringify(value).includes(content));
            ctx.expect(JSON.stringify(openedContent)).toContain(content);
        } finally {
            if (openedPageId) await closePage(ctx, openedPageId);
            await finishManagedLog(ctx, previousPageIds);
        }
    })),

    test("Log View toolbar toggles timestamps and clears entries after confirmation", async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        try {
            await ctx.app.pages.logView.push({ type: "log.info", text: "Entry to clear" });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.logView.showTimestamps, (enabled) => enabled === false)).toBe(false);
            await clickLogControl(ctx, "log-toggle-timestamps");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.logView.showTimestamps, (enabled) => enabled === true)).toBe(true);
            await clickLogControl(ctx, "log-toggle-timestamps");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.logView.showTimestamps, (enabled) => enabled === false)).toBe(false);

            await clickLogControl(ctx, "log-clear");
            await ctx.waitFor(
                (activeContext) => activeContext.callText("dialogs[0].message", undefined, { dialog: true }),
                (message) => message.toLowerCase().includes("clear"),
            );
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("dialogs[0].click", ["Yes"], { dialog: true });
            await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (snapshot) => !snapshot.includes("Clear all log entries?"),
            );
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.logView.entryCount, (count) => count === 0)).toBe(0);
            ctx.expect(await ctx.app.pages.logView.entries).toEqual([]);
        } finally {
            await finishManagedLog(ctx, previousPageIds);
        }
    }),

    test("Log View radio dialog records the selected answer", async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        try {
            const { dialogIds } = await pushDialog(ctx, {
                type: "input.radioboxes", title: "Choose size", items: ["Small", "Large"], buttons: ["Cancel", "OK"],
            });
            const id = dialogIds[0];
            ctx.expect(await ctx.app.pages.logView.dialogResult(id)).toEqual({ id, status: "unresolved" });
            await ctx.app.window.screen.click("text=Large");
            await clickLogControl(ctx, "log-button-OK");
            const result = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.logView.dialogResult(id),
                (value) => value?.status === "resolved",
            );
            ctx.expect(result.entry.checked).toBe("Large");
            ctx.expect(result.entry.button).toBe("OK");
        } finally {
            await finishManagedLog(ctx, previousPageIds);
        }
    }),

    test("Log View select dialog records the chosen option", async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        let dialogId;
        try {
            const result = await pushDialog(ctx, {
                type: "input.select", title: "Choose format", items: ["JSON", "CSV"], buttons: ["Cancel", "Use"],
            });
            dialogId = result.dialogIds[0];
            await ctx.app.window.screen.click('[data-name="log-select"]');
            await ctx.app.window.screen.click("text=CSV");
            await clickLogControl(ctx, "log-button-Use");
            const answer = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.logView.dialogResult(dialogId),
                (value) => value?.status === "resolved",
            );
            ctx.expect(answer.entry.selected).toBe("CSV");
            ctx.expect(answer.entry.button).toBe("Use");
            ctx.expect(answer.id).toBe(dialogId);
        } finally {
            await finishManagedLog(ctx, previousPageIds);
        }
    }),

    test("Log View text input dialog records typed text", async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        try {
            const { dialogIds } = await pushDialog(ctx, {
                type: "input.text", title: "Enter a label", placeholder: "Label", buttons: ["Cancel", "Submit"],
            });
            await ctx.app.window.screen.type('[data-name="log-text-input"] input', "release note");
            await clickLogControl(ctx, "log-button-Submit");
            const answer = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.logView.dialogResult(dialogIds[0]),
                (value) => value?.status === "resolved",
            );
            ctx.expect(answer.id).toBe(dialogIds[0]);
            ctx.expect(answer.entry.text).toBe("release note");
            ctx.expect(answer.entry.button).toBe("Submit");
        } finally {
            await finishManagedLog(ctx, previousPageIds);
        }
    }),

    test("Log View checkbox dialog records checked items", async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        try {
            const { dialogIds } = await pushDialog(ctx, {
                type: "input.checkboxes", title: "Choose items", items: [{ label: "Keep" }, { label: "Remove" }], buttons: ["Cancel", "Apply"],
            });
            await ctx.app.window.screen.click('[data-name="log-checkbox-1"]');
            await clickLogControl(ctx, "log-button-Apply");
            const answer = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.logView.dialogResult(dialogIds[0]),
                (value) => value?.status === "resolved",
            );
            ctx.expect(answer.id).toBe(dialogIds[0]);
            ctx.expect(answer.entry.items).toEqual([{ label: "Keep" }, { label: "Remove", checked: true }]);
            ctx.expect(answer.entry.button).toBe("Apply");
        } finally {
            await finishManagedLog(ctx, previousPageIds);
        }
    }),

    test("Log View button dialog records the selected button", async (ctx) => {
        const previousPageIds = await pageIds(ctx);
        try {
            const { dialogIds } = await pushDialog(ctx, {
                type: "input.buttons", title: "Choose an action", buttons: ["Save", "Discard"],
            });
            await clickLogControl(ctx, "log-button-Discard");
            const answer = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.logView.dialogResult(dialogIds[0]),
                (value) => value?.status === "resolved",
            );
            ctx.expect(answer.id).toBe(dialogIds[0]);
            ctx.expect(answer.entry.button).toBe("Discard");
            ctx.expect(answer.entry.buttonLabel).toBe("Discard");
        } finally {
            await finishManagedLog(ctx, previousPageIds);
        }
    }),

];
