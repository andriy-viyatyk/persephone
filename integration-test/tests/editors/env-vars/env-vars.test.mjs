import { test } from "../../../lib/context.mjs";
import { createStore, openEnvVarsFromSettings, restoreStore, screenSnapshot } from "./helpers.mjs";

export default [
    test("Settings opens the Environment Variables editor and namespace/profile values persist", async (ctx) => {
        let store;
        let page;
        try {
            store = await createStore(ctx, "us-2052/persistence", "vars.env.json");
            page = await openEnvVarsFromSettings(ctx);
            const editor = page.node.editor;
            ctx.expect(await ctx.app.pages[page.id].editor.id).toBe("env-vars-view");
            ctx.expect(await editor.namespaces).toEqual([]);

            ctx.expect(await editor.addNamespace("us-2052-test")).toBe(true);
            ctx.expect(await editor.addProfile("us-2052-test", "integration")).toBe(true);
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.profiles, (profiles) => profiles.includes("integration"));
            await editor.selectProfile("integration");

            const gridSnapshot = await ctx.waitFor(screenSnapshot, (snapshot) => snapshot.includes('button "+ add variable"'));
            ctx.expect(gridSnapshot).toContain('button "+ add variable"');
            await ctx.app.window.screen.click('text="+ add variable"');
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => document.querySelectorAll(\'[data-name="env-vars-grid"] .avg-data-cell\').length'),
                (cellCount) => cellCount === 2,
            );
            await ctx.app.window.screen.click('[data-name="env-vars-grid"] .avg-data-cell[data-col="0"]', { clickCount: 2 });
            await ctx.app.window.screen.type('[data-type="cell-editor"]', "API_TOKEN");
            await ctx.app.window.screen.pressKey("Tab");
            await ctx.app.window.screen.pressKey("Enter");
            await ctx.app.window.screen.type('[data-type="cell-editor"]', "test-secret-value");
            await ctx.app.window.screen.pressKey("Enter");
            const variables = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.variables, (rows) => rows.some((row) => row.name === "API_TOKEN"));
            ctx.expect(variables.find((row) => row.name === "API_TOKEN").value).toBe("test-secret-value");

            const closeResult = await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("pages.closePage", [page.id], { dialog: true });
            if (closeResult?.pending) {
                await ctx.waitFor(
                    (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
                    (title) => title === "Unsaved Changes",
                );
                await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("dialogs[0].click", ["Save"], { dialog: true });
            }
            await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => !pages.some((entry) => entry.id === page.id));
            page = await openEnvVarsFromSettings(ctx);
            const reopenedEditor = page.node.editor;
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.variables, (rows) => rows.some((row) => row.name === "API_TOKEN"))).toEqual([
                { name: "API_TOKEN", value: "test-secret-value" },
            ]);

            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call(`pages[${JSON.stringify(page.id)}].editor.deleteProfile`, ["us-2052-test", "integration"], { dialog: true });
            const profileDialogTitle = await ctx.waitFor(
                (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
                (title) => title.toLowerCase().includes("profile"),
            );
            ctx.expect(profileDialogTitle.toLowerCase()).toContain("profile");
            ctx.expect(await ctx.callText("dialogs[0].message", undefined, { dialog: true })).toContain("integration");
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.profiles, (profiles) => !profiles.includes("integration"))).toEqual([]);

            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call(`pages[${JSON.stringify(page.id)}].editor.deleteNamespace`, ["us-2052-test"], { dialog: true });
            const namespaceDialogTitle = await ctx.waitFor(
                (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
                (title) => title.toLowerCase().includes("namespace"),
            );
            ctx.expect(namespaceDialogTitle.toLowerCase()).toContain("namespace");
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.namespaces, (namespaces) => !namespaces.includes("us-2052-test"))).toEqual([]);
        } finally {
            await restoreStore(ctx, store, page);
        }
    }),

    test("Encrypted environment variables show Locked and unlock through the page control", async (ctx) => {
        let store;
        let page;
        const password = "us-2052-test-password";
        const plaintext = JSON.stringify({ "us-2052-encrypted": { default: { TOKEN: "decrypted-value" } } }, null, 4) + "\n";
        try {
            const encrypted = JSON.parse(await ctx.script(`return JSON.stringify(await app.shell.encryption.encrypt(${JSON.stringify(plaintext)}, ${JSON.stringify(password)}));`));
            store = await createStore(ctx, "us-2052/locked", "encrypted.env.json", `${encrypted}\n`);
            page = await openEnvVarsFromSettings(ctx);
            const editor = page.node.editor;
            ctx.expect(await editor.status).toBe("locked");
            ctx.expect(await editor.encrypted).toBe(true);
            ctx.expect(await screenSnapshot(ctx)).toContain("This environment variables file is encrypted.");
            const elements = await editor.elements;
            ctx.expect(elements.some((element) => element.name === "env-vars-unlock" && element.visible)).toBe(true);
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("window.screen.click", ['[data-name="env-vars-unlock"]'], { dialog: true });
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("dialogs[0].click", ["Decrypt"], { dialog: true });
            const dialog = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }], { dialog: true }),
                (snapshot) => snapshot.includes("textbox") && snapshot.includes('button "Decrypt"'),
            );
            const passwordField = dialog.match(/textbox[^\n]*\[ref=(e\d+)\]/i)?.[1];
            ctx.expect(passwordField).toBeTruthy();
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("window.screen.click", [{ ref: passwordField }], { dialog: true });
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("window.screen.type", [{ ref: passwordField }, password], { dialog: true });
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true } or maxLength. */ ctx.call("dialogs[0].click", ["Decrypt"], { dialog: true });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.status, (status) => status === "ok")).toBe("ok");
            ctx.expect(await editor.unlocked).toBe(true);
            ctx.expect(await editor.variables).toEqual([{ name: "TOKEN", value: "decrypted-value" }]);
        } finally {
            await restoreStore(ctx, store, page);
        }
    }),
];
