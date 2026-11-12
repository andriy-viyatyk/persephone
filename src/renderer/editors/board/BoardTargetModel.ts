import type { IBrowserTarget, IInputPoint, ITargetTab } from "../../automation/types";
import { CdpSession } from "../../automation/CdpSession";
import { BOARD_CDP_TAB } from "../../../ipc/api-types";
import { panelKey } from "../../api/pages/panel-key";
import { boardSecondaryPanelId, parseBoardSecondaryPanelId } from "./board-secondary";
import type { BoardFrameRegistry } from "./model/BoardFrameRegistry";
import type { BoardEditorModel } from "./BoardEditorModel";

/**
 * `IBrowserTarget` adapter for board automation. The board has no `WebContents` of its
 * own, so commands route through the host window's `<iframe>`.
 *
 * A board has no navigation or agent-creatable tabs, but it can have several frames:
 * the main view and each declared secondary view. `tabs` exposes those frames,
 * `switchTab` selects one, and `cdp(tabId?)`, `focusWebview`, and `insertText`
 * operate on the active or explicitly selected frame. Each frame has a separate
 * CDP registration, resolved by its `?v=` nonce.
 *
 * The active tab defaults to `main`, so behavior stays unchanged until a secondary
 * view is selected. Selecting one expands its sidebar panel and waits for the frame
 * to register before issuing commands. Navigation and tab creation or closing return
 * clear errors because a board has fixed frames and no page navigation.
 */
const NAV_MSG =
    "Navigation is not supported on board pages — a board is a single fixed document. " +
    "Use the board's own scripts (persephone.execute) to change its content.";
const TAB_MSG =
    "Tabs cannot be created or closed on board pages — a board's frames (its main view + " +
    "declared secondary views) are fixed by its manifest. Use the editor's tabs and switchTab() to switch between them.";

export class BoardTargetModel implements IBrowserTarget {
    constructor(private readonly model: BoardEditorModel, private readonly registry: BoardFrameRegistry) {}

    get id(): string {
        return this.model.id;
    }

    cdp(tabId?: string): CdpSession {
        // Route to the active tab's frame unless an explicit tab is given. The key shape
        // `${model.id}/${tab}` matches the per-frame registration in cdp-service.
        return new CdpSession(`${this.model.id}/${tabId ?? this.registry.activeTabId}`);
    }

    inputCdp(tabId?: string, sessionId?: string) {
        return {
            cdp: this.cdp(tabId),
            sessionId,
            mapPoint: (point: IInputPoint, offsets: ReadonlyArray<IInputPoint> = []) => offsets.reduce(
                (mapped, offset) => ({ x: mapped.x + offset.x, y: mapped.y + offset.y }), point,
            ),
        };
    }

    focusWebview(tabId?: string): void {
        // Focus remains available to the explicit synthetic compatibility path. Trusted mouse
        // and keyboard input use the resolved board-frame CDP session; the cross-origin
        // contentWindow itself cannot be focused.
        this.registry.getFrame(tabId ?? this.registry.activeTabId)?.focus();
    }

    async insertText(text: string, tabId?: string): Promise<void> {
        // The board frame is cross-origin — the host renderer can't reach its DOM (SOP).
        // Insert at the focused element via the board-frame CDP session instead. The
        // caller (input.ts) has already focused the target element via the same session.
        await this.cdp(tabId).evaluate(`document.execCommand('insertText', false, ${JSON.stringify(text)})`);
    }

    navigate(): void {
        throw new Error(NAV_MSG);
    }
    back(): void {
        throw new Error(NAV_MSG);
    }
    forward(): void {
        throw new Error(NAV_MSG);
    }
    reload(): void {
        // Soft reload = remount the board frames (the existing toolbar Reload /
        // pages[i].editor.reload() path. Re-handshakes the bridge + re-registers CDP on load.
        this.model.reloadBoard();
    }

