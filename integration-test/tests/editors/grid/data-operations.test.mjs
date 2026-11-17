import { test } from '../../../lib/context.mjs';
import { open } from '../../helpers/pilot-helpers.mjs';
// Discard-aware close: a page left modified by a failed step must not leave an Unsaved Changes dialog behind.
import { closePage as close } from '../helpers.mjs';

const typedRows = '[{"label":"alpha","count":1,"active":false},{"label":"beta","count":2,"active":false}]\n';
const cell = (row, key) => `[data-type="data-cell"][data-row="${row}"][data-column-key="${key}"]`;

async function waitForRows(ctx, id, predicate) {
    await ctx.waitFor(activeContext => activeContext.app.pages[id].editor.rows, predicate);
}

async function setTextFilter(ctx, id, key, op, text) {
    const screen = ctx.app.window.screen;
    // The filter button is hover-gated (grid guide); hover its header first.
    await screen.hover(`.avg-header-cell[data-column-key="${key}"]`);
    await screen.click(`.avg-header-cell[data-column-key="${key}"] .avg-filter-button`);
    await screen.waitFor({ selector: '.avg-text-filter-input', state: 'visible' });
    if (text !== undefined) await screen.type('.avg-text-filter-input', text);
    await screen.click(`button.avg-text-filter-op[data-op="${op}"]`);
    await screen.click('[data-action="apply"]');
}

