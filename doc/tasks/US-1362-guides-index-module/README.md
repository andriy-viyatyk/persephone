# US-1362 — `src/shared/guides/`: front-matter index, tree, lookup, search

## Goal

Add the process-neutral shared guide-index module used by the main-process `guides` node and by
EPIC-093's renderer guide browser. It must asynchronously enumerate the Markdown corpus supplied by
an injected source, parse the US-1361 front matter, expose the generated tree and page lookup, and
return ranked Markdown passages from full-text search without importing from `src/main/`.

This task defines and implements only the shared module's API and behavior. It does not implement
the `guides` descriptor, its help text or argument validation, resource aliases, layout schemas, or
any tests or test harnesses.

## Background

EPIC-092 decision 2 makes each page's front matter the source of truth; the tree is generated from
the files rather than maintained in a manifest. US-1361 has placed the corpus under
`assets/guides/` with a flat block of `title`, `audience`, `summary`, and optional `editorId` fields
at the top of each Markdown page. Only Markdown files are guide pages: the moved
`assets/guides/examples/greek-gods.fg.json` fixture is deliberately not indexed.

The module is source-injected and asynchronous. Its source receives paths relative to the guide
root, not an absolute asset root. The main process will own packaged/development asset-root
resolution and provide the source; EPIC-093 can provide equivalent relative-root operations through
the existing asset IPC/content-pipeline path. This keeps `src/shared/guides/` process-neutral and
consistent with `src/shared/ai-vision/`: `hint.ts` imports `types.ts` and `path-parser.ts`
(`src/shared/ai-vision/hint.ts:1-2`), `help-search.ts` imports only those shared helpers
(`src/shared/ai-vision/help-search.ts:1-4`), `member-suggestion.ts` imports `types.ts`
(`src/shared/ai-vision/member-suggestion.ts:1`), and `result-shaper.ts` imports `types.ts`
(`src/shared/ai-vision/result-shaper.ts:1`); `resolver.ts` imports the other AiVision helpers,
`argument-validation.ts`, and `src/shared/utils.ts` for `errMessage`
(`src/shared/ai-vision/resolver.ts:1-7`). `argument-validation.ts`, `types.ts`, and
`path-parser.ts` have no imports. None imports `src/main/`, renderer code, Electron, or filesystem
APIs. This is the precedent for what `src/shared/guides/` may depend on.

The existing resource loader establishes the cache precedent. `readGuideFile` resolves a file,
reads its `mtimeMs`, checks a `Map<string, { mtimeMs, text }>` and calls `readFileSync` only when
the mtime changes (`src/main/mcp/manifest.ts:117-129`). The source contract therefore returns
`mtimeMs` on each file entry from `readDirectory`, while `readFile` returns text only. The shared
index can compare freshness during the directory scan and read a file only on a cold or changed
entry, matching `readGuideFile`'s stat-then-read behavior. Directory listings are not cached: every
tree, lookup, layout, or search operation rescans directories, so a guide added while the
application is running becomes visible.

The existing helper must not be treated as a security boundary. `getAssetPath(...paths)` accepts
variadic path components and returns `path.join(resourcesPath, ...paths)` without a containment
check (`src/main/utils.ts:28-35`). The index first checks requested keys against the freshly
enumerated Markdown corpus and returns not-found for an unlisted key. The main source adapter also
performs a resolved-prefix containment check before reading, rejecting absolute, drive-qualified, or
`..` paths that would leave `assets/guides/`.

`helpSearch` is the convention for matching, but it searches a different corpus. It lowercases and
splits the query, requires every token as a substring, deduplicates, and applies the limit after
sorting (`src/shared/ai-vision/help-search.ts:24-26`, `64-66`, `130-142`). It walks the live
descriptor graph and searches member names, signatures, node summaries/help, and element purposes
(`src/shared/ai-vision/help-search.ts:38-60`, `69-99`). `guides.search` instead scans Markdown
front matter and body text, returns guide page keys plus passages, and never answers where a live
object-model member or UI control is located. This distinction is intentional per EPIC-092 decision
8: “what the documentation says about X” is `guides.search`; “where in the object model is X” is
`helpSearch`. Guide search defaults to 10 results; `helpSearch` defaults to 20.

There is no direct YAML/front-matter parser dependency in `package.json`; the declared dependency
lists contain no YAML parser (`package.json:25-90`), and transitive lockfile entries do not change
that contract. Because US-1361's block is a flat `key: "value"` list, use a small hand-rolled
parser with explicit validation rather than adding a YAML dependency.

## Implementation Plan

### 1. Create the source-injected public contract in `src/shared/guides/index.ts`

