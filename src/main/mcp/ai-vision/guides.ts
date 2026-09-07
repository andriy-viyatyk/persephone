import { app as electronApp } from "electron";

import { ArgumentValidationError, numberRule, stringRule, validateCallArguments } from "../../../shared/ai-vision/argument-validation";
import type { GuideIndex, GuideTreeFolder, GuideTreeNode, GuideTreePage } from "../../../shared/guides";
import { selectReleaseNotes } from "../../../shared/guides/release-notes";
import { IAiChild, IAiMember, IAiVisible, IAiVisionDescriptor } from "../../../shared/ai-vision/types";
import { MainGuideSource } from "./guide-source";

const NO_LAYOUT_MESSAGE = "This page is a catalogue or API/format reference rather than a screen layout, so it has no ## Layout schema. Screen and editor schemas live in the corresponding pages under guides/screens, guides/editors, or the top-level screen guides.";
const GUIDE_NOT_FOUND_EXAMPLE = 'guides["editors/grid"]';

const GUIDES_MEMBERS: readonly IAiMember[] = [
    { name: "search", kind: "method", signature: "search(query: string, limit = 10)", summary: "Search documentation text across the guide corpus; use helpSearch for the live descriptor graph." },
    { name: "whatsNew", kind: "property", summary: "What's new: the release notes / changelog section for the running version, and what changed since you last saw this app; use guides[\"whats-new\"] for the complete release notes history." },
];

const GUIDE_PAGE_MEMBERS: readonly IAiMember[] = [
    { name: "layout", kind: "property", summary: "The page's ## Layout schema; catalogue and API/format reference pages may legitimately have none." },
];

const GUIDE_SEARCH_DESCRIPTOR: IAiVisionDescriptor = {
    kind: "GuideSearch",
    summary: "Text search over documentation pages.",
    members: [],
    help: "guides.search(query, limit = 10) searches documentation text across all indexed Markdown pages; use helpSearch for the live descriptor graph and object-model paths.",
};

const SEARCH_ARGUMENTS = [
    stringRule("query", 'guides.search("grid")'),
    numberRule("limit", 'guides.search("grid", 10)', { required: false, minimum: 1 }),
] as const;

export class GuidesNode implements IAiVisible {
    constructor(
        private readonly index: GuideIndex,
        private readonly source: MainGuideSource,
    ) {}

    search(...args: unknown[]) {
        const [query, requestedLimit] = validateCallArguments("guides.search", args, SEARCH_ARGUMENTS, { maxArgs: 2 });
        if (!query.trim()) {
            throw new ArgumentValidationError(
                `Invalid argument "query" for guides.search: received ${formatArgument(query)} (string); expected a non-blank string. Example: guides.search("grid")`,
            );
        }
        const limit = requestedLimit ?? 10;
        if (!Number.isFinite(limit) || !Number.isInteger(limit)) {
            throw new ArgumentValidationError(
                `Invalid argument "limit" for guides.search: received ${formatArgument(limit)} (number); expected a finite integer at least 1. Example: guides.search("grid", 10)`,
            );
        }
        return this.index.search(query, limit).then(hits => hits.map(hit => ({
            ...hit,
            call: callPath(hit.pagePath),
            open: guideUrl(hit.pagePath),
        })));
    }

    get whatsNew(): Promise<string> {
        return this.readWhatsNew();
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Guides",
            summary: "Documentation tree and text search for how to do something or where it is. Reading a page returns its text for your own use; to SHOW the user a guide, open the page's \"open\" URL — pages.openUrl(\"persephone-guide://editors/grid\") for a Markdown tab, or pages[\"about-page\"].editor.open(\"editors/grid\") for the About guide browser — never by copying its text into a new page. Use guides.search(query) for what the documentation says about X, and guides.whatsNew for what changed in this release.",
            members: GUIDES_MEMBERS,
            help: "Reading a guide page returns its text for your use; showing the user a guide means opening it — not copying its text into a new page. pages.openUrl(\"persephone-guide://editors/grid\") opens an ordinary Markdown tab, while pages[\"about-page\"].editor.open(\"editors/grid\") opens it in the About guide browser next to the version card. Every tree entry and search hit carries both strings: \"call\" to read the page, \"open\" to show it. guides.search searches documentation text; helpSearch searches the live descriptor graph for object-model paths.",
            children: async () => toChildren(await this.index.getTree()),
            index: key => typeof key === "string" ? this.createNode(key) : undefined,
            provide: name => GUIDES_MEMBERS.some(member => member.name === name)
                ? undefined
                : { value: this.createNode(name) },
            summarize: async () => projectTree(await this.index.getTree()),
        };
    }

    private createNode(path: string): IAiVisible {
        return this.source.getEntryKind(path) === "directory"
            ? new GuideFolderNode(this.index, this.source, path)
            : new GuidePageNode(this.index, path);
    }

    private async readWhatsNew(): Promise<string> {
        const page = await this.index.getPage("whats-new");
        if (!page) return `No release notes are available for Persephone ${electronApp.getVersion()}.`;
        const version = electronApp.getVersion();
        return selectReleaseNotes(page.content, version);
    }
}