export default [
    test('Grid UI edits string, number, and boolean values and validates the number type', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/ui-typed-edits/typed-edits.json', typedRows, 'grid-json');
            const screen = ctx.app.window.screen;
            const editor = ctx.app.pages[page.id].editor;
            await screen.click(cell(0, 'label'));
            await screen.pressKey('Enter');
            await screen.waitFor({ selector: '.avg-cell-editor', state: 'visible' });
            await screen.type('.avg-cell-editor', 'gamma');
            await screen.pressKey('Enter');
            await waitForRows(ctx, page.id, rows => rows[0].label === 'gamma');

            await screen.click(cell(0, 'count'));
            await screen.pressKey('F2');
            await screen.waitFor({ selector: '.avg-cell-editor', state: 'visible' });
            await screen.type('.avg-cell-editor', '42');
            await screen.pressKey('Enter');
            await waitForRows(ctx, page.id, rows => rows[0].count === 42);
            await screen.pressKey('ArrowRight');
            await screen.pressKey('Space');
            await waitForRows(ctx, page.id, rows => rows[0].active === true);
            await screen.pressKey('Enter');
            await waitForRows(ctx, page.id, rows => rows[0].active === false);

            await screen.click(cell(0, 'count'));
            await screen.pressKey('F2');
            await screen.waitFor({ selector: '.avg-cell-editor', state: 'visible' });
            await screen.type('.avg-cell-editor', 'not-a-number');
            await screen.pressKey('Enter');
            await waitForRows(ctx, page.id, rows => rows[0].count === null);
            await ctx.app.pages[page.id].editorSwitches.switchTo('monaco');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.id, value => value === 'monaco');
            await ctx.app.pages[page.id].editor.saveFile();
            const saved = JSON.parse(await ctx.callText('fs.read', [page.filePath]));
            ctx.expect(saved[0]).toEqual({ label: 'gamma', count: null, active: false });
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Escape cancels a cell edit without changing the value', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/escape-cancel-edit/cancel-edit.json', '[{"label":"alpha"}]\n', 'grid-json');
            const screen = ctx.app.window.screen;
            await screen.click(cell(0, 'label'));
            await screen.pressKey('F2');
            await screen.waitFor({ selector: '.avg-cell-editor', state: 'visible' });
            await screen.type('.avg-cell-editor', 'discarded');
            await screen.pressKey('Escape');
            await screen.waitFor({ selector: '.avg-cell-editor', state: 'detached' });
            ctx.expect((await ctx.app.pages[page.id].editor.rows)[0].label).toBe('alpha');
            ctx.expect((await ctx.app.pages[page.id].content).includes('discarded')).toBe(false);
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Grid facade adds and deletes rows and columns', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/facade-crud/facade-crud.json', '[{"label":"alpha","count":1},{"label":"beta","count":2}]\n', 'grid-json');
            const editor = ctx.app.pages[page.id].editor;
            const addedRows = await editor.addRows(1);
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.rowCount, count => count === 3);
            const [newColumn] = await editor.addColumns(1);
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.columns, columns => columns.some(column => column.key === newColumn.key));
            const rowKeys = await editor.rowKeys;
            await editor.editCell(newColumn.key, rowKeys[2], 'gamma');
            await waitForRows(ctx, page.id, rows => rows[2][newColumn.key] === 'gamma');
            await editor.deleteRows([rowKeys[2]]);
            await editor.deleteColumns([newColumn.key]);
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.rowCount, count => count === 2);
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.columns, columns => !columns.some(column => column.key === newColumn.key));
            ctx.expect(addedRows.length).toBe(1);
            ctx.expect(await editor.rows).toEqual([{ label: 'alpha', count: 1 }, { label: 'beta', count: 2 }]);
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Clicking a Grid header sorts ascending then descending', async ctx => {
        let page;
        try {
            page = await open(ctx, 'us-2065-grid/sort-directions/sort.json', '[{"label":"charlie"},{"label":"alpha"},{"label":"bravo"}]\n', 'grid-json');
            const editor = ctx.app.pages[page.id].editor;
            await ctx.app.window.screen.click('.avg-header-cell[data-column-key="label"] .avg-header-title');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.sort, sort => sort?.key === 'label' && sort.direction === 'asc');
            ctx.expect(await editor.sort).toEqual({ key: 'label', direction: 'asc' });
            await ctx.app.window.screen.click('.avg-header-cell[data-column-key="label"] .avg-header-title');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.sort, sort => sort?.key === 'label' && sort.direction === 'desc');
            ctx.expect(await editor.sort).toEqual({ key: 'label', direction: 'desc' });
            ctx.expect(await editor.visibleRowCount).toBe(3);
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Column options and text filters combine', async ctx => {
        let page;
        try {
            const fixture = '[{"label":"alpha","group":"one"},{"label":"alpine","group":"one"},{"label":"beta","group":"one"},{"label":"","group":"two"}]\n';
            const cases = [
                ['contains', 'alp', 2], ['equals', 'alpha', 1], ['startsWith', 'al', 2], ['blank', undefined, 1], ['notBlank', undefined, 3],
            ];
            for (const [op, value, count] of cases) {
                page = await open(ctx, `us-2065-grid/column-text-filters/${op}.json`, fixture, 'grid-json');
                const screen = ctx.app.window.screen;
                const editor = ctx.app.pages[page.id].editor;
                await screen.click('[data-name="grid-columns"]');
                await screen.click('[data-type="data-cell"][data-row="0"][data-column-key="newFilterType"]');
                await screen.pressKey('Enter');
                await screen.click('text="text"');
                await screen.click('[data-name="columns-options-apply"]');
                await setTextFilter(ctx, page.id, 'label', op, value);
                await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.visibleRowCount, actual => actual === count);
                const filter = (await editor.filters).find(item => item.columnKey === 'label');
                ctx.expect(filter.columnKey).toBe('label');
                ctx.expect(filter.type).toBe('text');
                ctx.expect(filter.value).toEqual(op === 'blank' || op === 'notBlank' ? { op } : { op, text: value });
                // editor.rows is the full data set, not the filtered view; visibleRowCount above checks the filter.
                await close(ctx, page.id);
                page = undefined;
            }

            page = await open(ctx, 'us-2065-grid/column-text-filters/combined.json', fixture, 'grid-json');
            const screen = ctx.app.window.screen;
            const editor = ctx.app.pages[page.id].editor;
            await screen.click('[data-name="grid-columns"]');
            await screen.click('[data-type="data-cell"][data-row="0"][data-column-key="newFilterType"]');
            await screen.pressKey('Enter');
            await screen.click('text="text"');
            await screen.click('[data-name="columns-options-apply"]');
            await setTextFilter(ctx, page.id, 'label', 'contains', 'alp');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.visibleRowCount, actual => actual === 2);
            await screen.hover('.avg-header-cell[data-column-key="group"]');
            await screen.click('.avg-header-cell[data-column-key="group"] .avg-filter-button');
            await screen.click('.avg-filter-popover .avg-list-item[data-index="0"]');
            await screen.click('[data-action="apply"]');
            await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.visibleRowCount, actual => actual === 2);
            ctx.expect((await editor.filters).map(filter => filter.columnKey).sort()).toEqual(['group', 'label']);
        } finally {
            if (page) await close(ctx, page.id);
        }
    }),
    test('Ctrl+Insert adds an unsorted row and is blocked while sorted or filtered', async ctx => {
        const pages = [];
        const fixture = '[{"label":"alpha"},{"label":"beta"},{"label":"gamma"}]\n';
        try {
            const unsorted = await open(ctx, 'us-2065-grid/insert-guard/unsorted.json', fixture, 'grid-json');
            pages.push(unsorted);
            const editor = ctx.app.pages[unsorted.id].editor;
            await ctx.app.window.screen.click(cell(0, 'label'));
            await ctx.app.window.screen.pressKey('Control+Insert');
            await ctx.waitFor(activeContext => activeContext.app.pages[unsorted.id].editor.rowCount, count => count === 4);

            const sorted = await open(ctx, 'us-2065-grid/insert-guard/sorted.json', fixture, 'grid-json');
            pages.push(sorted);
            const sortedEditor = ctx.app.pages[sorted.id].editor;
            await ctx.app.window.screen.click('.avg-header-cell[data-column-key="label"] .avg-header-title');
            await ctx.waitFor(activeContext => activeContext.app.pages[sorted.id].editor.sort, sort => sort?.direction === 'asc');
            await ctx.app.window.screen.click(cell(0, 'label'));
            await ctx.app.window.screen.pressKey('Control+Insert');
            ctx.expect(await sortedEditor.rowCount).toBe(3);

            const filtered = await open(ctx, 'us-2065-grid/insert-guard/filtered.json', fixture, 'grid-json');
            pages.push(filtered);
            const filteredEditor = ctx.app.pages[filtered.id].editor;
            await ctx.app.window.screen.click('[data-name="grid-columns"]');
            await ctx.app.window.screen.click('[data-type="data-cell"][data-row="0"][data-column-key="newFilterType"]');
            await ctx.app.window.screen.pressKey('Enter');
            await ctx.app.window.screen.click('text="text"');
            await ctx.app.window.screen.click('[data-name="columns-options-apply"]');
            await setTextFilter(ctx, filtered.id, 'label', 'contains', 'alpha');
            await ctx.waitFor(activeContext => activeContext.app.pages[filtered.id].editor.visibleRowCount, count => count === 1);
            await ctx.app.window.screen.click(cell(0, 'label'));
            await ctx.app.window.screen.pressKey('Control+Insert');
            ctx.expect(await filteredEditor.rowCount).toBe(3);
        } finally {
            for (const page of pages) await close(ctx, page.id);
        }
    }),
];
