import path from "node:path";
import { test } from "../../../lib/context.mjs";
import {
    clickTabMenuItem,
    closeOwnedPages,
    closeTabMenu,
    openTabMenu,
    openTextPage,
    pagePath,
    readTabOrder,
    replacePageContent,
} from "../../helpers/shell-helpers.mjs";

const folder = "us-2033-tabs";

export default [
    test("opening, closing, and showing pages keeps the active tab on a neighbor", async (ctx) => {
        const owned = new Set();
        try {
            const first = await openTextPage(ctx, `${folder}/active`, "first.txt", "first page\n");
            owned.add(first.id);
            const second = await openTextPage(ctx, `${folder}/active`, "second.txt", "second page\n");
            owned.add(second.id);
            const third = await openTextPage(ctx, `${folder}/active`, "third.txt", "third page\n");
            owned.add(third.id);

            const pages = await ctx.app.pages.all;
            ctx.expect(pages.some((page) => page.id === first.id)).toBe(true);
            ctx.expect(pages.some((page) => page.id === second.id)).toBe(true);
            ctx.expect(pages.some((page) => page.id === third.id)).toBe(true);
            ctx.expect((await readTabOrder(ctx)).includes(second.id)).toBe(true);

            await ctx.app.pages.showPage(second.id);
            ctx.expect(await ctx.app.pages.activePage.id).toBe(second.id);
            const beforeClose = await ctx.app.pages.all;
            const index = beforeClose.findIndex((page) => page.id === second.id);
            const neighbors = new Set([beforeClose[index - 1]?.id, beforeClose[index + 1]?.id].filter(Boolean));
            await ctx.app.pages.closePage(second.id);
            owned.delete(second.id);
            const active = await ctx.waitFor((activeContext) => activeContext.app.pages.activePage.id, (id) => neighbors.has(id));
            ctx.expect(neighbors.has(active)).toBe(true);
            ctx.expect((await ctx.app.pages.all).some((page) => page.id === second.id)).toBe(false);
        } finally {
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("tab menu closes tabs to the right and closes other unpinned tabs", async (ctx) => {
        const owned = new Set();
        try {
            const anchor = await openTextPage(ctx, `${folder}/close-menu`, "anchor.txt", "preserved anchor\n");
            owned.add(anchor.id);
            const rightOne = await openTextPage(ctx, `${folder}/close-menu`, "right-one.txt", "right one\n");
            owned.add(rightOne.id);
            const rightTwo = await openTextPage(ctx, `${folder}/close-menu`, "right-two.txt", "right two\n");
            owned.add(rightTwo.id);
            const left = await openTextPage(ctx, `${folder}/close-menu`, "left.txt", "left\n");
            owned.add(left.id);

            let order = await ctx.app.pages.all;
            const desired = [anchor.id, rightOne.id, rightTwo.id, left.id];
            for (const pageId of [...desired].reverse()) {
                order = await ctx.app.pages.all;
                if (order[0].id !== pageId) await ctx.app.pages.moveTab(pageId, order[0].id);
            }
            order = await ctx.app.pages.all;
            ctx.expect(order.slice(0, desired.length).map((page) => page.id)).toEqual(desired);

            await openTabMenu(ctx, rightOne.id, "page-tab-close-to-right");
            await clickTabMenuItem(ctx, "page-tab-close-to-right");
            await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => !pages.some((page) => page.id === rightTwo.id || page.id === left.id));
            owned.delete(rightTwo.id);
            owned.delete(left.id);
            ctx.expect((await ctx.app.pages.all).some((page) => page.id === rightOne.id)).toBe(true);

            await openTabMenu(ctx, anchor.id, "page-tab-close-other");
            await clickTabMenuItem(ctx, "page-tab-close-other");
            const remaining = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.length === 1 && pages[0].id === anchor.id);
            ctx.expect(remaining[0].id).toBe(anchor.id);
            owned.delete(rightOne.id);
        } finally {
            await closeTabMenu(ctx);
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("moving a tab updates pages.all and the rendered tab strip order", async (ctx) => {
        const owned = new Set();
        try {
            const first = await openTextPage(ctx, `${folder}/order`, "order-first.txt", "one\n");
            owned.add(first.id);
            const second = await openTextPage(ctx, `${folder}/order`, "order-second.txt", "two\n");
            owned.add(second.id);
            const third = await openTextPage(ctx, `${folder}/order`, "order-third.txt", "three\n");
            owned.add(third.id);

            let before = await ctx.app.pages.all;
            const expected = before.map((page) => page.id);
            const fromIndex = expected.indexOf(first.id);
            const toIndex = expected.indexOf(third.id);
            expected.splice(toIndex, 0, expected.splice(fromIndex, 1)[0]);
            await ctx.app.pages.moveTab(first.id, third.id);

            const modelOrder = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.map((page) => page.id).join(",") === expected.join(","));
            ctx.expect(modelOrder.map((page) => page.id)).toEqual(expected);
            ctx.expect(await ctx.waitFor(readTabOrder, (ids) => ids.join(",") === expected.filter((id) => modelOrder.find((page) => page.id === id)?.pinSide !== "right").join(","))).toEqual(expected.filter((id) => modelOrder.find((page) => page.id === id)?.pinSide !== "right"));
        } finally {
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("left and right pins stay in their strips and the right page opens in a popover", async (ctx) => {
        const owned = new Set();
        const originalPins = new Map((await ctx.app.pages.all).map((page) => [page.id, page.pinSide]));
        try {
            const left = await openTextPage(ctx, `${folder}/pins`, "left-pin.txt", "left pinned\n");
            owned.add(left.id);
            const right = await openTextPage(ctx, `${folder}/pins`, "right-pin.txt", "right pinned\n");
            owned.add(right.id);

            await openTabMenu(ctx, left.id, "page-tab-pin-to-left");
            await clickTabMenuItem(ctx, "page-tab-pin-to-left");
            await openTabMenu(ctx, right.id, "page-tab-pin-to-right");
            await clickTabMenuItem(ctx, "page-tab-pin-to-right");
            ctx.expect(await ctx.app.pages[left.id].pinSide).toBe("left");
            ctx.expect(await ctx.app.pages[right.id].pinSide).toBe("right");
            const strips = await ctx.app.window.screen.evaluate('() => ({ left: Array.from(document.querySelectorAll("[data-name=page-tabs-wrapper] [data-name=page-tab][data-pinned]" )).map(tab => tab.dataset.pageId), right: Array.from(document.querySelectorAll("[data-name=right-page-tabs] [data-name=page-tab]")).map(tab => tab.dataset.pageId) })');
            ctx.expect(strips.left.includes(left.id)).toBe(true);
            ctx.expect(strips.right.includes(right.id)).toBe(true);

            await openTabMenu(ctx, left.id, "page-tab-unpin");
            await clickTabMenuItem(ctx, "page-tab-unpin");
            ctx.expect(await ctx.app.pages[left.id].pinSide).toBe(null);
            await openTabMenu(ctx, left.id, "page-tab-pin-to-left");
            await clickTabMenuItem(ctx, "page-tab-pin-to-left");
            ctx.expect(await ctx.app.pages[left.id].pinSide).toBe("left");

            await openTabMenu(ctx, right.id, "page-tab-unpin");
            await clickTabMenuItem(ctx, "page-tab-unpin");
            ctx.expect(await ctx.app.pages[right.id].pinSide).toBe(null);
            await openTabMenu(ctx, right.id, "page-tab-pin-to-right");
            await clickTabMenuItem(ctx, "page-tab-pin-to-right");
            ctx.expect(await ctx.app.pages[right.id].pinSide).toBe("right");

            const activeBeforePopover = await ctx.app.pages.activePage.id;
            const rightSelector = `[data-page-id=${JSON.stringify(right.id)}][data-name="page-tab"]`;
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.click", [rightSelector], { dialog: true });
            ctx.expect(await ctx.app.pages.activePage.id).toBe(activeBeforePopover);
            const openPopover = await ctx.waitFor((activeContext) => activeContext.app.pages.popoverPage, (page) => page?.id === right.id);
            ctx.expect(openPopover.id).toBe(right.id);
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Escape"], { dialog: true });
            await ctx.waitFor((activeContext) => activeContext.app.pages.popoverPage, (page) => page == null);

        } finally {
            await closeTabMenu(ctx);
            const all = await ctx.app.pages.all;
            if (await ctx.app.pages.popoverPage) await ctx.app.pages.closePopover();
            for (const page of all) {
                if (owned.has(page.id)) {
                    if (page.pinSide) await ctx.app.pages.unpinTab(page.id);
                } else if (page.pinSide !== originalPins.get(page.id) && (page.pinSide || originalPins.get(page.id))) {
                    if (page.pinSide) await ctx.app.pages.unpinTab(page.id);
                    if (originalPins.get(page.id)) await ctx.app.pages.pinTab(page.id, originalPins.get(page.id));
                }
            }
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("duplicating a page keeps its editor and content with a fresh id", async (ctx) => {
        const owned = new Set();
        const initialIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        try {
            const original = await openTextPage(ctx, `${folder}/duplicate`, "duplicate.txt", "duplicate me\n");
            owned.add(original.id);
            await openTabMenu(ctx, original.id, "page-tab-duplicate");
            await clickTabMenuItem(ctx, "page-tab-duplicate");

            const pages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (current) => current.some((page) => page.id !== original.id && !initialIds.has(page.id)),
            );
            const duplicate = pages.find((page) => page.id !== original.id && !initialIds.has(page.id));
            ctx.expect(Boolean(duplicate)).toBe(true);
            owned.add(duplicate.id);
            ctx.expect(duplicate.id === original.id).toBe(false);
            ctx.expect({
                title: duplicate.title,
                editor: duplicate.editor,
                content: await ctx.callText(pagePath(duplicate.id, "content")),
            }).toEqual({ title: "duplicate.txt", editor: "monaco", content: "duplicate me\n" });
            ctx.expect(await ctx.app.pages.getGroupedPage(original.id).then((page) => page?.id)).toBe(duplicate.id);
        } finally {
            await closeTabMenu(ctx);
            for (const page of await ctx.app.pages.all) {
                if (!initialIds.has(page.id)) owned.add(page.id);
            }
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("renaming from the tab dialog changes the file and page title", async (ctx) => {
        const owned = new Set();
        const oldName = "before-rename.txt";
        const newName = "after-rename.txt";
        try {
            const page = await openTextPage(ctx, `${folder}/rename`, oldName, "rename this file\n");
            owned.add(page.id);
            const newPath = path.join(path.dirname(page.filePath), newName);
            if (await ctx.app.fs.exists(newPath)) await ctx.app.fs.delete(newPath);
            await openTabMenu(ctx, page.id, "rename");
            await clickTabMenuItem(ctx, "rename");
            await ctx.waitFor((activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }), (title) => title === "Rename File");
            ctx.expect(await ctx.callText("dialogs[0].value", undefined, { dialog: true })).toBe(oldName);
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.type", ['[data-name="input-dialog-input"] input', newName], { dialog: true });
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("dialogs[0].click", ["Rename"], { dialog: true });

            await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.some((candidate) => candidate.id === page.id && candidate.title === newName));
            ctx.expect(await ctx.app.fs.exists(page.filePath)).toBe(false);
            ctx.expect(await ctx.app.fs.exists(newPath)).toBe(true);
            ctx.expect(await ctx.callText("fs.read", [newPath])).toBe("rename this file\n");
        } finally {
            await closeTabMenu(ctx);
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("editing marks the tab modified and saving clears the marker", async (ctx) => {
        const owned = new Set();
        try {
            const page = await openTextPage(ctx, `${folder}/dirty`, "dirty.txt", "original\n");
            owned.add(page.id);
            ctx.expect(await ctx.app.pages[page.id].modified).toBe(false);

            await replacePageContent(ctx, page.id, "edited\n");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified)).toBe(true);
            ctx.expect(await ctx.app.pages[page.id].tab.modified).toBe(true);
            await ctx.app.pages[page.id].editor.saveFile();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false)).toBe(false);
            ctx.expect(await ctx.callText("fs.read", [page.filePath])).toBe("edited\n");
        } finally {
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("modified pages honor Save, Don't Save, and Cancel when closing", async (ctx) => {
        const owned = new Set();
        const files = [];
        try {
            for (const [name, content] of [["save.txt", "saved original\n"], ["discard.txt", "discard original\n"], ["cancel.txt", "cancel original\n"]]) {
                const page = await openTextPage(ctx, `${folder}/close-prompt`, name, content);
                owned.add(page.id);
                files.push({ ...page, original: content, changed: `${name} changed\n` });
                await replacePageContent(ctx, page.id, `${name} changed\n`);
                await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified);
            }

            const [savePage, discardPage, cancelPage] = files;
            ctx.expect(await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("pages.closePage", [savePage.id], { dialog: true })).toEqual({ pending: true });
            await ctx.waitFor((activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }), (title) => title === "Unsaved Changes");
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("dialogs[0].click", ["Save"], { dialog: true });
            await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => !pages.some((page) => page.id === savePage.id));
            owned.delete(savePage.id);
            ctx.expect(await ctx.callText("fs.read", [savePage.filePath])).toBe(savePage.changed);

            ctx.expect(await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("pages.closePage", [discardPage.id], { dialog: true })).toEqual({ pending: true });
            await ctx.waitFor((activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }), (title) => title === "Unsaved Changes");
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("dialogs[0].click", ["Don't Save"], { dialog: true });
            await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => !pages.some((page) => page.id === discardPage.id));
            owned.delete(discardPage.id);
            ctx.expect(await ctx.callText("fs.read", [discardPage.filePath])).toBe(discardPage.original);

            ctx.expect(await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("pages.closePage", [cancelPage.id], { dialog: true })).toEqual({ pending: true });
            await ctx.waitFor((activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }), (title) => title === "Unsaved Changes");
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[cancelPage.id].modified, (modified) => modified)).toBe(true);
            ctx.expect((await ctx.app.pages.all).some((page) => page.id === cancelPage.id)).toBe(true);
        } finally {
            await closeTabMenu(ctx);
            await closeOwnedPages(ctx, owned);
        }
    }),

    test("right tab strip and editor categories popover list their entries", async (ctx) => {
        const owned = new Set();
        try {
            const right = await openTextPage(ctx, `${folder}/popovers`, "popover-right.txt", "right entry\n");
            owned.add(right.id);
            await ctx.app.pages.pinTab(right.id, "right");
            const readRightStrip = () => ctx.app.window.screen.evaluate('() => Array.from(document.querySelectorAll("[data-name=right-page-tabs] [data-name=page-tab]")).map(tab => tab.dataset.pageId)');
            const stripEntries = await ctx.waitFor(readRightStrip, (entries) => entries.includes(right.id));
            ctx.expect(stripEntries.includes(right.id)).toBe(true);
            const tab = (await ctx.app.pages.all).find((page) => page.id === right.id);
            ctx.expect(stripEntries.includes(tab.id)).toBe(true);

            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.click", ['[data-name="page-tabs-add"] [data-name="split-caret"]'], { dialog: true });
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => Boolean(document.querySelector("[data-name=editor-categories-popover]"))'),
                Boolean,
            );
            const listing = await ctx.app.window.screen.evaluate('() => ({ columns: Array.from(document.querySelectorAll("[data-name=editor-categories-popover] [data-name=editor-category-header]")).map(item => item.textContent.trim()), rows: Array.from(document.querySelectorAll("[data-name=editor-categories-popover] [data-name=editor-category-popover-item]")).map(item => item.textContent.trim()) })');
            ctx.expect(listing.columns.length > 0).toBe(true);
            ctx.expect(listing.rows.length > 0).toBe(true);
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Escape"], { dialog: true });
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => Boolean(document.querySelector("[data-name=editor-categories-popover]"))'),
                (open) => open === false,
            );
        } finally {
            const popoverOpen = await ctx.app.window.screen.evaluate('() => Boolean(document.querySelector("[data-name=editor-categories-popover]"))');
            if (popoverOpen) await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Escape"], { dialog: true });
            await closeOwnedPages(ctx, owned);
        }
    }),
];
