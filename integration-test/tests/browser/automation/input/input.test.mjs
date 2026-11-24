import { test } from "../../../../lib/context.mjs";
import { closeBrowserPage, fixturePage, openBrowserPage } from "../../helpers.mjs";

async function openInputPage(ctx, file = "input-controls.html") {
    return openBrowserPage(ctx, fixturePage(ctx, "automation", file));
}

async function openHoverPage(ctx) {
    return openBrowserPage(ctx, fixturePage(ctx, "automation", "input-hover.html"));
}

async function captureError(operation) {
    try {
        await operation();
        return undefined;
    } catch (error) {
        return error;
    }
}

function refForLine(snapshot, accessibleName) {
    const line = snapshot.split("\n").find((item) => item.includes(accessibleName) && item.includes("[ref="));
    const match = line?.match(/\[ref=([^\]]+)\]/);
    if (!match) throw new Error(`No snapshot ref found for ${accessibleName}.`);
    return match[1];
}

export default [
    test("snapshot returns interactive refs and shortens bounded output", async (ctx) => {
        const page = await openInputPage(ctx, "input-many.html");
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#snapshot-root" });
            const nodeLimited = await editor.snapshot({ interactive: true, maxNodes: 3 });
            const charLimited = await editor.snapshot({ interactive: true, maxChars: 220 });
            ctx.expect(nodeLimited).toContain("[ref=");
            ctx.expect(nodeLimited).toContain("# Shortened");
            ctx.expect(charLimited).toContain("[ref=");
            ctx.expect(charLimited).toContain("# Shortened");

            const scopedRef = refForLine(await editor.snapshot({ interactive: true }), "Snapshot scoped section");
            const scoped = await editor.snapshot({ root: { ref: scopedRef }, interactive: true });
            ctx.expect(scoped).toContain("Inside scoped snapshot");
            ctx.expect(scoped.includes("Outside scoped snapshot")).toBe(false);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("actions accept snapshot refs, CSS selectors, and text locators", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#ref-action" });
            const snapshot = await editor.snapshot({ interactive: true });
            const ref = refForLine(snapshot, "Snapshot ref action");
            await editor.click({ ref });
            await editor.click("#css-action");
            await editor.click('text="Exact action"');
            ctx.expect(await editor.evaluate("() => window.results.actionCounts")).toEqual({ ref: 1, css: 1, text: 1 });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("strict actions reject ambiguous visible matches and nth selects one", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: ".duplicate" });
            const error = await captureError(() => editor.click(".duplicate"));
            ctx.expect(error?.message).toContain("Ambiguous selector");
            await editor.click(".duplicate", { nth: 1 });
            ctx.expect(await editor.evaluate("() => window.results.duplicateCounts")).toEqual([0, 1]);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("actionability rejects hidden, covered, and disabled targets; force bypasses checks", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#covered" });
            const hiddenError = await captureError(() => editor.click("#hidden"));
            const coveredError = await captureError(() => editor.click("#covered"));
            const disabledError = await captureError(() => editor.click("#disabled"));
            ctx.expect(hiddenError?.message).toContain("not visible");
            ctx.expect(coveredError?.message).toContain("does not receive pointer events");
            ctx.expect(disabledError?.message).toContain("disabled");
            await editor.click("#covered", { force: true });
            ctx.expect(await editor.evaluate("() => window.results.coverClicks")).toBe(1);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("click and hover deliver browser pointer input to page listeners", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#click-action" });
            await editor.click("#click-action");
            await editor.hover("#hover-action");
            ctx.expect(await editor.evaluate("() => window.results.clicks")).toBe(1);
            ctx.expect(await editor.evaluate("() => window.results.pointerEvents.includes('pointerover:hover-action') && window.results.pointerEvents.includes('pointerenter:hover-action')")).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("hover applies CSS pseudo state and click reveals hidden targets once", async (ctx) => {
        const page = await openHoverPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#hover-row" });
            await editor.hover("#hover-row");
            ctx.expect(await editor.evaluate("() => document.querySelector('#hover-row').matches(':hover') && getComputedStyle(document.querySelector('#menu-after-hover')).visibility === 'visible'")).toBe(true);
            await editor.click("#menu-after-hover");

            await editor.click("#menu-auto");
            ctx.expect(await editor.evaluate("() => window.results")).toEqual(["hover", "auto"]);

            await editor.hover("#reset"); // move the native pointer off the row first
            const hiddenError = await captureError(() => editor.click("#menu-auto", { hoverFirst: false, timeout: 100 }));
            ctx.expect(hiddenError?.message).toContain("Timed out after 100 ms: Element is not visible. If it appears on hover, hover its container first with hover().");

            await editor.hover("#click-row");
            await editor.snapshot({ interactive: true }); // DOM reads may acquire fresh node IDs.
            await editor.click("#reset");
            ctx.expect(await editor.evaluate("() => getComputedStyle(document.querySelector('#menu-auto')).visibility")).toBe("hidden");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("type replaces text, supports slowly and submits", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#replace-input" });
            await editor.type("#replace-input", "fresh value");
            await editor.type("#slow-input", "slow", { slowly: true });
            await editor.type("#submit-input", "send this", { submit: true });
            ctx.expect(await editor.getValue("#replace-input")).toBe("fresh value");
            ctx.expect(await editor.getValue("#slow-input")).toBe("slow");
            ctx.expect(await editor.getValue("#submit-input")).toBe("send this");
            ctx.expect(await editor.getText("#submit-result")).toBe("submitted:send this");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("type replaces contenteditable content", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#editable" });
            await editor.type("#editable", "replacement");
            ctx.expect(await editor.evaluate("() => document.querySelector('#editable').textContent")).toBe("replacement");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("clear removes editable text", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#replace-input" });
            await editor.clear("#replace-input");
            ctx.expect(await editor.getValue("#replace-input")).toBe("");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("select chooses one or several native options without a pointer hit-test", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#single-select" });
            await editor.select("#single-select", "green");
            await editor.select("#multi-select", ["red", "blue"]);
            ctx.expect(await editor.getValue("#single-select")).toBe("green");
            ctx.expect(await editor.evaluate("() => [...document.querySelector('#multi-select').selectedOptions].map((option) => option.value)")).toEqual(["red", "blue"]);
            ctx.expect(await editor.evaluate("() => window.results.selectChanges")).toEqual(["single:green", "multi:red,blue"]);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("label locators match associated labels without nested control text", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#label-show-select" });

            ctx.expect(await editor.count('label="Show:"s')).toBe(1);
            ctx.expect(await editor.getAttribute('label="Show:"s', "id")).toBe("label-show-select");
            ctx.expect(await editor.count("label=Show")).toBe(1);
            ctx.expect(await editor.count("label=All")).toBe(0);
            await editor.select('label="Show:"s', "all");
            ctx.expect(await editor.getValue("#label-show-select")).toBe("all");

            ctx.expect(await editor.getAttribute('label="Search"s', "id")).toBe("label-wrapped-input");
            ctx.expect(await editor.count('label="wrapped input content"s')).toBe(0);
            ctx.expect(await editor.getAttribute('label="Notes"s', "id")).toBe("label-textarea");
            ctx.expect(await editor.count('label="textarea child content"s')).toBe(0);
            ctx.expect(await editor.getAttribute('label="Inline nested label"s', "id")).toBe("label-inline-input");
            ctx.expect(await editor.getAttribute('label="Joined inlinetext"s', "id")).toBe("label-adjacent-input");
            ctx.expect(await editor.getAttribute('label="Line Break"s', "id")).toBe("label-break-input");
            ctx.expect(await editor.getAttribute('label="Block Boundary"s', "id")).toBe("label-block-input");
            ctx.expect(await editor.getAttribute('label="Visible visible override text"s', "id")).toBe("label-hidden-input");
            ctx.expect(await editor.count("label=hidden attribute text")).toBe(0);
            ctx.expect(await editor.count("label=display hidden text")).toBe(0);
            ctx.expect(await editor.count("label=visibility hidden text")).toBe(0);
            ctx.expect(await editor.getAttribute('label=visible override text', "id")).toBe("label-hidden-input");
            ctx.expect(await editor.count('label="other control text"s')).toBe(0);
            ctx.expect(await editor.getAttribute('label="Primary"s', "id")).toBe("label-other-control-input");

            ctx.expect(await editor.getAttribute('label="Separate label"s', "id")).toBe("label-separate-input");
            ctx.expect(await editor.getAttribute('label="First label"s', "id")).toBe("label-multiple-input");
            ctx.expect(await editor.getAttribute('label="Second label"s', "id")).toBe("label-multiple-input");
            ctx.expect(await editor.getAttribute('label=/Second label/', "id")).toBe("label-multiple-input");
            ctx.expect(await editor.getAttribute({ label: "Second label", exact: true }, "id")).toBe("label-multiple-input");
            ctx.expect(await editor.getAttribute('label="ARIA label source"s', "id")).toBe("label-aria-input");
            ctx.expect(await editor.getAttribute('label="ARIA labelledby source"s', "id")).toBe("label-aria-labelledby-input");
            ctx.expect(await editor.getAttribute('label="Ancestor reference source"s', "id")).toBe("label-aria-ancestor-input");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("check and uncheck change checkbox state, including through an associated label", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#visible-check" });
            await editor.check("#visible-check");
            ctx.expect(await editor.evaluate("() => document.querySelector('#visible-check').checked")).toBe(true);
            await editor.uncheck("#visible-check");
            ctx.expect(await editor.evaluate("() => document.querySelector('#visible-check').checked")).toBe(false);
            await editor.check("#hidden-check");
            ctx.expect(await editor.evaluate("() => document.querySelector('#hidden-check').checked")).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("fillForm applies named fields in order", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#form-first" });
            await editor.fillForm([
                { name: "First", locator: "#form-first", action: "type", value: "one" },
                { name: "Choice", locator: "#single-select", action: "select", value: "green" },
                { name: "Opt in", locator: "#form-check", action: "check" },
            ]);
            ctx.expect(await editor.getValue("#form-first")).toBe("one");
            ctx.expect(await editor.getValue("#single-select")).toBe("green");
            ctx.expect(await editor.evaluate("() => document.querySelector('#form-check').checked")).toBe(true);
            ctx.expect(await editor.evaluate("() => window.results.formEvents")).toEqual(["first", "choice", "opt-in"]);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("fillForm names the first failing field and keeps earlier changes", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#form-first" });
            const error = await captureError(() => editor.fillForm([
                { name: "First", locator: "#form-first", action: "type", value: "kept" },
                { name: "Missing field", locator: "#not-present", action: "type", value: "ignored" },
                { name: "Later", locator: "#form-later", action: "type", value: "not applied" },
            ]));
            ctx.expect(error?.message).toContain('fillForm field "Missing field"');
            ctx.expect(await editor.getValue("#form-first")).toBe("kept");
            ctx.expect(await editor.getValue("#form-later")).toBe("later seed");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("pressKey, keyDown, and keyUp support a held-key sequence", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#key-input" });
            await editor.pressKey("a", { target: "#key-input" });
            await editor.keyDown("Shift");
            await editor.pressKey("b");
            await editor.keyUp("Shift");
            await editor.pressKey("Enter");
            const keyState = await editor.evaluate("() => ({ firstTypedA: window.results.keyInputValues.includes('a'), bWithShift: window.results.keydowns.some((event) => event.key.toLowerCase() === 'b' && event.shiftKey), submitted: window.results.keySubmit })");
            ctx.expect(keyState.firstTypedA).toBe(true);
            ctx.expect(keyState.bWithShift).toBe(true);
            ctx.expect(keyState.submitted).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("pressKey F5 reloads the browser guest", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#key-input" });
            await editor.evaluate("() => { window.reloadMarker = 'before reload'; }");
            const navigation = editor.waitForNavigation();
            await editor.pressKey("F5");
            await navigation;
            ctx.expect(await editor.evaluate("() => window.reloadMarker ?? null")).toBe(null);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("drag transfers the fixture marker to its drop target", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#drag-source" });
            await editor.drag("#drag-source", "#drop-target");
            ctx.expect(await editor.getText("#drop-result")).toBe("fixture-drag-marker");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("setInputFiles assigns a test-owned fixture file", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#file-input" });
            const path = ctx.fixture("us-2086/upload.txt");
            const content = "fixture upload content\n";
            await ctx.app.fs.write(path, content);
            await editor.setInputFiles("#file-input", [path]);
            ctx.expect(await editor.evaluate("() => { const file = document.querySelector('#file-input').files[0]; return { name: file.name, size: file.size }; }")).toEqual({ name: "upload.txt", size: content.length });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("synthetic input uses the compatibility event path", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#synthetic-action" });
            await editor.click("#synthetic-action", { synthetic: true });
            await editor.type("#synthetic-input", "legacy", { synthetic: true });
            ctx.expect(await editor.evaluate("() => ({ clicks: window.results.syntheticClicks, value: document.querySelector('#synthetic-input').value, inputs: window.results.syntheticInputs })")).toEqual({ clicks: 1, value: "legacy", inputs: 1 });
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("queries return text, value, attribute, HTML, and existence results", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#query-text" });
            ctx.expect(await editor.getText("#query-text")).toBe("query text");
            ctx.expect(await editor.getValue("#query-input")).toBe("query value");
            ctx.expect(await editor.getAttribute("#query-text", "data-state")).toBe("ready");
            ctx.expect(await editor.getHtml("#query-html")).toBe("<strong>inside</strong>");
            ctx.expect(await editor.exists("#query-text")).toBe(true);
            ctx.expect(await editor.exists("#absent")).toBe(false);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("an armed page clipboard copies, cuts and pastes within the page", async (ctx) => {
        // The OS clipboard is not read here: the suite must not touch it. Isolation shows as the page
        // pasting its own copy and the Clipboard API reading back only page-written text.
        const page = await openInputPage(ctx, "input-clipboard.html");
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#paste-target" });
            await editor.clipboard.arm();

            await editor.evaluate("() => window.selectContents('plain')");
            await editor.pressKey("Control+c");
            ctx.expect(await editor.clipboard.readText()).toBe("plain selection");

            await editor.evaluate("() => window.selectContents('custom')");
            await editor.pressKey("Control+c");
            ctx.expect(await editor.clipboard.readText()).toBe("custom payload");
            await editor.click("#paste-target");
            await editor.pressKey("Control+v");
            ctx.expect(await editor.getValue("#paste-target")).toBe("custom payload");

            await editor.evaluate("() => { const input = document.getElementById('cut-source'); input.focus(); input.select(); }");
            await editor.pressKey("Control+x");
            ctx.expect(await editor.getValue("#cut-source")).toBe("");
            ctx.expect(await editor.clipboard.readText()).toBe("cut me");

            await editor.click("#api-write");
            await ctx.waitFor(() => editor.clipboard.readText(), (text) => text === "api payload");
            await editor.click("#api-read");
            await ctx.waitFor(() => editor.evaluate("() => window.results.apiRead"), (text) => text === "api payload");

            await editor.clipboard.writeText("staged text");
            await editor.evaluate("() => { const input = document.getElementById('paste-target'); input.value = ''; }");
            await editor.click("#paste-target");
            await editor.pressKey("Control+v");
            ctx.expect(await editor.getValue("#paste-target")).toBe("staged text");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("evaluate invokes a string function with JSON-safe arguments", async (ctx) => {
        const page = await openInputPage(ctx);
        try {
            const editor = ctx.app.pages[page.id].editor;
            await editor.waitFor({ selector: "#query-text" });
            ctx.expect(await editor.evaluate("(prefix, count) => prefix + ':' + count", { args: ["item", 3] })).toBe("item:3");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),
];