    get tabs(): ReadonlyArray<ITargetTab> {
        const s = this.model.state.get();
        const defs = s.secondaryViewDefs ?? [];
        const mainTab: ITargetTab = {
            id: BOARD_CDP_TAB,
            url: "board:///index.html",
            title: s.selectedBoard ?? "Board",
            loading: false,
            active: this.registry.activeTabId === BOARD_CDP_TAB,
        };
        const secondaryTabs = defs.map<ITargetTab>((d) => {
            const id = boardSecondaryPanelId(d.id);
            return {
                id,
                url: `board:///${d.html ?? "index.html"}?view=${encodeURIComponent(d.id)}`,
                title: d.title ?? d.id,
                // `loading:true` means "declared but not attachable yet" — its sidebar panel
                // is closed, or open but its frame hasn't registered for CDP. switchTab /
                // ensureReady open it and wait on demand.
                loading: !this.registry.isLoaded(id),
                active: this.registry.activeTabId === id,
            };
        });
        return [mainTab, ...secondaryTabs];
    }

    get activeTab(): ITargetTab | undefined {
        return this.tabs.find((t) => t.active) ?? this.tabs[0];
    }

    addTab(): string {
        throw new Error(TAB_MSG);
    }
    closeTab(): void {
        throw new Error(TAB_MSG);
    }

    /**
     * Select which board frame `browser_*` drives. Selecting the main frame is instant;
     * selecting a secondary view auto-expands its sidebar panel and WAITS until the frame
     * is CDP-attachable, so the command that follows always succeeds.
     */
    async switchTab(tabId: string): Promise<void> {
        if (tabId === BOARD_CDP_TAB) {
            this.registry.selectTab(BOARD_CDP_TAB);
            return;
        }
        const viewId = parseBoardSecondaryPanelId(tabId);
        if (viewId === null || !this.registry.hasSecondaryView(viewId)) throw new Error(`Unknown board view '${tabId}'.`);
        this.registry.selectTab(tabId);
        await this.mountAndWait(tabId);
    }

    /**
     * Readiness gate the dispatcher awaits before EVERY board command. If the active tab is
     * a secondary view whose frame isn't attachable yet — panel closed, or open but still
     * loading — expand + wait here so the command that follows always succeeds. A no-op for
     * the main tab and for an already-ready secondary (resolves immediately).
     */
    async ensureReady(tabId = this.registry.activeTabId): Promise<void> {
        if (tabId === BOARD_CDP_TAB) return;
        // The registry records when a frame REGISTERED for CDP — not whether it is on screen.
        // A secondary panel that has loaded and then been collapsed keeps its frame mounted and
        // registered, and Chromium omits hidden subtrees from the accessibility tree, so a
        // snapshot of a loaded-but-collapsed frame comes back EMPTY instead of failing. Skipping
        // the mount for an already-loaded tab therefore produced a silent empty answer, which is
        // worse than an error. `mountAndWait` is the only thing that expands and activates the
        // panel, and it resolves immediately when the frame is already loaded, so run it for
        // every secondary tab rather than trusting the registration flag.
        await this.mountAndWait(tabId);
    }

    /**
     * Open + activate the secondary panel (so BoardWebview mounts its frame) and resolve
     * once the frame has registered for CDP. Mirrors how getTarget calls showPage to make a
     * page automatable — a visible-but-expected UI side effect.
     */
    private async mountAndWait(tabId: string): Promise<void> {
        const page = this.model.page;
        const loaded = this.waitForLoaded(tabId, 5000);
        page?.setSecondaryViewsState({ open: true });
        page?.setActivePanel(panelKey(this.model.id, tabId));
        await loaded;
    }

    /**
     * Resolve once the tab's frame has finished loading + registered for CDP
     * (the registry's loaded flag), or after `timeoutMs`. Never rejects: on the rare timeout the
     * following CDP command still runs and cdp-service's resolve-and-retry surfaces any
     * genuine failure with a real message.
     */
    private waitForLoaded(tabId: string, timeoutMs: number): Promise<void> {
        if (this.registry.isLoaded(tabId)) return Promise.resolve();
        return this.registry.waitForFrameLoad(tabId, timeoutMs).then((): void => undefined);
    }
}
