import { extractLayout, extractMarkdownCandidates } from "./markdown";
import { parseGuideFile } from "./front-matter";
import { BOARD_SELF_EDITOR_ID } from "./mounted-source";

export type GuideAudience = "user" | "agent" | "both";

/** `all` is the default; `user` and `agent` each include pages marked `both`. */
export type GuideAudienceFilter = GuideAudience | "all";

export type GuideSourceEntry =
    | { readonly name: string; readonly kind: "directory" }
    | { readonly name: string; readonly kind: "file"; readonly mtimeMs: number };

/** All paths are relative to `assets/guides/`; the source owns root resolution. */
export interface GuideSource {
    readDirectory(relativeDirectory: string): Promise<readonly GuideSourceEntry[]>;
    readFile(relativePath: string): Promise<string>;
}

export interface GuideFrontMatter {
    readonly title: string;
    readonly audience: GuideAudience;
    readonly summary: string;
    readonly screen?: string;
    readonly editorId?: string | readonly string[];
}

export interface GuideTreePage {
    readonly kind: "page";
    /** Slash-separated canonical key without `.md`, e.g. `editors/index`. */
    readonly path: string;
    /** The final path segment; `index` remains a page name. */
    readonly name: string;
    readonly title: string;
    readonly audience: GuideAudience;
    readonly summary: string;
    readonly screen?: string;
    readonly editorId?: string | readonly string[];
    readonly editorIdDiagnostics?: readonly string[];
}

export interface GuideTreeFolder {
    readonly kind: "folder";
    /** Slash-separated folder key, e.g. `editors`; the root is returned as children, not a node. */
    readonly path: string;
    readonly name: string;
    readonly children: readonly GuideTreeNode[];
}

export type GuideTreeNode = GuideTreeFolder | GuideTreePage;

export interface GuidePage extends GuideTreePage {
    /** Markdown body with a valid front-matter block removed; otherwise the raw file text. */
    readonly content: string;
}

export type GuideSearchMatchKind = "title" | "summary" | "heading" | "table-row" | "body";

export interface GuideSearchHit {
    readonly pagePath: string;
    readonly title: string;
    /** Nearest preceding ATX heading, or the matched heading itself; absent before any heading. */
    readonly heading?: string;
    /** A title, heading line, complete paragraph/list item, complete table row, or body block. */
    readonly passage: string;
    readonly matchKind: GuideSearchMatchKind;
    readonly score: number;
}

export interface GuideIndex {
    /** Freshly enumerate directories; returns root-level pages and folders in deterministic order. */
    getTree(audience?: GuideAudienceFilter): Promise<readonly GuideTreeNode[]>;
    /** Canonical key lookup, e.g. `index` or `editors/index`; returns undefined when not found/filter-excluded. */
    getPage(path: string, audience?: GuideAudienceFilter): Promise<GuidePage | undefined>;
    /** Case-insensitive prefix search across query tokens; hits rank by token coverage. Default limit is 10 after dedupe. */
    search(query: string, limit?: number, audience?: GuideAudienceFilter): Promise<readonly GuideSearchHit[]>;
    /** Returns the `## Layout` body, or undefined when that section is absent. */
    getLayout(path: string, audience?: GuideAudienceFilter): Promise<string | undefined>;
}

interface CachedPage {
    readonly mtimeMs: number;
    readonly page: GuidePage;
}

interface GuideFileEntry {
    readonly relativePath: string;
    readonly mtimeMs: number;
}

interface MutableFolder {
    readonly path: string;
    readonly name: string;
    readonly folders: Map<string, MutableFolder>;
    readonly pages: GuideTreePage[];
}

interface RankedGuideHit extends GuideSearchHit {
    readonly sourceLine: number;
    readonly distinctTokenCount: number;
    readonly queryTokenCount: number;
    readonly tokenOccurrences: number;
    readonly passageLength: number;
    readonly isBuiltIn: boolean;
}

