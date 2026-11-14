import { EditorId } from "../../../shared/editor-ids";
import { EditorModel, type EditorStateBase } from "../base/EditorModel";
import { untranslated } from "../../../shared/i18n/t";
import { TOOLS_HUB_PAGE_ID } from "./tools-hub-page-id";

export { TOOLS_HUB_PAGE_ID } from "./tools-hub-page-id";

/** Which content tab the hub shows. Persisted in editor state (survives restart). */
export type HubTab = "editors" | "search" | "tools" | "site-extensions";
const VALID_HUB_TABS: readonly HubTab[] = ["editors", "search", "tools", "site-extensions"];

function restoreHubTab(value: unknown): HubTab {
    if (value === "builtin" || value === "boards") return "editors";
    return VALID_HUB_TABS.includes(value as HubTab) ? value as HubTab : "editors";
}

export interface ToolsHubEditorState extends EditorStateBase {
    /** State-type discriminator. */
    tab: HubTab;
}

export const getDefaultToolsHubEditorState = (): ToolsHubEditorState => ({
    id: TOOLS_HUB_PAGE_ID,
    title: untranslated("Tools & Editors"),
    modified: false,
    editor: EditorId.toolsHubView,
    tab: "editors",
});

/**
 * Tools & Editors hub — a singleton full-page counterpart to the AppBar "Tools & Editors"
 * slide-out panel. Four content tabs (Editors / Search boards / Tools / Site extensions)
 * plus a Pinned rail. Like About/Storybook it is a page-sized
 * `hasContentHost: false` editor reached only via `showToolsHubPage`; the fixed page id makes
 * it a singleton (`addPage` dedupes).
 */
export class ToolsHubEditor extends EditorModel<ToolsHubEditorState> {
    /** Editor identity. Matches `EditorDescriptor.editorId`. */
    readonly editorId = EditorId.toolsHubView;

    noLanguage = true;
    skipSave = true;
    showBackgroundOrnament = true;

    setTab(tab: HubTab): void {
        if (!VALID_HUB_TABS.includes(tab)) {
            throw new Error(`Unknown Tools hub tab ${JSON.stringify(tab)}. Valid tabs: ${VALID_HUB_TABS.join(", ")}.`);
        }
        this.state.update((s) => { s.tab = tab; });
    }

    /** Preserve the title across restore (parity with About). */
    async restore(): Promise<void> {
        await super.restore();
        this.state.update((s) => {
            s.tab = restoreHubTab(s.tab);
            s.title = untranslated("Tools & Editors");
        });
    }
}
