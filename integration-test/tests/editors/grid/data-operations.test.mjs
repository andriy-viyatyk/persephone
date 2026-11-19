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
    test('Ctrl+Insert inserts before the focused row in file order, also while sorted or filtered', async ctx => {
        const pages = [];
        const fixture = '[{"label":"alpha"},{"label":"beta"},{"label":"gamma"}]\n';
        // File order of the labels; the inserted blank row has no label.
        const labels = rows => rows.map(row => row.label ?? null);
        try {
            const unsorted = await open(ctx, 'us-2065-grid/insert-placement/unsorted.json', fixture, 'grid-json');
            pages.push(unsorted);
            await ctx.app.window.screen.click(cell(0, 'label'));
            await ctx.app.window.screen.pressKey('Control+Insert');
            await ctx.waitFor(activeContext => activeContext.app.pages[unsorted.id].editor.rowCount, count => count === 4);
            ctx.expect(labels(await ctx.app.pages[unsorted.id].editor.rows)).toEqual([null, 'alpha', 'beta', 'gamma']);

            // Sorted descending, display row 0 is gamma (file index 2): the new row goes before gamma in the file,
            // not at file index 0.
            const sorted = await open(ctx, 'us-2065-grid/insert-placement/sorted.json', fixture, 'grid-json');
            pages.push(sorted);
            const header = '.avg-header-cell[data-column-key="label"] .avg-header-title';
            await ctx.app.window.screen.click(header);
            await ctx.waitFor(activeContext => activeContext.app.pages[sorted.id].editor.sort, sort => sort?.direction === 'asc');
            // Once sorted, the hover-gated filter button can cover a short title's centre; click its left edge.
            await ctx.app.window.screen.click(header, { position: { x: 4, y: 4 } });
            await ctx.waitFor(activeContext => activeContext.app.pages[sorted.id].editor.sort, sort => sort?.direction === 'desc');
            await ctx.app.window.screen.click(cell(0, 'label'));
            await ctx.app.window.screen.pressKey('Control+Insert');
            await ctx.waitFor(activeContext => activeContext.app.pages[sorted.id].editor.rowCount, count => count === 4);
            ctx.expect(labels(await ctx.app.pages[sorted.id].editor.rows)).toEqual(['alpha', 'beta', null, 'gamma']);

            // Filtered to gamma (file index 2): the new row goes before gamma and stays visible while being filled in.
            const filtered = await open(ctx, 'us-2065-grid/insert-placement/filtered.json', fixture, 'grid-json');
            pages.push(filtered);
            await ctx.app.window.screen.click('[data-name="grid-columns"]');
            await ctx.app.window.screen.click('[data-type="data-cell"][data-row="0"][data-column-key="newFilterType"]');
            await ctx.app.window.screen.pressKey('Enter');
            await ctx.app.window.screen.click('text="text"');
            await ctx.app.window.screen.click('[data-name="columns-options-apply"]');
            await setTextFilter(ctx, filtered.id, 'label', 'contains', 'gamma');
            await ctx.waitFor(activeContext => activeContext.app.pages[filtered.id].editor.visibleRowCount, count => count === 1);
            await ctx.app.window.screen.click(cell(0, 'label'));
            await ctx.app.window.screen.pressKey('Control+Insert');
            await ctx.waitFor(activeContext => activeContext.app.pages[filtered.id].editor.rowCount, count => count === 4);
            ctx.expect(labels(await ctx.app.pages[filtered.id].editor.rows)).toEqual(['alpha', 'beta', null, 'gamma']);
            // The display is frozen while the new row is filled in, so it shows above gamma. visibleRowCount is not
            // the check: av-grid reports visible rows only when it re-filters, which the freeze defers.
            await ctx.app.window.screen.waitFor({ selector: cell(1, 'label'), state: 'visible' });
        } finally {
            for (const page of pages) await close(ctx, page.id);
        }
    }),
];
