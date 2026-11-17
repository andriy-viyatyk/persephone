import { test } from '../../../lib/context.mjs';
import { open } from '../../helpers/pilot-helpers.mjs';
// Discard-aware close: a page left modified by a failed step must not leave an Unsaved Changes dialog behind.
import { closePage as close } from '../helpers.mjs';

const arrayJson = '[{"label":"alpha","count":1,"active":true},{"label":"beta","count":2,"active":false}]\n';
const objectJson = '{"label":"solo","count":3,"active":true}\n';
const jsonl = '{"label":"alpha","count":1,"active":true}\n{"label":"beta","count":2,"active":false}\n';

async function openEvenIfEmpty(ctx, file, content, editor) {
    const filePath = ctx.fixture(file);
    await ctx.app.fs.write(filePath, content);
    const page = await ctx.app.pages.openFile(filePath);
    const node = ctx.handle(ctx.app.pages[page.id]);
    await ctx.app.pages[page.id].editorSwitches.switchTo(editor);
    await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.id, value => value === editor);
    return { id: page.id, filePath, node };
}

export default [
    test('Grid opens JSON arrays and a single JSON object as rows', async ctx => {
        const pages = [];
        try {
            const arrayPage = await open(ctx, 'us-2065-grid/json-array-object/array.json', arrayJson, 'grid-json');
            pages.push(arrayPage);
            await ctx.waitFor(activeContext => activeContext.app.pages[arrayPage.id].editor.rowCount, count => count === 2);
            const arrayEditor = ctx.app.pages[arrayPage.id].editor;
            ctx.expect((await arrayEditor.columns).map(column => column.key)).toEqual(['label', 'count', 'active']);
            ctx.expect(await arrayEditor.rows).toEqual([
                { label: 'alpha', count: 1, active: true },
                { label: 'beta', count: 2, active: false },
            ]);

            const objectPage = await open(ctx, 'us-2065-grid/json-array-object/object.json', objectJson, 'grid-json');
            pages.push(objectPage);
            await ctx.waitFor(activeContext => activeContext.app.pages[objectPage.id].editor.rowCount, count => count === 1);
            ctx.expect((await ctx.app.pages[objectPage.id].editor.columns).map(column => column.key)).toEqual(['label', 'count', 'active']);
            ctx.expect(await ctx.app.pages[objectPage.id].editor.rows).toEqual([{ label: 'solo', count: 3, active: true }]);
        } finally {
            for (const page of pages) await close(ctx, page.id);
        }
    }),
    test('Grid opens JSONL and NDJSON records by line', async ctx => {
        const pages = [];
        try {
            for (const suffix of ['jsonl', 'ndjson']) {
                const page = await open(ctx, `us-2065-grid/jsonl-ndjson/records.${suffix}`, jsonl, 'grid-jsonl');
                pages.push(page);
                await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.rowCount, count => count === 2);
                ctx.expect(await ctx.app.pages[page.id].editor.rows).toEqual([
                    { label: 'alpha', count: 1, active: true },
                    { label: 'beta', count: 2, active: false },
                ]);
            }
        } finally {
            for (const page of pages) await close(ctx, page.id);
        }
    }),
    test('Grid opens CSV with headers and headerless spreadsheet column names', async ctx => {
        const pages = [];
        try {
            const headed = await open(ctx, 'us-2065-grid/csv-formats/headed.csv', 'label,count\nalpha,1\nbeta,2\n', 'grid-csv');
            pages.push(headed);
            const headedEditor = ctx.app.pages[headed.id].editor;
            await headedEditor.setCsvWithColumns(true);
            await ctx.waitFor(activeContext => activeContext.app.pages[headed.id].editor.csvWithColumns, value => value === true);
            await ctx.waitFor(activeContext => activeContext.app.pages[headed.id].editor.rowCount, count => count === 2);
            ctx.expect((await headedEditor.columns).map(column => column.key)).toEqual(['label', 'count']);
            ctx.expect(await headedEditor.rows).toEqual([{ label: 'alpha', count: '1' }, { label: 'beta', count: '2' }]);
            ctx.expect(await headedEditor.csvWithColumns).toBe(true);

            const headerless = await open(ctx, 'us-2065-grid/csv-formats/headerless.csv', 'alpha,1\nbeta,2\n', 'grid-csv');
            pages.push(headerless);
            await ctx.waitFor(activeContext => activeContext.app.pages[headerless.id].editor.rowCount, count => count === 2);
            const headerlessEditor = ctx.app.pages[headerless.id].editor;
            ctx.expect((await headerlessEditor.columns).map(column => column.key)).toEqual(['a', 'b']);
            ctx.expect(await headerlessEditor.rows).toEqual([{ a: 'alpha', b: '1' }, { a: 'beta', b: '2' }]);
            ctx.expect(await headerlessEditor.csvWithColumns).toBe(false);
            await headerlessEditor.setCsvWithColumns(true);
            await ctx.waitFor(activeContext => activeContext.app.pages[headerless.id].editor.csvWithColumns, value => value === true);
            await headerlessEditor.setCsvWithColumns(false);
            await ctx.waitFor(activeContext => activeContext.app.pages[headerless.id].editor.csvWithColumns, value => value === false);
        } finally {
            for (const page of pages) await close(ctx, page.id);
        }
    }),
    test('Malformed JSON and JSONL show the parse error panel', async ctx => {
        const pages = [];
        try {
            for (const [file, text, editor, expectedError] of [
                ['us-2065-grid/malformed-json-jsonl/broken.json', '{ broken\n', 'grid-json', 'SyntaxError:'],
                ['us-2065-grid/malformed-json-jsonl/broken.jsonl', '{"label":"alpha"}\n{ broken\n', 'grid-jsonl', 'Line 2:'],
            ]) {
                const page = await openEvenIfEmpty(ctx, file, text, editor);
                pages.push(page);
                await ctx.waitFor(activeContext => activeContext.app.pages[page.id].editor.rowCount, count => count === 0);
                await ctx.waitFor(activeContext => activeContext.app.window.screen.snapshot(), value => value.includes(expectedError));
                const visible = await ctx.app.window.screen.snapshot();
                ctx.expect(visible).toContain(expectedError);
                ctx.expect(visible.includes('alpha')).toBe(false);
            }
        } finally {
            for (const page of pages) await close(ctx, page.id);
        }
    }),
];
