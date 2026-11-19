import { test } from '../../../lib/context.mjs';
import { open, close, csv, json } from '../../helpers/pilot-helpers.mjs';

async function grid(ctx, file, content, editor) {
    const p = await open(ctx, file, content, editor);
    if (editor === 'grid-csv') {
        await ctx.app.pages[p.id].editor.setCsvWithColumns(true);
        await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.csvWithColumns, v => v === true);
    }
    await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.rowCount, n => n === 3);
    return p;
}

export default [
    test('grid: CSV headers and rows', async ctx => {
        const p = await grid(ctx, 'pilot.csv', csv, 'grid-csv');
        ctx.expect((await ctx.app.pages[p.id].editor.columns).map(c => c.name)).toEqual(['name', 'city']);
        ctx.expect((await ctx.app.pages[p.id].editor.rows)[0].name).toBe('Ada');
        await ctx.app.pages[p.id].editorSwitches.switchTo('monaco');
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].editor.id`), v => v === 'monaco');
        await ctx.app.pages[p.id].editor.saveFile();
        await close(ctx, p.id);
    }),
    test('grid: JSON rows', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        ctx.expect((await ctx.app.pages[p.id].editor.rows).map(r => r.name)).toEqual(['Ada', 'Bo', 'Cy']);
        await close(ctx, p.id);
    }),
    test('grid: help lists every curated element', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        const editor = ctx.app.pages[p.id].editor;
        const elements = await editor.elements;
        const help = await editor.$help;
        ctx.expect(elements.some(element => element.name === 'grid-column-filter')).toBe(true);
        ctx.expect(help).toContain('grid-column-filter');
        await close(ctx, p.id);
    }),
    test('grid: edit JSON cell and save', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        const keys = await ctx.app.pages[p.id].editor.rowKeys;
        await ctx.app.pages[p.id].editor.editCell('city', keys[0], 'Odesa');
        await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.rows, rows => rows[0].city === 'Odesa');
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].content`), value => value.includes('Odesa'));
        await ctx.app.pages[p.id].editorSwitches.switchTo('monaco');
        await ctx.waitFor(c => c.callText(`pages[${JSON.stringify(p.id)}].editor.id`), v => v === 'monaco');
        ctx.expect(await ctx.app.pages[p.id].editor.saveFile()).toBe(true);
        ctx.expect(JSON.parse(await ctx.callText('fs.read', [p.filePath]))[0].city).toBe('Odesa');
        await close(ctx, p.id);
    }),
    test('grid: sort by name', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.visibleRowCount, n => n === 3);
        await ctx.app.window.screen.click('.avg-header-cell[data-column-key="name"] .avg-header-title');
        await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.sort, s => s && s.key === 'name' && s.direction === 'asc');
        ctx.expect(await ctx.app.pages[p.id].editor.sort).toEqual({ key: 'name', direction: 'asc' });
        await close(ctx, p.id);
    }),
    test('grid: search filters visible rows', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        await ctx.app.pages[p.id].editor.setSearch('Lviv');
        await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.visibleRowCount, n => n === 1);
        ctx.expect(await ctx.callText(`pages[${JSON.stringify(p.id)}].editor.searchText`)).toBe('Lviv');
        await ctx.app.pages[p.id].editor.clearSearch();
        await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].editor.visibleRowCount, n => n === 3);
        await close(ctx, p.id);
    }),
];
