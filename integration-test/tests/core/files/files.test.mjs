import { test } from "../../../lib/context.mjs";

const password = "US-2031 test password";

function testFolder(ctx, name) {
    return ctx.fixture(`us-2031/${name}`);
}

function pagePath(pageId, path) {
    return `pages[${JSON.stringify(pageId)}].${path}`;
}

async function closePages(ctx, pageIds) {
    const pages = await ctx.app.pages.all;
    for (const page of pages.filter((candidate) => pageIds.has(candidate.id))) {
        const closed = await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("pages.closePage", [page.id], { dialog: true });
        if (closed?.pending) {
            await ctx.waitFor(
                (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
                (title) => title === "Unsaved Changes",
            );
            await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("dialogs[0].click", ["Don't Save"], { dialog: true });
        }
        await ctx.waitFor((activeContext) => activeContext.app.pages.all, (remaining) => !remaining.some((candidate) => candidate.id === page.id));
    }
}

async function typePassword(ctx, value, confirm = false) {
    await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("window.screen.type", ['[data-name="password-dialog-password"] input', value], { dialog: true });
    if (confirm) {
        await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("window.screen.type", ['[data-name="password-dialog-confirm"] input', value], { dialog: true });
    }
    await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("window.screen.click", ["[data-name=\"password-submit\"]"], { dialog: true });
}

async function openDecryptDialog(ctx, pageId) {
    const selector = `[data-page-id=${JSON.stringify(pageId)}] [data-part="encryption-icon"]`;
    await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("window.screen.click", [selector], { dialog: true });
    await ctx.waitFor(
        (activeContext) => /* ctx.call remains because the app stand-in cannot pass call options such as dialog. */ activeContext.call("dialogs[0].buttons", undefined, { dialog: true }),
        (buttons) => buttons.includes("Decrypt"),
    );
}

async function replacePageContent(ctx, pageId, content) {
    await ctx.app.pages.showPage(pageId);
    await ctx.app.window.screen.click('[data-name="page-editor"]');
    await ctx.app.window.screen.pressKey("Control+A");
    await ctx.app.pages[pageId].editor.replaceSelection(content);
}

export default [
    test("app.fs file and directory operations stay within the test work folder", async (ctx) => {
        const root = testFolder(ctx, "fs-operations");
        const source = `${root}/source.txt`;
        const copy = `${root}/copy.txt`;
        const renamed = `${root}/renamed.txt`;
        const nested = `${root}/nested`;
        try {
            await ctx.app.fs.mkdir(root);
            ctx.expect(await ctx.app.fs.exists(source)).toBe(false);
            await ctx.app.fs.write(source, "filesystem round trip\n");
            ctx.expect(await ctx.callText("fs.read", [source])).toBe("filesystem round trip\n");
            ctx.expect((await ctx.app.fs.listDir(root)).includes("source.txt")).toBe(true);

            await ctx.app.fs.copyFile(source, copy);
            ctx.expect(await ctx.callText("fs.read", [copy])).toBe("filesystem round trip\n");
            await ctx.app.fs.rename(copy, renamed);
            ctx.expect(await ctx.app.fs.exists(copy)).toBe(false);
            ctx.expect(await ctx.app.fs.exists(renamed)).toBe(true);

            await ctx.app.fs.mkdir(nested);
            ctx.expect((await ctx.app.fs.listDirWithTypes(root)).find((entry) => entry.name === "nested").isDirectory).toBe(true);
            await ctx.app.fs.delete(renamed);
            ctx.expect(await ctx.app.fs.exists(renamed)).toBe(false);
        } finally {
            await ctx.app.fs.removeDir(root, true);
        }
    }),

    test("editing and saving a file updates disk and clears the dirty marker", async (ctx) => {
        const root = testFolder(ctx, "edit-save");
        const file = `${root}/notes.txt`;
        const openedIds = new Set();
        try {
            await ctx.app.fs.write(file, "before edit\n");
            const page = await ctx.app.pages.openFile(file);
            openedIds.add(page.id);
            ctx.expect(await ctx.callText(pagePath(page.id, "content"))).toBe("before edit\n");
            await replacePageContent(ctx, page.id, "after edit\n");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified)).toBe(true);

            ctx.expect(await ctx.app.pages[page.id].editor.saveFile()).toBe(true);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText("fs.read", [file]),
                (content) => content === "after edit\n",
            )).toBe("after edit\n");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false)).toBe(false);
        } finally {
            await closePages(ctx, openedIds);
            await ctx.app.fs.removeDir(root, true);
        }
    }),

    test("external file changes reload an unmodified page", async (ctx) => {
        const root = testFolder(ctx, "external-change");
        const cleanFile = `${root}/clean.txt`;
        const openedIds = new Set();
        try {
            await ctx.app.fs.write(cleanFile, "original clean\n");
            const cleanPage = await ctx.app.pages.openFile(cleanFile);
            openedIds.add(cleanPage.id);
            await ctx.app.fs.write(cleanFile, "changed outside\n");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[cleanPage.id].content, (content) => content === "changed outside\n"))
                .toBe("changed outside\n");
            ctx.expect(await ctx.app.pages[cleanPage.id].modified).toBe(false);
        } finally {
            await closePages(ctx, openedIds);
            await ctx.app.fs.removeDir(root, true);
        }
    }),

    test("UTF-8 BOM, UTF-16 LE, and Windows-1252 files decode and keep encoding after save", async (ctx) => {
        const root = testFolder(ctx, "encoding");
        const westernSentence = "Le café est très bon, la crème brûlée était délicieuse — à bientôt. Préférez-vous l’été?";
        const cases = [
            { name: "bom.txt", encoding: "utf-8-bom", expected: "BOM text — café\n", updated: "BOM text — café saved\n" },
            { name: "utf16.txt", encoding: "utf-16le", expected: "UTF-16 text — café\n", updated: "UTF-16 text — café saved\n" },
            { name: "windows1252.txt", encoding: "windows-1252", expected: westernSentence, updated: `${westernSentence} Merci.` },
        ];
        const openedIds = new Set();
        try {
            for (const item of cases) await ctx.app.fs.write(`${root}/${item.name}`, item.expected, item.encoding);
            for (const item of cases) {
                const file = `${root}/${item.name}`;
                const page = await ctx.app.pages.openFile(file);
                openedIds.add(page.id);
                ctx.expect(await ctx.callText(pagePath(page.id, "content"))).toBe(item.expected);
                if (item.encoding === "windows-1252") {
                    ctx.expect((await ctx.app.fs.readFile(file)).encoding).toBe("windows-1252");
                }
                await replacePageContent(ctx, page.id, item.updated);
                ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified)).toBe(true);
                ctx.expect(await ctx.app.pages[page.id].editor.saveFile()).toBe(true);
                const saved = await ctx.waitFor(
                    (activeContext) => activeContext.app.fs.readFile(file),
                    (result) => result.content === item.updated,
                );
                ctx.expect(saved.content).toBe(item.updated);
                ctx.expect(saved.encoding).toBe(item.encoding);
                if (item.encoding === "windows-1252") {
                    ctx.expect((await ctx.app.fs.readFile(file)).encoding).toBe("windows-1252");
                }
            }
        } finally {
            await closePages(ctx, openedIds);
            await ctx.app.fs.removeDir(root, true);
        }
    }),

    test("CRLF and LF files retain their line endings when saved", async (ctx) => {
        const root = testFolder(ctx, "line-endings");
        const cases = [
            { name: "crlf.txt", initial: "first\r\nsecond\r\n", updated: "first\r\nsecond\r\nthird\r\n" },
            { name: "lf.txt", initial: "first\nsecond\n", updated: "first\nsecond\nthird\n" },
        ];
        const openedIds = new Set();
        try {
            for (const item of cases) await ctx.app.fs.write(`${root}/${item.name}`, item.initial);
            for (const item of cases) {
                const file = `${root}/${item.name}`;
                const page = await ctx.app.pages.openFile(file);
                openedIds.add(page.id);
                ctx.expect(await ctx.callText(pagePath(page.id, "content"))).toBe(item.initial);
                await replacePageContent(ctx, page.id, item.updated);
                ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified)).toBe(true);
                await ctx.app.pages[page.id].editor.saveFile();
                ctx.expect(await ctx.waitFor(
                    (activeContext) => activeContext.callText("fs.read", [file]),
                    (content) => content === item.updated,
                )).toBe(item.updated);
            }
        } finally {
            await closePages(ctx, openedIds);
            await ctx.app.fs.removeDir(root, true);
        }
    }),

    test("recent files survive restart and open from the Recent Files category", async (ctx) => {
        const root = testFolder(ctx, "recent-files");
        // Built by ctx.fixture so the separators match the normalized paths the recent list stores.
        const file = ctx.fixture("us-2031/recent-files/recent-note.txt");
        await ctx.app.recent.load();
        const originalRecent = await ctx.app.recent.files;
        const openedIds = new Set();
        const originalMenuBarOpen = await ctx.app.window.menuBar.isOpen;
        const originalSelectedFolder = await ctx.app.window.menuBar.selected;
        try {
            await ctx.app.fs.write(file, "opened from recent list\n");
            const page = await ctx.app.pages.openFile(file);
            openedIds.add(page.id);
            ctx.expect((await ctx.app.recent.files).includes(file)).toBe(true);
            ctx.expect(await ctx.app.pages.closePage(page.id)).toBe(true);

            await ctx.restartApp();
            await ctx.app.recent.load();
            ctx.expect((await ctx.app.recent.files).includes(file)).toBe(true);

            await ctx.app.window.menuBar.open("recent-files");
            ctx.expect(await ctx.app.window.menuBar.isOpen).toBe(true);
            await ctx.app.window.screen.click(`text=${JSON.stringify("recent-note.txt")}`);
            const reopened = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.find((candidate) => candidate.filePath === file));
            const recentPage = reopened.find((candidate) => candidate.filePath === file);
            openedIds.add(recentPage.id);
            ctx.expect(await ctx.callText(pagePath(recentPage.id, "content"))).toBe("opened from recent list\n");
        } finally {
            await closePages(ctx, openedIds);
            await ctx.app.recent.clear();
            for (const recentPath of originalRecent) await ctx.app.recent.add(recentPath);
            if (originalMenuBarOpen && originalSelectedFolder?.id) {
                await ctx.app.window.menuBar.open(originalSelectedFolder.id);
            } else {
                await ctx.app.window.menuBar.close();
            }
            await ctx.app.fs.removeDir(root, true);
        }
    }, { requires: ["launch"] }),

    test("reopening an encrypted file shows locked content and decrypts from the tab lock", async (ctx) => {
        const root = testFolder(ctx, "encryption-open-prompt");
        const file = `${root}/private.txt`;
        const openedIds = new Set();
        try {
            await ctx.app.fs.write(file, "private original content\n");
            const page = await ctx.app.pages.openFile(file);
            openedIds.add(page.id);
            ctx.expect(await ctx.app.pages[page.id].editor.encrypted).toBe(false);

            ctx.expect(await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call(pagePath(page.id, "editor.showEncryptionDialog"), [], { dialog: true }))
                .toEqual({ pending: true });
            await ctx.waitFor(
                (activeContext) => /* ctx.call remains because the app stand-in cannot pass call options such as dialog. */ activeContext.call("dialogs[0].buttons", undefined, { dialog: true }),
                (buttons) => buttons.includes("Encrypt"),
            );
            await typePassword(ctx, password, true);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.encrypted, (encrypted) => encrypted)).toBe(true);
            ctx.expect(await ctx.app.pages[page.id].editor.saveFile()).toBe(true);
            const encryptedText = await ctx.waitFor(
                (activeContext) => activeContext.callText("fs.read", [file]),
                (content) => content.startsWith("ENC-v001:"),
            );
            ctx.expect(encryptedText.startsWith("private original content")).toBe(false);
            ctx.expect(await ctx.app.pages.closePage(page.id)).toBe(true);
            openedIds.delete(page.id);

            const encryptedPage = await ctx.app.pages.openFile(file);
            openedIds.add(encryptedPage.id);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[encryptedPage.id].editor.encrypted, (encrypted) => encrypted === true)).toBe(true);
            ctx.expect(await ctx.callText(pagePath(encryptedPage.id, "content"))).toBe(encryptedText);
            const lockIcon = await ctx.app.window.screen.evaluate('pageId => document.querySelector(`[data-page-id="${pageId}"] [data-part="encryption-icon"]`)?.textContent', { args: [encryptedPage.id] });
            ctx.expect(lockIcon).toBe("\u{1F512}");

            await ctx.app.pages.showPage(encryptedPage.id);
            await ctx.app.window.screen.click('[data-name="page-editor"]');
            await ctx.app.window.screen.pressKey("X");
            ctx.expect(await ctx.callText(pagePath(encryptedPage.id, "content"))).toBe(encryptedText);
            ctx.expect(await ctx.app.pages[encryptedPage.id].modified).toBe(false);

            await openDecryptDialog(ctx, encryptedPage.id);
            await typePassword(ctx, password);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[encryptedPage.id].editor.decrypted, (decrypted) => decrypted === true)).toBe(true);
            ctx.expect(await ctx.callText(pagePath(encryptedPage.id, "content"))).toBe("private original content\n");
        } finally {
            await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("dialogs[0].cancel", [], { dialog: true }).catch(() => {});
            await closePages(ctx, openedIds);
            await ctx.app.fs.removeDir(root, true);
        }
    }),

    test("wrong encryption passwords are rejected and the right password decrypts", async (ctx) => {
        const root = testFolder(ctx, "encryption-passwords");
        const file = `${root}/private.txt`;
        const openedIds = new Set();
        try {
            await ctx.app.fs.write(file, "private original content\n");
            const page = await ctx.app.pages.openFile(file);
            openedIds.add(page.id);
            ctx.expect(await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call(pagePath(page.id, "editor.showEncryptionDialog"), [], { dialog: true }))
                .toEqual({ pending: true });
            await ctx.waitFor(
                (activeContext) => /* ctx.call remains because the app stand-in cannot pass call options such as dialog. */ activeContext.call("dialogs[0].buttons", undefined, { dialog: true }),
                (buttons) => buttons.includes("Encrypt"),
            );
            await typePassword(ctx, password, true);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.encrypted, (encrypted) => encrypted)).toBe(true);
            ctx.expect(await ctx.app.pages[page.id].editor.saveFile()).toBe(true);
            const encryptedText = await ctx.waitFor(
                (activeContext) => activeContext.callText("fs.read", [file]),
                (content) => content.startsWith("ENC-v001:"),
            );
            ctx.expect(encryptedText.startsWith("private original content")).toBe(false);
            ctx.expect(await ctx.app.pages.closePage(page.id)).toBe(true);
            openedIds.delete(page.id);

            const encryptedPage = await ctx.app.pages.openFile(file);
            openedIds.add(encryptedPage.id);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[encryptedPage.id].editor.encrypted, (encrypted) => encrypted === true)).toBe(true);
            await openDecryptDialog(ctx, encryptedPage.id);
            await typePassword(ctx, "incorrect password");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[encryptedPage.id].editor.decrypted, (decrypted) => decrypted === false)).toBe(false);
            ctx.expect(await ctx.app.pages[encryptedPage.id].editor.encrypted).toBe(true);

            await openDecryptDialog(ctx, encryptedPage.id);
            await typePassword(ctx, password);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[encryptedPage.id].editor.decrypted, (decrypted) => decrypted === true)).toBe(true);
            ctx.expect(await ctx.callText(pagePath(encryptedPage.id, "content"))).toBe("private original content\n");
        } finally {
            await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("dialogs[0].cancel", [], { dialog: true }).catch(() => {});
            await closePages(ctx, openedIds);
            await ctx.app.fs.removeDir(root, true);
        }
    }),
];
