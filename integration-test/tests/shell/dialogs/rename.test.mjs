import { test } from '../../../lib/context.mjs';
import { open, close, text } from '../../helpers/pilot-helpers.mjs';

export default test('dialog: cancel rename preserves file', async ctx => {
    const p = await open(ctx, 'pilot.txt', text, 'monaco');
    ctx.expect(await ctx.call(`${p.root}.editor.promptRename`, [],
        { dialog: true })).toEqual({ pending: true });
    await ctx.waitFor(c => c.callText('dialogs[0].title', undefined,
        { dialog: true }), title => title === 'Rename File');
    ctx.expect(await ctx.callText('dialogs[0].value', undefined,
        { dialog: true })).toBe('pilot.txt');
    await ctx.call('dialogs[0].click', ['Cancel'], { dialog: true });
    await ctx.waitFor(c => c.callText(`${p.root}.filePath`), path => path === p.filePath);
    ctx.expect(await ctx.callText('fs.read', [p.filePath])).toBe(text);
    await close(ctx, p.id);
});
