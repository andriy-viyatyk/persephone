import { extractLayout, extractMarkdownCandidates } from "./markdown";
import { parseGuideFile } from "./front-matter";

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

export type GuideSearchMatchKind = "title" | "heading" | "table-row" | "body";

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
    /** All-token, case-insensitive word-start search; default limit is 10 and is applied after dedupe. */
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
    readonly tokenOccurrences: number;
    readonly passageLength: number;
}

interface MatchRelevance {
    readonly distinctTokenCount: number;
    readonly tokenOccurrences: number;
}

const TITLE_SCORE = 300;
const HEADING_SCORE = 200;
const TABLE_ROW_SCORE = 150;
const BODY_SCORE = 100;

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
        const pages = await loadPages(await scan());
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
        const tokens = [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))];
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
            tokenOccurrences: _tokenOccurrences,
            passageLength: _passageLength,
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
    return right.score - left.score
        || right.distinctTokenCount - left.distinctTokenCount
        || left.passageLength - right.passageLength
        || right.tokenOccurrences - left.tokenOccurrences
        || compareStrings(left.pagePath, right.pagePath)
        || left.sourceLine - right.sourceLine
        || compareStrings(left.passage, right.passage);
}

function getMatchRelevance(candidate: string, tokens: readonly string[]): MatchRelevance | undefined {
    const lower = candidate.toLowerCase();
    const occurrences = tokens.map(token => countWordStartOccurrences(lower, token));
    if (occurrences.some(count => count === 0)) return undefined;
    return {
        distinctTokenCount: occurrences.filter(count => count > 0).length,
        tokenOccurrences: occurrences.reduce((total, count) => total + count, 0),
    };
}

function countWordStartOccurrences(text: string, token: string): number {
    let count = 0;
    let searchStart = 0;
    while (searchStart < text.length) {
        const index = text.indexOf(token, searchStart);
        if (index === -1) break;
        if (index === 0 || !isAlphaNumeric(text[index - 1])) count++;
        searchStart = index + Math.max(token.length, 1);
    }
    return count;
}

function isAlphaNumeric(character: string | undefined): boolean {
    return character !== undefined
        && ((character >= "a" && character <= "z")
            || (character >= "0" && character <= "9"));
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
