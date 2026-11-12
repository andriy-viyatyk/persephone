import { t } from "../../../shared/i18n/t";
import type { EditorView } from "../../../shared/types";
import { editorRegistry } from "../../editors/base/editorRegistry";
import { ExplorerEditor, getDefaultExplorerEditorState } from "../../editors/explorer";
import { newTextFileModel } from "../../editors/text";
import { TComponentState } from "../../core/state/state";
import { guard } from "../../core/utils/guard";
import { attachEditorToPage } from "../../editors/editor-factory";
import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";
import { ABOUT_PAGE_ID } from "../../editors/about/about-page-id";
import { SETTINGS_PAGE_ID } from "../../editors/settings/settings-page-id";
import { MNEME_CONFIG_PAGE_ID } from "../../editors/mneme-config/mneme-config-page-id";
import { STORYBOOK_PAGE_ID } from "../../editors/storybook/storybook-page-id";
import { TOOLS_HUB_PAGE_ID } from "../../editors/tools-hub/tools-hub-page-id";
import type { HubTab } from "../../editors/tools-hub";

type TextHostPageId = "mcp-ui-log" | "mcp-server-log";
type FixedStandalonePageId =
    | "about-page" | "settings-page" | "mneme-config-page" | "storybook-page"
    | "tools-hub-page" | "clipboard-page" | TextHostPageId;
type StandalonePageId = FixedStandalonePageId | "video-player";
type EditorOrCustomPageId = Exclude<StandalonePageId, TextHostPageId>;

export interface StandalonePageOptions {
    atContents?: boolean;
    tab?: HubTab;
}

interface StandalonePageEntry {
    id: StandalonePageId;
    build:
        | { kind: "editor"; editorId: EditorView }
        | { kind: "text-host"; editorId: EditorView; language: string; title: string }
        | { kind: "custom"; build: (model: PagesModel) => Promise<PageModel> };
    afterShow?: (page: PageModel, options: StandalonePageOptions) => void | Promise<void>;
}

const MCP_UI_LOG_TITLE = "MCP Log.log.jsonl";
const MCP_SERVER_LOG_TITLE = "MCP Server Log.log.jsonl";

export class StandalonePages {
    private readonly entries = new Map<StandalonePageId, StandalonePageEntry>([
        [ABOUT_PAGE_ID, {
            id: ABOUT_PAGE_ID,
            build: { kind: "editor", editorId: "about-view" },
            afterShow: async (page, options) => {
                if (!options.atContents) return;
                const { AboutEditor } = await import("../../editors/about");
                const editor = page.mainEditorInstance;
                if (editor instanceof AboutEditor) editor.resetGuideBrowser();
            },
        }],
        [SETTINGS_PAGE_ID, {
            id: SETTINGS_PAGE_ID,
            build: { kind: "editor", editorId: "settings-view" },
        }],
        [MNEME_CONFIG_PAGE_ID, {
            id: MNEME_CONFIG_PAGE_ID,
            build: { kind: "editor", editorId: "mneme-config" },
        }],
        [STORYBOOK_PAGE_ID, {
            id: STORYBOOK_PAGE_ID,
            build: { kind: "editor", editorId: "storybook-view" },
        }],
        [TOOLS_HUB_PAGE_ID, {
            id: TOOLS_HUB_PAGE_ID,
            build: { kind: "editor", editorId: "tools-hub-view" },
            afterShow: async (page, options) => {
                if (!options.tab) return;
                const { ToolsHubEditor } = await import("../../editors/tools-hub");
                const editor = page.mainEditorInstance;
                if (editor instanceof ToolsHubEditor) editor.setTab(options.tab);
            },
        }],
        ["clipboard-page", {
            id: "clipboard-page",
            build: {
                kind: "custom",
                build: async (model) => {
                    const page = this.createPage("clipboard-page");
                    const state = new TComponentState({
                        ...getDefaultExplorerEditorState(),
                        rootPath: "",
                        hideExplorer: true,
                        clipboardOpen: true,
                    });
                    page.attach(new ExplorerEditor(state));
                    const explorer = page.findExplorer();
                    if (explorer instanceof ExplorerEditor) await explorer.restore();
                    page.ensureSecondaryViewsModel();
                    page.expandPanel("clipboard");
                    return model.addPage(null, page);
                },
            },
            afterShow: (page) => {
                const explorer = page.findExplorer();
                if (explorer instanceof ExplorerEditor) explorer.openClipboard();
            },
        }],
        ["mcp-ui-log", {
            id: "mcp-ui-log",
            build: { kind: "text-host", editorId: "log-view", language: "jsonl", title: MCP_UI_LOG_TITLE },
        }],
        ["mcp-server-log", {
            id: "mcp-server-log",
            build: { kind: "text-host", editorId: "log-view", language: "jsonl", title: MCP_SERVER_LOG_TITLE },
        }],
        ["video-player", {
            id: "video-player",
            build: { kind: "editor", editorId: "video-view" },
        }],
    ]);

    constructor(
        private readonly model: PagesModel,
        private readonly createPage: (id?: string) => PageModel,
    ) {}

    requireTextPage(id: TextHostPageId): PageModel {
        const entry = this.entries.get(id);
        if (!entry || entry.build.kind !== "text-host") {
            throw new Error(`Unknown text-host page ID: "${id}"`);
        }
        const build = entry.build;

        const existing = this.model.query.findPage(id);
        if (existing) {
            this.model.navigation.showPage(existing.id);
            return existing;
        }

        const editorModel = newTextFileModel("");
        editorModel.state.update((state) => {
            state.id = id;
            state.title = build.title;
            state.language = build.language;
            state.editor = editorRegistry.validateForLanguage(
                build.editorId,
                build.language,
            ) as EditorView;
        });
        editorModel.restore();
        return this.model.addPage(attachEditorToPage(editorModel), this.createPage(id));
    }

    async show(
        id: EditorOrCustomPageId,
        options: StandalonePageOptions = {},
    ): Promise<PageModel | undefined> {
        const entry = this.entries.get(id);
        if (!entry || entry.build.kind === "text-host") {
            throw new Error(`Unknown standalone page ID: "${id}"`);
        }

        const isVideoPlayer = id === "video-player";
        let page = isVideoPlayer ? undefined : this.model.query.findPage(id);
        if (page) {
            this.model.navigation.showPage(page.id);
        } else {
            page = await guard(
                t("api.failedToOpenEditor", { editorId: entry.build.kind === "editor" ? entry.build.editorId : id }),
                async () => {
                    if (entry.build.kind === "custom") return entry.build.build(this.model);
                    const editor = await editorRegistry.createEditor(entry.build.editorId);
                    return this.model.addPage(editor, this.createPage(isVideoPlayer ? undefined : entry.id));
                },
            );
        }

        if (page) await entry.afterShow?.(page, options);
        return page;
    }
}
