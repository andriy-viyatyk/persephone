export const text = 'alpha\nbeta\n';
export const csv = 'name,city\nAda,Kyiv\nBo,Lviv\nCy,Kyiv\n';
export const json = '[{"name":"Ada","city":"Kyiv"},{"name":"Bo","city":"Lviv"},{"name":"Cy","city":"Kyiv"}]\n';

export async function open(ctx, file, content, editor) {
    const filePath = ctx.fixture(file);
    await ctx.app.fs.write(filePath, content);
    const page = await ctx.app.pages.openFile(filePath);
    ctx.expect(typeof page.id).toBe('string');
    const node = ctx.handle(ctx.app.pages[page.id]);
    await ctx.app.pages[page.id].editorSwitches.switchTo(editor);
    await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (value) => value === editor);
    if (editor.startsWith('grid-')) {
        await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.rowCount, (count) => count > 0);
    }
    return { node, id: page.id, filePath };
}

export async function close(ctx, id) {
    ctx.expect(await ctx.app.pages.closePage(id)).toBe(true);
}
