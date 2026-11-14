import { EditorId } from "../../../shared/editor-ids";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import { TComponentState } from "../../core/state/state";
import type { EditorStateBase } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import { TextFileModel } from "../content-host/TextFileModel";
import { FRAGMENT_NAV_TRAIT } from "../base/editor-traits";
import { ViewPort } from "../base/view-port";
import { MarkdownSearchState } from "./MarkdownSearchState";
import type {
    MarkdownBodyState,
    MarkdownBodyViewPort,
    MarkdownQueueEvent,
    MarkdownQueueRequest,
} from "./MarkdownBodyModel";

export type { MarkdownQueueEvent, MarkdownQueueRequest } from "./MarkdownBodyModel";

/**
 * HS1 host-slot shape — `compactMode` rides `host.editorSettings["md-view"]`
 * so it survives Markdown↔Monaco switches AND app restarts (PV2/PV6 HS1
 * amendment 2026-05-21).
 */
interface MarkdownViewSettings {
    compactMode?: boolean;
}

export interface MarkdownEditorState extends EditorStateBase, MarkdownBodyState {
    // HS1 — rides host.editorSettings["md-view"]. Bounded boolean.
    compactMode: boolean;
    // View-derived — present on state for in-session reactivity, stripped
    // from getRestoreData per PV2 / MO5 / GR8 pattern. Search is a transient
    // gesture; persisting it surprises the user on next open.
    searchVisible: boolean;
    searchText: string;
    currentMatchIndex: number;
    totalMatches: number;
}

export const defaultMarkdownEditorState: MarkdownEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
    compactMode: false,
    searchVisible: false,
    searchText: "",
    currentMatchIndex: 0,
    totalMatches: 0,
};

export class MarkdownEditor extends TextHostEditorModel<
    MarkdownEditorState,
    MarkdownQueueEvent,
    MarkdownQueueRequest
> {
    readonly editorId = EditorId.mdView;
    protected readonly displayName = "Markdown";

    private readonly viewPort = new ViewPort<MarkdownBodyViewPort>();
    private readonly searchState: MarkdownSearchState<MarkdownEditorState>;

    constructor(state: TComponentState<MarkdownEditorState>) {
        super(state);
        this.searchState = new MarkdownSearchState(state);
        this.traits.add(FRAGMENT_NAV_TRAIT, {
            revealFragment: (fragment) => this.revealFragment(fragment),
        });
    }

    focus(): void {
        this.queue.send({ type: "focus" });
    }

    /** — scroll to a heading anchor from a `#fragment` link. The body may
     *  not be mounted yet (this runs right after the editor is attached to the
     *  page); `ComponentQueue` buffers the event and drains it on subscribe. */
    revealFragment(fragment: string): void {
        if (fragment) this.queue.send({ type: "anchor", fragment });
    }

    /** Back-navigate the page to the previous Markdown document. Pops
     *  the page's back stack and re-opens that entry in place. Goes straight
     *  through `openRawLink` (not the link interceptor), so it does not push a
     *  new history entry. No-op when there's no page or no history. */
    navigateBack = async (): Promise<void> => {
        const page = this.page;
        const pageId = page?.id;
        if (!page || !pageId) return;
        const entry = page.popNavBack();
        if (!entry) return;
        await app.events.openRawLink.sendAsync(
            createLinkData(entry.href, { pageId, target: EditorId.mdView }),
        );
    };

    followLink(href: string): boolean {
        const page = this.page;
        const pageId = page?.id;
        if (!page || !pageId) return false;

        const current = this.host?.state.get();
        if (current?.filePath) {
            page.pushNavBack({ href: current.filePath, title: current.title });
        }
        void app.events.openRawLink.sendAsync(
            createLinkData(href, { pageId, target: EditorId.mdView, sourceId: "markdown-link" }),
        );
        return true;
    }

    adoptHost(host: TextFileModel): void {
        super.adoptHost(host);

        // The vanilla body subscribes to host.state and updates its owned
        // MarkdownBlockView directly; no editor-side content event is needed.

        // HS1 — seed `compactMode` from host slot (sync, no flicker) and mirror
        // changes back. Slice-bound so search-state mutations (the dominant
        // write source) never trigger a host-slot write.
        this.mirrorHostSettings<MarkdownViewSettings>(
            (saved) => {
                if (saved.compactMode !== undefined) {
                    this.state.update((s) => {
                        s.compactMode = saved.compactMode;
                    });
                }
            },
            (s) => ({ compactMode: s.compactMode }),
            (s) => s.compactMode,
        );
    }

    // ── View-driven setters / state mutators ────────────────────────────

    attachViewPort(port: MarkdownBodyViewPort): () => void {
        return this.viewPort.attach(port);
    }

    toggleCompact = (): void => {
        this.state.update((s) => {
            s.compactMode = !s.compactMode;
        });
    };

    openSearch = (): void => this.searchState.open();

    closeSearch = (): void => this.searchState.close();

    setSearchText = (text: string): void => this.searchState.setText(text);

    /** Called from the view's `onMatchCountChange` bridge — clamps the index
     *  when the count changes (e.g., user types extra chars and total drops). */
    setMatchCount = (count: number): void => this.searchState.setMatchCount(count);

    nextMatch = (): void => this.searchState.next();

    prevMatch = (): void => this.searchState.prev();

    // ── Facade-only accessors ─────────────────────────────────────

    get containerInnerHtml(): string | undefined {
        return this.viewPort.get()?.renderedHtml();
    }

    get viewMounted(): boolean {
        return this.viewPort.get() !== undefined;
    }

    async dispose(): Promise<void> {
        this.viewPort.clear();
        await super.dispose();
    }
}
