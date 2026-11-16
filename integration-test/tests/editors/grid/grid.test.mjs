import { test } from '../../../lib/context.mjs';
import { open, close, csv, json } from '../../helpers/pilot-helpers.mjs';

async function grid(ctx, file, content, editor) {
    const p = await open(ctx, file, content, editor);
    if (editor === 'grid-csv') {
        await ctx.call(`${p.root}.editor.setCsvWithColumns`, [true]);
        await ctx.waitFor(`${p.root}.editor.csvWithColumns`, v => v === true);
    }
    await ctx.waitFor(`${p.root}.editor.rowCount`, n => n === 3);
    return p;
}

export default [
    test('grid: CSV headers and rows', async ctx => {
        const p = await grid(ctx, 'pilot.csv', csv, 'grid-csv');
        ctx.expect((await ctx.call(`${p.root}.editor.columns`)).map(c => c.name)).toEqual(['name', 'city']);
        ctx.expect((await ctx.call(`${p.root}.editor.rows`))[0].name).toBe('Ada');
        await ctx.call(`${p.root}.editorSwitches.switchTo`, ['monaco']);
        await ctx.waitFor(c => c.callText(`${p.root}.editor.id`), v => v === 'monaco');
        await ctx.call(`${p.root}.editor.saveFile`, []);
        await close(ctx, p.id);
    }),
    test('grid: JSON rows', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        ctx.expect((await ctx.call(`${p.root}.editor.rows`)).map(r => r.name)).toEqual(['Ada', 'Bo', 'Cy']);
        await close(ctx, p.id);
    }),
    test('grid: edit JSON cell and save', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        const keys = await ctx.call(`${p.root}.editor.rowKeys`);
        await ctx.call(`${p.root}.editor.editCell`, ['city', keys[0], 'Odesa']);
        await ctx.waitFor(`${p.root}.editor.rows`, rows => rows[0].city === 'Odesa');
        await ctx.waitFor(c => c.callText(`${p.root}.content`), value => value.includes('Odesa'));
        await ctx.call(`${p.root}.editorSwitches.switchTo`, ['monaco']);
        await ctx.waitFor(c => c.callText(`${p.root}.editor.id`), v => v === 'monaco');
        ctx.expect(await ctx.call(`${p.root}.editor.saveFile`, [])).toBe(true);
        ctx.expect(JSON.parse(await ctx.callText('fs.read', [p.filePath]))[0].city).toBe('Odesa');
        await close(ctx, p.id);
    }),
    test('grid: sort by name', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        await ctx.waitFor(`${p.root}.editor.visibleRowCount`, n => n === 3);
        await ctx.call('window.screen.click', ['.avg-header-cell[data-column-key="name"] .avg-header-title']);
        await ctx.waitFor(`${p.root}.editor.sort`, s => s && s.key === 'name' && s.direction === 'asc');
        ctx.expect(await ctx.call(`${p.root}.editor.sort`)).toEqual({ key: 'name', direction: 'asc' });
        await close(ctx, p.id);
    }),
    test('grid: search filters visible rows', async ctx => {
        const p = await grid(ctx, 'pilot.json', json, 'grid-json');
        await ctx.call(`${p.root}.editor.setSearch`, ['Lviv']);
        await ctx.waitFor(`${p.root}.editor.visibleRowCount`, n => n === 1);
        ctx.expect(await ctx.callText(`${p.root}.editor.searchText`)).toBe('Lviv');
        await ctx.call(`${p.root}.editor.clearSearch`, []);
        await ctx.waitFor(`${p.root}.editor.visibleRowCount`, n => n === 3);
        await close(ctx, p.id);
    }),
];
