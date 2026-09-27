import type { SvgIconComponent } from "../../theme/icons";
import { BoardIcon } from "../../theme/icons";
import { DefaultIcon } from "../../theme/language-icons";
import { fs } from "../../api/fs";
import { fpBasename, fpExtname } from "../../core/utils/file-path";
import { prepareFileIconAsync, resolveFileIcon } from "../../components/icons/language-icon-resolver";
import { getBoardIconPathSync, resolveBoardIcon } from "./board-icon-cache";

/**
 * `persephone.icons.forFiles()` host side (US-1533): resolve file names to the icon Persephone
 * shows for them, as image URLs a board frame can load. Every URL is a `data:` URL because the
 * board protocol's CSP allows `img-src 'self' data: blob:` and not `file:`.
 */

const MAX_NAMES = 500;
const MAX_NAME_LENGTH = 260;
const ICON_SIZE = 16;

/** The reply shape: distinct URLs once, and each requested name pointing at one of them. */
export interface BoardFileIcons {
    urls: string[];
    icons: Record<string, number>;
}

const BOARD_ICON_MIME: Record<string, string> = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
};

/** Serialize a DOM-built icon. `currentColor` means nothing inside an `<img>`, so it becomes the
 *  theme's icon colour; the board re-requests on a theme change (the shim drops its cache). */
function svgIconUrl(icon: SvgIconComponent, iconColor: string): string {
    const element = icon.createElement({ width: ICON_SIZE, height: ICON_SIZE });
    element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svg = element.outerHTML.replace(/currentColor/g, iconColor);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function boardIconUrl(boardRoot: string, iconColor: string): Promise<string> {
    const path = getBoardIconPathSync(boardRoot) ?? await resolveBoardIcon(boardRoot);
    const mime = path ? BOARD_ICON_MIME[fpExtname(path).toLowerCase()] : undefined;
    if (path && mime) {
        try {
            const bytes = await fs.readBinary(path);
            return `data:${mime};base64,${bytes.toString("base64")}`;
        } catch {
            // Unreadable icon file: fall back to the generic board glyph.
        }
    }
    return svgIconUrl(BoardIcon, iconColor);
}

async function iconUrlFor(name: string, iconColor: string): Promise<{ key: string; url: () => Promise<string> }> {
    await prepareFileIconAsync(name);
    const resolved = resolveFileIcon(name);
    switch (resolved.kind) {
        case "board":
            return { key: `board:${resolved.boardRoot}`, url: () => boardIconUrl(resolved.boardRoot, iconColor) };
        case "system":
            return { key: `system:${resolved.url}`, url: async () => resolved.url };
        case "component":
            return { key: `component:${fpExtname(name).toLowerCase()}:${name.toLowerCase()}`, url: async () => svgIconUrl(resolved.Icon, iconColor) };
        default:
            return { key: "default", url: async () => svgIconUrl(DefaultIcon, iconColor) };
    }
}

/** Resolve names (basenames are used; paths are accepted) to deduplicated `data:` URLs. */
export async function resolveBoardFileIcons(names: readonly unknown[]): Promise<BoardFileIcons> {
    const iconColor = getComputedStyle(document.documentElement).getPropertyValue("--color-icon-default").trim()
        || "#cccccc";
    const urls: string[] = [];
    const icons: Record<string, number> = {};
    const indexByKey = new Map<string, number>();
    const indexByUrl = new Map<string, number>();

    for (const name of names.slice(0, MAX_NAMES)) {
        if (typeof name !== "string" || !name || name.length > MAX_NAME_LENGTH || name in icons) continue;
        const { key, url } = await iconUrlFor(fpBasename(name), iconColor);
        let index = indexByKey.get(key);
        if (index === undefined) {
            const value = await url();
            // Different keys can still produce one URL (two extensions, one language icon).
            index = indexByUrl.get(value) ?? urls.push(value) - 1;
            indexByUrl.set(value, index);
            indexByKey.set(key, index);
        }
        icons[name] = index;
    }
    return { urls, icons };
}
