import { withEditorGuideHelp } from "./editor-guide-help";
import type { AboutEditor, AboutGuideLocation } from "../../editors/about/AboutEditor";
import { getGuideIndex } from "../../guides";
import type { IAiElementDeclaration, IAiMember, IAiVisible, IAiVisionDescriptor } from "../../../shared/ai-vision/types";
import type { GuidePage, GuideTreeFolder, GuideTreeNode } from "../../../shared/guides";
import { parseGuideUrl, PERSEPHONE_GUIDE_PREFIX } from "../../../shared/guides/guide-links";
import { errMessage } from "../../../shared/utils";
import { ui } from "../../api/ui";
import { createElements } from "../ai-vision/elements";
import { activatePageAndWaitForLayout, pageScopeSelector } from "../ai-vision/page-elements";

export const ABOUT_ELEMENTS: readonly IAiElementDeclaration[] = [
    { name: "about-root", purpose: "The complete About page containing the card and guide browser.", where: "whole About page" },
    { name: "about-content", purpose: "The About card's product, version, runtime, update, and link content.", where: "inside the left About card" },
    { name: "about-card", purpose: "The left About pane with Persephone identity, runtime information, update status, and external links.", where: "left pane of About" },
    { name: "about-check-updates", purpose: "Check whether a newer Persephone release is available.", where: "lower part of the About card" },
    { name: "about-github", purpose: "Open the Persephone GitHub repository.", where: "bottom of the About card" },
    { name: "about-report-issue", purpose: "Open the Persephone issue tracker to report a problem.", where: "bottom of the About card, beside GitHub Repository" },
    { name: "about-update-download", purpose: "Download the available Persephone update release.", where: "About update status area" },
    { name: "about-update-whats-new", purpose: "Open the in-app What's New guide for the available update.", where: "About update status area, beside Download" },
    { name: "about-splitter", purpose: "Resize the left About card pane and the right guide pane.", where: "between the About card and guide browser" },
    { name: "about-guide-browser", purpose: "The right side of About containing either guide contents or the selected guide page.", where: "right pane of About" },
    { name: "about-whats-new", purpose: "In the contents pane, show the inline What's New release-note summary.", where: "guide contents pane, What's New section" },
    { name: "about-whats-new-open", purpose: "In the contents pane, open the complete What's New guide in the About pane.", where: "guide contents pane, beside What's New" },
    { name: "about-resources", purpose: "In the contents pane, show the repository, issues, boards, and MCP resources.", where: "guide contents pane, one Resources row between What's New and the guide tree" },
    { name: "about-resource-repository", purpose: "In the contents pane, open the Persephone repository resource.", where: "Resources row, first button after the label" },
    { name: "about-resource-issues", purpose: "In the contents pane, open the Persephone issues resource.", where: "Resources row, after Repository" },
    { name: "about-resource-boards", purpose: "In the contents pane, open the in-app Boards catalogue guide.", where: "Resources row, after Issues" },
    { name: "about-resource-mcp-setup", purpose: "In the contents pane, open the in-app MCP setup guide.", where: "Resources row, last button" },
    { name: "about-show-agent-guides", purpose: "In the contents pane, include agent-audience guides in the contents tree.", where: "guide contents pane, above the guide tree" },
    { name: "about-guide-tree", purpose: "In the contents pane, browse the available guide pages and folders.", where: "guide contents pane, below its filters and resources" },
    { name: "about-guide-page", purpose: "In guide state, host the right-pane view that replaces contents for the selected guide.", where: "right pane of About, replacing guide contents" },
    { name: "about-guide-breadcrumbs", purpose: "In guide state, show the current guide's navigable folder and page trail.", where: "top of the selected guide pane" },
    { name: "about-guide-back", purpose: "In guide state, return to the previous About guide location.", where: "top-left of the selected guide pane" },
    { name: "about-guide-open-in-tab", purpose: "In guide state, open the current guide as a normal Markdown tab without changing About's location.", where: "top-right of the selected guide pane" },
    { name: "about-guide-body", purpose: "In guide state, display the rendered Markdown body of the selected guide.", where: "below the selected guide header" },
];