interface MatchRelevance {
    readonly distinctTokenCount: number;
    readonly queryTokenCount: number;
    readonly tokenOccurrences: number;
}

const TITLE_SCORE = 300;
const SUMMARY_SCORE = 250;
const HEADING_SCORE = 200;
const TABLE_ROW_SCORE = 150;
const BODY_SCORE = 100;
const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it",
    "of", "on", "or", "the", "to", "was", "what", "when", "where", "which", "who", "why", "with",
]);

export function createGuideIndex(source: GuideSource): GuideIndex {
    const pageCache = new Map<string, CachedPage>();

    async function scan(): Promise<readonly GuideFileEntry[]> {
        return scanDirectory("");
    }

    async function scanDirectory(relativeDirectory: string): Promise<readonly GuideFileEntry[]> {
        const entries = await source.readDirectory(relativeDirectory);
        const directories = entries
            .filter(entry => entry.kind === "directory" && isSafeEntryName(entry.name))
            .map(entry => entry.name)
            .sort(compareStrings);
        const files = entries
            .filter((entry): entry is Extract<GuideSourceEntry, { readonly kind: "file" }> =>
                entry.kind === "file" && entry.name.endsWith(".md") && isSafeEntryName(entry.name))
            .sort((left, right) => compareStrings(left.name, right.name));

        const childFiles = await Promise.all(directories.map(directory => scanDirectory(joinPath(relativeDirectory, directory))));
        const filesInChildren = childFiles.flat();
        const filesInDirectory: GuideFileEntry[] = [];
        for (const entry of files) {
            const relativePath = joinPath(relativeDirectory, entry.name);
            filesInDirectory.push({ relativePath, mtimeMs: entry.mtimeMs });
        }
        return [...filesInChildren, ...filesInDirectory].sort((left, right) =>
            compareStrings(left.relativePath, right.relativePath));
    }

    async function loadPage(file: GuideFileEntry): Promise<GuidePage> {
        const cached = pageCache.get(file.relativePath);
        if (cached?.mtimeMs === file.mtimeMs) return cached.page;

        const parsed = parseGuideFile(file.relativePath, await source.readFile(file.relativePath));
        const path = file.relativePath.slice(0, -3);
        const page: GuidePage = {
            kind: "page",
            path,
            name: path.slice(path.lastIndexOf("/") + 1),
            title: parsed.frontMatter.title,
            audience: parsed.frontMatter.audience,
            summary: parsed.frontMatter.summary,
            ...(parsed.frontMatter.screen === undefined ? {} : { screen: parsed.frontMatter.screen }),
            ...(parsed.frontMatter.editorId === undefined ? {} : { editorId: parsed.frontMatter.editorId }),
            content: parsed.content,
        };
        pageCache.set(file.relativePath, { mtimeMs: file.mtimeMs, page });
        return page;
    }

    async function getTree(audience: GuideAudienceFilter = "all"): Promise<readonly GuideTreeNode[]> {
        const pages = annotateEditorIdDiagnostics(await loadPages(await scan()));
        return buildTree(pages.filter(page => audienceIncludes(page.audience, audience)));
    }

    async function getPage(path: string, audience: GuideAudienceFilter = "all"): Promise<GuidePage | undefined> {
        const files = await scan();
        if (!isSafeGuidePath(path)) return undefined;
        const file = files.find(candidate => candidate.relativePath === `${path}.md`);
        if (!file) return undefined;
        const page = await loadPage(file);
        return page && audienceIncludes(page.audience, audience) ? page : undefined;
    }

    async function search(query: string, limit = 10, audience: GuideAudienceFilter = "all"): Promise<readonly GuideSearchHit[]> {
        const allTokens = tokenizeSearchText(query);
        const substantiveTokens = allTokens.filter(token => !STOP_WORDS.has(token));
        const tokens = substantiveTokens.length > 0 ? substantiveTokens : allTokens;
        if (tokens.length === 0) return [];

        const pages = await loadPages(await scan());
        const hits: RankedGuideHit[] = [];
        for (const page of pages) {
            if (!audienceIncludes(page.audience, audience)) continue;
            const titleRelevance = getMatchRelevance(page.title, tokens);
            if (titleRelevance) {
                hits.push({
                    pagePath: page.path,
                    title: page.title,
                    passage: page.title,
                    matchKind: "title",
                    score: TITLE_SCORE,
                    sourceLine: -1,
                    ...titleRelevance,
                    passageLength: page.title.length,
                    isBuiltIn: !page.path.startsWith("installed-boards/"),
                });
            }
            const summaryRelevance = getMatchRelevance(page.summary, tokens);
            if (summaryRelevance) {
                hits.push({
                    pagePath: page.path,
                    title: page.title,
                    passage: page.summary,
                    matchKind: "summary",
                    score: SUMMARY_SCORE,
                    sourceLine: -1,
                    ...summaryRelevance,
                    passageLength: page.summary.length,
                    isBuiltIn: !page.path.startsWith("installed-boards/"),
                });
            }
            for (const candidate of extractMarkdownCandidates(page.content)) {
                const relevance = getMatchRelevance(candidate.passage, tokens);
                if (!relevance) continue;
                hits.push({
                    pagePath: page.path,
                    title: page.title,
                    ...(candidate.heading === undefined ? {} : { heading: candidate.heading }),
                    passage: candidate.passage,
                    matchKind: candidate.matchKind,
                    score: candidate.matchKind === "heading"
                        ? HEADING_SCORE
                        : candidate.matchKind === "table-row" ? TABLE_ROW_SCORE : BODY_SCORE,
                    sourceLine: candidate.sourceLine,
                    ...relevance,
                    passageLength: candidate.passage.length,
                    isBuiltIn: !page.path.startsWith("installed-boards/"),
                });
            }
        }

        const deduplicated = new Map<string, RankedGuideHit>();
        for (const hit of hits) {
            const key = JSON.stringify([hit.pagePath, hit.matchKind, hit.passage, hit.heading]);
            if (!deduplicated.has(key)) deduplicated.set(key, hit);
        }
        const sorted = [...deduplicated.values()].sort(compareHits);
        const resultLimit = Math.max(0, Math.floor(limit));
        return sorted.slice(0, resultLimit).map(({
            sourceLine: _sourceLine,
            distinctTokenCount: _distinctTokenCount,
            queryTokenCount: _queryTokenCount,
            tokenOccurrences: _tokenOccurrences,
            passageLength: _passageLength,
            isBuiltIn: _isBuiltIn,
            ...hit
        }) => hit);
    }

    async function getLayout(path: string, audience: GuideAudienceFilter = "all"): Promise<string | undefined> {
        const page = await getPage(path, audience);
        return page ? extractLayout(page.content) : undefined;
    }

    return { getTree, getPage, search, getLayout };

    async function loadPages(files: readonly GuideFileEntry[]): Promise<readonly GuidePage[]> {
        return Promise.all(files.map(loadPage));
    }
}