Keep the public API in one direct-import entry point. The implementation may split private parsing
and Markdown helpers into files under `src/shared/guides/`, but those helpers must remain pure/shared
and must not import `src/main/`, Electron, Node filesystem/path modules, renderer APIs, or content
providers. The following is the complete exported TypeScript declaration contract for US-1363 and
EPIC-093 to consume:

```ts
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
    readonly editorId?: string;
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
    readonly editorId?: string;
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

export function createGuideIndex(source: GuideSource): GuideIndex;
```

The before/after integration shape makes the process boundary explicit:

```ts
// Before: main-owned resource loading resolves an arbitrary manifest file directly.
readGuideFile("guides/agents/browser.md");

// After: US-1363 injects a root-scoped source; the shared module sees only relative guide paths.
const guides = createGuideIndex(mainGuideSource);
await guides.getPage("agents/browser");
```

Do not export a main-process asset-root factory from this module. Do not expose the JSON fixture as
a `GuideTreePage`; `GuideSource` enumeration is filtered to `.md` files before page parsing.

### 2. Enumerate the corpus and build the tree per operation

Implement a recursive scan beginning with `readDirectory("")`. Include regular `.md` files only,
recurse into directories, and derive the canonical key by removing the final `.md` and joining
segments with `/`. Sort folders and pages deterministically (folders before pages, then by
case-sensitive canonical path) so the node and browser have stable output.

Treat `index.md` like every other file. In `editors/`, it produces the folder node `path: "editors"`
and a child page `path: "editors/index", name: "index"`; it does not become an implicit page for
the folder and does not replace the folder. The root `index.md` is the page `path: "index"`.

Apply audience filtering after metadata is parsed, not while walking directories: `all` includes
every page; `user` includes `user` and `both`; `agent` includes `agent` and `both`. The same
optional parameter is used by `getTree`, `getPage`, `search`, and `getLayout`; there are no separate
agent/user index functions. The agent tree calls the default `all` filter. EPIC-093 can pass `user`
until its agent-guide toggle is enabled.

Cache only parsed page content by source-relative `.md` path and the `mtimeMs` supplied by that
file's `readDirectory` entry, matching `readGuideFile`'s stat-then-read behavior. A scan must still
call `readDirectory` for every operation; it must not reuse a directory snapshot. A changed mtime
invalidates the parsed page and causes one `readFile`; an unchanged entry reuses the parsed page
without a file read. A new or removed file is observed on the next operation.

### 3. Parse front matter defensively

Add a small parser for the exact US-1361 shape: a `---` delimiter on the first line, flat
`key: "value"` entries, and a closing `---`. Accept only the four known keys, require a non-empty
`title`, `summary`, and valid `audience`, and preserve optional `editorId`. Strip a valid block from
`GuidePage.content`; do not search the metadata delimiters as body prose.

Malformed front matter must never reject the operation or throw. If the block is missing, unterminated,
has a malformed line, or has invalid required values, treat it as absent: keep the complete raw file
as `content`, derive `title` from the filename stem, use `audience: "both"`, use `summary: ""`, and
omit `editorId`. A syntactically valid block may omit only that optional field; missing or invalid
required fields use the complete fallback above. This keeps a hand-edited page visible and
searchable while making its degraded metadata explicit; the fallback `both` means it is not hidden
by either audience filter.

### 4. Implement ranked search in `src/shared/guides/search.ts` (or a private helper)

Follow `helpSearch`'s matching conventions exactly where they fit:

1. Trim, lowercase, and split the query on whitespace. An empty query returns `[]`.
2. A hit requires every token to occur case-insensitively at a word start in the same searchable
   candidate. A token must start at the beginning of the candidate or after a non-alphanumeric
   character, but it may run into the rest of the word: `filter` matches `filters` and `filtering`,
   and `row` matches `rows`. There is no stemming, fuzzy matching, OR behavior, or requirement for
   a word boundary after the token.
3. Search each page title, each Markdown heading, and each body passage. A page may produce more
   than one hit when distinct candidates match.
4. Deduplicate identical page/candidate results before applying the limit. The default limit is 10;
   `limit` is a final result slice, not a scan cap.

Assign these numeric scores, highest first:

| Match class | Score | Candidate |
|---|---:|---|
| `title` | 300 | The front-matter `title` value. The passage is that title. |
| `heading` | 200 | One ATX heading line (`#` through `######`). The passage is the trimmed Markdown heading line. |
| `table-row` | 150 | A complete GFM-style table row, including its pipe delimiters. This is a body hit with a distinct score because the answers in `assets/guides/shortcuts.md` live in table rows. |
| `body` | 100 | A paragraph, list item, or other non-heading body block. |

