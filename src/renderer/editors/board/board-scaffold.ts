import { api } from "../../../ipc/renderer/api";
import { fs } from "../../api/fs";
import { ui } from "../../api/ui";
import { boardTrust } from "../../api/board-trust";
import { settings } from "../../api/settings";
import { fpJoin } from "../../core/utils/file-path";
import {
    defaultBoardManifest,
    ensureBoardManifest,
    readBoardManifest,
    writeBoardManifest,
} from "./board-manifest";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";

/**
 * Populate a fresh board folder by recursively copying a bundled template into
 * it. `template` selects which `assets/<template>/` folder to
 * copy — `"board-template"` (default) for a blank board, `"demo-board"` for the
 * demo.
 *
 * Every board also receives the shared `assets/board-base.css` (page background,
 * themed scrollbars, monospace default) — maintained once, copied into each board,
 * and linked by both templates' `index.html`.
 *
 * The caller (`BoardEditorModel.createBoard` / `createDemoBoard`) guarantees the
 * destination is a brand-new, empty folder (it errors on a name collision first),
 * so there is no skip-if-exists guard here — every template file is copied
 * unconditionally. `assets/` ships via electron-builder's `extraResources`, so the
 * template + base stylesheet are present beside the app in both dev and packaged builds.
 */
export async function scaffoldBoard(destDir: string, template = "board-template"): Promise<void> {
    const appRoot = await api.getAppRootPath();
    const assetsRoot = fpJoin(appRoot, "assets");
    await copyDirInto(fpJoin(assetsRoot, template), destDir);
    // Every board also gets the shared base stylesheet (page bg, themed scrollbars,
    // monospace default) — maintained once in assets/board-base.css and copied in.
    // Both templates link it via <link href="./board-base.css">.
    await fs.copyFile(fpJoin(assetsRoot, "board-base.css"), fpJoin(destDir, "board-base.css"));
    if (template === "board-template") {
        await generateBoardAuthoringGuide(assetsRoot, destDir);
    }
}

const BOARD_GUIDE_EXCLUSION_START = "<!-- board-template:exclude -->";
const BOARD_GUIDE_EXCLUSION_END = "<!-- /board-template:exclude -->";

async function generateBoardAuthoringGuide(assetsRoot: string, boardRoot: string): Promise<void> {
    const guidePath = fpJoin(assetsRoot, "guides", "agents", "boards.md");
    const headerPath = fpJoin(assetsRoot, "board-template-header.md");
    const boardGuidePath = fpJoin(boardRoot, "CLAUDE.md");
    const temporaryPath = fpJoin(boardRoot, "CLAUDE.md.tmp");

    await fs.delete(boardGuidePath);
    try {
        const [header, guide] = await Promise.all([fs.read(headerPath), fs.read(guidePath)]);
        const content = `${header.trimEnd()}\n\n${filterBoardGuideExclusions(guide)}`;
        await fs.write(temporaryPath, content);
        await fs.rename(temporaryPath, boardGuidePath);
    } catch (err) {
        await fs.delete(temporaryPath);
        console.error("Failed to generate the blank-board CLAUDE.md from assets/guides/agents/boards.md.", err);
        throw err;
    }
}

function filterBoardGuideExclusions(guide: string): string {
    let excluded = false;
    let openingLine = 0;
    let line = 1;
    let output = "";
    let cursor = 0;
    const markers = new RegExp(`${BOARD_GUIDE_EXCLUSION_START}|${BOARD_GUIDE_EXCLUSION_END}`, "g");

    for (const marker of guide.matchAll(markers)) {
        const index = marker.index ?? 0;
        const visible = guide.slice(cursor, index);
        if (!excluded) output += visible;
        line += (guide.slice(cursor, index + marker[0].length).match(/\n/g) ?? []).length;

        if (marker[0] === BOARD_GUIDE_EXCLUSION_START) {
            if (excluded) {
                throw new Error(`Malformed board-template exclusion markers in assets/guides/agents/boards.md: nested opening marker at line ${line}.`);
            }
            excluded = true;
            openingLine = line;
        } else {
            if (!excluded) {
                throw new Error(`Malformed board-template exclusion markers in assets/guides/agents/boards.md: unmatched closing marker at line ${line}.`);
            }
            excluded = false;
        }
        cursor = index + marker[0].length;
    }

    const remainder = guide.slice(cursor);
    if (!excluded) output += remainder;
    if (excluded) {
        throw new Error(`Malformed board-template exclusion markers in assets/guides/agents/boards.md: unmatched opening marker at line ${openingLine}.`);
    }
    return output;
}

/**
 * Create a board named `name` inside the container folder `dir`, scaffolded from
 * `template`. This is the canonical, **editor-independent**
 * board-creation API:
 * - the Explorer Boards panel's "New board" flow calls it (via the Create dialog);
 * - exposes it on the `app` object model + an MCP tool so an agent can
 *   create a board at any path, at any time, with no board editor open.
 *
 * Errors on a name collision; on a template-copy failure it still produces a
 * usable (empty) board folder + warns. Always guarantees the board-identity
 * manifest exists. A board Persephone creates is **auto-trusted at creation**
 *  — by provenance, not a manifest field — so an authored board
 * never hits the trust gate. Returns the created board's absolute root.
 */
export async function createBoardFromTemplate(name: string, dir: string, template: string): Promise<string> {
    const boardRoot = fpJoin(dir, name);
    if (await fs.exists(boardRoot)) {
        throw new Error(`A board named "${name}" already exists in "${dir}".`);
    }
    try {
        await scaffoldBoard(boardRoot, template);
    } catch (err) {
        // Template missing / copy failed — still produce a usable (empty) board.
        console.error(`Failed to scaffold board "${name}" from template "${template}".`, err);
        await fs.mkdir(boardRoot);
        ui.notify(t("board.boardCreatedTemplateCopyFailed", { error: errMessage(err) }), "warning");
    }
    // Guarantee the board-identity manifest exists regardless of which path ran
    // above (template copy or empty fallback) — a board is identified by it.
    await ensureBoardManifest(boardRoot);
    const manifest = await readBoardManifest(boardRoot) ?? defaultBoardManifest(name);
    const configuredAuthor = settings.get("boards.default-author");
    manifest.name = name;
    manifest.author = typeof configuredAuthor === "string" ? configuredAuthor : "";
    await writeBoardManifest(boardRoot, manifest);
    // Auto-trust a Persephone-created board: provenance-based registry write,
    // never a manifest self-declaration. Covers the list editor + the MCP create.
    await boardTrust.trust(boardRoot);
    return boardRoot;
}

async function copyDirInto(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest);
    const entries = await fs.listDirWithTypes(src);
    for (const entry of entries) {
        const from = fpJoin(src, entry.name);
        const to = fpJoin(dest, entry.name);
        if (entry.isDirectory) {
            await copyDirInto(from, to);
        } else {
            await fs.copyFile(from, to);
        }
    }
}
