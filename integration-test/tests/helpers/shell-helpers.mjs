export const shellPagePath = (pageId, member) => `pages[${JSON.stringify(pageId)}].${member}`;
export const pagePath = shellPagePath;

export async function focusNeutralWindow(ctx) {
    const focused = await ctx.call("window.screen.evaluate", [
        "() => { const hadTabIndex = document.body.hasAttribute('tabindex'); const tabIndex = document.body.getAttribute('tabindex'); document.body.tabIndex = -1; document.body.focus(); const focused = document.activeElement === document.body; if (hadTabIndex) document.body.setAttribute('tabindex', tabIndex); else document.body.removeAttribute('tabindex'); return focused; }",
    ]);
    ctx.expect(focused).toBe(true);
}

export async function pressWindowShortcut(ctx, key) {
    const priorTabIndex = await ctx.call("window.screen.evaluate", [
        "() => ({ present: document.body.hasAttribute('tabindex'), value: document.body.getAttribute('tabindex') })",
    ]);
    const focused = await ctx.call("window.screen.evaluate", [
        "() => { document.body.tabIndex = -1; document.body.focus(); return document.activeElement === document.body; }",
    ]);
    ctx.expect(focused).toBe(true);
    try {
        await ctx.call("window.screen.pressKey", [key]);
    } finally {
        const restore = priorTabIndex.present
            ? `document.body.setAttribute('tabindex', ${JSON.stringify(priorTabIndex.value)})`
            : "document.body.removeAttribute('tabindex')";
        await ctx.call("window.screen.evaluate", [`() => { ${restore}; }`]);
    }
}

export async function pressNativeShortcut(ctx, keyCode, modifiers) {
    const windowIndex = await ctx.call("window.windowIndex");
    const script = `(() => {
        const matches = openWindows.windows.filter((entry) =>
            entry.index === ${JSON.stringify(windowIndex)}
            && !entry.boardRoot
            && entry.window
            && !entry.window.window.isDestroyed()
            && entry.window.window.isVisible()
            && !entry.window.window.webContents.isDevToolsOpened()
        );
        if (matches.length !== 1) throw new Error("Expected exactly one visible non-board app window for test window " + ${JSON.stringify(windowIndex)} + ", got " + matches.length);
        const entry = matches[0];
        const browserWindow = entry.window.window;
        if (openWindows.getWindowIndex(browserWindow) !== ${JSON.stringify(windowIndex)}) throw new Error("Selected app window does not own the test window index");
        const input = { keyCode: ${JSON.stringify(keyCode)}, modifiers: ${JSON.stringify(modifiers)} };
        browserWindow.webContents.sendInputEvent({ type: "keyDown", ...input });
        browserWindow.webContents.sendInputEvent({ type: "keyUp", ...input });
        return { windowIndex: entry.index, visible: browserWindow.isVisible(), devToolsOpen: browserWindow.webContents.isDevToolsOpened() };
    })()`;
    const result = await ctx.call("main.script.execute", [script]);
    ctx.expect(result.isError).toBe(false);
    ctx.expect(result.result.windowIndex).toBe(windowIndex);
    ctx.expect(result.result.visible).toBe(true);
    ctx.expect(result.result.devToolsOpen).toBe(false);
}

export async function waitForPageEditorFocus(ctx, pageId) {
    const slotSelector = `[data-name="page-slot"][data-page-id=${JSON.stringify(pageId)}]`;
    const focused = await ctx.waitFor(
        (activeContext) => activeContext.call("window.screen.evaluate", [
            `() => { const slot = document.querySelector(${JSON.stringify(slotSelector)}); return Boolean(slot && document.activeElement && slot.contains(document.activeElement) && document.activeElement.closest('.monaco-editor')); }`,
        ]),
        Boolean,
    );
    ctx.expect(focused).toBe(true);
}

export async function openTextPage(ctx, folder, filename, content) {
    const filePath = ctx.fixture(`${folder}/${filename}`);
    await ctx.call("fs.write", [filePath, content]);
    const page = await ctx.call("pages.openFile", [filePath]);
    ctx.expect(page.editor).toBe("monaco");
    ctx.expect(await ctx.callText(shellPagePath(page.id, "content"))).toBe(content);
    return { id: page.id, filePath };
}

export async function replacePageContent(ctx, pageId, content) {
    await ctx.call("pages.showPage", [pageId]);
    await ctx.call("window.screen.click", [`[data-name="page-slot"][data-page-id=${JSON.stringify(pageId)}] [data-name="page-editor"]`]);
    await ctx.call("window.screen.pressKey", ["Control+A"]);
    await ctx.call(shellPagePath(pageId, "editor.replaceSelection"), [content]);
}

export async function addFileBackedPage(ctx, folder, filename, content) {
    const filePath = ctx.fixture(`${folder}/${filename}`);
    await ctx.call("fs.write", [filePath, content]);
    const page = await ctx.call("pages.addEmptyPage", []);
    ctx.expect(await ctx.call("pages.navigatePageTo", [page.id, filePath])).toBe(true);
    ctx.expect(await ctx.call(shellPagePath(page.id, "filePath"))).toBe(filePath);
    ctx.expect(await ctx.callText(shellPagePath(page.id, "content"))).toBe(content);
    ctx.expect(await ctx.call(shellPagePath(page.id, "modified"))).toBe(false);
    return { id: page.id, filePath };
}

