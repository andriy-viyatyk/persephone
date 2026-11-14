// Shared types + helpers for the Mneme config/monitoring editor.
//
// These mirror the JSON contracts returned by Mneme's control-plane MCP tools
// (`mneme/src/mcp/results.rs`). Field names match the serialized JSON exactly
// (camelCase where Rust applies `#[serde(rename)]`, otherwise as-is).

/** Per-root entry of `status`. Note: `model` here is the model *name*
 *  (a plain string), not the model object — that lives at the top level. */
export interface WikiRootStatus {
    name: string;
    folder: string;
    docCount: number;
    model: string;
    precision: string;
    schemaVer: number;
    indexPath: string;
    indexBytes: number;
    reindex?: WikiReindexProgress;
}

export interface WikiReindexProgress {
    phase: "idle" | "scanning" | "embedding" | "done" | "cancelled" | "error" | string;
    processed: number;
    total: number;
}

export interface WikiModelFile {
    filename: string;
    present: boolean;
    verified: boolean;
    bytes: number;
}

/** Live model-download progress, present while a background
 *  `model_update` is in flight or errored. Mirrors Rust `ModelDownloadStatus`. */
export interface WikiModelDownload {
    phase: "idle" | "downloading" | "verifying" | "done" | "error" | string;
    bytesDone: number;
    bytesTotal: number;
}

export interface WikiModelStatus {
    name: string;
    precision: string;
    version: number;
    dir: string;
    complete: boolean;
    files: WikiModelFile[];
    download?: WikiModelDownload;
}

/** Result of `status` — the primary monitoring source. */
export interface WikiStatus {
    roots: WikiRootStatus[];
    model?: WikiModelStatus;
}

/** Result of `root_config`. */
export interface WikiRootConfig {
    name: string;
    folder: string;
    include: string[];
    ignore: string[];
}

/** Per-root stats from `reindex`. */
export interface WikiReindexRootStat {
    name: string;
    scanned: number;
    indexed: number;
    refreshed: number;
    skipped: number;
    vectorized: number;
    deleted: number;
    errors: number;
}

export interface WikiReindexResult {
    roots: WikiReindexRootStat[];
}

/** A discovered on-disk index DB under `{folder}/.mneme/`. */
export interface StaleIndexEntry {
    /** `{model}-{precision}` — the `modelId` arg for `index_delete`. */
    modelId: string;
    /** schema version `N` from `index-v{N}.db`. */
    schemaVer: number;
    bytes: number;
    path: string;
    /** True when this is the root's currently-active index DB. */
    active: boolean;
}

/** One ranked `search` result. `uri` is a scheme-less `{root}/{path}`. */
export interface WikiSearchHit {
    uri: string;
    title: string;
    tags: string[];
    snippet: string;
    score: number;
}

/** `search` structured result. `note` is set when vector/hybrid degraded to text. */
export interface WikiSearchResult {
    results: WikiSearchHit[];
    note?: string;
}

/** One `tree` entry (flat depth-first node). */
export interface MnemeTreeEntry {
    uri: string;
    name: string;
    isDir: boolean;
    depth: number;
}

/** `modelReady` is the green/yellow signal: a working embedding model exists
 *  iff `wiki_status.model` is present and fully provisioned (`complete`). */
export function isModelReady(status: WikiStatus | null): boolean {
    return !!status?.model && status.model.complete === true;
}

/** True while a root's background reindex pass is active —
 *  `scanning`/`embedding`, as opposed to `idle`/`done`/`cancelled`/`error`. */
export function isReindexActive(p?: WikiReindexProgress): boolean {
    return !!p && (p.phase === "scanning" || p.phase === "embedding");
}

/** True while a background model download is active. */
export function isDownloadActive(d?: WikiModelDownload): boolean {
    return !!d && (d.phase === "downloading" || d.phase === "verifying");
}

/** Whether any background job (reindex of any root, or model download) is
 *  running — drives the editor's status-poll loop. */
export function isStatusBusy(status: WikiStatus | null): boolean {
    if (!status) return false;
    return (
        status.roots.some((r) => isReindexActive(r.reindex)) ||
        isDownloadActive(status.model?.download)
    );
}
