import {
    EditorModel,
    type EditorStateBase,
} from "../base/EditorModel";

export const ABOUT_PAGE_ID = "about-page";

export interface AboutEditorState extends EditorStateBase {
    /** State-type discriminator. */
    type: "aboutPage";
}

export const getDefaultAboutEditorState = (): AboutEditorState => ({
    id: ABOUT_PAGE_ID,
    title: "About",
    modified: false,
    type: "aboutPage",
    editor: "about-view",
});

export type AboutGuideLocation =
    | { kind: "contents" }
    | { kind: "guide"; path: string; fragment?: string };

type GuideLocationListener = (location: AboutGuideLocation) => void;

/** Runtime-only navigation state for the About guide browser. */
export class AboutGuideBrowserState {
    private location: AboutGuideLocation = { kind: "contents" };
    private history: AboutGuideLocation[] = [];
    private showAgentGuidesValue = false;
    private readonly listeners = new Set<GuideLocationListener>();

    get currentLocation(): AboutGuideLocation {
        return this.location;
    }

    get canGoBack(): boolean {
        return this.history.length > 0;
    }

    get showAgentGuides(): boolean {
        return this.showAgentGuidesValue;
    }

    subscribe(listener: GuideLocationListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    openGuide(location: Extract<AboutGuideLocation, { kind: "guide" }>): void {
        this.history.push(this.location);
        this.location = location;
        this.notify();
    }

    back(): void {
        const previous = this.history.pop();
        if (!previous) return;
        this.location = previous;
        this.notify();
    }

    setShowAgentGuides(show: boolean): void {
        if (show === this.showAgentGuidesValue) return;
        this.showAgentGuidesValue = show;
        this.notify();
    }

    reset(): void {
        this.location = { kind: "contents" };
        this.history = [];
        this.showAgentGuidesValue = false;
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners) listener(this.location);
    }
}

export class AboutEditor extends EditorModel<AboutEditorState> {
    /** Editor identity. Matches `EditorDescriptor.editorId`. */
    readonly editorId = "about-view";

    readonly guideBrowser = new AboutGuideBrowserState();

    noLanguage = true;
    skipSave = true;
    showBackgroundOrnament = true;

    resetGuideBrowser(): void {
        this.guideBrowser.reset();
    }

    /** Preserve the legacy `restore()` title-reset for parity. */
    async restore(): Promise<void> {
        await super.restore();
        this.state.update((s) => { s.title = "About"; });
    }
}
