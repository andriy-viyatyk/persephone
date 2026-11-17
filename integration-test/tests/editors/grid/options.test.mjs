import { test } from '../../../lib/context.mjs';
import { open } from '../../helpers/pilot-helpers.mjs';
// Discard-aware close: a page left modified by a failed step must not leave an Unsaved Changes dialog behind.
import { closePage as close } from '../helpers.mjs';

export default [
    test('Edit Columns hides/shows a column, Apply commits, and Cancel discards', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/columns-visibility-apply-cancel/visibility.json', '[{"alpha":"a1","beta":"b1","gamma":"g1"},{"alpha":"a2","beta":"b2","gamma":"g2"}]\n', 'grid-json');
            const editor = ctx.app.pages[page.id].editor;
            const screen = ctx.app.window.screen;
            await screen.click('[data-name="grid-columns"]');
            await screen.click('[data-type="data-cell"][data-row="1"][data-column-key="visible"]');
            await screen.click('[data-name="columns-options-apply"]');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.hiddenColumns, columns => columns.includes('beta'));

            await screen.click('[data-name="grid-columns"]');
            await screen.click('[data-type="data-cell"][data-row="1"][data-column-key="visible"]');
            await screen.click('[data-name="columns-options-cancel"]');
            ctx.expect((await editor.hiddenColumns).includes('beta')).toBe(true);

            await screen.click('[data-name="grid-columns"]');
            await screen.click('[data-type="data-cell"][data-row="1"][data-column-key="visible"]');
            await screen.click('[data-name="columns-options-apply"]');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.hiddenColumns, columns => !columns.includes('beta'));
            ctx.expect((await editor.hiddenColumns).includes('beta')).toBe(false);
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('CSV Options change header mode and delimiter', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/csv-header-delimiter/csv-options.csv', 'label,count\nalpha,1\nbeta,2\n', 'grid-csv');
            const editor = ctx.app.pages[page.id].editor;
            const screen = ctx.app.window.screen;
            await screen.click('[data-name="grid-csv-options"]');
            await screen.click('[data-name="csv-options-header"]');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.csvWithColumns, value => value === true);
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.rowCount, count => count === 2);
            ctx.expect((await editor.columns).map(column => column.key)).toEqual(['label', 'count']);
            await screen.click('[data-name="csv-options-delimiter"] [data-type="radio"]', { nth: 1 });
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.csvDelimiter, delimiter => delimiter === ';');
            await screen.click('[data-name="csv-options-delimiter"] [data-type="radio"]', { nth: 0 });
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.csvDelimiter, delimiter => delimiter === ',');
            ctx.expect(await editor.csvWithColumns).toBe(true);
            ctx.expect(await editor.csvDelimiter).toBe(',');
            await ctx.app.pages[page.id].editorSwitches.switchTo('monaco');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.id, value => value === 'monaco');
            await ctx.app.pages[page.id].editor.saveFile();
            ctx.expect(await ctx.callText('fs.read', [page.filePath])).toContain('label,count');
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
];
