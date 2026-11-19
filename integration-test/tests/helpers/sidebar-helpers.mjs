import { closeOwnedPages } from "./shell-helpers.mjs";

export async function clickSidebarText(ctx, label) {
    await ctx.app.window.screen.click(`text=${JSON.stringify(label)}`);
}

export async function clickSidebarRow(ctx, selector, label) {
    const index = await ctx.app.window.screen.evaluate(
        `() => Array.from(document.querySelectorAll(${JSON.stringify(selector)})).findIndex((row) => row.innerText.includes(${JSON.stringify(label)}))`,
    );
    if (index < 0) throw new Error(`Could not find sidebar row ${JSON.stringify(label)} in ${selector}.`);
    await ctx.app.window.screen.click(selector, { nth: index });
}

export async function openExplorerFixture(ctx, folder, files) {
    const folderPath = ctx.fixture(folder);
    await ctx.app.fs.removeDir(folderPath, true);
    await ctx.app.fs.mkdir(folderPath);
    for (const [relativePath, content] of Object.entries(files)) {
        await ctx.app.fs.write(ctx.fixture(`${folder}/${relativePath}`), content);
    }
    const page = await ctx.app.pages.openFile(folderPath);
    const pageRoot = ctx.handle(ctx.app.pages[page.id]);
    await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].panels.explorer, Boolean);
    const expectedTitles = [...new Set(Object.keys(files).map((relativePath) => relativePath.split(/[\\/]/, 1)[0]))];
    await explorerItems(ctx, page.id, expectedTitles);
    return { pageId: page.id, pageRoot, folderPath };
}

export async function closeExplorerFixture(ctx, fixture) {
    await closePages(ctx, [fixture?.pageId]);
}

export async function explorerItems(ctx, pageId, expectedTitles = []) {
    return ctx.waitFor(
        (activeContext) => activeContext.app.pages[pageId].panels.explorer.listItems(),
        (items) => Array.isArray(items) && expectedTitles.every((title) => items.some((item) => item.title === title)),
    );
}

export async function waitForExplorerEntry(ctx, pageId, title, present = true) {
    return ctx.waitFor(
        (activeContext) => explorerItems(activeContext, pageId),
        (items) => items.some((item) => item.title === title) === present,
    );
}

export async function selectedExplorerRows(ctx) {
    return ctx.app.window.screen.evaluate(
        '() => Array.from(document.querySelectorAll(\'[data-type="tree-provider-view"] [role="treeitem"][aria-selected="true"]\')).map((row) => row.innerText.trim())',
    );
}

export async function explorerRowRefs(ctx, names) {
    return ctx.waitFor(
        async (activeContext) => {
            const snapshot = await activeContext.callText("window.screen.snapshot", [{ interactive: true, root: '[data-type="tree-provider-view"]' }]);
            const refs = {};
            for (const name of names) {
                const expectedFolderRow = `treeitem ${JSON.stringify(`Expand 📁 ${name}`)}`;
                const expectedRow = `treeitem ${JSON.stringify(name)}`;
                const row = snapshot.split("\n").find((line) => line.includes(expectedRow));
                const ref = row?.match(/\bref=(e\d+)\b/)?.[1] ?? row?.match(/\b(e\d+)\s+treeitem\b/)?.[1];
                if (ref) refs[name] = ref;
            }
            return refs;
        },
        (refs) => names.every((name) => Boolean(refs[name])),
    );
}

export async function explorerRowRef(ctx, name) {
    return (await explorerRowRefs(ctx, [name]))[name];
}

export async function openTreeContextMenu(ctx, name) {
    const ref = await explorerRowRef(ctx, name);
    // ctx.call remains because dialog-aware calls cannot be expressed by the app stand-in.
    await ctx.call("window.screen.click", [{ ref }, { button: "right" }], { dialog: true });
    // ctx.call remains because dialog-aware calls cannot be expressed by the app stand-in.
    await ctx.call("menus[0].items", undefined, { dialog: true });
}

export async function chooseTreeMenuItem(ctx, itemId) {
    // ctx.call remains because dialog-aware calls cannot be expressed by the app stand-in.
    await ctx.call("menus[0].click", [itemId], { dialog: true });
}

export async function answerInputDialog(ctx, value, buttonLabel) {
    const snapshot = await ctx.waitFor(
        (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }], { dialog: true }),
        (text) => text.includes("textbox"),
    );
    const inputs = snapshot.split("\n").filter((line) => line.includes("textbox"));
    const input = inputs.at(-1);
    const ref = input?.match(/\bref=(e\d+)\b/)?.[1] ?? input?.match(/\b(e\d+)\s+textbox\b/)?.[1];
    if (!ref) throw new Error("Could not find the text input in the open dialog.");
    // ctx.call remains because dialog-aware calls cannot be expressed by the app stand-in.
    await ctx.call("window.screen.click", [{ ref }], { dialog: true });
    // ctx.call remains because dialog-aware calls cannot be expressed by the app stand-in.
    await ctx.call("window.screen.pressKey", ["Control+A"], { dialog: true });
    // ctx.call remains because dialog-aware calls cannot be expressed by the app stand-in.
    await ctx.call("window.screen.type", [{ ref }, value], { dialog: true });
    // ctx.call remains because dialog-aware calls cannot be expressed by the app stand-in.
    await ctx.call("window.screen.click", [`text=${JSON.stringify(buttonLabel)}`], { dialog: true });
}

export async function readSidebarRows(ctx, selector) {
    return ctx.app.window.screen.evaluate(
        `() => Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((row) => row.innerText.trim())`,
    );
}

export async function closePages(ctx, pageIds) {
    await closeOwnedPages(ctx, pageIds);
}
