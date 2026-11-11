import type { BoardHostTextId } from "../../shared/board/host-text";
export type { BoardHostTextId } from "../../shared/board/host-text";



/** The host color palette pushed into a board: the frozen color `--p-*` contract
 *  resolved to concrete values, plus theme identity. The `vars` keys are `--p-*`
 *  names (e.g. `--p-bg`). Re-pushed on every theme switch. */
export interface BoardThemePalette {
    /** Active theme id, e.g. "default-dark". */
    id: string;
    /** True for dark themes (lets a board pick asset variants). */
    isDark: boolean;
    /** `--p-*` name → concrete CSS color value. */
    vars: Record<string, string>;
    /** The `--p-graph-*` family as concrete values, keyed by the camelCased CSS suffix
     *  (`--p-graph-node-default` → `nodeDefault`) — a `<canvas>` cannot consume `var(...)`
     *  The field is optional on the wire only: the renderer ships the family inside
     *  `vars` like every other color, and the board SHIM derives this field from it, so the
     *  palette a board actually observes always carries it. */
    graph?: Record<string, string>;
}

export type BoardI18nMessage = string | Partial<Record<"zero" | "one" | "two" | "few" | "many" | "other", string>>;
export type BoardI18nTable = Record<string, BoardI18nMessage>;

/** Registration-time locale and board messages, ordered current/base/default. */
export interface BoardI18nContext {
    locale: { code: string };
    tables: [BoardI18nTable, BoardI18nTable, BoardI18nTable];
}

/** App-catalog strings used by Persephone's built-in board UI. */
export type BoardHostText = Record<BoardHostTextId, string>;

/** The board context baked into served HTML by the `board://` handler as
 *  `window.__persephoneBoot` — read synchronously by the shim
 *  before the first author script, replacing the old synchronous `getContext` IPC.
 *  The board root is NOT included: main fills the default `execute()` cwd + relative
 *  file paths from its own `boardId → root` registry. */
export interface BoardBootContext {
    /** Initial color palette, applied by the shim at first paint. Live
     *  switches arrive later as a {@link MainToBoard} `theme` envelope over the port. */
    theme: BoardThemePalette;
    /** Locale and board message tables fixed for this document registration. */
    i18n: BoardI18nContext;
    /** Resolved app-catalog text used by Persephone's built-in board UI. */
    hostText: BoardHostText;
    /** Static metric vars (`--p-space-*`, `--p-radius-*`, …) — theme-independent. */
    tokens: Record<string, string>;
    /** The host renderer's origin. The shim accepts the port handshake only when
     *  `event.origin === hostOrigin` and `event.source === window.parent`. */
    hostOrigin: string;
}