const ABOUT_MEMBERS: readonly IAiMember[] = [
    { name: "id", kind: "property", summary: "The concrete About editor id: about-view." },
    { name: "name", kind: "property", summary: "The About editor's registry display name." },
    { name: "open", kind: "method", signature: "open(path: string): Promise<void>", summary: "Open a validated guide in About's right pane without creating a tab; a folder path opens its index page.", caution: "activates About and changes its guide-browser location" },
    { name: "back", kind: "method", signature: "back(): Promise<void>", summary: "Return to the previous About guide-browser location; throws when history is empty.", caution: "activates About and changes its guide-browser location" },
    { name: "current", kind: "property", summary: "The current About guide-browser location: { kind: \"contents\" } or { kind: \"guide\", path, fragment? }." },
];

const GUIDE_OPEN_EXAMPLE = 'pages[i].editor.open("editors/grid")';
const GUIDE_INPUT_FORMS = 'Accepted forms are "editors/grid", "editors/grid#filtering", or a canonical guide URL with an optional fragment.';
const GUIDE_DISCOVERY = "Use guides to discover valid guide identities.";
const GUIDE_EXAMPLE = `Example: ${GUIDE_OPEN_EXAMPLE}.`;

const ABOUT_HELP = `Access via pages[i].editor after narrowing editor.id to "about-view".
About is a one-page guide browser. ${GUIDE_INPUT_FORMS} ${GUIDE_DISCOVERY} For example, ${GUIDE_OPEN_EXAMPLE}.
open(path) validates the corpus path against the renderer's all-audience GuideIndex, activates About,
waits for its page slot layout, and changes the existing right-pane state. It does not create an md-view
tab or use the ordinary raw-link pipeline. Agent-only guides are accepted and turn on the existing
Show agent guides toggle so the guide can render; that visible toggle change remains on after open() and
back() and is not silently reversed. User and both-audience guides leave the toggle unchanged.
If path names a guide folder, open() shows that folder's index page when it exists; a folder without an
index page produces an error naming the folder's pages, while a path naming neither a page nor a folder
is an unknown-guide error. current reports the resolved index page path.
current is exactly { kind: "contents" } on the contents pane, or { kind: "guide", path: "editors/grid" }
without a fragment, or { kind: "guide", path: "editors/grid", fragment: "filtering" } when supplied;
absent keys are omitted, never null or empty strings. back() activates About and consumes one history
entry; it throws when history is empty, so open a guide before calling it. On contents, guide-only
elements remain declared but are hidden; call open(path) to reveal the guide page, breadcrumbs, back,
Open in tab, and body controls. elements reports live visibility, and highlight does not navigate the
pane.`;

function displayInput(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value);
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    return `${typeof value} ${String(value)}`;
}

function invalidGuideInput(value: unknown): Error {
    return new Error(
        `Invalid About guide location ${displayInput(value)}. ${GUIDE_INPUT_FORMS} ${GUIDE_DISCOVERY} ${GUIDE_EXAMPLE}`,
    );
}

function parseAboutGuideInput(value: unknown): { path: string; fragment?: string } {
    if (typeof value !== "string") throw invalidGuideInput(value);

    const normalized = value.startsWith(PERSEPHONE_GUIDE_PREFIX)
        ? value
        : `${PERSEPHONE_GUIDE_PREFIX}${value}`;
    const parsed = parseGuideUrl(normalized);
    if (!parsed || value.includes("?")) throw invalidGuideInput(value);
    return parsed;
}

function findGuideFolder(nodes: readonly GuideTreeNode[], path: string): GuideTreeFolder | undefined {
    for (const node of nodes) {
        if (node.kind !== "folder") continue;
        if (node.path === path) return node;
        const nested = findGuideFolder(node.children, path);
        if (nested) return nested;
    }
    return undefined;
}

function folderPagePaths(folder: GuideTreeFolder): string[] {
    return folder.children.flatMap((node) =>
        node.kind === "page" ? [node.path] : folderPagePaths(node));
}

