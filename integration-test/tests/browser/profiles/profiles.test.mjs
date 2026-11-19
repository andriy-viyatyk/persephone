import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage, fixturePage, openBrowserPage } from "../helpers.mjs";

const ADD_BOOKMARK_TITLE = "Add Bookmark";
const EDIT_BOOKMARK_TITLE = "Edit Bookmark";
const DELETE_LINK_TITLE = "Delete Link";
const STORAGE_KEY = "us2080-profile-storage";
const EMPTY_BOOKMARKS = '{"links":[],"state":{}}\n';
const STAR = '[data-name="url-bookmark-toggle"]';
const BOOKMARKS = '[data-name="toolbar-bookmarks"]';

function uniqueProfileName(profiles) {
    const names = new Set(profiles.map((profile) => profile.name));
    let suffix = 1;
    while (names.has(`US-2080 Browser Profile ${suffix}`)) suffix += 1;
    return `US-2080 Browser Profile ${suffix}`;
}

async function resetBookmarksFile(ctx, path) {
    await ctx.app.fs.write(path, EMPTY_BOOKMARKS);
}

async function readBookmarks(ctx, path, predicate = () => true) {
    return await ctx.waitFor(async (activeContext) => {
        // callText preserves the file string so JSON.parse reads the exact persisted document.
        const contents = await activeContext.callText("fs.read", [path]);
        // The app may be mid-write; an unparsable read is "not yet", not a failure.
        try { return JSON.parse(contents); } catch { return {}; }
    }, predicate, { timeout: 10000 });
}

async function dialogProperty(ctx, property) {
    // ctx.call is required because dialog reads need dialog-aware dispatch that the app stand-in cannot express.
    return await ctx.call(`dialogs[0].${property}`, [], { dialog: true });
}

async function saveBookmarkDialog(ctx) {
    // ctx.call is required because dialog actions need dialog-aware dispatch that the app stand-in cannot express.
    await ctx.call("dialogs[0].click", ["Save"], { dialog: true });
}

async function cancelPendingDialog(ctx) {
    try {
        // ctx.call is required because dialog cleanup needs dialog-aware dispatch that the app stand-in cannot express.
        await ctx.call("dialogs[0].cancel", [], { dialog: true });
    } catch {
        // No pending dialog is already clean.
    }
}

async function closePendingMenu(ctx) {
    try {
        // ctx.call is required because popup-menu cleanup needs dialog-aware dispatch the app stand-in cannot express.
        await ctx.call("menus[0].close", [], { dialog: true });
    } catch {
        // No open popup menu is already clean.
    }
}

async function restoreSetting(ctx, key, value) {
    try {
        await ctx.app.settings.set(key, value);
    } catch {
        // Preserve the test result if settings cleanup cannot complete.
    }
}

async function openBookmark(ctx, page, title, url) {
    await activatePage(ctx, page.id);
    // ctx.call is required because the star opens a renderer dialog and needs dialog-aware dispatch.
    await ctx.call("window.screen.click", [STAR], { dialog: true });
    const dialogTitle = await ctx.waitFor(
        (activeContext) => dialogProperty(activeContext, "title"),
        (value) => value === ADD_BOOKMARK_TITLE,
    );
    ctx.expect(dialogTitle).toBe(ADD_BOOKMARK_TITLE);
    ctx.expect(await dialogProperty(ctx, "linkTitle")).toBe(title);
    ctx.expect(await dialogProperty(ctx, "href")).toBe(url);
    await saveBookmarkDialog(ctx);
}

async function openBookmarksDrawer(ctx, page, expectedTitle) {
    await activatePage(ctx, page.id);
    await ctx.app.window.screen.click(BOOKMARKS);
    await activatePage(ctx, page.id);
    await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.snapshot(),
        (snapshot) => snapshot.includes(expectedTitle),
    );
    await activatePage(ctx, page.id);
    return await ctx.app.window.screen.evaluate(
        // Inactive pages stay mounted; read the drawer of the visible (active) page only. innerText, not
        // textContent: the virtualized lists keep recycled rows attached but hidden.
        "() => [...document.querySelectorAll('[data-name=bookmarks-drawer-root]')].find((element) => element.offsetParent)?.innerText ?? ''",
    );
}

