export const text = 'alpha\nbeta\n';
export const csv = 'name,city\nAda,Kyiv\nBo,Lviv\nCy,Kyiv\n';
export const json = '[{"name":"Ada","city":"Kyiv"},{"name":"Bo","city":"Lviv"},{"name":"Cy","city":"Kyiv"}]\n';

export async function open(ctx, file, content, editor) {
    const filePath = ctx.fixture(file);
    await ctx.call('fs.write', [filePath, content]);
    const page = await ctx.call('pages.openFile', [filePath]);
    ctx.expect(typeof page.id).toBe('string');
    const root = `pages[${JSON.stringify(page.id)}]`;
    await ctx.call(`${root}.editorSwitches.switchTo`, [editor]);
    await ctx.waitFor(c => c.callText(`${root}.editor.id`), v => v === editor);
    if (editor.startsWith('grid-')) {
        await ctx.waitFor(`${root}.editor.rowCount`, n => n > 0);
    }
    return { root, id: page.id, filePath };
}

export async function close(ctx, id) {
    ctx.expect(await ctx.call('pages.closePage', [id])).toBe(true);
}
