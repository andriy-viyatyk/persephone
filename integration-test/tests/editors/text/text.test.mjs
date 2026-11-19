import { test } from '../../../lib/context.mjs';
import { open, close, text } from '../../helpers/pilot-helpers.mjs';

export default [
    test('text: open and read fixture', async ctx => {
        const p = await open(ctx, 'pilot.txt', text, 'monaco');
        ctx.expect(await ctx.callText(`pages[${JSON.stringify(p.id)}].content`)).toBe(text);
        await close(ctx, p.id);
    }),
    test('text: insert and save work copy', async ctx => {
        const p = await open(ctx, 'pilot.txt', text, 'monaco');
        await ctx.app.pages[p.id].editor.insertText('X');
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].content`), v => v.includes('X'));
        const changed = await ctx.callText(`pages[${JSON.stringify(p.id)}].content`);
        ctx.expect(await ctx.app.pages[p.id].save()).toBe(true);
        ctx.expect(await ctx.callText('fs.read', [p.filePath])).toBe(changed);
        await close(ctx, p.id);
    }),
    test('text: insertion can be undone', async ctx => {
        const p = await open(ctx, 'pilot.txt', text, 'monaco');
        await ctx.app.pages[p.id].editor.insertText('X');
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].content`), v => v.includes('X'));
        await ctx.app.window.screen.pressKey('Control+z', { target: '.monaco-editor-host-root .monaco-editor' });
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].content`), v => v === text);
        ctx.expect(await ctx.app.pages[p.id].save()).toBe(true);
        await close(ctx, p.id);
    }),
    test('text: JSON round trip through grid', async ctx => {
        const p = await open(ctx, 'pilot.json', '[{"name":"Ada","city":"Kyiv"},{"name":"Bo","city":"Lviv"},{"name":"Cy","city":"Kyiv"}]\n', 'monaco');
        await ctx.app.pages[p.id].editorSwitches.switchTo('grid-json');
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].editor.id`), v => v === 'grid-json');
        await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.rowCount, n => n === 3);
        await ctx.app.pages[p.id].editorSwitches.switchTo('monaco');
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].editor.id`), v => v === 'monaco');
        ctx.expect(JSON.parse(await ctx.callText(`pages[${JSON.stringify(p.id)}].content`)).length).toBe(3);
        await close(ctx, p.id);
    }),
];
