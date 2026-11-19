import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

async function waitForDom(ctx, editor, expression, predicate) {
    return ctx.waitFor(async () => {
        try {
            return await editor.evaluate(expression);
        } catch {
            return null;
        }
    }, predicate);
}

export default [
    test("opens the board and preflights the live root tree", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "aivision-explorer");
            const editor = ctx.app.pages[handle.id].editor;
            const root = await ctx.call("$describe");
            ctx.expect(root.kind).toBe("Persephone");
            for (const name of ["pages", "boards", "helpSearch", "events"]) {
                ctx.expect(root.members.some((member) => member.name === name)).toBe(true);
            }

            await editor.snapshot();
            const state = await editor.evaluate(`() => ({
                bootHidden: document.querySelector('#boot').hidden,
                shellHidden: document.querySelector('#app-shell').hidden,
                paths: [...document.querySelectorAll('#tree button[data-path]')].map(row => row.dataset.path),
                green: [...document.querySelectorAll('#tree button[data-path]')]
                    .filter(row => ['helpSearch', 'events'].includes(row.dataset.path)
                        && row.querySelector('.tree-kind.special')).length
            })`);
            ctx.expect(state.bootHidden).toBe(true);
            ctx.expect(state.shellHidden).toBe(false);
            for (const name of ["pages", "boards", "helpSearch", "events"]) {
                ctx.expect(state.paths.includes(name)).toBe(true);
            }
            ctx.expect(state.green).toBe(2);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("expands a node, reads a leaf, and renders help without a hint", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "aivision-explorer");
            const editor = ctx.app.pages[handle.id].editor;
            const pagesDescription = await ctx.call("pages.$describe");
            await editor.click('button[data-path="pages"]');
            const expectedPaths = ["$help"];
            for (const child of pagesDescription.children ?? []) expectedPaths.push(child.path);
            for (const member of pagesDescription.members ?? []) {
                expectedPaths.push(/^[A-Za-z_$][\w$]*$/.test(member.name)
                    ? `pages.${member.name}`
                    : `pages[${JSON.stringify(member.name)}]`);
            }
            const visiblePaths = await waitForDom(
                ctx,
                editor,
                "() => [...document.querySelectorAll('#tree button[data-path]')].map(row => row.dataset.path)",
                (paths) => expectedPaths.every((path) => paths?.includes(path)),
            );
            ctx.expect(visiblePaths.includes("$help")).toBe(true);
            for (const child of pagesDescription.children ?? []) {
                ctx.expect(visiblePaths.includes(child.path)).toBe(true);
            }
            for (const member of pagesDescription.members ?? []) {
                const memberPath = /^[A-Za-z_$][\w$]*$/.test(member.name)
                    ? `pages.${member.name}`
                    : `pages[${JSON.stringify(member.name)}]`;
                ctx.expect(visiblePaths.includes(memberPath)).toBe(true);
            }

            const expectedVersion = await ctx.callText("version");
            await editor.click('button[data-path="version"]');
            const leaf = await waitForDom(ctx, editor, `() => ({
                path: document.querySelector('#selected-path').textContent,
                value: document.querySelector('#returned-value').textContent,
                hintHidden: document.querySelector('#hint-panel').hidden,
                hint: document.querySelector('#agent-hint').textContent
            })`, (state) => state?.path.includes("version") && state.value === expectedVersion);
            ctx.expect(leaf.value).toBe(expectedVersion);
            ctx.expect(leaf.hintHidden).toBe(false);
            ctx.expect(leaf.hint).toBe("No descriptor — this path resolves to a value, so the agent is given the value alone.");

            const expectedHelp = await ctx.callText("$help");
            await editor.click('button[data-path="$help"]');
            const help = await waitForDom(ctx, editor, `() => ({
                path: document.querySelector('#selected-path').textContent,
                value: document.querySelector('#returned-value').textContent,
                hintHidden: document.querySelector('#hint-panel').hidden
            })`, (state) => state?.path.includes("$help")
                && state.value === expectedHelp && state.hintHidden);
            ctx.expect(help.value).toBe(expectedHelp);
            ctx.expect(help.hintHidden).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("Members count matches describe and Read stays in a result dialog", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "aivision-explorer");
            const editor = ctx.app.pages[handle.id].editor;
            const description = await ctx.call("$describe");
            const agentValueBefore = await editor.evaluate(
                "() => ({ text: document.querySelector('#returned-value').textContent })",
            );
            await editor.click("#tab-btn-members");
            const memberCount = await waitForDom(
                ctx,
                editor,
                "() => ({ text: document.querySelector('#member-count').textContent, selected: document.querySelector('#tab-btn-members').getAttribute('aria-selected') })",
                (state) => state?.selected === "true" && state.text.includes(String(description.members.length)),
            );
            ctx.expect(memberCount.text).toContain(String(description.members.length));

            const versionIndex = await editor.evaluate(`() => [...document.querySelectorAll('#members .member-card')]
                .findIndex(card => card.querySelector('.member-name')?.textContent.trim() === 'version')`);
            ctx.expect(versionIndex >= 0).toBe(true);
            await editor.click(
                `#members .member-card:nth-child(${versionIndex + 1}) .member-actions button`,
            );
            const resultText = await waitForDom(
                ctx,
                editor,
                "() => ({ text: document.querySelector('#dialog-mount .result-box pre.result-code')?.textContent })",
                (state) => state?.text !== undefined,
            );
            ctx.expect(resultText.text).toBe(await ctx.callText("version"));
            const agentValueAfter = await editor.evaluate(
                "() => ({ text: document.querySelector('#returned-value').textContent })",
            );
            ctx.expect(agentValueAfter.text).toBe(agentValueBefore.text);
            await editor.click("#dialog-mount .result-box .confirm-actions button:last-child");
            await waitForDom(ctx, editor, "() => Boolean(document.querySelector('#dialog-mount .result-box'))", (open) => open === false);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("help search selects a method result without invoking it", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "aivision-explorer");
            const editor = ctx.app.pages[handle.id].editor;
            const hits = await ctx.call("helpSearch", ["empty text page", 20]);
            ctx.expect(hits.some((hit) => hit.path === "pages.addEmptyPage()")).toBe(true);
            const pagesBefore = await ctx.call("pages.all");
            await editor.click('button[data-path="helpSearch"]');
            await waitForDom(ctx, editor, "() => ({ hidden: document.querySelector('#tab-btn-search').hidden })", (state) => state?.hidden === false);
            await editor.type("#search-query", "empty text page");
            await waitForDom(ctx, editor, "() => ({ value: document.querySelector('#search-query').value })", (state) => state?.value === "empty text page");
            await editor.click('#search-form button[type="submit"]');
            await waitForDom(
                ctx,
                editor,
                "() => Boolean(document.querySelector('button.search-result[data-path=\"pages.addEmptyPage\"]'))",
                Boolean,
            );
            await editor.click('button.search-result[data-path="pages.addEmptyPage"]');
            const selectedPath = await waitForDom(
                ctx,
                editor,
                "() => ({ text: document.querySelector('#selected-path').textContent })",
                (state) => state?.text.includes("pages.addEmptyPage"),
            );
            ctx.expect(selectedPath.text).toContain("pages.addEmptyPage");
            const valueAfter = await editor.evaluate(
                "() => ({ text: document.querySelector('#returned-value').textContent })",
            );
            // A selected search hit is never read or invoked: the Agent tab says so (app.js renderResultForSelection).
            ctx.expect(valueAfter.text).toBe("Not read yet.");
            const pagesAfter = await ctx.call("pages.all");
            ctx.expect(pagesAfter.length).toBe(pagesBefore.length);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("Events shows a remote-notify event from the board frame", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "aivision-explorer");
            const editor = ctx.app.pages[handle.id].editor;
            await editor.click('button[data-path="events"]');
            await waitForDom(
                ctx,
                editor,
                "() => ({ tabHidden: document.querySelector('#tab-btn-events').hidden, rendered: Boolean(document.querySelector('#events .event-item, #events .empty-state')) })",
                (state) => state?.tabHidden === false && state.rendered,
            );
            await editor.click("#tab-btn-events");
            await waitForDom(
                ctx,
                editor,
                "() => ({ selected: document.querySelector('#tab-btn-events').getAttribute('aria-selected'), rendered: Boolean(document.querySelector('#events .event-item, #events .empty-state')) })",
                (state) => state?.selected === "true" && state.rendered,
            );
            const before = await ctx.call("events.recent", [50]);
            const beforeSeq = Math.max(0, ...before.map((event) => event.seq ?? 0));

            await editor.evaluate("() => { const remote = window.persephone.aiVision.expose({ aiVision: { kind: 'Us2108Probe', summary: 'Test probe that raises one notify event.', members: [] } }); remote.notify('US-2108 synthetic event'); return true; }");
            const recent = await ctx.waitFor(
                () => ctx.call("events.recent", [50]),
                (events) => events.some((event) => event.kind === "remote-notify"
                    && event.seq > beforeSeq && event.text?.includes("US-2108 synthetic event")),
            );
            const expectedEvent = recent.find((event) => event.kind === "remote-notify"
                && event.seq > beforeSeq && event.text?.includes("US-2108 synthetic event"));
            ctx.expect(expectedEvent).toBeTruthy();
            const expectedSequenceText = `#${expectedEvent.seq}`;
            const rows = await waitForDom(
                ctx,
                editor,
                `() => [...document.querySelectorAll('#events .event-item')].map(item => ({
                    kind: item.querySelector('.event-type')?.textContent,
                    seq: item.querySelector('.event-seq')?.textContent,
                    text: item.querySelector('.event-data')?.textContent
                }))`,
                (items) => items.some((item) => item.kind === "remote-notify"
                    && item.seq === expectedSequenceText && item.text?.includes("US-2108 synthetic event")),
            );
            ctx.expect(rows.some((item) => item.kind === "remote-notify"
                && item.seq === expectedSequenceText && item.text?.includes("US-2108 synthetic event"))).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("invokes harmless events.recent and shows the returned events", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "aivision-explorer");
            const editor = ctx.app.pages[handle.id].editor;
            await editor.click('button[data-path="events"]');
            await waitForDom(
                ctx,
                editor,
                "() => [...document.querySelectorAll('#tree button[data-path]')].map(row => row.dataset.path)",
                (paths) => paths?.includes("events.recent"),
            );
            await editor.click('button[data-path="events.recent"]');
            await waitForDom(
                ctx,
                editor,
                "() => ({ path: document.querySelector('#selected-path').textContent, input: document.querySelector('#member-ops input')?.value })",
                (state) => state?.path.includes("events.recent") && state.input !== undefined,
            );
            await editor.type("#member-ops input", "[5]");
            await waitForDom(ctx, editor, "() => ({ value: document.querySelector('#member-ops input').value })", (state) => state?.value === "[5]");
            await editor.click("#member-ops button");

            const returned = await waitForDom(
                ctx,
                editor,
                "() => ({ text: document.querySelector('#returned-value').textContent })",
                (state) => {
                    if (!state?.text || state.text === "No value read yet.") return false;
                    try {
                        const value = JSON.parse(state.text);
                        return Array.isArray(value) && value.every((event) => typeof event.seq === "number");
                    } catch {
                        return false;
                    }
                },
            );
            const displayed = JSON.parse(returned.text);
            ctx.expect(Array.isArray(displayed)).toBe(true);
            ctx.expect(displayed.length <= 5).toBe(true);
            ctx.expect(displayed.every((event) => typeof event.seq === "number" && typeof event.kind === "string")).toBe(true);
            ctx.expect(displayed.every((event, index) => index === 0 || displayed[index - 1].seq >= event.seq)).toBe(true);
            const recent = await ctx.call("events.recent", [50]);
            const recentSeqs = recent.map((event) => event.seq);
            ctx.expect(displayed.every((event) => recentSeqs.includes(event.seq))).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("caution on grouped-page Read can be cancelled without creating a page", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "aivision-explorer");
            const editor = ctx.app.pages[handle.id].editor;
            const pagesBefore = await ctx.call("pages.all");
            const pagesDescription = await ctx.call("pages.$describe");
            const pageChild = pagesDescription.children?.find((child) => child.summary?.includes(`id=${handle.id}`));
            ctx.expect(Boolean(pageChild)).toBe(true);
            const pagePath = pageChild.path;

            await editor.click('button[data-path="pages"]');
            await waitForDom(
                ctx,
                editor,
                "() => [...document.querySelectorAll('#tree button[data-path]')].map(row => row.dataset.path)",
                (paths) => paths?.includes(pagePath),
            );
            await editor.click(`button[data-path=${JSON.stringify(pagePath)}]`);
            const groupedPath = `${pagePath}.grouped`;
            await waitForDom(
                ctx,
                editor,
                "() => [...document.querySelectorAll('#tree button[data-path]')].map(row => row.dataset.path)",
                (paths) => paths?.includes(groupedPath),
            );
            await editor.click(`button[data-path=${JSON.stringify(`${pagePath}.grouped`)}]`);
            const selectedGrouped = await waitForDom(
                ctx,
                editor,
                "() => ({ path: document.querySelector('#selected-path').textContent, readHidden: document.querySelector('#read-selected').hidden })",
                (state) => state?.path.includes(groupedPath) && state.readHidden === false,
            );
            ctx.expect(selectedGrouped.path).toContain(groupedPath);
            const caution = await editor.evaluate(
                `() => [...document.querySelectorAll('button[data-path]')]
                    .find(row => row.dataset.path === ${JSON.stringify(groupedPath)})?.dataset.caution
                    ? { text: [...document.querySelectorAll('button[data-path]')]
                        .find(row => row.dataset.path === ${JSON.stringify(groupedPath)}).dataset.caution }
                    : null`,
            );
            ctx.expect(caution.text).toContain("CREATES");
            await editor.click("#read-selected");
            await waitForDom(
                ctx,
                editor,
                "() => Boolean(document.querySelector('#dialog-mount .confirm-box'))",
                Boolean,
            );
            await editor.click("#dialog-mount .confirm-box .confirm-actions button:first-child");

            const status = await waitForDom(
                ctx,
                editor,
                "() => ({ text: document.querySelector('#operation-status').textContent, dialogOpen: Boolean(document.querySelector('#dialog-mount .confirm-box')) })",
                (state) => state?.text.toLowerCase().includes("cancel") && !state.dialogOpen,
            );
            ctx.expect(status.text.toLowerCase()).toContain("cancel");
            const pagesAfter = await ctx.call("pages.all");
            ctx.expect(pagesAfter.length).toBe(pagesBefore.length);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
