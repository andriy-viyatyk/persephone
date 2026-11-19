import { test } from "../../../lib/context.mjs";
import path from "node:path";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };
const CLI_REQUIRED_TEXT = "Install the Claude or Codex CLI and sign in before starting a session.";
const SETTING_IDS = [
    "claude-executable",
    "default-model",
    "default-effort",
    "codex-executable",
    "codex-default-model",
    "codex-default-effort",
    "cross-board-permission-ceiling",
];

async function waitForDom(ctx, editor, expression, predicate) {
    return ctx.waitFor(async () => {
        try {
            return await editor.evaluate(expression);
        } catch {
            return null;
        }
    }, predicate);
}

async function selectBoardSettings(ctx, namespace) {
    const section = `[data-name="settings-section-board-${encodeURIComponent(namespace)}"]`;
    await ctx.app.pages.showSettingsPage();
    await ctx.waitFor((active) => active.app.pages.all, (pages) => pages.some((page) => page.editor === "settings-view"));
    await ctx.app.window.screen.click(section);
    return section;
}

async function closeNewSettingsPages(ctx, before) {
    try {
        const after = await ctx.app.pages.all;
        for (const page of after) {
            if (page.editor === "settings-view" && !before.some((old) => old.id === page.id)) {
                await ctx.app.pages.closePage(page.id);
            }
        }
    } catch { /* Cleanup must not hide the test result. */ }
}

export default [
    test("opens offline without sessions or SDK files and confines Agent Chat data", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "claude-agent");
            const state = await waitForDom(ctx, handle.editor, `() => ({
                consentVisible: (() => {
                    const consent = document.querySelector('#consent');
                    return Boolean(consent && !consent.classList.contains('hidden') && consent.getClientRects().length);
                })(),
                acceptText: document.querySelector('#accept')?.textContent.trim(),
                sessionItems: document.querySelectorAll('.session-item').length,
                sessionRows: document.querySelectorAll('.session-row').length,
                cliText: document.querySelector('#intro p[data-i18n="cli.required"]')?.textContent.trim(),
                error: document.querySelector('#error-text')?.textContent.trim() ?? '',
            })`, (value) => value?.consentVisible === true && value.cliText === CLI_REQUIRED_TEXT
                && value.sessionItems === 0 && value.sessionRows === 0);
            ctx.expect(state.consentVisible).toBe(true);
            ctx.expect(state.acceptText).toBe("Accept and download");
            ctx.expect(state.sessionItems).toBe(0);
            ctx.expect(state.sessionRows).toBe(0);
            ctx.expect(state.cliText).toBe(CLI_REQUIRED_TEXT);
            ctx.expect(state.error).toBe("");

            const userData = (await ctx.app.main.runtime.paths).userData;
            const groupChatRoot = path.join(userData, "board-data", "claude-agent", "group-chat");
            ctx.expect(await ctx.app.fs.listDir(groupChatRoot)).toContain("profiles.json");

            const testHome = path.join(userData, "test-home");
            const claudeConfig = path.join(testHome, ".claude");
            const claudeEntries = await ctx.app.fs.listDir(claudeConfig);
            ctx.expect(claudeEntries.includes("projects")).toBe(false);

            const sdkRoot = path.join(userData, "test-local-app-data", "Persephone", "board-data", "claude-agent", "sdk");
            ctx.expect(await ctx.app.fs.listDir(sdkRoot)).toEqual([]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("renders the published board's persisted setting defaults", async (ctx) => {
        const pagesBefore = await ctx.app.pages.all;
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "claude-agent");
            const namespace = await ctx.app.boardVars.namespaceFor(handle.root);
            const section = await selectBoardSettings(ctx, namespace);
            const values = await ctx.waitFor(
                () => ctx.app.window.screen.evaluate(`() => ${JSON.stringify(SETTING_IDS)}.map(id => {
                    const root = document.querySelector(${JSON.stringify(section)} + ' [data-name="board-setting-' + id + '"]');
                    return root?.querySelector('input')?.value ?? null;
                })`),
                (result) => result.length === SETTING_IDS.length && result.every((value) => value !== null),
            );
            ctx.expect(values).toEqual(["", "", "", "", "", "", "read-only"]);
        } finally {
            await closeNewSettingsPages(ctx, pagesBefore);
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("shows the no-CLI message when a session start is attempted", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "claude-agent");
            const userData = (await ctx.app.main.runtime.paths).userData;
            const workingDirectory = path.join(userData, "test-home");
            await handle.editor.evaluate(`async () => {
                const cwd = document.querySelector('#cwd');
                cwd.value = ${JSON.stringify(workingDirectory)};
                cwd.dispatchEvent(new Event('input', { bubbles: true }));
                const prompt = document.querySelector('#prompt');
                prompt.textContent = 'Synthetic offline Agent Chat test';
                prompt.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Synthetic offline Agent Chat test' }));
                document.querySelector('#send').click();
            }`);

            const outcome = await waitForDom(ctx, handle.editor, `() => ({
                message: document.querySelector('#error-text')?.textContent.trim() ?? '',
                sessionItems: document.querySelectorAll('.session-item').length,
                sessionRows: document.querySelectorAll('.session-row').length,
                acceptText: document.querySelector('#accept')?.textContent.trim(),
            })`, (value) => value?.message === CLI_REQUIRED_TEXT && value.sessionItems === 0 && value.sessionRows === 0);
            ctx.expect(outcome.message).toBe(CLI_REQUIRED_TEXT);
            ctx.expect(outcome.sessionItems).toBe(0);
            ctx.expect(outcome.sessionRows).toBe(0);
            ctx.expect(outcome.acceptText).toBe("Accept and download");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