function annotateEditorIdDiagnostics(pages: readonly GuidePage[]): readonly GuidePage[] {
    const claims = new Map<string, string[]>();
    for (const page of pages) {
        for (const editorId of normalizeEditorIds(page.editorId)) {
            // This token means the page's own board, so sharing it across board guides is expected.
            if (editorId === BOARD_SELF_EDITOR_ID) continue;
            const paths = claims.get(editorId) ?? [];
            paths.push(page.path);
            claims.set(editorId, paths);
        }
    }

    const diagnosticsByPath = new Map<string, string[]>();
    for (const [editorId, paths] of claims) {
        if (paths.length < 2) continue;
        const diagnostic = `Duplicate editorId "${editorId}" claimed by guide pages: ${paths.join(", ")}.`;
        for (const path of paths) {
            const diagnostics = diagnosticsByPath.get(path) ?? [];
            diagnostics.push(diagnostic);
            diagnosticsByPath.set(path, diagnostics);
        }
    }

    return pages.map(page => {
        const diagnostics = diagnosticsByPath.get(page.path);
        return diagnostics === undefined ? page : { ...page, editorIdDiagnostics: diagnostics };
    });
}

function normalizeEditorIds(editorId: GuideTreePage["editorId"]): readonly string[] {
    if (editorId === undefined) return [];
    return typeof editorId === "string" ? [editorId] : editorId;
}

