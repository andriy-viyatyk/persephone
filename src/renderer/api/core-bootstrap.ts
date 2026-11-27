import { ui } from "./ui";
import { fs } from "./fs";
import { setGuardReporter } from "../core/utils/guard";
import { TraitSet } from "../core/traits/traits";
import { traitRegistry, TraitTypeId } from "../core/traits/TraitRegistry";
import { LINK, type LinkDragData } from "../core/traits/linkTraits";
import { FILE_LINK, type OsFileData } from "../core/traits/fileLinkTraits";
import { fpBasename } from "../core/utils/file-path";
import type { IFileLink } from "./types/io.tree";

setGuardReporter((message, level) => {
    void ui.notify(message, level);
});

// ── OsFile producer (OS desktop file drops) ───────────────────────────────────

// The accessor is the factory that rebuilds the real IFileLink items from the
// serializable descriptor; getBytes reads the file from disk on demand via app.fs.
const osFileTraits = new TraitSet().add(FILE_LINK, {
    getFiles: (data) => (data as OsFileData).files.map((f) => ({
        name: f.name,
        filePath: f.path,
        getBytes: async () => fs.readBinary(f.path),
    })),
});

traitRegistry.register(TraitTypeId.OsFile, osFileTraits);

// ── ILink trait registration ─────────────────────────────────────────────────

/**
 * True for an href that is a real on-disk path (so its bytes can be copied), false
 * for URLs / curl commands / any URI scheme (`http://`, `mneme://`, `file://`, …).
 * Drives whether a link contributes file content when dropped on a file-backed
 * target (e.g. Mneme): local-file links copy, non-file links are ignored there.
 */
function isLocalFileHref(href: string): boolean {
    if (!href) return false;
    const h = href.trimStart();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) return false; // http://, mneme://, file://, …
    if (/^curl\s/i.test(h)) return false;
    return true;
}

const linkTraits = new TraitSet()
    .add(LINK, {
        getItems: (data: unknown) => (data as LinkDragData).items,
        getSourceId: (data: unknown) => (data as LinkDragData).sourceId,
        getTreeDragToken: (data: unknown) => (data as LinkDragData).treeDragToken,
    })
    // A link to a local file is also a file producer: dropping it on a file-backed
    // target (Mneme) copies the file; non-file links contribute nothing and are
    // ignored there. Bytes are read lazily so the drag payload stays small.
    .add(FILE_LINK, {
        getFiles: (data: unknown): IFileLink[] =>
            (data as LinkDragData).items
                .filter((i) => !i.isDirectory && isLocalFileHref(i.href))
                .map((i) => ({
                    name: i.title || fpBasename(i.href),
                    filePath: i.href,
                    getBytes: async () => fs.readBinary(i.href),
                })),
    });

traitRegistry.register(TraitTypeId.ILink, linkTraits);
