// Open in Windows Default App and Show in Folder launch external programs and stay uncovered.
import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage, closePage, fixturePage, openBrowserPage } from "../helpers.mjs";

const DOWNLOAD_LINE = "Persephone download fixture.\n";

function newestDownload(entries, filename) {
    return entries
        .filter((entry) => entry.filename === filename)
        .sort((left, right) => right.startTime - left.startTime)[0];
}

function expectedBody(bytes = DOWNLOAD_LINE.length) {
    return DOWNLOAD_LINE.repeat(Math.ceil(bytes / DOWNLOAD_LINE.length)).slice(0, bytes);
}

async function resetFixture(ctx, name) {
    const folder = ctx.fixture(`us-2081/${name}`);
    try {
        await ctx.app.fs.removeDir(folder, true);
    } catch {
        // A missing fixture directory is already clean.
    }
    // Finished entries from other tests would add their own row buttons to the popup.
    await ctx.app.downloads.clearCompleted();
}

async function waitForDownload(ctx, filename, status) {
    const entries = await ctx.waitFor(
        (activeContext) => activeContext.app.downloads.downloads,
        (downloads) => newestDownload(downloads, filename)?.status === status,
    );
    return newestDownload(entries, filename);
}

async function openDownloadsPopup(ctx, pageId) {
    await activatePage(ctx, pageId);
    await ctx.app.window.screen.click('[data-name="toolbar-downloads"]');
    await activatePage(ctx, pageId);
    const snapshot = await ctx.app.window.screen.snapshot({ root: '[data-name="downloads-list"]' });
    return snapshot;
}

async function closeDownloadsPopup(ctx, pageId) {
    try {
        await activatePage(ctx, pageId);
        const isOpen = await ctx.app.window.screen.evaluate(
            "() => Boolean(document.querySelector('[data-name=\"downloads-popup\"]'))",
        );
        if (isOpen) {
            await activatePage(ctx, pageId);
            await ctx.app.window.screen.pressKey("Escape");
        }
    } catch {
        // Cleanup must not hide the test's original result.
    }
}

async function readDownload(ctx, savePath) {
    // callText preserves an exact file string that a valid JSON string could otherwise parse.
    return ctx.callText("fs.read", [savePath]);
}