function buildTree(pages: readonly GuidePage[]): readonly GuideTreeNode[] {
    const root: MutableFolder = { path: "", name: "", folders: new Map(), pages: [] };
    for (const page of pages) {
        const segments = page.path.split("/");
        let folder = root;
        for (const segment of segments.slice(0, -1)) {
            const folderPath = joinPath(folder.path, segment);
            let child = folder.folders.get(folderPath);
            if (!child) {
                child = { path: folderPath, name: segment, folders: new Map(), pages: [] };
                folder.folders.set(folderPath, child);
            }
            folder = child;
        }
        folder.pages.push(toTreePage(page));
    }

    return sortNodes([
        ...[...root.folders.values()].map(buildFolder),
        ...root.pages,
    ]);
}

function buildFolder(folder: MutableFolder): GuideTreeFolder {
    return {
        kind: "folder",
        path: folder.path,
        name: folder.name,
        children: sortNodes([
            ...[...folder.folders.values()].map(buildFolder),
            ...folder.pages,
        ]),
    };
}

function sortNodes(nodes: readonly GuideTreeNode[]): readonly GuideTreeNode[] {
    return [...nodes].sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
        return compareStrings(left.path, right.path);
    });
}

function toTreePage(page: GuidePage): GuideTreePage {
    const { content: _content, ...treePage } = page;
    return treePage;
}

function compareHits(left: RankedGuideHit, right: RankedGuideHit): number {
    const leftFullCoverage = left.distinctTokenCount === left.queryTokenCount;
    const rightFullCoverage = right.distinctTokenCount === right.queryTokenCount;
    return Number(rightFullCoverage) - Number(leftFullCoverage)
        || right.distinctTokenCount - left.distinctTokenCount
        || right.score - left.score
        || Number(right.isBuiltIn) - Number(left.isBuiltIn)
        || left.passageLength - right.passageLength
        || right.tokenOccurrences - left.tokenOccurrences
        || compareStrings(left.pagePath, right.pagePath)
        || left.sourceLine - right.sourceLine
        || compareStrings(left.passage, right.passage);
}

function getMatchRelevance(candidate: string, tokens: readonly string[]): MatchRelevance | undefined {
    const candidateTokens = tokenizeSearchText(candidate);
    const occurrences = tokens.map(token => candidateTokens.filter(candidateToken => candidateToken.startsWith(token)).length);
    if (occurrences.every(count => count === 0)) return undefined;
    return {
        distinctTokenCount: occurrences.filter(count => count > 0).length,
        queryTokenCount: tokens.length,
        tokenOccurrences: occurrences.reduce((total, count) => total + count, 0),
    };
}

function tokenizeSearchText(text: string): string[] {
    const tokens = new Set<string>();
    const identifiers = text.match(/[a-zA-Z0-9]+/g) ?? [];
    for (const identifier of identifiers) {
        tokens.add(identifier.toLowerCase());
        const splitIdentifier = identifier
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
        for (const word of splitIdentifier.split(/\s+/)) {
            if (word) tokens.add(word.toLowerCase());
        }
    }
    return [...tokens];
}

function audienceIncludes(audience: GuideAudience, filter: GuideAudienceFilter): boolean {
    return filter === "all" || audience === filter || audience === "both";
}

function isSafeGuidePath(path: string): boolean {
    if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
    const segments = path.split("/");
    return segments.every(segment => segment !== "" && segment !== "." && segment !== "..");
}

function isSafeEntryName(name: string): boolean {
    return name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\");
}

function joinPath(directory: string, name: string): string {
    return directory ? `${directory}/${name}` : name;
}

function compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