export default [
    test("browser profiles and Incognito isolate localStorage", async (ctx) => {
        const originalProfiles = await ctx.app.settings.get("browser-profiles");
        const originalDefaultProfile = await ctx.app.settings.get("browser-default-profile");
        const profileName = uniqueProfileName(originalProfiles);
        let defaultPage;
        let namedPage;
        let incognitoPage;
        let reopenedIncognitoPage;
        try {
            await ctx.app.settings.set("browser-profiles", [
                ...originalProfiles,
                { name: profileName, color: "Dodger Blue" },
            ]);
            await ctx.app.settings.set("browser-default-profile", "");

            const url = fixturePage(ctx, "profiles", "storage.html");
            defaultPage = await openBrowserPage(ctx, url);
            await defaultPage.editor.waitFor({ selector: "#ready" });
            await defaultPage.editor.evaluate(`() => {
                localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});
                localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, "default profile");
            }`);

            namedPage = await openBrowserPage(ctx, url, { profile: profileName });
            await namedPage.editor.waitFor({ selector: "#ready" });
            const namedBeforeWrite = await namedPage.editor.evaluate(`() => {
                const value = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
                localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});
                localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, "named profile");
                return value;
            }`);
            ctx.expect(namedBeforeWrite).toBe(null);
            ctx.expect(await defaultPage.editor.evaluate(`() => localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`)).toBe("default profile");

            incognitoPage = await openBrowserPage(ctx, url, { incognito: true });
            await incognitoPage.editor.waitFor({ selector: "#ready" });
            const incognitoBeforeWrite = await incognitoPage.editor.evaluate(`() => {
                const value = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
                localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});
                localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, "incognito profile");
                return value;
            }`);
            ctx.expect(incognitoBeforeWrite).toBe(null);
            ctx.expect(await namedPage.editor.evaluate(`() => localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`)).toBe("named profile");
            await closeBrowserPage(ctx, incognitoPage);
            incognitoPage = undefined;

            reopenedIncognitoPage = await openBrowserPage(ctx, url, { incognito: true });
            await reopenedIncognitoPage.editor.waitFor({ selector: "#ready" });
            ctx.expect(await reopenedIncognitoPage.editor.evaluate(`() => localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`)).toBe(null);
        } finally {
            await closeBrowserPage(ctx, reopenedIncognitoPage);
            await closeBrowserPage(ctx, incognitoPage);
            await closeBrowserPage(ctx, namedPage);
            await closeBrowserPage(ctx, defaultPage);
            await restoreSetting(ctx, "browser-default-profile", originalDefaultProfile);
            await restoreSetting(ctx, "browser-profiles", originalProfiles);
        }
    }),

    test("bookmark star adds or edits the current page and the drawer opens it in a new tab", async (ctx) => {
        const originalBookmarkFile = await ctx.app.settings.get("browser-default-bookmarks-file");
        const bookmarkFile = ctx.fixture("us-2080-bookmarks.link.json");
        const bookmarkTitle = "US-2080 Bookmark Fixture";
        const editedTitle = "US-2080 Edited Bookmark";
        const bookmarkUrl = fixturePage(ctx, "profiles", "bookmark.html");
        let page;
        try {
            await resetBookmarksFile(ctx, bookmarkFile);
            await ctx.app.settings.set("browser-default-bookmarks-file", bookmarkFile);
            page = await openBrowserPage(ctx, bookmarkUrl);
            await page.editor.waitFor({ selector: "#ready" });

            await activatePage(ctx, page.id);
            // ctx.call is required because the star opens a renderer dialog and needs dialog-aware dispatch.
            await ctx.call("window.screen.click", [STAR], { dialog: true });
            const addTitle = await ctx.waitFor(
                (activeContext) => dialogProperty(activeContext, "title"),
                (value) => value === ADD_BOOKMARK_TITLE,
            );
            ctx.expect(addTitle).toBe(ADD_BOOKMARK_TITLE);
            ctx.expect(await dialogProperty(ctx, "linkTitle")).toBe(bookmarkTitle);
            ctx.expect(await dialogProperty(ctx, "href")).toBe(bookmarkUrl);
            await saveBookmarkDialog(ctx);

            await activatePage(ctx, page.id);
            // ctx.call is required because the star opens a renderer dialog and needs dialog-aware dispatch.
            await ctx.call("window.screen.click", [STAR], { dialog: true });
            const editTitle = await ctx.waitFor(
                (activeContext) => dialogProperty(activeContext, "title"),
                (value) => value === EDIT_BOOKMARK_TITLE,
            );
            ctx.expect(editTitle).toBe(EDIT_BOOKMARK_TITLE);
            ctx.expect(await dialogProperty(ctx, "linkTitle")).toBe(bookmarkTitle);
            ctx.expect(await dialogProperty(ctx, "href")).toBe(bookmarkUrl);
            // The modal dialog is open, so no page activation here (a stand-in call would meet its attention).
            // ctx.call is required because the edit dialog is open and the app stand-in cannot pass dialog-aware options.
            await ctx.call("window.screen.type", ['[data-name="edit-link-title"]', editedTitle], { dialog: true });
            await saveBookmarkDialog(ctx);

            const savedBookmarks = await readBookmarks(ctx, bookmarkFile, (data) => data.links?.length === 1 && data.links[0].title === editedTitle);
            ctx.expect(savedBookmarks.links.length).toBe(1);
            ctx.expect(savedBookmarks.links[0].title).toBe(editedTitle);
            ctx.expect(savedBookmarks.links[0].href).toBe(bookmarkUrl);

            await page.editor.navigateAndWait(fixturePage(ctx, "profiles", "bookmark-default.html"));
            const drawer = await openBookmarksDrawer(ctx, page, editedTitle);
            ctx.expect(drawer).toContain(editedTitle);
            await activatePage(ctx, page.id);
            // Double-click the link list's row. The title also shows in the drawer's category tree, where a
            // single click already opens the link, so a double-click there opens it twice.
            await ctx.app.window.screen.click('[data-name="bookmarks-drawer-root"] [data-name="link-row"]', { clickCount: 2 });

            const tabs = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.tabs,
                (items) => items.length === 2 && items.some((item) => item.url === bookmarkUrl),
            );
            ctx.expect(tabs.length).toBe(2);
            ctx.expect(tabs.some((item) => item.url === bookmarkUrl)).toBe(true);
            // The drawer stays open after a bookmark opens (the link editor's embedded open path); no
            // contract says otherwise, so the test does not check it.
            const bookmarkTab = tabs.find((item) => item.url === bookmarkUrl);
            await page.editor.switchTab(bookmarkTab.id);
            await page.editor.navigateAndWait(fixturePage(ctx, "profiles", "bookmark-default.html"));
            await openBookmarksDrawer(ctx, page, editedTitle);
            await activatePage(ctx, page.id);
            // ctx.call is required because a right-click opens a popup menu and needs dialog-aware dispatch.
            // Right-click the link row in the list (the category panel shows the title too, with a different menu).
            await ctx.call("window.screen.click", ['[data-name="link-row-wrapper"]', { button: "right" }], { dialog: true });
            // ctx.call is required because popup-menu reads need dialog-aware dispatch that the app stand-in cannot express.
            const menuItems = await ctx.call("menus[0].items", [], { dialog: true });
            ctx.expect(menuItems.some((item) => item.id === "link-delete" && item.enabled)).toBe(true);
            // ctx.call is required because popup-menu actions need dialog-aware dispatch that the app stand-in cannot express.
            await ctx.call("menus[0].click", ["link-delete"], { dialog: true });
            const deleteTitle = await ctx.waitFor(
                (activeContext) => dialogProperty(activeContext, "title"),
                (value) => value === DELETE_LINK_TITLE,
            );
            ctx.expect(deleteTitle).toBe(DELETE_LINK_TITLE);
            // ctx.call is required because dialog actions need dialog-aware dispatch that the app stand-in cannot express.
            await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
            const afterRemoval = await readBookmarks(ctx, bookmarkFile, (data) => data.links?.length === 0);
            ctx.expect(afterRemoval.links).toEqual([]);
            await activatePage(ctx, page.id);
            const drawerAfterRemoval = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(
                    // Inactive pages stay mounted; read the drawer of the visible (active) page only. innerText
                    // skips the recycled rows a virtualized list keeps attached but hidden.
                    "() => [...document.querySelectorAll('[data-name=bookmarks-drawer-root]')].find((element) => element.offsetParent)?.innerText ?? ''",
                ),
                (text) => !String(text).includes(editedTitle),
            );
            ctx.expect(String(drawerAfterRemoval).includes(editedTitle)).toBe(false);
        } finally {
            await closePendingMenu(ctx);
            await cancelPendingDialog(ctx);
            await closeBrowserPage(ctx, page);
            await restoreSetting(ctx, "browser-default-bookmarks-file", originalBookmarkFile);
        }
    }),

    test("bookmarks are stored separately for the default and named profiles", async (ctx) => {
        const originalProfiles = await ctx.app.settings.get("browser-profiles");
        const originalDefaultProfile = await ctx.app.settings.get("browser-default-profile");
        const originalBookmarkFile = await ctx.app.settings.get("browser-default-bookmarks-file");
        const profileName = uniqueProfileName(originalProfiles);
        const defaultBookmarkFile = ctx.fixture("us-2080-default-bookmarks.link.json");
        const namedBookmarkFile = ctx.fixture("us-2080-named-bookmarks.link.json");
        const defaultTitle = "US-2080 Default Bookmark";
        const namedTitle = "US-2080 Named Bookmark";
        let defaultPage;
        let namedPage;
        try {
            await resetBookmarksFile(ctx, defaultBookmarkFile);
            await resetBookmarksFile(ctx, namedBookmarkFile);
            await ctx.app.settings.set("browser-profiles", [
                ...originalProfiles,
                { name: profileName, color: "Dodger Blue", bookmarksFile: namedBookmarkFile },
            ]);
            await ctx.app.settings.set("browser-default-profile", "");
            await ctx.app.settings.set("browser-default-bookmarks-file", defaultBookmarkFile);

            defaultPage = await openBrowserPage(ctx, fixturePage(ctx, "profiles", "bookmark-default.html"));
            await defaultPage.editor.waitFor({ selector: "#ready" });
            namedPage = await openBrowserPage(ctx, fixturePage(ctx, "profiles", "bookmark-named.html"), { profile: profileName });
            await namedPage.editor.waitFor({ selector: "#ready" });

            await openBookmark(ctx, defaultPage, defaultTitle, fixturePage(ctx, "profiles", "bookmark-default.html"));
            await openBookmark(ctx, namedPage, namedTitle, fixturePage(ctx, "profiles", "bookmark-named.html"));

            const defaultData = await readBookmarks(ctx, defaultBookmarkFile, (data) => data.links?.length === 1);
            const namedData = await readBookmarks(ctx, namedBookmarkFile, (data) => data.links?.length === 1);
            ctx.expect(defaultData.links[0].title).toBe(defaultTitle);
            ctx.expect(namedData.links[0].title).toBe(namedTitle);

            const defaultDrawer = await openBookmarksDrawer(ctx, defaultPage, defaultTitle);
            ctx.expect(defaultDrawer).toContain(defaultTitle);
            ctx.expect(defaultDrawer.includes(namedTitle)).toBe(false);
            const namedDrawer = await openBookmarksDrawer(ctx, namedPage, namedTitle);
            ctx.expect(namedDrawer).toContain(namedTitle);
            ctx.expect(namedDrawer.includes(defaultTitle)).toBe(false);
        } finally {
            await cancelPendingDialog(ctx);
            await closeBrowserPage(ctx, namedPage);
            await closeBrowserPage(ctx, defaultPage);
            await restoreSetting(ctx, "browser-default-bookmarks-file", originalBookmarkFile);
            await restoreSetting(ctx, "browser-default-profile", originalDefaultProfile);
            await restoreSetting(ctx, "browser-profiles", originalProfiles);
        }
    }),
];
