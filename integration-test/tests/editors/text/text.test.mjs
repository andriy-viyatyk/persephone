import { test } from '../../../lib/context.mjs';
import { open, close, text } from '../../helpers/pilot-helpers.mjs';

export default [
    test('text: open and read fixture', async ctx => {
        const p = await open(ctx, 'pilot.txt', text, 'monaco');
        ctx.expect(await ctx.callText(`${p.root}.content`)).toBe(text);
        await close(ctx, p.id);
    }),
    test('text: insert and save work copy', async ctx => {
        const p = await open(ctx, 'pilot.txt', text, 'monaco');
        await ctx.call(`${p.root}.editor.insertText`, ['X']);
        await ctx.waitFor(c => c.callText(`${p.root}.content`), v => v.includes('X'));
        const changed = await ctx.callText(`${p.root}.content`);
        ctx.expect(await ctx.call(`${p.root}.editor.saveFile`, [])).toBe(true);
        ctx.expect(await ctx.callText('fs.read', [p.filePath])).toBe(changed);
        await close(ctx, p.id);
    }),
    test('text: insertion can be undone', async ctx => {
        const p = await open(ctx, 'pilot.txt', text, 'monaco');
        await ctx.call(`${p.root}.editor.insertText`, ['X']);
        await ctx.waitFor(c => c.callText(`${p.root}.content`), v => v.includes('X'));
        await ctx.call('window.screen.pressKey', ['Control+z', { target: '.monaco-editor-host-root .monaco-editor' }]);
        await ctx.waitFor(c => c.callText(`${p.root}.content`), v => v === text);
        ctx.expect(await ctx.call(`${p.root}.editor.saveFile`, [])).toBe(true);
        await close(ctx, p.id);
    }),
    test('text: JSON round trip through grid', async ctx => {
        const p = await open(ctx, 'pilot.json', '[{"name":"Ada","city":"Kyiv"},{"name":"Bo","city":"Lviv"},{"name":"Cy","city":"Kyiv"}]\n', 'monaco');
        await ctx.call(`${p.root}.editorSwitches.switchTo`, ['grid-json']);
        await ctx.waitFor(c => c.callText(`${p.root}.editor.id`), v => v === 'grid-json');
        await ctx.waitFor(`${p.root}.editor.rowCount`, n => n === 3);
        await ctx.call(`${p.root}.editorSwitches.switchTo`, ['monaco']);
        await ctx.waitFor(c => c.callText(`${p.root}.editor.id`), v => v === 'monaco');
        ctx.expect(JSON.parse(await ctx.callText(`${p.root}.content`)).length).toBe(3);
        await close(ctx, p.id);
    }),
];
