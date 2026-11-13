import type { TOneState } from "../../core/state/state";
import type { EditorModelInstance as EditorModel } from "../../editors/base";
import type { IContentPipe } from "../types/io.pipe";
import type { ISecondaryViewsState, SecondaryViewsModel } from "./SecondaryViewsModel";
import type { IPageState } from "./PageModel";
import type { NavEntry } from "../../../shared/persistence";

/**
 * The editor↔owner contract that `EditorModel.page` is typed as. `PageModel`
 * implements it in full; a future `BrowserPanelHost` implements the
 * required members and omits the optional main-editor-navigation group.
 *
 * The required core (identity, reactive state, panels/sidebar)
 * is shared by every host. The optional members are main-editor navigation — a
 * host that never swaps a main editor (e.g. the Browser empty page) omits them,
 * and call sites reach them through optional chaining (`editor.page?.foo?.()`).
 */
export interface IPageHost {
    // identity + reactive page state
    readonly id: string;
    readonly state: TOneState<IPageState>;

    // panels / sidebar — every host has panels
    panelEditors: EditorModel[];
    activePanel: string;
    /** Bare panel-type id of the active panel (`activePanel` is the composite
     *  `${editorId}::${panelId}`). Use for "is panel X expanded" checks. */
    activePanelId: string;
    hasSidebar: boolean;
    /** Whether the sidebar is mandatory-open (cannot be closed). PageModel
     *  computes the Explorer-only-closeable rule; an embedded `BrowserPanelHost`
     *   returns `true`. Read by the close affordances (toggle / ✕). */
    sidebarMandatory?: boolean;
    expandPanel(panelId: string): void;
    setActivePanel(panel: string): void;
    setSecondaryViewsState(patch: Partial<ISecondaryViewsState>): void;
    rememberSecondaryViewsWidth?(width?: number): void;
    secondaryViewsModel: SecondaryViewsModel | null;
    ensureSecondaryViewsModel(): SecondaryViewsModel;
    canOpenNavigator(pipe?: IContentPipe | null, filePath?: string): boolean;
    toggleNavigator(pipe?: IContentPipe | null, filePath?: string): Promise<void>;
    releaseEditor(editor: EditorModel, options: { dispose: boolean }): Promise<void>;

    // Markdown in-page back-navigation history 
    pushNavBack(entry: NavEntry): void;
    popNavBack(): NavEntry | undefined;

    // ── OPTIONAL — page-tab property (an embedded host isn't a pinnable tab) ──
    pinned?: boolean;
    /** The board a board-mode window was launched for; its tab is locked first. */
    readonly isLockedBoardPage?: boolean;

    // ── OPTIONAL — main-editor navigation (a Browser host omits these).
    //    Membership is final after Link exercised the full surface: every
    //    member below has a live `editor.page?.…` caller. `setMainEditor`/`close`
    //    were trimmed — they are only ever called via the concrete `pages` model,
    //    never through `editor.page`. ──
    mainEditor: EditorModel | null;
    switchMainEditor?(newEditorId: string): Promise<void>;
    promoteToMain?(editor: EditorModel): Promise<void>;
}