export default [
    test("runner download results include MIME type and a redacted URL attachment", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "downloads", "index.html"));
        try {
            await page.editor.waitFor({ selector: "#download-runner-metadata" });
            const pending = ctx.app.pages[page.id].editor.waitForDownload({ timeout: 10000 });
            await page.editor.click("#download-runner-metadata");
            const download = await pending;
            ctx.expect(download.mimeType).toBe("application/octet-stream");
            ctx.expect(download.url).toContain("token=%E2%80%A6");
            ctx.expect(download.url).not.toContain("secret-value");
            ctx.expect(download.url).not.toContain("private-fragment");
            ctx.expect(download.path.includes(`${path.sep}${path.join("downloads", "us2190-runner.txt")}`)).toBe(true);
            ctx.expect(await readDownload(ctx, download.path)).toBe(DOWNLOAD_LINE);
            const attachment = ctx._state.attachments.find((item) => item.suggestedFilename === download.suggestedFilename);
            ctx.expect(attachment.mimeType).toBe(download.mimeType);
            ctx.expect(attachment.url).toBe(download.url);
        } finally { await closeBrowserPage(ctx, page); }
    }),

    test("runner download results redact non-HTTP URLs", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "downloads", "index.html"));
        try {
            await page.editor.waitFor({ selector: "#download-complete" });
            const pending = ctx.app.pages[page.id].editor.waitForDownload({ timeout: 10000 });
            await page.editor.evaluate(`() => {
                const link = document.createElement("a");
                const url = URL.createObjectURL(new Blob([${JSON.stringify(DOWNLOAD_LINE)}], { type: "text/plain" }));
                link.href = url;
                link.download = "us2190-blob.txt";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            }`);
            const download = await pending;
            ctx.expect(download.url).toBe("[redacted URL]");
            ctx.expect(download.mimeType).toContain("text/plain");
            ctx.expect(await readDownload(ctx, download.path)).toBe(DOWNLOAD_LINE);
            const attachment = ctx._state.attachments.find((item) => item.suggestedFilename === download.suggestedFilename);
            ctx.expect(attachment.url).toBe(download.url);
        } finally { await closeBrowserPage(ctx, page); }
    }),

    test("download completes into the test folder and Clear removes the manager entry", async (ctx) => {
        const filename = "us2081-complete.txt";
        await resetFixture(ctx, "complete");
        let page;
        try {
            page = await openBrowserPage(ctx, fixturePage(ctx, "downloads", "index.html"));
            await page.editor.waitFor({ selector: "#download-complete" });
            await page.editor.click("#download-complete");

            const entry = await waitForDownload(ctx, filename, "completed");
            ctx.expect(entry.filename).toBe(filename);
            ctx.expect(entry.totalBytes).toBe(DOWNLOAD_LINE.length);
            ctx.expect(entry.receivedBytes).toBe(DOWNLOAD_LINE.length);
            ctx.expect(entry.savePath.endsWith(path.join("test-downloads", filename))).toBe(true);
            ctx.expect(await readDownload(ctx, entry.savePath)).toBe(expectedBody());

            const snapshot = await openDownloadsPopup(ctx, page.id);
            ctx.expect(snapshot).toContain(filename);
            await activatePage(ctx, page.id);
            const popupSnapshot = await ctx.app.window.screen.snapshot();
            ctx.expect(popupSnapshot).toContain("Clear");
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="downloads-clear"]');
            const remaining = await ctx.waitFor(
                (activeContext) => activeContext.app.downloads.downloads,
                (downloads) => !newestDownload(downloads, filename),
            );
            ctx.expect(remaining.some((item) => item.filename === filename)).toBe(false);
        } finally {
            await closeDownloadsPopup(ctx, page?.id);
            await closeBrowserPage(ctx, page);
        }
    }),

    test("downloads popup shows slow progress and its Cancel button stops the download", async (ctx) => {
        const filename = "us2081-slow.txt";
        await resetFixture(ctx, "slow");
        let page;
        try {
            page = await openBrowserPage(ctx, fixturePage(ctx, "downloads", "index.html"));
            await page.editor.waitFor({ selector: "#download-slow" });
            await page.editor.click("#download-slow");

            const startingEntries = await ctx.waitFor(
                (activeContext) => activeContext.app.downloads.downloads,
                (downloads) => newestDownload(downloads, filename)?.status === "downloading",
            );
            const startingEntry = newestDownload(startingEntries, filename);
            const updatedEntries = await ctx.waitFor(
                (activeContext) => activeContext.app.downloads.downloads,
                (downloads) => {
                    const entry = newestDownload(downloads, filename);
                    return entry?.status === "downloading" && entry.receivedBytes > startingEntry.receivedBytes;
                },
            );
            const updatedEntry = newestDownload(updatedEntries, filename);
            ctx.expect(updatedEntry.receivedBytes > startingEntry.receivedBytes).toBe(true);

            const snapshot = await openDownloadsPopup(ctx, page.id);
            ctx.expect(snapshot).toContain(filename);
            ctx.expect(snapshot).toContain("Cancel");
            await activatePage(ctx, page.id);
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="downloads-cancel"]');

            const cancelled = await waitForDownload(ctx, filename, "cancelled");
            ctx.expect(cancelled.status).toBe("cancelled");
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="downloads-clear"]');
            const remaining = await ctx.waitFor(
                (activeContext) => activeContext.app.downloads.downloads,
                (downloads) => !newestDownload(downloads, filename),
            );
            ctx.expect(remaining.some((item) => item.filename === filename)).toBe(false);
        } finally {
            if (page) {
                try {
                    const entry = newestDownload(await ctx.app.downloads.downloads, filename);
                    if (entry?.status === "downloading") await ctx.app.downloads.cancelDownload(entry.id);
                } catch {
                    // Best-effort cancellation only for a still-active test download.
                }
            }
            await closeDownloadsPopup(ctx, page?.id);
            await closeBrowserPage(ctx, page);
        }
    }),

    test("Open in Persephone opens a completed text download with its content", async (ctx) => {
        const filename = "us2081-open.txt";
        await resetFixture(ctx, "open");
        let page;
        let openedPageId;
        try {
            page = await openBrowserPage(ctx, fixturePage(ctx, "downloads", "index.html"));
            const existingPages = new Set((await ctx.app.pages.all).map((item) => item.id));
            await page.editor.waitFor({ selector: "#download-open" });
            await page.editor.click("#download-open");

            const entry = await waitForDownload(ctx, filename, "completed");
            ctx.expect(entry.savePath.endsWith(path.join("test-downloads", filename))).toBe(true);
            ctx.expect(await readDownload(ctx, entry.savePath)).toBe(expectedBody());

            const snapshot = await openDownloadsPopup(ctx, page.id);
            ctx.expect(snapshot).toContain(filename);
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="downloads-open"]');
            const openedPages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (pages) => pages.find((item) => !existingPages.has(item.id) && item.title === filename),
            );
            openedPageId = openedPages.find((item) => !existingPages.has(item.id) && item.title === filename)?.id;
            ctx.expect(openedPageId).toBeTruthy();
            ctx.expect(await ctx.app.pages[openedPageId].content).toBe(expectedBody());
        } finally {
            await closeDownloadsPopup(ctx, page?.id);
            if (openedPageId) {
                try { await closePage(ctx, openedPageId); } catch { /* cleanup must not replace the test result */ }
            }
            await closeBrowserPage(ctx, page);
        }
    }),
];
