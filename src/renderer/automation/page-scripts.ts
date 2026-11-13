/** Shared snippets evaluated inside the inspected page. Keep this module independent of callers. */
export const VISIBLE_FN = `const displayed = el => { const style = getComputedStyle(el); return style.visibility !== 'hidden' && style.display !== 'none'; };
const visible = el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && displayed(el);
};`;

export const FRAME_OFFSETS_FN = `const frameOffsets = [];
for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
    const frameRect = frame.getBoundingClientRect();
    frameOffsets.push({ x: frameRect.left + frame.clientLeft, y: frameRect.top + frame.clientTop });
}`;

/** Existing query/action selector semantics shared by all page-side locator snippets. */
export function resolveCandidatesSource(): string {
    return String.raw`function resolveCandidates(selector, mode, options = {}) {
        ${VISIBLE_FN}
        let candidates;
        if (!selector.startsWith('text=')) {
            if (mode === 'query') document.querySelector(selector);
            const allMatches = [...document.querySelectorAll(selector)];
            if (mode === 'query') candidates = allMatches;
            else {
                const displayedMatches = allMatches.filter(displayed);
                const sizedMatches = displayedMatches.filter(visible);
                candidates = force ? allMatches : sizedMatches.length ? sizedMatches : displayedMatches;
            }
        } else {
            const source = selector.slice(5).trim();
            const quoted = source.startsWith('"') && source.endsWith('"');
            const wanted = (quoted ? JSON.parse(source) : source).replace(/\s+/g, ' ').trim();
            const normalize = value => value.replace(/\s+/g, ' ').trim();
            const matches = [...document.querySelectorAll('body *')].filter(el => {
                const text = normalize(el.innerText || el.textContent || '');
                if (quoted ? text !== wanted : !text.toLocaleLowerCase().includes(wanted.toLocaleLowerCase())) return false;
                return (mode === 'action' && force) || displayed(el);
            });
            const innermost = matches.filter(el => !matches.some(candidate => candidate !== el && el.contains(candidate)));
            const sized = innermost.filter(visible);
            candidates = (mode === 'action' && force ? innermost : sized.length ? sized : innermost)
                .sort((a, b) => {
                    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
                    const area = ar.width * ar.height - br.width * br.height;
                    if (area) return area;
                    const depth = el => { let value = 0; for (let node = el; node; node = node.parentElement) value++; return value; };
                    return depth(b) - depth(a);
                });
        }
        if (options.visibleOnly) candidates = candidates.filter(visible);
        return options.nth === undefined ? candidates : candidates.slice(options.nth, options.nth + 1);
    }`;
}
