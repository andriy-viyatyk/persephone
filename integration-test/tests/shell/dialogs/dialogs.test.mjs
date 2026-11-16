import { test } from "../../../lib/context.mjs";
import { closeOrphanedUs2036Pages, closePendingDialog, closeShellPage, startDialogScript, waitForDialog } from "../../helpers/shell-helpers.mjs";

export default [
    test("confirmation dialogs return the chosen label and Escape cancels", async (ctx) => {
        const pageIds = [];
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            let pageId = await startDialogScript(ctx,
                'const answer = await app.ui.confirm("US-2036 confirmation", { title: "US-2036 Confirm", buttons: ["Proceed", "Cancel"] }); page.content = answer ?? "<cancelled>"; return page.content;',
                "us-2036-confirm.js");
            pageIds.push(pageId);
            ctx.expect(await ctx.callText("dialogs[0].title", undefined, { dialog: true })).toBe("US-2036 Confirm");
            ctx.expect(await ctx.callText("dialogs[0].message", undefined, { dialog: true })).toBe("US-2036 confirmation");
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Proceed", "Cancel"]);
            await ctx.call("dialogs[0].click", ["Proceed"], { dialog: true });
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(pageId)}].content`, (value) => value === "Proceed")).toBe("Proceed");

            pageId = await startDialogScript(ctx,
                'const answer = await app.ui.confirm("US-2036 escape", { title: "US-2036 Escape" }); page.content = answer ?? "<cancelled>"; return page.content;',
                "us-2036-confirm-cancel.js");
            pageIds.push(pageId);
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "US-2036 Escape", { timeout: 5000 });
            await ctx.call("window.screen.pressKey", ["Escape", { target: '[data-name="confirmation-dialog"]' }], { dialog: true });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.callText(`pages[${JSON.stringify(pageId)}].content`, undefined, { dialog: true }), (value) => value === "<cancelled>")).toBe("<cancelled>");
        } finally {
            await closePendingDialog(ctx);
            for (const ownedPageId of pageIds) await closeShellPage(ctx, ownedPageId);
        }
    }),

    test("input dialog returns edited text and Enter submits while Escape cancels", async (ctx) => {
        const pageIds = [];
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            let pageId = await startDialogScript(ctx,
                'const answer = await app.ui.input("US-2036 input", { title: "US-2036 Input", value: "seed-value" }); page.content = answer ? answer.button + ":" + answer.value : "<cancelled>"; return page.content;',
                "us-2036-input.js");
            pageIds.push(pageId);
            ctx.expect(await ctx.call("dialogs[0].value", undefined, { dialog: true })).toBe("seed-value");
            await ctx.call("window.screen.type", ['[data-name="input-dialog-input"] input', "changed-value"], { dialog: true });
            await ctx.call("window.screen.pressKey", ["Enter", { target: '[data-name="input-dialog-input"] input' }], { dialog: true });
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(pageId)}].content`, (value) => value === "OK:changed-value")).toBe("OK:changed-value");

            pageId = await startDialogScript(ctx,
                'const answer = await app.ui.input("US-2036 input cancel", { title: "US-2036 Input Cancel", value: "discard-me" }); page.content = answer ? answer.value : "<cancelled>"; return page.content;',
                "us-2036-input-cancel.js");
            pageIds.push(pageId);
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "US-2036 Input Cancel", { timeout: 5000 });
            await ctx.call("window.screen.pressKey", ["Escape", { target: '[data-name="input-dialog-input"] input' }], { dialog: true });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.callText(`pages[${JSON.stringify(pageId)}].content`, undefined, { dialog: true }), (value) => value === "<cancelled>")).toBe("<cancelled>");
        } finally {
            await closePendingDialog(ctx);
            for (const ownedPageId of pageIds) await closeShellPage(ctx, ownedPageId);
        }
    }),

    test("password dialogs return a supplied secret and cancellation returns null", async (ctx) => {
        const pageIds = [];
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            let pageId = await startDialogScript(ctx,
                'const password = await app.ui.password({ mode: "decrypt" }); page.content = password === "us-2036-secret" ? "received" : "missing"; return page.content;',
                "us-2036-password.js");
            pageIds.push(pageId);
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Decrypt", "Cancel"]);
            await ctx.call("window.screen.type", ['[data-name="password-dialog-password"] input', "us-2036-secret"], { dialog: true });
            await ctx.call("dialogs[0].click", ["Decrypt"], { dialog: true });
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(pageId)}].content`, (value) => value === "received")).toBe("received");

            pageId = await startDialogScript(ctx,
                'const password = await app.ui.password({ mode: "decrypt" }); page.content = password === null ? "<cancelled>" : "unexpected"; return page.content;',
                "us-2036-password-cancel.js");
            pageIds.push(pageId);
            await waitForDialog(ctx, "dialogs[0].buttons", (buttons) => buttons.includes("Decrypt"), { timeout: 5000 });
            await ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(pageId)}].content`, (value) => value === "<cancelled>")).toBe("<cancelled>");
        } finally {
            await closePendingDialog(ctx);
            for (const ownedPageId of pageIds) await closeShellPage(ctx, ownedPageId);
        }
    }),

    test("text dialogs return their content and Escape cancels", async (ctx) => {
        const pageIds = [];
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            let pageId = await startDialogScript(ctx,
                'const answer = await app.ui.textDialog({ title: "US-2036 Text", text: "first line\\nsecond line", buttons: ["Use text", "Cancel"] }); page.content = answer ? answer.button + ":" + answer.text : "<cancelled>"; return page.content;',
                "us-2036-text.js");
            pageIds.push(pageId);
            ctx.expect(await ctx.callText("dialogs[0].title", undefined, { dialog: true })).toBe("US-2036 Text");
            ctx.expect(await ctx.callText("dialogs[0].editorText", undefined, { dialog: true })).toBe("first line\nsecond line");
            await ctx.call("dialogs[0].click", ["Use text"], { dialog: true });
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(pageId)}].content`, (value) => value === "Use text:first line\nsecond line")).toBe("Use text:first line\nsecond line");

            pageId = await startDialogScript(ctx,
                'const answer = await app.ui.textDialog({ title: "US-2036 Text Cancel", text: "cancel me" }); page.content = answer ? answer.text : "<cancelled>"; return page.content;',
                "us-2036-text-cancel.js");
            pageIds.push(pageId);
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "US-2036 Text Cancel", { timeout: 5000 });
            await ctx.call("window.screen.pressKey", ["Escape", { target: '[data-name="text-dialog"]' }], { dialog: true });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.callText(`pages[${JSON.stringify(pageId)}].content`, undefined, { dialog: true }), (value) => value === "<cancelled>")).toBe("<cancelled>");
        } finally {
            await closePendingDialog(ctx);
            for (const ownedPageId of pageIds) await closeShellPage(ctx, ownedPageId);
        }
    }),

    test("a second simultaneous dialog moves to dialogs zero after the first closes", async (ctx) => {
        let pageId;
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            pageId = await startDialogScript(ctx,
                'const answers = await Promise.all([app.ui.confirm("US-2036 first", { title: "US-2036 First" }), app.ui.input("US-2036 second", { title: "US-2036 Second", value: "second-answer" })]); page.content = answers[0] + ":" + answers[1]?.value; return page.content;',
                "us-2036-queued.js");
            ctx.expect(await ctx.callText("dialogs[0].title", undefined, { dialog: true })).toBe("US-2036 First");
            ctx.expect(await ctx.callText("dialogs[1].title", undefined, { dialog: true })).toBe("US-2036 Second");
            await ctx.call("dialogs[0].click", ["Yes"], { dialog: true });
            ctx.expect(await waitForDialog(ctx, "dialogs[0].title", (title) => title === "US-2036 Second", { timeout: 5000 })).toBe("US-2036 Second");
            await ctx.call("dialogs[0].click", ["OK"], { dialog: true });
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(pageId)}].content`, (value) => value === "Yes:second-answer")).toBe("Yes:second-answer");
        } finally {
            await closePendingDialog(ctx);
            await closeShellPage(ctx, pageId);
        }
    }),
];
