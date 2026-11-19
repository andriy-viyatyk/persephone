import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage, openBrowserPage } from "../helpers.mjs";

const HOST = "127.0.0.1";
const FIXTURE = "/browser/site-extensions/";
const HUB_ID = "tools-hub-page";

function uniqueId(label) {
    return `us2089-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function browser(ctx, pageId) {
    return ctx.handle(ctx.app.pages[pageId].editor);
}

async function begin(ctx, label) {
    const folder = ctx.fixture(`us-2089/${label}/site-extensions`);
    try { await ctx.app.fs.removeDir(folder, true); } catch { /* The fixture folder may not exist yet. */ }
    const previousPath = await ctx.app.settings.get("site-extensions.path");
    await ctx.app.settings.set("site-extensions.path", folder);
    return { folder, previousPath, ids: new Set(), removed: new Set() };
}

async function create(ctx, state, label, hosts = [HOST]) {
    const id = uniqueId(label);
    const result = await ctx.app.siteExtensions.create(id, {
        name: `US-2089 ${label}`,
        hosts,
        fetchHosts: [],
        description: "Test-only saved site extension",
    });
    state.ids.add(id);
    return result;
}

async function trust(ctx, pageId) {
    const current = browser(ctx, pageId);
    await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.reload(pageId), (result) => result.status === "waiting-for-user");
    return await current.trustSiteExtension();
}

async function removeWithConfirmation(ctx, id) {
    const result = await ctx.call("siteExtensions.remove", [id], { dialog: true });
    await ctx.waitFor(async (activeContext) => {
        try { return await activeContext.callText("dialogs[0].title", undefined, { dialog: true }); }
        catch { return undefined; }
    }, (title) => title === "Remove site extension");
    ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Delete", "Cancel"]);
    await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
    return result;
}

async function finish(ctx, state) {
    if (!state) return;
    for (const id of state.ids) {
        if (state.removed.has(id)) continue;
        try {
            const pending = await ctx.call("siteExtensions.remove", [id], { dialog: true });
            if (pending?.pending) {
                await ctx.waitFor(async (activeContext) => {
                    try { return await activeContext.callText("dialogs[0].title", undefined, { dialog: true }); }
                    catch { return undefined; }
                }, (title) => title === "Remove site extension");
                await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
            }
        } catch (error) {
            ctx.log(`US-2089 cleanup could not remove ${id}: ${String(error)}`);
        }
    }
    try { await ctx.app.fs.removeDir(state.folder, true); }
    catch (error) { ctx.log(`US-2089 cleanup could not remove fixture extension folder: ${String(error)}`); }
    try { await ctx.app.settings.set("site-extensions.path", state.previousPath); }
    catch (error) { ctx.log(`US-2089 cleanup could not restore site-extensions.path: ${String(error)}`); }
}

async function openFixture(ctx, file) {
    return openBrowserPage(ctx, ctx.httpsUrl(`${FIXTURE}${file}`));
}

async function writeScript(ctx, result, source) {
    await ctx.app.fs.write(result.scriptPath, source);
}

async function close(ctx, ...pages) {
    for (const page of pages) await closeBrowserPage(ctx, page);
}

async function closePageIds(ctx, ids) {
    for (const id of ids) {
        try { await ctx.app.pages.closePage(id); }
        catch (error) { ctx.log(`US-2089 cleanup could not close opened page ${id}: ${String(error)}`); }
    }
}

export default [
    test("create scaffolds a saved extension with its paths and trust requirement", async (ctx) => {
        const state = await begin(ctx, "create");
        try {
            const root = await ctx.app.siteExtensions.folder;
            const result = await create(ctx, state, "create");
            ctx.expect(result.id).toBeTruthy();
            ctx.expect(result.folder.startsWith(root)).toBe(true);
            ctx.expect(result.manifestPath.startsWith(result.folder)).toBe(true);
            ctx.expect(result.scriptPath.startsWith(result.folder)).toBe(true);
            ctx.expect(result.requiresTrust).toBe(true);
            ctx.expect(result.message).toContain(HOST);
            ctx.expect(result.message.toLowerCase()).toContain("trust");
            const manifest = JSON.parse(await ctx.callText("fs.read", [result.manifestPath]));
            ctx.expect(manifest.hosts).toEqual([HOST]);
            ctx.expect(manifest.fetchHosts).toEqual([]);
            ctx.expect(manifest.script).toBe("extension.js");
            ctx.expect(await ctx.callText("fs.read", [result.scriptPath])).toContain("runtime.expose");
            let rejected = false;
            try { await ctx.app.siteExtensions.create(uniqueId("invalid-fetch"), { name: "Invalid", hosts: ["us2089.example"], fetchHosts: [HOST] }); }
            catch { rejected = true; }
            ctx.expect(rejected).toBe(true);
        } finally { await finish(ctx, state); }
    }),

    test("matching HTTPS pages show extension consent and the Trust bar button grants it", async (ctx) => {
        const state = await begin(ctx, "trust-bar");
        let page;
        try {
            const extension = await create(ctx, state, "trust-bar");
            page = await openFixture(ctx, "trust.html");
            const editor = browser(ctx, page.id);
            const prompt = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteExtensionTrustPrompt, (value) => value?.id === extension.id);
            ctx.expect(prompt.status).toBe("waiting-for-user");
            ctx.expect(prompt.name).toBe("US-2089 trust-bar");
            ctx.expect(prompt.host).toBe(HOST);
            ctx.expect(prompt.otherHosts).toEqual([]);
            ctx.expect(prompt.fetchHosts).toEqual([]);
            ctx.expect(prompt.note).toContain("trustSiteExtension");
            await activatePage(ctx, page.id);
            await ctx.waitFor((activeContext) => activeContext.app.window.screen.evaluate('() => Boolean(document.querySelector("[data-name=site-extension-trust]")?.getClientRects().length)'), Boolean);
            await ctx.app.window.screen.click('[data-name="site-extension-trust"]');
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteExtensionTrustPrompt, (value) => !value);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => items.find((item) => item.id === extension.id)?.trustState === "trusted")).toBeTruthy();
            const modelStatus = await ctx.waitFor(async (activeContext) => {
                try { return await activeContext.app.pages[page.id].editor.app.status; }
                catch { return undefined; }
            }, (status) => status === "starter");
            ctx.expect(modelStatus).toBe("starter");
            ctx.expect(await editor.siteActions).toEqual([]);
        } finally { await close(ctx, page); await finish(ctx, state); }
    }),

    test("trust API grants the current prompt and reports no prompt on a second call", async (ctx) => {
        const state = await begin(ctx, "trust-api");
        let page;
        try {
            const extension = await create(ctx, state, "trust-api");
            page = await openFixture(ctx, "trust.html");
            const outcome = await trust(ctx, page.id);
            ctx.expect(outcome).toEqual({ status: "trusted", id: extension.id, hosts: [HOST], fetchHosts: [] });
            ctx.expect(await browser(ctx, page.id).trustSiteExtension()).toEqual({ status: "no-prompt" });
        } finally { await close(ctx, page); await finish(ctx, state); }
    }),

    test("reload reports waiting, injected and registered, no extension, script error, and HTTP not-current", async (ctx) => {
        const state = await begin(ctx, "reload");
        let page;
        let httpPage;
        try {
            const extension = await create(ctx, state, "reload");
            page = await openFixture(ctx, "reload.html");
            const editor = browser(ctx, page.id);
            ctx.expect(await ctx.app.siteExtensions.reload(page.id)).toEqual({ status: "waiting-for-user", registered: false });
            ctx.expect((await editor.trustSiteExtension()).status).toBe("trusted");
            await writeScript(ctx, extension, 'const remote = window.__persephoneSiteRuntime.expose({ status: "ready", aiVision: { kind: "SiteExtension", summary: "Reload probe", members: [{ name: "status", kind: "property", summary: "Status" }], help: "Reload probe model." } }); remote.refresh();');
            const injected = await ctx.app.siteExtensions.reload(page.id);
            ctx.expect(injected.status).toBe("injected");
            const modelStatus = await ctx.waitFor(async (activeContext) => {
                try { return await activeContext.app.pages[page.id].editor.app.status; }
                catch { return undefined; }
            }, (status) => status === "ready");
            ctx.expect(modelStatus).toBe("ready");
            ctx.expect(injected.registered).toBe(true);
            await close(ctx, page); page = undefined;
            const removed = await removeWithConfirmation(ctx, extension.id);
            ctx.expect(removed.pending).toBe(true);
            state.removed.add(extension.id);
            await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => !items.some((item) => item.id === extension.id));
            const noExtensionPage = await openFixture(ctx, "model.html");
            try { ctx.expect(await ctx.app.siteExtensions.reload(noExtensionPage.id)).toEqual({ status: "no-extension", registered: false }); }
            finally { await close(ctx, noExtensionPage); }
            const throwing = await create(ctx, state, "throwing");
            await writeScript(ctx, throwing, 'throw new Error("US-2089 expected extension failure");');
            httpPage = await openBrowserPage(ctx, ctx.httpUrl(`${FIXTURE}throwing.html`));
            ctx.expect(await ctx.app.siteExtensions.reload(httpPage.id)).toEqual({ status: "not-current", registered: false });
            await close(ctx, httpPage); httpPage = undefined;
            await close(ctx, page); page = undefined;
            page = await openFixture(ctx, "throwing.html");
            await trust(ctx, page.id);
            const failure = await ctx.app.siteExtensions.reload(page.id);
            ctx.expect(failure.status).toBe("extension-error");
            ctx.expect(failure.error).toContain("US-2089 expected extension failure");
        } finally { await close(ctx, page, httpPage); await finish(ctx, state); }
    }),

    test("trusted extension page model is reachable and its help describes the model", async (ctx) => {
        const state = await begin(ctx, "model");
        let page;
        try {
            const extension = await create(ctx, state, "model");
            await writeScript(ctx, extension, 'const remote = window.__persephoneSiteRuntime.expose({ status: "model-ready", aiVision: { kind: "SiteExtension", summary: "Model fixture", members: [{ name: "status", kind: "property", summary: "Model status" }], help: "US-2089 model-specific help." } }); remote.refresh();');
            page = await openFixture(ctx, "model.html");
            await trust(ctx, page.id);
            const modelStatus = await ctx.waitFor(async (activeContext) => {
                try { return await activeContext.app.pages[page.id].editor.app.status; }
                catch { return undefined; }
            }, (status) => status === "model-ready");
            ctx.expect(modelStatus).toBe("model-ready");
            const help = await ctx.callText(`pages[${JSON.stringify(page.id)}].editor.app.$help`);
            ctx.expect(help).toContain("US-2089 model-specific help.");
            const facadeHelp = await ctx.callText(`pages[${JSON.stringify(page.id)}].editor.$help`);
            ctx.expect(facadeHelp).toContain("trustSiteExtension");
            ctx.expect(facadeHelp).toContain("runSiteAction");
        } finally { await close(ctx, page); await finish(ctx, state); }
    }),

    test("site actions dispatch message, text, links, and HTTPS URL results", async (ctx) => {
        const state = await begin(ctx, "actions");
        let page;
        const openedIds = new Set();
        try {
            const extension = await create(ctx, state, "actions");
            const fixtureUrl = ctx.httpsUrl(`${FIXTURE}trust.html`);
            await writeScript(ctx, extension, `const runtime = window.__persephoneSiteRuntime;
runtime.setActions([
 { id: "message", label: "Message", run: () => ({ kind: "message", text: "US-2089 action message" }) },
 { id: "text", label: "Text", run: () => ({ kind: "text", title: "US-2089 Action Text", format: "plain", content: "US-2089 text result" }) },
 { id: "links", label: "Links", run: () => ({ kind: "links", title: "US-2089 Links", items: [{ title: "Fixture", url: ${JSON.stringify(fixtureUrl)} }] }) },
 { id: "url", label: "URL", run: () => ({ kind: "url", url: ${JSON.stringify(fixtureUrl)} }) }
]);`);
            page = await openFixture(ctx, "actions.html");
            await trust(ctx, page.id);
            const actions = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteActions, (items) => items.length === 4);
            ctx.expect(actions.map((item) => item.id)).toEqual(["message", "text", "links", "url"]);
            ctx.expect(await browser(ctx, page.id).runSiteAction("message")).toEqual({ status: "message", text: "US-2089 action message" });
            const beforeText = new Set((await ctx.app.pages.all).map((item) => item.id));
            ctx.expect(await browser(ctx, page.id).runSiteAction("text")).toEqual({ status: "opened" });
            const textPage = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (items) => items.find((item) => !beforeText.has(item.id) && item.editor === "monaco"));
            const openedText = textPage.find((item) => !beforeText.has(item.id) && item.editor === "monaco");
            openedIds.add(openedText.id);
            ctx.expect(openedText.title).toContain("US-2089 Action Text");
            const beforeLinks = new Set((await ctx.app.pages.all).map((item) => item.id));
            ctx.expect(await browser(ctx, page.id).runSiteAction("links")).toEqual({ status: "opened" });
            const linksPage = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (items) => items.find((item) => !beforeLinks.has(item.id) && item.editor === "link-view"));
            openedIds.add(linksPage.id);
            // openRawLink routes the URL through the content pipeline. The seed sets link-open-behavior to
            // internal-browser, so it opens in Persephone's browser: a new browser page, or a new inner
            // tab of the active browser page. Accept either, but it must open there.
            const beforeTabIds = new Set((await ctx.app.pages[page.id].editor.tabs).map((tab) => tab.id));
            const beforeUrlPages = new Set((await ctx.app.pages.all).map((item) => item.id));
            ctx.expect(await browser(ctx, page.id).runSiteAction("url")).toEqual({ status: "opened" });
            const opened = await ctx.waitFor(async (activeContext) => {
                const newPage = (await activeContext.app.pages.all).find((item) => !beforeUrlPages.has(item.id));
                if (newPage) return { pageId: newPage.id, editor: newPage.editor, url: newPage.url ?? newPage.title };
                const newTab = (await activeContext.app.pages[page.id].editor.tabs).find((tab) => !beforeTabIds.has(tab.id));
                return newTab ? { url: newTab.url } : null;
            }, (value) => Boolean(value?.url?.includes("site-extensions/trust.html")));
            if (opened.pageId) openedIds.add(opened.pageId);
            ctx.expect(opened.url).toContain("site-extensions/trust.html");
        } finally { await closePageIds(ctx, openedIds); await close(ctx, page); await finish(ctx, state); }
    }),

    test("video choices open a Video Player page for the selected item", async (ctx) => {
        const state = await begin(ctx, "video-choice");
        let page;
        const openedIds = new Set();
        try {
            const extension = await create(ctx, state, "video-choice");
            await writeScript(ctx, extension, 'window.__persephoneSiteRuntime.setActions([{ id: "videos", label: "Videos", run: () => ({ kind: "video", items: [{ label: "First", url: "https://127.0.0.1:17868/browser/site-extensions/trust.html?video=first" }, { label: "Chosen", url: "https://127.0.0.1:17868/browser/site-extensions/trust.html?video=chosen" }] }) }]);');
            page = await openFixture(ctx, "video-choice.html");
            await trust(ctx, page.id);
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteActions, (items) => items.length === 1);
            const outcome = await browser(ctx, page.id).runSiteAction("videos");
            ctx.expect(outcome.status).toBe("choice-required");
            ctx.expect(outcome.choices.map((choice) => choice.label)).toEqual(["First", "Chosen"]);
            const previous = new Set((await ctx.app.pages.all).map((item) => item.id));
            ctx.expect(await browser(ctx, page.id).chooseSiteActionResult(outcome.token, 1)).toEqual({ status: "opened" });
            const videoPage = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (items) => items.some((item) => !previous.has(item.id) && item.editor === "video-view"));
            const opened = videoPage.find((item) => !previous.has(item.id) && item.editor === "video-view");
            openedIds.add(opened.id);
            ctx.expect(opened).toBeTruthy();
            ctx.expect(await ctx.app.pages[opened.id].editor.source).toContain("video=chosen");
        } finally { await closePageIds(ctx, openedIds); await close(ctx, page); await finish(ctx, state); }
    }),

    test("invalid action updates preserve the previous tree and an empty tree clears it", async (ctx) => {
        const state = await begin(ctx, "actions-update");
        let page;
        try {
            const extension = await create(ctx, state, "actions-update");
            await writeScript(ctx, extension, `const runtime = window.__persephoneSiteRuntime;
runtime.setActions([{ id: "valid", label: "Valid", run: () => ({ kind: "message", text: "valid" }) }]);`);
            page = await openFixture(ctx, "actions.html");
            await trust(ctx, page.id);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteActions, (items) => items.some((item) => item.id === "valid"))).toEqual([{ id: "valid", label: "Valid" }]);
            const invalidUpdate = await ctx.app.pages[page.id].editor.evaluate(`(() => {
    try {
        window.__persephoneSiteRuntime.setActions([
            { id: "duplicate", label: "One", run: () => ({ kind: "message", text: "one" }) },
            { id: "duplicate", label: "Two", run: () => ({ kind: "message", text: "two" }) },
        ]);
        return "accepted";
    } catch { return "rejected"; }
})()`);
            ctx.expect(invalidUpdate).toBe("rejected");
            const preserved = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteActions, (items) => items.some((item) => item.id === "valid"));
            ctx.expect(preserved.map((item) => item.id)).toEqual(["valid"]);
            await ctx.app.pages[page.id].editor.evaluate("window.__persephoneSiteRuntime.setActions([])");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteActions, (items) => items.length === 0)).toEqual([]);
        } finally { await close(ctx, page); await finish(ctx, state); }
    }),

    test("listing reports trust state, host changes, and claimed-host conflicts", async (ctx) => {
        const state = await begin(ctx, "listing");
        let page;
        try {
            const first = await create(ctx, state, "listing");
            const initial = await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => items.some((item) => item.id === first.id));
            const entry = initial.find((item) => item.id === first.id);
            ctx.expect(entry.id).toBe(first.id);
            ctx.expect(entry.name).toBe("US-2089 listing");
            ctx.expect(entry.version).toBe("1.0.0");
            ctx.expect(entry.hosts).toEqual([HOST]);
            ctx.expect(entry.fetchHosts).toEqual([]);
            ctx.expect(entry.scriptPath).toBe(first.scriptPath);
            ctx.expect(entry.status).toBe("valid");
            ctx.expect(entry.trustState).toBe("untrusted");
            ctx.expect(entry.hostsChangedSinceTrust).toBe(null);
            page = await openFixture(ctx, "trust.html");
            await trust(ctx, page.id);
            const trusted = await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => items.find((item) => item.id === first.id)?.trustState === "trusted");
            ctx.expect(trusted.find((item) => item.id === first.id).hostsChangedSinceTrust).toBe(false);
            const secondId = uniqueId("conflict");
            const secondFolder = `${state.folder}\\${secondId}`;
            state.ids.add(secondId);
            await ctx.app.fs.write(`${secondFolder}\\manifest.json`, JSON.stringify({ name: "US-2089 conflict", version: "1.0.0", description: "Conflict fixture", hosts: [HOST], fetchHosts: [], script: "extension.js" }));
            await ctx.app.fs.write(`${secondFolder}\\extension.js`, "// conflict-only fixture\\n");
            const conflicts = await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => items.filter((item) => [first.id, secondId].includes(item.id) && item.status === "conflict").length === 2);
            for (const conflict of conflicts.filter((item) => [first.id, secondId].includes(item.id))) {
                ctx.expect(conflict.conflictingHosts).toEqual([HOST]);
            }
        } finally { await close(ctx, page); await finish(ctx, state); }
    }),

    test("manifest host changes require a fresh trust decision and update the prompt", async (ctx) => {
        const state = await begin(ctx, "host-change");
        let page;
        try {
            const extension = await create(ctx, state, "host-change");
            page = await openFixture(ctx, "host-change.html");
            await trust(ctx, page.id);
            const manifest = JSON.parse(await ctx.callText("fs.read", [extension.manifestPath]));
            manifest.hosts.push("site-extension-extra.example");
            await ctx.app.fs.write(extension.manifestPath, JSON.stringify(manifest, null, 2));
            await ctx.app.pages[page.id].editor.reload();
            const prompt = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.siteExtensionTrustPrompt, (value) => value?.otherHosts?.includes("site-extension-extra.example"));
            ctx.expect(prompt.otherHosts).toEqual(["site-extension-extra.example"]);
            const changedManifest = JSON.parse(await ctx.callText("fs.read", [extension.manifestPath]));
            changedManifest.hosts.push("site-extension-third.example");
            await ctx.app.fs.write(extension.manifestPath, JSON.stringify(changedManifest, null, 2));
            ctx.expect(await browser(ctx, page.id).trustSiteExtension()).toEqual({ status: "changed" });
            const refreshed = await ctx.app.pages[page.id].editor.siteExtensionTrustPrompt;
            ctx.expect(refreshed.otherHosts).toEqual(["site-extension-extra.example", "site-extension-third.example"]);
            ctx.expect(await browser(ctx, page.id).trustSiteExtension()).toEqual({ status: "trusted", id: extension.id, hosts: [HOST, "site-extension-extra.example", "site-extension-third.example"], fetchHosts: [] });
        } finally { await close(ctx, page); await finish(ctx, state); }
    }),

    test("Tools hub can disable a trusted extension and reload reports disabled", async (ctx) => {
        const state = await begin(ctx, "disable");
        let page;
        let hubCreated = false;
        try {
            const extension = await create(ctx, state, "disable");
            page = await openFixture(ctx, "trust.html");
            await trust(ctx, page.id);
            await ctx.app.pages.showToolsHubPage({ tab: "editors" });
            await ctx.waitFor((activeContext) => activeContext.app.pages.all, (items) => items.some((item) => item.id === HUB_ID && item.editor === "tools-hub-view"));
            hubCreated = true;
            await ctx.app.pages[HUB_ID].editor.setTab("site-extensions");
            await ctx.waitFor((activeContext) => activeContext.app.pages[HUB_ID].editor.activeTab, (tab) => tab === "site-extensions");
            await activatePage(ctx, HUB_ID);
            await ctx.app.window.screen.click(`[data-name="site-extension-enabled-${extension.id}"]`);
            await ctx.waitFor((activeContext) => activeContext.app.window.screen.evaluate(`() => document.querySelector('[data-name="site-extension-enabled-${extension.id}"]')?.getAttribute("aria-checked")`), (checked) => checked === "false"); // window.screen has no getAttribute (browser pages only)
            await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => items.find((item) => item.id === extension.id)?.trustState === "disabled");
            await activatePage(ctx, page.id);
            await ctx.app.pages[page.id].editor.reload();
            ctx.expect(await ctx.app.siteExtensions.reload(page.id)).toEqual({ status: "disabled", registered: false });
        } finally {
            if (hubCreated) {
                try { await ctx.app.pages.closePage(HUB_ID); } catch (error) { ctx.log(`US-2089 cleanup could not close Tools hub: ${String(error)}`); }
            }
            await close(ctx, page);
            await finish(ctx, state);
        }
    }),

    test("remove confirms deletion and revokes trust", async (ctx) => {
        const state = await begin(ctx, "remove");
        let page;
        try {
            const extension = await create(ctx, state, "remove");
            page = await openFixture(ctx, "trust.html");
            await trust(ctx, page.id);
            const result = await removeWithConfirmation(ctx, extension.id);
            ctx.expect(result.pending).toBe(true);
            state.removed.add(extension.id);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => !items.some((item) => item.id === extension.id))).toBeTruthy();
            ctx.expect(await ctx.app.fs.exists(extension.folder)).toBe(false);
            const recreated = await ctx.app.siteExtensions.create(extension.id, {
                name: "US-2089 remove",
                hosts: [HOST],
                fetchHosts: [],
                description: "Trust revocation probe",
            });
            state.removed.delete(extension.id);
            const recreatedListing = await ctx.waitFor((activeContext) => activeContext.app.siteExtensions.list(), (items) => items.find((item) => item.id === extension.id));
            ctx.expect(recreated.requiresTrust).toBe(true);
            ctx.expect(recreatedListing.find((item) => item.id === extension.id).trustState).toBe("untrusted");
        } finally { await close(ctx, page); await finish(ctx, state); }
    }),
];