Sort by descending class score, then descending number of distinct query tokens matched at a word
boundary, then ascending passage length, then descending total token occurrences, then ascending
canonical `pagePath`, then ascending first source line of the candidate, then lexicographic passage
text. The class scores remain 300/200/150/100 and are the public `score`; relevance components only
order hits within a match class. A short passage containing every query word is a better
documentation answer than a long passage that contains them incidentally: long passages are often
reference dumps rather than explanations. Total occurrences only break ties between similarly sized
passages. The final path, line, and text fields make results deterministic as the directory is
rescanned and equal-line synthetic candidates are compared. Deduplicate on
`pagePath + matchKind + passage + heading` before applying the limit.

Define a passage in Markdown terms rather than as an arbitrary character window:

- A paragraph is contiguous non-blank prose up to a block boundary or heading.
- A list passage is one list item, including its marker, continuation lines, and nested/indented
  continuation belonging to that item, stopping at the next sibling item or block boundary.
- A table passage is exactly one non-separator table row, retaining the complete raw row so a
  shortcut question returns the key and its answer together.
- A fenced code block is one body passage when it matches; headings inside the fence are not
  headings and do not change attribution.
- A matched heading is not expanded to its whole section. For every body/table/heading hit,
  attribute `heading` to the nearest preceding ATX heading in the same Markdown body, or leave it
  absent when the passage precedes any heading. A heading hit attributes itself.

Search title/front matter separately from body content. A valid front-matter block is not a body
passage; malformed-front-matter fallback content is searched as raw text under the `body` class.

This is intentionally different from `helpSearch`: a guide hit is evidence in documentation and
contains `pagePath`, title, heading context, passage, class, and score; a help hit is a descriptor
graph result with a callable object-model path, kind, and matched line. The shared guide module must
not import or invoke `helpSearch`.

### 5. Implement lookup and the `## Layout` accessor

`getPage` accepts the canonical slash key without `.md` and returns the page metadata plus body. It
must compare the requested key with the freshly enumerated Markdown index before asking the source
to read anything. A key that is absent, names the JSON fixture, contains an absolute/drive-qualified
path, or attempts `.`/`..` traversal is simply `undefined`; it is not passed to `readFile`.

`getLayout` uses the same filtered lookup and returns:

- the trimmed body after an exact level-two `## Layout` heading, through the next heading of level
  two or higher, while retaining nested level-three-or-deeper content; or
- `undefined` when the page is absent, excluded by the audience filter, or has no `## Layout` section.

An existing `## Layout` with no body returns `""`, which is distinct from absence. No current page
has this section; EPIC-094 will add it. US-1363, not this module, turns `undefined` into the
agent-facing “no layout schema yet” message.

### 6. Keep path safety at both layers

The scan is the authoritative corpus membership check. Convert only enumerated Markdown entries to
source paths (`key + ".md"`); never concatenate an agent-provided key into a filesystem path before
membership succeeds. The main-process `GuideSource` adapter must then resolve the candidate against
its packaged/development `assets/guides/` root and require the resolved path to equal the root or
start with the root plus a path separator. This defense-in-depth check covers absolute paths,
Windows drive letters, and traversal even if a future caller bypasses the index.

The adapter owns errors from missing/raced files; the shared parser still must tolerate malformed
content. No change to `getAssetPath` or `readGuideFile` is part of this task, and no shared code may
assume that either main-process helper is available.

## Concerns / Open Questions

There are no unresolved design questions for this task; the decisions below are fixed by EPIC-092
and the previous investigation.

- **Process coupling:** Keep all asset-root resolution, filesystem access, and resolved-prefix
  checks in the injected source adapter owned by the caller. The shared module receives only async
  relative-root operations, mtime-bearing directory entries, and plain file text.
- **Freshness versus cost:** Directory traversal is intentionally repeated for each public operation
  so newly added guides appear without restarting. The source folds the freshness check into the
  file entries returned by that traversal. Over the current 43-page corpus, a cold `search` does
  43 file freshness stats and 43 file reads; a warm unchanged `search` still does 43 freshness
  stats but 0 file reads. A changed page costs one additional read, and a new page costs one read;
  only parsed file content is cached by source-relative path and exact `mtimeMs`, matching
  `readGuideFile`.
- **Hand-edited metadata:** A malformed or incomplete block degrades to raw searchable content,
  filename-stem title, empty summary, `both` audience, and no `editorId`; it never throws or silently
  removes the page from the tree.
