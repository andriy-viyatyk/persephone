import { test } from "../../../lib/context.mjs";
import { closeLinksPage, collectionContent, openLinksPage, reopenLinksPage, screenSnapshot } from "./helpers.mjs";

export default [
    test("Link editor opens a collection and exposes link, category, and tag snapshots", async (ctx) => {
        let page;
        try {
            page = await openLinksPage(ctx, "us-2051/snapshots");
            const editor = page.node.editor;
            ctx.expect(await editor.id).toBe("link-view");
            const links = await editor.links;
            ctx.expect(links.map(({ id, url, title, category, tags }) => ({ id, url, title, category, tags }))).toEqual([
                { id: "docs", url: "https://example.com/docs", title: "Documentation", category: "Reference", tags: ["guide", "web"] },
                { id: "tools", url: "https://tools.example.net/", title: "Developer Tools", category: "Reference/Tools", tags: ["cli"] },
                { id: "news", url: "https://news.example.org/", title: "News", category: "Reading", tags: ["web"] },
            ]);
            ctx.expect(await editor.categories).toEqual(["Reference", "Reference/Tools", "Reading"]);
            ctx.expect(await editor.tags).toEqual(["guide", "web", "cli"]);
            ctx.expect(await editor.linksCount).toBe(3);
        } finally {
            await closeLinksPage(ctx, page);
        }
    }),

    test("Link editor facade mutations update snapshots and save the collection", async (ctx) => {
        let page;
        try {
            page = await openLinksPage(ctx, "us-2051/mutations");
            const editor = page.node.editor;
            await editor.addLink("https://example.org/new", "New Link", "Added");
            const added = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.links, (links) => links.some((link) => link.title === "New Link"));
            const newLink = added.find((link) => link.title === "New Link");
            ctx.expect(newLink.url).toBe("https://example.org/new");
            ctx.expect(newLink.category).toBe("Added");
            await editor.updateLink(newLink.id, { title: "Updated Link", category: "Updated", url: "https://updated.example.org/" });
            const updated = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.links, (links) => links.some((link) => link.id === newLink.id && link.title === "Updated Link"));
            ctx.expect(updated.find((link) => link.id === newLink.id).url).toBe("https://updated.example.org/");

            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (current) => current === "monaco");
            await ctx.app.pages[page.id].editor.saveFile();
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false);
            const savedContent = JSON.parse(await ctx.callText("fs.read", [page.filePath]));
            const savedLink = savedContent.links.find((link) => link.id === newLink.id);
            ctx.expect(savedLink.title).toBe("Updated Link");
            ctx.expect(savedLink.href).toBe("https://updated.example.org/");

            await ctx.app.pages[page.id].editorSwitches.switchTo("link-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (current) => current === "link-view");
            await editor.deleteLink(newLink.id);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.links, (links) => !links.some((link) => link.id === newLink.id))).toEqual([
                { id: "docs", url: "https://example.com/docs", title: "Documentation", category: "Reference", tags: ["guide", "web"], pinned: false, isDirectory: false },
                { id: "tools", url: "https://tools.example.net/", title: "Developer Tools", category: "Reference/Tools", tags: ["cli"], pinned: false, isDirectory: false },
                { id: "news", url: "https://news.example.org/", title: "News", category: "Reading", tags: ["web"], pinned: false, isDirectory: false },
            ]);
            await ctx.waitFor(
                async (activeContext) => JSON.parse(await activeContext.callText(`pages[${JSON.stringify(page.id)}].content`)),
                (saved) => saved.links.length === 3 && saved.links.every((link) => link.id !== newLink.id),
            );
            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (current) => current === "monaco");
            await ctx.app.pages[page.id].editor.saveFile();
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false);
            const diskContent = JSON.parse(await ctx.callText("fs.read", [page.filePath]));
            ctx.expect(diskContent.links.map((link) => link.id)).toEqual(["docs", "tools", "news"]);
            ctx.expect(diskContent.links[0].title).toBe("Documentation");
        } finally {
            await closeLinksPage(ctx, page);
        }
    }),

    test("JSON with the link-editor marker offers the Links editor switch", async (ctx) => {
        let page;
        const markedContent = JSON.stringify({
            type: "link-editor",
            links: [{ id: "marked", title: "Marked Link", href: "https://marked.example/", category: "", tags: [] }],
            state: {},
        }, null, 2) + "\n";
        try {
            page = await openLinksPage(ctx, "us-2051/switch", "marked.json", markedContent);
            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
            const options = await ctx.app.pages[page.id].editorSwitches.options;
            ctx.expect(options.map((option) => option.id)).toContain("link-view");
        } finally {
            await closeLinksPage(ctx, page);
        }
    }),

    test("Link editor filters the visible collection through sidebar panels", async (ctx) => {
        let page;
        try {
            page = await openLinksPage(ctx, "us-2051/filters");
            let snapshot = await screenSnapshot(ctx);
            ctx.expect(snapshot).toContain("Documentation");
            ctx.expect(snapshot).toContain("Developer Tools");
            ctx.expect(snapshot).toContain("News");

            await ctx.app.window.screen.click("text=Reading");
            snapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes("News") && !value.includes("Documentation"));
            ctx.expect(snapshot).toContain("News");
            ctx.expect(snapshot.includes("Documentation")).toBe(false);

            await ctx.app.pages[page.id].panels.expand("link-tags");
            await ctx.app.window.screen.click('text="cli"');
            snapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes("Developer Tools") && !value.includes("News"));
            ctx.expect(snapshot).toContain("Developer Tools");
            ctx.expect(snapshot.includes("News")).toBe(false);

            await ctx.app.pages[page.id].panels.expand("link-hostnames");
            const hostnameSnapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes('generic "example.com 1"'));
            const hostnameRow = hostnameSnapshot.match(/generic "example\.com 1" \[cursor=pointer\] \[ref=(e\d+)\]/);
            ctx.expect(hostnameRow).toBeTruthy();
            await ctx.app.window.screen.click({ ref: hostnameRow[1] });
            snapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes("Documentation") && !value.includes("Developer Tools"));
            ctx.expect(snapshot).toContain("Documentation");
            ctx.expect(snapshot.includes("Developer Tools")).toBe(false);
        } finally {
            await closeLinksPage(ctx, page);
        }
    }),

    test("Link editor list and tile choices are remembered for collection filters", async (ctx) => {
        let page;
        try {
            page = await openLinksPage(ctx, "us-2051/views");
            await ctx.app.window.screen.click('text="Reference"');
            await ctx.app.window.screen.click('[data-name="link-editor-view-mode"]');
            await ctx.app.window.screen.click('text="Landscape"');
            let snapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes('button "Landscape"'));
            ctx.expect(snapshot).toContain('button "Landscape"');

            await ctx.app.window.screen.click("text=Reading");
            await ctx.app.window.screen.click('[data-name="link-editor-view-mode"]');
            await ctx.app.window.screen.click('text="List"', { nth: 1 });
            snapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes('button "List"'));
            ctx.expect(snapshot).toContain('button "List"');

            await ctx.app.window.screen.click("text=Reference");
            snapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes("Landscape"));
            ctx.expect(snapshot).toContain("Landscape");

            await closeLinksPage(ctx, page);
            page = await reopenLinksPage(ctx, page.filePath);
            await ctx.app.window.screen.click('text="Reference"');
            snapshot = await ctx.waitFor(screenSnapshot, (value) => value.includes('button "Landscape"'));
            ctx.expect(snapshot).toContain('button "Landscape"');
            const reopenedContent = JSON.parse(await ctx.callText(`pages[${JSON.stringify(page.id)}].content`));
            ctx.expect(reopenedContent.state.categoryViewMode.Reference).toBe("tiles-landscape");
            ctx.expect(reopenedContent.links).toEqual(JSON.parse(collectionContent).links);
        } finally {
            await closeLinksPage(ctx, page);
        }
    }),
];
