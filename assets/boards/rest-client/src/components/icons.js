/**
 * Inline SVG icons copied from Persephone's icon registry (`src/renderer/theme/icon-registry.ts`)
 * so the board's buttons carry the same glyphs as the built-in REST client.
 */
const ICONS = {
    copy: `<svg viewBox="0 0 24 24"><path d="M6 11C6 8.17157 6 6.75736 6.87868 5.87868C7.75736 5 9.17157 5 12 5H15C17.8284 5 19.2426 5 20.1213 5.87868C21 6.75736 21 8.17157 21 11V16C21 18.8284 21 20.2426 20.1213 21.1213C19.2426 22 17.8284 22 15 22H12C9.17157 22 7.75736 22 6.87868 21.1213C6 20.2426 6 18.8284 6 16V11Z" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M6 19C4.34315 19 3 17.6569 3 16V10C3 6.22876 3 4.34315 4.17157 3.17157C5.34315 2 7.22876 2 11 2H15C16.6569 2 18 3.34315 18 5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`,
    delete: `<svg viewBox="0 0 24 24"><path d="M20.5001 6H3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M18.8332 8.5L18.3732 15.3991C18.1962 18.054 18.1077 19.3815 17.2427 20.1907C16.3777 21 15.0473 21 12.3865 21H11.6132C8.95235 21 7.62195 21 6.75694 20.1907C5.89194 19.3815 5.80344 18.054 5.62644 15.3991L5.1665 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M9.1709 4C9.58273 2.83481 10.694 2 12.0002 2C13.3064 2 14.4177 2.83481 14.8295 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><line x1="16.9999" y1="7" x2="7.00001" y2="16.9999" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7.00006" y1="7" x2="17" y2="16.9999" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M6 12H18M12 6V18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
    "new-window": `<svg viewBox="-2 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M14.267 3.793v7.996a.477.477 0 0 1-.475.475h-2.356v2.472a.476.476 0 0 1-.475.475H1.208a.476.476 0 0 1-.475-.475V6.74a.476.476 0 0 1 .475-.475h2.356V3.793a.476.476 0 0 1 .475-.475h9.753a.476.476 0 0 1 .475.475zm-3.94 8.471H4.04a.477.477 0 0 1-.475-.475V8.626H1.84v5.476h8.487zm2.832-6.585H4.672v5.476h8.487z"/></svg>`,
    "chevron-down": `<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M3.16272 5.17574C3.37968 4.94142 3.73143 4.94142 3.94839 5.17574L8 9.55147L12.0516 5.17574C12.2686 4.94142 12.6203 4.94142 12.8373 5.17574C13.0542 5.41005 13.0542 5.78995 12.8373 6.02426L8.39284 10.8243C8.17588 11.0586 7.82412 11.0586 7.60716 10.8243L3.16272 6.02426C2.94576 5.78995 2.94576 5.41005 3.16272 5.17574Z"/></svg>`,
    // The file-type glyph the app shows for code languages; its fill is part of the icon, not the theme.
    braces: `<svg viewBox="3 3 26 26"><path fill="#DBCD68" d="M7.5 15.1c1.5 0 1.7-.8 1.7-1.5 0-.6-.1-1.1-.1-1.7S9 10.7 9 10.2c0-2.1 1.3-3 3.4-3h.8v1.9h-.4c-1 0-1.3.6-1.3 1.6 0 .4.1.8.1 1.3 0 .4.1.9.1 1.5 0 1.7-.7 2.3-1.9 2.6 1.2.3 1.9.9 1.9 2.6 0 .6-.1 1.1-.1 1.5 0 .4-.1.9-.1 1.2 0 1 .3 1.6 1.3 1.6h.4v1.9h-.8c-2 0-3.3-.8-3.3-3 0-.6 0-1.1.1-1.7.1-.6.1-1.2.1-1.7 0-.6-.2-1.5-1.7-1.5l-.1-1.9zm17 1.7c-1.5 0-1.7.9-1.7 1.5s.1 1.1.1 1.7c.1.6.1 1.2.1 1.7 0 2.2-1.4 3-3.4 3h-.8V23h.4c1 0 1.3-.6 1.3-1.6 0-.4 0-.8-.1-1.2 0-.5-.1-1-.1-1.5 0-1.7.7-2.3 1.9-2.6-1.2-.3-1.9-.9-1.9-2.6 0-.6.1-1.1.1-1.5.1-.5.1-.9.1-1.3 0-1-.4-1.5-1.3-1.6h-.4V7.2h.8c2.1 0 3.4.9 3.4 3 0 .6-.1 1.1-.1 1.7-.1.6-.1 1.2-.1 1.7 0 .7.2 1.5 1.7 1.5v1.7z"/></svg>`,
};

export function createIcon(name) {
    const template = document.createElement("template");
    template.innerHTML = ICONS[name];
    const svg = template.content.firstElementChild;
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("icon");
    return svg;
}

/** A square 24px muted icon button — the app's small IconButton. */
export function createIconButton({ icon, name, title, onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn";
    if (name) button.dataset.name = name;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.append(createIcon(icon));
    if (onClick) button.addEventListener("click", onClick);
    return button;
}