- **Search interpretation:** Table rows are first-class passages with score 150 because
  `shortcuts.md` stores its answers in rows. Guide tokens match at word starts rather than as
  unbounded substrings because the latter produced a false positive in `assets/guides/boards.md:471`,
  where the query token `rows` matched the unrelated word `browses`. Within each class, distinct
  token count, shorter passage length, and then total occurrences provide relevance before
  deterministic path and source-line ordering. The measured reason for putting length before count is
  `search("filter rows")`: with count first, `scripting/api/index`, `agents/scripting`,
  `scripting/api/page`, and `agents/boards` all ranked above `editors/grid`; those hits are API
  listings and code fences whose repeated `rows` occurrences rewarded verbosity. The search remains
  documentation text search and must not be merged with descriptor-graph `helpSearch`.
- **Future layout schemas:** `undefined` is the module-level absence signal. The agent-facing prose
  for that signal belongs to US-1363; no layout schema or descriptor/help wording is added here.
- **Testing scope:** Do not add unit tests, fixtures, or a test harness in this task. The future
  implementation still needs the repository's normal type/lint checks and the EPIC-092 live QA gate
  in US-1364, which exercises real corpus queries after the node exists.

## Acceptance Criteria

- [ ] `src/shared/guides/` exposes exactly the source-injected asynchronous API in the declaration
      block above; every public type and method has the documented path, filtering, caching, and
      absence semantics.
- [ ] The module imports no `src/main/`, Electron, renderer, filesystem, or process-specific
      implementation. It can be instantiated with an in-memory or IPC-backed `GuideSource`.
- [ ] Every operation rescans directories, indexes `.md` files recursively, excludes
      `assets/guides/examples/greek-gods.fg.json`, and treats `index.md` as an explicit `index`
      page alongside its containing folder.
- [ ] Tree ordering is deterministic; canonical keys omit `.md`; `editors` is a folder and
      `editors/index` is its page.
- [ ] Valid US-1361 front matter is parsed and removed from `content`; missing, malformed, or
      invalid front matter never throws and degrades exactly as specified.
- [ ] Each `.md` file entry supplies `mtimeMs` during the directory scan; parsed page content is
      reused only when both its source-relative path and `mtimeMs` match. Over 43 pages, cold
      search performs 43 freshness stats plus 43 reads, while warm unchanged search performs 43
      freshness stats plus 0 reads; changed and newly added files are read on the next operation.
- [ ] Lookup performs corpus membership first and returns `undefined` for unlisted or unsafe keys;
      the consuming source adapter also applies the resolved-prefix containment check.
- [ ] Audience filtering is one parameter shared by tree, lookup, search, and layout. `all` shows
      all pages, while `user` and `agent` include their own audience plus `both`.
- [ ] Search implements all-token, case-insensitive word-start matching with suffix continuation;
      deduplication; final `limit` slicing with default 10; scores 300/200/150/100; within-class
      relevance ordering by distinct token count, ascending passage length, and then total
      occurrences; stable path/line/text tie-breaking; and the paragraph/list/table-row/heading
      attribution rules above.
- [ ] `getLayout` returns the trimmed `## Layout` section body, returns `""` for an empty present
      section, and returns `undefined` when absent or inaccessible by audience.
- [ ] No guide-node descriptor, members, help text, argument validation, resource alias, layout
      schema, or test harness is added as part of US-1362. The existing dashboard entry remains the
      task link under EPIC-092.

## Files Changed

| File | Change |
|---|---|
| `src/shared/guides/index.ts` | Add the public types, `createGuideIndex`, operation orchestration, fresh directory scan, audience filtering, membership checks, and mtime-keyed page cache. |
| `src/shared/guides/front-matter.ts` | Add the defensive flat front-matter parser and documented fallback metadata. |
| `src/shared/guides/markdown.ts` | Add Markdown passage extraction, search candidate classification/ranking metadata, heading attribution, and `## Layout` extraction. |
| `src/main/mcp/manifest.ts` | **No change.** Read only for the existing `readGuideFile` mtime-cache precedent; the main adapter belongs to US-1363. |
| `src/main/utils.ts` | **No change.** `getAssetPath` is a verified path-resolution fact, not a shared-module dependency. |
| `src/shared/ai-vision/*` | **No change.** Existing import boundaries and `helpSearch` behavior are precedents only. |
| `assets/guides/**` | **No change.** US-1361 owns the corpus move/front matter; the JSON fixture remains excluded. |
| `package.json` | **No change.** No YAML dependency is needed for the flat front matter. |
| `src/main/**` guide node and `src/renderer/**` guide browser | **No change.** These consumers are US-1363 and EPIC-093 work. |