export async function readTabOrder(ctx) {
    return ctx.call("window.screen.evaluate", [
        '() => Array.from(document.querySelectorAll(\'[data-name="page-tabs"] [data-page-id]\')).map((tab) => tab.dataset.pageId)',
    ]);
}

export async function openTabMenu(ctx, pageId) {
    await closeTabMenu(ctx);
    // A tab's own element in either strip: the main strip or the right-pinned chips.
    await ctx.call("window.screen.click", [`[data-name="page-tab"][data-page-id="${pageId}"]`, { button: "right" }], { dialog: true });
    await ctx.call("menus[0].items", undefined, { dialog: true });
}

export async function clickTabMenuItem(ctx, itemId) {
    await ctx.call("menus[0].click", [itemId], { dialog: true });
}

export async function closeTabMenu(ctx) {
    await ctx.call("menus[0].close", []).catch(() => {});
}

export async function expectGroupedPair(ctx, leftPageId, rightPageId) {
    const pair = await ctx.waitFor(
        (activeContext) => activeContext.call("pages.getGroupedPage", [leftPageId]),
        (group) => group?.id === rightPageId,
        { timeout: 5000 },
    );
    ctx.expect(pair.id).toBe(rightPageId);
    ctx.expect(await ctx.call("pages.getGroupedPage", [rightPageId])).toEqual(await ctx.call("pages.findPage", [leftPageId]));
}

export async function closeOwnedPages(ctx, pageIds) {
    for (const pageId of new Set(Array.from(pageIds).filter(Boolean))) {
        try {
            const result = await ctx.call("pages.closePage", [pageId], { dialog: true });
            if (result === true) {
                await ctx.waitFor("pages.all", (pages) => !pages.some((page) => page.id === pageId));
                continue;
            }
            const title = await ctx.callText("dialogs[0].title", undefined, { dialog: true }).catch(() => "");
            if (title === "Unsaved Changes") {
                await ctx.call("dialogs[0].click", ["Don't Save"], { dialog: true });
                await ctx.waitFor("pages.all", (pages) => !pages.some((page) => page.id === pageId));
            }
        } catch {
            // Preserve the original failure; page cleanup is best-effort.
        }
    }
}

export async function closePagesCreatedSince(ctx, existingPageIds) {
    const pages = await ctx.call("pages.all");
    const createdIds = pages.filter((page) => !existingPageIds.has(page.id)).map((page) => page.id);
    await closeOwnedPages(ctx, createdIds);
    await ctx.waitFor("pages.all", (currentPages) => currentPages.every((page) => existingPageIds.has(page.id)));
}

export async function startDialogScript(ctx, source, title) {
    const page = await ctx.call("pages.addEditorPage", ["monaco", "javascript", title, source]);
    await ctx.call("pages.showPage", [page.id]);
    const result = await ctx.call(shellPagePath(page.id, "runScript"), [], { dialog: true });
    ctx.expect(result?.pending).toBe(true);
    return page.id;
}

export async function closeShellPage(ctx, pageId) {
    if (!pageId) return;
    try {
        const groupedPage = await ctx.call(shellPagePath(pageId, "grouped")).catch(() => undefined);
        if (groupedPage?.id) await closeOwnedPages(ctx, [groupedPage.id]);
        const closed = await ctx.call("pages.closePage", [pageId], { dialog: true });
        if (closed === true) {
            await ctx.waitFor("pages.all", (pages) => !pages.some((page) => page.id === pageId));
            return;
        }
        const dialogTitle = await ctx.callText("dialogs[0].title", undefined, { dialog: true }).catch(() => "");
        if (dialogTitle === "Unsaved Changes") {
            await ctx.call("dialogs[0].click", ["Don't Save"], { dialog: true });
            await ctx.waitFor("pages.all", (pages) => !pages.some((page) => page.id === pageId));
            return;
        }
        if (pageId === "settings-page") {
            await ctx.call("window.screen.click", ['[data-name="page-tabs"] [data-page-id="settings-page"] button']);
            await ctx.waitFor("pages.all", (pages) => !pages.some((page) => page.id === pageId));
        }
    } catch {
        // Preserve the test failure; the area run will report any leaked UI state.
    }
}

export async function closePendingDialog(ctx) {
    await ctx.call("dialogs[0].cancel", [], { dialog: true }).catch(() => {});
}

export async function waitForDialog(ctx, path, predicate, options) {
    return ctx.waitFor((activeContext) => activeContext.call(path, undefined, { dialog: true }), predicate, options);
}

export async function closeOrphanedUs2036Pages(ctx) {
    let pages = await ctx.call("pages.all");
    for (const page of pages.filter((entry) => entry.title.startsWith("us-2036-"))) {
        await closeShellPage(ctx, page.id);
    }
    pages = await ctx.call("pages.all");
    const generatedOutputPages = pages.filter((entry) => entry.title === "untitled" && entry.modified);
    await closeOwnedPages(ctx, generatedOutputPages.map((page) => page.id));
}
