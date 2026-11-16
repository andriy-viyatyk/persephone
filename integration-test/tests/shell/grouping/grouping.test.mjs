import { test } from "../../../lib/context.mjs";
import { closeOwnedPages, expectGroupedPair } from "../../helpers/shell-helpers.mjs";
import { close, open } from "../../helpers/pilot-helpers.mjs";

export default [
    test("grouped pages can be ungrouped and regrouped with their sides swapped", async (ctx) => {
        const ownedPageIds = [];
        try {
            const left = await open(ctx, "us-2034/group-swap/left.txt", "left side\n", "monaco");
            ownedPageIds.push(left.id);
            const right = await open(ctx, "us-2034/group-swap/right.txt", "right side\n", "monaco");
            ownedPageIds.push(right.id);

            ctx.expect(await ctx.call("pages.isGrouped", [left.id])).toBe(false);
            ctx.expect(await ctx.call("pages.isGrouped", [right.id])).toBe(false);

            await ctx.call("pages.group", [left.id, right.id]);
            await expectGroupedPair(ctx, left.id, right.id);

            await ctx.call("pages.ungroup", [right.id]);
            ctx.expect(await ctx.call("pages.isGrouped", [left.id])).toBe(false);
            ctx.expect(await ctx.call("pages.isGrouped", [right.id])).toBe(false);

            await ctx.call("pages.group", [right.id, left.id]);
            await expectGroupedPair(ctx, left.id, right.id);
            await ctx.call("pages.compare.enter", [right.id]);
            const swappedPair = await ctx.waitFor(
                "pages.compare.pairs",
                (pairs) => pairs.some((pair) => pair.leftPageId === right.id && pair.rightPageId === left.id),
            );
            ctx.expect(swappedPair.some((pair) => pair.leftPageId === right.id && pair.rightPageId === left.id)).toBe(true);
        } finally {
            await closeOwnedPages(ctx, ownedPageIds);
        }
    }),

    test("Ctrl-clicking a third page replaces the active page's grouped partner", async (ctx) => {
        const ownedPageIds = [];
        try {
            const first = await open(ctx, "us-2034/group-replacement/first.txt", "first page\n", "monaco");
            ownedPageIds.push(first.id);
            const active = await open(ctx, "us-2034/group-replacement/active.txt", "active page\n", "monaco");
            ownedPageIds.push(active.id);
            const replacement = await open(ctx, "us-2034/group-replacement/replacement.txt", "replacement page\n", "monaco");
            ownedPageIds.push(replacement.id);

            await ctx.call("pages.group", [first.id, active.id]);
            await ctx.call("pages.showPage", [active.id]);
            await expectGroupedPair(ctx, first.id, active.id);

            await ctx.call("window.screen.click", [
                `[data-page-id="${replacement.id}"]`,
                { modifiers: ["Control"] },
            ]);

            await ctx.waitFor(
                (activeContext) => activeContext.call("pages.getGroupedPage", [active.id]),
                (partner) => partner?.id === replacement.id,
            );
            await expectGroupedPair(ctx, active.id, replacement.id);
            ctx.expect(await ctx.call("pages.isGrouped", [first.id])).toBe(false);
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(first.id)}].content`)).toBe("first page\n");
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(active.id)}].content`)).toBe("active page\n");
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(replacement.id)}].content`)).toBe("replacement page\n");
        } finally {
            await closeOwnedPages(ctx, ownedPageIds);
        }
    }),

    test("compare mode opens and closes without changing either text page", async (ctx) => {
        const ownedPageIds = [];
        try {
            const left = await open(ctx, "us-2034/compare/left.txt", "before\nshared\n", "monaco");
            ownedPageIds.push(left.id);
            const right = await open(ctx, "us-2034/compare/right.txt", "after\nshared\n", "monaco");
            ownedPageIds.push(right.id);

            await ctx.call("pages.group", [left.id, right.id]);
            await ctx.call("pages.compare.enter", [left.id]);
            const pairs = await ctx.waitFor("pages.compare.pairs", (currentPairs) => currentPairs.length === 1);
            ctx.expect(pairs[0].leftPageId).toBe(left.id);
            ctx.expect(pairs[0].rightPageId).toBe(right.id);

            const compareElements = await ctx.waitFor(
                "pages.compare.elements",
                (elements) => elements.some((element) => element.name === "compare-root" && element.visible),
            );
            ctx.expect(compareElements.find((element) => element.name === "compare-root").visible).toBe(true);

            await ctx.call("pages.compare.exit", [right.id]);
            await ctx.waitFor("pages.compare.pairs", (currentPairs) => currentPairs.length === 0);
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(left.id)}].content`)).toBe("before\nshared\n");
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(right.id)}].content`)).toBe("after\nshared\n");
            await expectGroupedPair(ctx, left.id, right.id);
        } finally {
            await closeOwnedPages(ctx, ownedPageIds);
        }
    }),

    test("closing one grouped page leaves its partner open, ungrouped, and readable", async (ctx) => {
        const ownedPageIds = [];
        try {
            const closing = await open(ctx, "us-2034/close-group/closing.txt", "closing page\n", "monaco");
            ownedPageIds.push(closing.id);
            const surviving = await open(ctx, "us-2034/close-group/surviving.txt", "surviving page\n", "monaco");
            ownedPageIds.push(surviving.id);

            await ctx.call("pages.group", [closing.id, surviving.id]);
            await expectGroupedPair(ctx, closing.id, surviving.id);
            await close(ctx, closing.id);
            ownedPageIds.splice(ownedPageIds.indexOf(closing.id), 1);

            ctx.expect(await ctx.call("pages.findPage", [closing.id])).toBe(null);
            ctx.expect(await ctx.call("pages.findPage", [surviving.id])).toBeTruthy();
            ctx.expect(await ctx.call("pages.isGrouped", [surviving.id])).toBe(false);
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(surviving.id)}].content`)).toBe("surviving page\n");
        } finally {
            await closeOwnedPages(ctx, ownedPageIds);
        }
    }),
];
