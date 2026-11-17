import { test } from '../../../lib/context.mjs';
import { open } from '../../helpers/pilot-helpers.mjs';
// Discard-aware close: a page left modified by a failed step must not leave an Unsaved Changes dialog behind.
import { closePage as close } from '../helpers.mjs';

const cell = (row, key) => `[data-type="data-cell"][data-row="${row}"][data-column-key="${key}"]`;

export default [
    test('Arrow keys move the focused cell and report selection', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/arrow-selection/selection.json', '[{"alpha":"a1","beta":"b1"},{"alpha":"a2","beta":"b2"}]\n', 'grid-json');
            const editor = ctx.app.pages[page.id].editor;
            const screen = ctx.app.window.screen;
            await screen.click(cell(0, 'alpha'));
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.selection, selection => selection?.columnKeyStart === 'alpha' && selection.rowStart === 0);
            let selection = await editor.selection;
            ctx.expect(selection.columnStart).toBe(0);
            ctx.expect(selection.rowStart).toBe(0);
            await screen.pressKey('ArrowRight');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.selection, value => value?.columnKeyStart === 'beta' && value.columnStart === 1);
            selection = await editor.selection;
            ctx.expect(selection.columnKeyStart).toBe('beta');
            await screen.pressKey('ArrowDown');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.selection, value => value?.rowStart === 1);
            selection = await editor.selection;
            ctx.expect(selection.rowStart).toBe(1);
            ctx.expect(selection.rowKeyStart).toBe((await editor.rowKeys)[1]);
            ctx.expect(selection.columnKeyStart).toBe('beta');
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Enter and F2 open a cell editor; Enter commits', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/enter-f2-edit/open-edit.json', '[{"label":"alpha"}]\n', 'grid-json');
            const screen = ctx.app.window.screen;
            const editor = ctx.app.pages[page.id].editor;
            for (const [key, value] of [['Enter', 'gamma'], ['F2', 'delta']]) {
                await screen.click(cell(0, 'label'));
                await screen.pressKey(key);
                await screen.waitFor({ selector: '.avg-cell-editor', state: 'visible' });
                await screen.type('.avg-cell-editor', value);
                await screen.pressKey('Enter');
                await screen.waitFor({ selector: '.avg-cell-editor', state: 'detached' });
                await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.rows, rows => rows[0].label === value);
            }
            ctx.expect((await editor.rows)[0].label).toBe('delta');
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Ctrl+Delete deletes the selected row and Ctrl+Shift+Delete deletes its selected column', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/keyboard-delete-selection/delete-selection.json', '[{"alpha":"a1","beta":"b1"},{"alpha":"a2","beta":"b2"}]\n', 'grid-json');
            const editor = ctx.app.pages[page.id].editor;
            const screen = ctx.app.window.screen;
            await screen.click(cell(0, 'alpha'));
            await screen.pressKey('Control+Delete');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.rowCount, count => count === 1);
            ctx.expect(await editor.rows).toEqual([{ alpha: 'a2', beta: 'b2' }]);
            await screen.click(cell(0, 'beta'));
            await screen.pressKey('Control+Shift+Delete');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.columns, columns => columns.length === 1);
            ctx.expect((await editor.columns).map(column => column.key)).toEqual(['alpha']);
            ctx.expect(await editor.rows).toEqual([{ alpha: 'a2' }]);
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Pasting TSV grows rows and columns, and one value fills a selection', async ctx => {
        let growthPage;
        let fillPage;
        let previousClipboard;
        try {
            growthPage = await open(ctx, 'us-2065-grid/clipboard-paste-growth/paste-growth.json', '[{"alpha":"a1","beta":"b1"},{"alpha":"a2","beta":"b2"}]\n', 'grid-json');
            previousClipboard = await ctx.script('var clipboardText = await navigator.clipboard.readText();\nclipboardText;');
            try {
                await ctx.script(`await navigator.clipboard.writeText(${JSON.stringify('gamma\tomega\ndelta\tsigma')});\ntrue;`);
                await ctx.app.window.screen.click(cell(1, 'beta'));
                await ctx.app.window.screen.pressKey('Control+v');
                const editor = ctx.app.pages[growthPage.id].editor;
                await ctx.waitFor(activeContext => activeContext.app.pages[growthPage.id].editor.rowCount, count => count === 3);
                await ctx.waitFor(activeContext => activeContext.app.pages[growthPage.id].editor.columns, columns => columns.length === 3);
                const rows = await editor.rows;
                const columns = await editor.columns;
                const addedColumnKey = columns[2].key;
                ctx.expect(rows[1].beta).toBe('gamma');
                ctx.expect(rows[1][addedColumnKey]).toBe('omega');
                ctx.expect(rows[2].beta).toBe('delta');
                ctx.expect(rows[2][addedColumnKey]).toBe('sigma');
            } finally {
                await ctx.script(`await navigator.clipboard.writeText(${JSON.stringify(previousClipboard)});\ntrue;`);
            }

            fillPage = await open(ctx, 'us-2065-grid/clipboard-paste-selection/paste-fill.json', '[{"alpha":"a1","beta":"b1"},{"alpha":"a2","beta":"b2"}]\n', 'grid-json');
            previousClipboard = await ctx.script('var clipboardText = await navigator.clipboard.readText();\nclipboardText;');
            try {
                await ctx.script(`await navigator.clipboard.writeText(${JSON.stringify('filled')});\ntrue;`);
                await ctx.app.window.screen.click(cell(0, 'alpha'));
                await ctx.app.window.screen.pressKey('Shift+ArrowRight');
                await ctx.app.window.screen.pressKey('Shift+ArrowDown');
                const editor = ctx.app.pages[fillPage.id].editor;
                await ctx.waitFor(activeContext => activeContext.app.pages[fillPage.id].editor.selection, selection => selection?.rowStart === 0 && selection.rowEnd === 1 && selection.columnStart === 0 && selection.columnEnd === 1);
                await ctx.app.window.screen.pressKey('Control+v');
                await ctx.waitFor(activeContext => activeContext.app.pages[fillPage.id].editor.rows, rows => rows.every(row => row.alpha === 'filled' && row.beta === 'filled'));
                ctx.expect(await editor.rowCount).toBe(2);
                ctx.expect((await editor.columns).map(column => column.key)).toEqual(['alpha', 'beta']);
            } finally {
                await ctx.script(`await navigator.clipboard.writeText(${JSON.stringify(previousClipboard)});\ntrue;`);
            }
        } finally {
            if (growthPage) await close(ctx, growthPage.id);
            if (fillPage) await close(ctx, fillPage.id);
        }
    }),
];