function unknownGuideError(path: string): Error {
    return new Error(`Unknown About guide ${JSON.stringify(path)}. ${GUIDE_DISCOVERY} ${GUIDE_EXAMPLE}`);
}

function folderWithoutIndexError(path: string, folder: GuideTreeFolder): Error {
    const pages = folderPagePaths(folder);
    return new Error(
        `About guide folder ${JSON.stringify(path)} has no index page. `
        + `Pages in this folder: ${pages.join(", ") || "(none)"}. ${GUIDE_DISCOVERY} ${GUIDE_EXAMPLE}`,
    );
}

export class AboutEditorFacade implements IAiVisible {
    constructor(private readonly editor: AboutEditor, readonly id: "about-view", readonly name: string) {}

    get aiVision(): IAiVisionDescriptor {
        const pageId = this.editor.page?.id;
        const elements = createElements(ABOUT_ELEMENTS, ui.highlightElement.bind(ui), {
            scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
            beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
        });
        return {
            kind: "AboutEditor",
            summary: "About page guide-browser facade.",
            members: [...ABOUT_MEMBERS, ...elements.members],
            help: withEditorGuideHelp(this.id, ABOUT_HELP),
            elements: ABOUT_ELEMENTS,
            provide: elements.provide,
            summarize: () => ({
                kind: "AboutEditor",
                id: this.id,
                name: this.name,
                current: this.current,
            }),
        };
    }

    async open(path: string): Promise<void> {
        const parsed = parseAboutGuideInput(path);
        let page: GuidePage | undefined;
        try {
            page = await getGuideIndex().getPage(parsed.path, "all");
        } catch (error) {
            throw new Error(
                `Unable to validate About guide ${JSON.stringify(parsed.path)}: ${errMessage(error)}. `
                + `${GUIDE_DISCOVERY} ${GUIDE_EXAMPLE}`,
            );
        }
        if (!page) {
            let tree: readonly GuideTreeNode[];
            try {
                tree = await getGuideIndex().getTree("all");
            } catch (error) {
                throw new Error(
                    `Unable to inspect About guide folder ${JSON.stringify(parsed.path)}: ${errMessage(error)}. `
                    + `${GUIDE_DISCOVERY} ${GUIDE_EXAMPLE}`,
                );
            }
            const folder = findGuideFolder(tree, parsed.path);
            if (!folder) throw unknownGuideError(parsed.path);

            const indexPath = `${parsed.path}/index`;
            try {
                page = await getGuideIndex().getPage(indexPath, "all");
            } catch (error) {
                throw new Error(
                    `Unable to validate About guide folder index ${JSON.stringify(indexPath)}: ${errMessage(error)}. `
                    + `${GUIDE_DISCOVERY} ${GUIDE_EXAMPLE}`,
                );
            }
            if (!page) throw folderWithoutIndexError(parsed.path, folder);
            parsed.path = page.path;
        }

        const pageId = this.requirePageId("open");
        await activatePageAndWaitForLayout(pageId);
        if (page.audience === "agent" && !this.editor.guideBrowser.showAgentGuides) {
            this.editor.guideBrowser.setShowAgentGuides(true);
        }
        this.editor.guideBrowser.openGuide({
            kind: "guide",
            path: parsed.path,
            ...(parsed.fragment ? { fragment: parsed.fragment } : {}),
        });
    }

    async back(): Promise<void> {
        if (!this.editor.guideBrowser.canGoBack) {
            throw new Error("About guide history is empty; open a guide before calling back().");
        }
        const pageId = this.requirePageId("back");
        await activatePageAndWaitForLayout(pageId);
        this.editor.guideBrowser.back();
    }

    get current(): AboutGuideLocation {
        const location = this.editor.guideBrowser.currentLocation;
        if (location.kind === "contents") return { kind: "contents" };
        return {
            kind: "guide",
            path: location.path,
            ...(location.fragment ? { fragment: location.fragment } : {}),
        };
    }

    private requirePageId(action: string): string {
        const pageId = this.editor.page?.id;
        if (!pageId) throw new Error(`About action unavailable: cannot ${action} without an About page host.`);
        return pageId;
    }
}