Object.defineProperty(GuidesNode.prototype.search, "aiVision", { value: GUIDE_SEARCH_DESCRIPTOR });

class GuideFolderNode implements IAiVisible {
    constructor(
        private readonly index: GuideIndex,
        private readonly source: MainGuideSource,
        private readonly path: string,
    ) {}

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "GuideFolder",
            summary: `Guide folder "${this.path}".`,
            members: [],
            children: async () => toChildren(await this.getChildren()),
            index: key => typeof key === "string" ? this.createNode(joinPath(this.path, key)) : undefined,
            provide: name => ({ value: this.createNode(joinPath(this.path, name)) }),
            summarize: async () => projectNodes(await this.getChildren()),
        };
    }

    private async getChildren(): Promise<readonly GuideTreeNode[]> {
        const tree = await this.index.getTree();
        const folder = findFolder(tree, this.path);
        if (!folder) throw guideNotFound(this.path);
        return folder.children;
    }

    private createNode(path: string): IAiVisible {
        return this.source.getEntryKind(path) === "directory"
            ? new GuideFolderNode(this.index, this.source, path)
            : new GuidePageNode(this.index, path);
    }
}

class GuidePageNode implements IAiVisible {
    constructor(
        private readonly index: GuideIndex,
        private readonly path: string,
    ) {}

    get layout(): Promise<string> {
        return this.readLayout();
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "GuidePage",
            summary: `Guide page "${this.path}"; its terminal value is front-matter-stripped text.`,
            help: `Read this page for its text; show it by opening pages.openUrl("${guideUrl(this.path)}") as a Markdown tab or pages["about-page"].editor.open("${this.path}") in the About browser — not by copying its text into a new page.`,
            members: GUIDE_PAGE_MEMBERS,
            summarize: async () => {
                const page = await this.index.getPage(this.path);
                if (!page) throw guideNotFound(this.path);
                return page.content;
            },
        };
    }

    private async readLayout(): Promise<string> {
        const page = await this.index.getPage(this.path);
        if (!page) throw guideNotFound(this.path);
        const layout = await this.index.getLayout(this.path);
        return layout ?? NO_LAYOUT_MESSAGE;
    }
}

function toChildren(nodes: readonly GuideTreeNode[]): readonly IAiChild[] {
    return nodes.map(node => ({
        segment: childSegment(node),
        kind: node.kind === "folder" ? "GuideFolder" : "GuidePage",
        summary: `${node.kind === "folder" ? `folder: ${node.path}` : `${node.title}: ${node.summary}`}${formatDiagnostics(node)}`,
    }));
}

function formatDiagnostics(node: GuideTreeNode): string {
    const diagnostics = node.kind === "page"
        ? node.editorIdDiagnostics ?? []
        : collectDiagnostics(node.children);
    return diagnostics.length ? ` [${diagnostics.join(" ")}]` : "";
}

function collectDiagnostics(nodes: readonly GuideTreeNode[]): readonly string[] {
    return nodes.flatMap(node => node.kind === "page"
        ? node.editorIdDiagnostics ?? []
        : collectDiagnostics(node.children));
}

function projectTree(nodes: readonly GuideTreeNode[]): readonly GuideTreeNode[] {
    return nodes.map(projectNode);
}

function projectNodes(nodes: readonly GuideTreeNode[]): readonly GuideTreeNode[] {
    return nodes.map(projectNode);
}

function projectNode(node: GuideTreeNode): GuideTreeNode {
    if (node.kind === "folder") {
        return {
            ...node,
            call: callPath(node.path),
            children: projectTree(node.children),
        } as GuideTreeFolder & { readonly call: string };
    }
    return { ...node, call: callPath(node.path), open: guideUrl(node.path) } as GuideTreePage & { readonly call: string; readonly open: string };
}

function findFolder(nodes: readonly GuideTreeNode[], path: string): GuideTreeFolder | undefined {
    for (const node of nodes) {
        if (node.kind === "folder") {
            if (node.path === path) return node;
            const nested = findFolder(node.children, path);
            if (nested) return nested;
        }
    }
    return undefined;
}

function childSegment(node: GuideTreeNode): string {
    return isIdentifier(node.name) ? `.${node.name}` : `[${JSON.stringify(node.name)}]`;
}

function callPath(path: string): string {
    return path.split("/").every(isIdentifier)
        ? `guides.${path.split("/").join(".")}`
        : `guides[${JSON.stringify(path)}]`;
}

function guideUrl(path: string): string {
    return `persephone-guide://${path}`;
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function joinPath(parent: string, child: string): string {
    return `${parent}/${child}`;
}

function guideNotFound(path: string): Error {
    return new Error(`Guide path "${path}" was not found in the current Markdown corpus. Use "guides" to inspect available guides or "${GUIDE_NOT_FOUND_EXAMPLE}".`);
}

function formatArgument(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return String(value);
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}
