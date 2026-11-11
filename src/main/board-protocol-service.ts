import { app, net, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BoardHostText, BoardI18nContext, BoardThemePalette } from "../ipc/board-bridge/boot";
import { BOARD_DIALOG_MAX_BYTES, parseBoardDialogXhrRequest, parseBoardOriginRoute } from "../ipc/board-bridge/origin-routes";
import type { BoardPipeKind } from "../ipc/board-pipe-channels";
import { BoardPipeError } from "./board-pipe-service";
import { readPipeRange, BoardPipeRangeError } from "./board-pipe-range-reader";
import { mimeTypeForPath } from "../shared/mime-types";
import { errMessage } from "../shared/utils";
import * as boardLog from "./board-log";
import { boardTrustService } from "./board-trust-service";
import { boardFileAccess } from "./board-file-access";
import { readBoardManifest } from "./board-manifest-reader";
import { boardFrameRegistry } from "./board-host/BoardFrameRegistry";
import { requestBoardDialog } from "./board-dialog-service";
import { BoardRoot } from "../shared/board/board-root";
import { boardHost } from "./board-root-hashes";

/**
 * `board://` scheme handler, routed by host —
 * serves a board's own files in-process (no HTTP server / port).
 *
 * The scheme is declared privileged once at startup (`main-setup.ts`), and the
 * `protocol.handle("board", …)` is registered **once** on the host renderer's shared
 * session (`initBoardProtocol`, called at startup with `appPartition`). A board loads
 * a **distinct cross-origin** `board://<host>` where `host` is a stable hash of the
 * board root (`boardHost`); the handler routes each request by its URL host to
 * the matching board root (`hostToRoot`). Per-board isolation comes from the distinct
 * cross-origin origin + `nodeIntegrationInSubFrames:false` + the served CSP — not from
 * a per-board session partition.
 *
 * Object-form permission grants confine assets to this board's canonical root.
 * Legacy grants retain their historical traversal behavior until migration.
 */

/** board:// URL host → absolute board root folder. Populated by `registerBoard` on
 *  board open, dropped by `unregisterBoard` on unmount/close. */
const hostToRoot = new Map<string, string>();

/** board:// URL host → its design + handshake context. The color palette + static
 *  metric tokens are injected as a `:root{--p-*}` `<style>` at serve time (parse-time
 *  theming → no first-paint flash); `hostOrigin` (the host renderer's origin) is baked
 * into `window.__persephoneBoot` so the shim can validate the port handshake.
 *  The theme is app-global; each host registers with the then-current palette and
 *  `updateAllBoardThemes` refreshes them on a theme switch. */
interface BoardDesign {
    theme: BoardThemePalette;
    tokens: Record<string, string>;
    i18n: BoardI18nContext;
    hostText: BoardHostText;
    hostOrigin: string;
}
const hostToDesign = new Map<string, BoardDesign>();

/** board:// host → live registration count. A board's main and
 *  secondary frames resolve to the SAME host (`boardHost` is deterministic), so
 *  each frame registers/unregisters it. The host→root/design mappings are dropped only
 *  when the LAST frame unregisters — otherwise a secondary-panel close (or a main reload
 *  while panels exist) would tear out the routing a surviving frame still needs. */
const hostRefCount = new Map<string, number>();

/** CSP for board HTML documents: local origin only; inline scripts/styles allowed
 *  enabled for author convenience and forbidden for remote boards. Set as a response header. */
const BOARD_CSP = [
    "default-src 'none'",
    // 'wasm-unsafe-eval' permits compiling WebAssembly and nothing else — it does not
    // re-admit JavaScript eval(). Vendored libraries increasingly ship a .wasm core
    // (image codecs, database engines, parsers), and without it they fail at load.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    // Same-origin nested frames only. A board that embeds a vendored web app (a PDF or
    // diagram viewer shipped as its own HTML page) needs this; it cannot reach remote
    // content, since 'self' is the board's own `board://<host>` origin.
    "frame-src 'self'",
    // Explicit rather than inherited: workers already resolve through the
    // worker-src → child-src → script-src fallback chain, but stating the directive keeps
    // that from silently breaking if script-src is ever tightened.
    "worker-src 'self'",
].join("; ");

/** Build a `:root{…}` `<style>` defining the board's `--p-*` color palette + static
 *  metric tokens. Injected into served HTML so the variables are defined at PARSE
 *  time — the first paint is themed and a board's light CSS fallbacks (e.g.
 *  `var(--p-bg, #fff)`) never flash before the shim's JS application runs. */
function buildThemeStyle(design: BoardDesign | undefined): string {
    if (!design) return "";
    const decls: string[] = [];
    for (const [k, v] of Object.entries(design.theme.vars)) decls.push(`${k}:${v};`);
    for (const [k, v] of Object.entries(design.tokens)) decls.push(`${k}:${v};`);
    if (!decls.length) return "";
    return `<style id="persephone-theme-init">:root{${decls.join("")}}</style>`;
}

/** Escape a JSON string for safe embedding inside an inline `<script>` (prevent a
 *  value containing `</script>` from terminating the element early). */
function safeJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Build the `window.__persephoneBoot` `<script>` — the board context read
 *  synchronously by the shim before the first author script (replaces the old
 *  `getContext` IPC provides the initial theme/tokens and host renderer origin for
 * the handshake check. */
function buildBootScript(design: BoardDesign | undefined): string {
    const boot = {
        theme: design?.theme ?? { id: "", isDark: true, vars: {} },
        tokens: design?.tokens ?? {},
        i18n: design?.i18n ?? { locale: { code: "en" }, tables: [{}, {}, {}] },
        hostText: design?.hostText ?? {},
        hostOrigin: design?.hostOrigin ?? "",
    };
    return `<script id="persephone-boot">window.__persephoneBoot=${safeJson(boot)};</script>`;
}

/** The bridge shim source (`board-shim.js`, built beside `main.js`). Inlined into served HTML so
 *  `window.persephone` exists synchronously, before the first author script.
 *
 *  Cached for the process lifetime in a packaged build (the file cannot change under us). In DEV the
 *  cache is skipped, because the dev server rebuilds the shim on every edit WITHOUT restarting
 *  Electron — caching there would serve a stale shim to every board until a manual restart. */
let shimSource: string | null = null;
function getShimSource(): string {
    if (shimSource === null || !app.isPackaged) {
        try {
            shimSource = fs.readFileSync(path.join(__dirname, "board-shim.js"), "utf8");
        } catch (e) {
            console.error("board:// failed to load board-shim.js:", e);
            shimSource = "";
        }
    }
    return shimSource;
}

function buildShimScript(): string {
    const src = getShimSource();
    if (!src) return "";
    // Neutralize any `</script` terminator that could appear inside a string/regex
    // literal in the shim, so it can't close the injected element early. NOTE: this
    // is raw JS source, not JSON — a blanket `<` escape (as in safeJson) would
    // corrupt comparison operators (`i < n`); only the closing-tag sequence is escaped.
    const safe = src.replace(/<\/(script)/gi, "<\\/$1");
    return `<script id="persephone-shim">${safe}</script>`;
}

/** Insert `fragment` as early as possible in the document so the `--p-*` vars + the
 *  bridge shim are present before any board stylesheet/script resolves: right after
 *  the opening `<head>`, else after `<html …>`, else prepended. */
function injectHead(html: string, fragment: string): string {
    if (!fragment) return html;
    const headOpen = html.match(/<head[^>]*>/i);
    if (headOpen && headOpen.index !== undefined) {
        const idx = headOpen.index + headOpen[0].length;
        return html.slice(0, idx) + fragment + html.slice(idx);
    }
    const htmlOpen = html.match(/<html[^>]*>/i);
    if (htmlOpen && htmlOpen.index !== undefined) {
        const idx = htmlOpen.index + htmlOpen[0].length;
        return html.slice(0, idx) + fragment + html.slice(idx);
    }
    return fragment + html;
}

/** Text MIME types served with an explicit `charset=utf-8`.
 *
 *  Board sources are read and re-encoded as UTF-8, but a bare `text/html` leaves the
 *  encoding to the document's `<meta charset>` — and the injected head fragment (theme
 *  style + boot + the ~100 kB shim) lands *before* that meta and pushes it well past the
 *  1024-byte sniffing window, so the whole document was being decoded as windows-1252 and
 *  every non-ASCII character in the shim (the em dashes in the AiVision member cautions,
 *  found by the todo board reached the agent mojibaked. The header wins over
 *  the meta, so stating it here fixes the document and its scripts, which inherit it. */
const UTF8_MIME_TYPES = new Set([
    "text/html",
    "text/javascript",
    "text/css",
    "application/json",
    "text/markdown",
    "text/csv",
    "application/xml",
    "application/yaml",
    "image/svg+xml",
    "text/plain",
]);

function boardContentType(mime: string): string {
    return UTF8_MIME_TYPES.has(mime) ? `${mime}; charset=utf-8` : mime;
}

/** Log a missing board **document** to the board's `ui.log`,
 *  mode A). A `board://` handler that returns a 404 `Response` is a *completed* load to
 *  Electron, so `did-fail-load` never fires for a renamed/missing `index.html` — log it
 *  here so the failure is reported immediately and precisely (the on-board log indicator
 *  lights; the mode-D watchdog still toasts). Never throws into the handler. */
function logBoardDocMissing(root: string, rel: string, reason: string): void {
    void boardLog.append(root, "error", `board document not found: ${rel} (${reason})`).catch(() => {});
}

async function serveBoardPipe(
    host: string,
    pipeKind: BoardPipeKind,
    pipeId: string,
    rangeHeader?: string,
    requestSignal?: AbortSignal,
): Promise<Response> {
    // One AbortController per HTTP request, covering the first read and every continuation read
    // inside the stream's pull loop. Aborted from two sources: the inbound Request's own signal,
    // and the response ReadableStream's cancel() algorithm — the mechanism the Streams spec fires
    // when the consumer (Chromium) abandons an in-flight response, e.g. a <video> seek that
    // supersedes the previous Range request without the page ever closing (see section 7a).
    const abort = new AbortController();
    if (requestSignal?.aborted) abort.abort();
    else requestSignal?.addEventListener("abort", () => abort.abort(), { once: true });

    let result;
    try {
        result = await readPipeRange(pipeKind, pipeId, host, rangeHeader, abort.signal);
    } catch (error: unknown) {
        const status = error instanceof BoardPipeError ? error.status : 503;
        const body = error instanceof BoardPipeRangeError && error.source === "read" && status === 404
            ? "Not found"
            : errMessage(error, "Board pipe unavailable.");
        return new Response(body, { status });
    }
    const iterator = result.chunks[Symbol.asyncIterator]();
    const headers = new Headers(result.headers);
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                if (abort.signal.aborted) { controller.close(); return; }
                const next = await iterator.next();
                if (abort.signal.aborted) { controller.close(); return; }
                if (next.done) controller.close();
                else controller.enqueue(next.value);
            } catch (error: unknown) {
                if (abort.signal.aborted) controller.close();
                else controller.error(new Error(errMessage(error, "Board pipe unavailable.")));
            }
        },
        cancel(reason: unknown) {
            abort.abort(reason);
            void iterator.return?.();
        },
    });
    return new Response(result.status === 416 ? null : body, { status: result.status, headers });
}

async function serveBoardDialog(request: Request, host: string): Promise<Response> {
    if (request.method !== "POST" || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) return new Response(null, { status: 400 });
    try {
        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > BOARD_DIALOG_MAX_BYTES) { await reader.cancel(); return new Response(null, { status: 413 }); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const data = parseBoardDialogXhrRequest(input);
        if (!data) return new Response(null, { status: 400 });
        const source = new URL(data.url);
        if (source.protocol !== "board:" || source.host !== host || source.searchParams.get("v") !== data.nonce || (source.searchParams.get("view") ?? "main") !== data.view) return new Response(null, { status: 400 });
        const frame = boardFrameRegistry.resolveDialogFrame(host, data.nonce, data.view);
        if (!frame) return new Response(null, { status: 404 });
        const result = await requestBoardDialog(frame.host, frame.key, { type: data.type, message: data.message, defaultPrompt: data.defaultPrompt, url: data.url, title: frame.title, pageId: frame.pageId }, request.signal);
        return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    } catch {
        return new Response(null, { status: 400 });
    }
}

async function serveBoardFile(request: Request): Promise<Response> {
    const { host, pathname } = new URL(request.url);
    const route = parseBoardOriginRoute(pathname);
    if (route?.kind === "invalid") return new Response("Not found", { status: 404 });
    if (route?.kind === "dialog") return serveBoardDialog(request, host);
    if (route?.kind === "pipe-resource") return serveBoardPipe(host, "resource", route.resourceId, request.headers.get("Range") || undefined, request.signal);
    if (route?.kind === "pipe-page") return serveBoardPipe(host, "page", route.pageId, request.headers.get("Range") || undefined, request.signal);
    const root = hostToRoot.get(host);
    if (!root) return new Response("No board registered", { status: 404 });

    const grant = await boardTrustService.getGrant(root);
    const confined = grant?.isDeclared() || (await readBoardManifest(BoardRoot.from(root)))?.permissions.kind === "flags";
    let rel: string;
    try {
        rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
    } catch {
        return new Response("Not found", { status: 404 });
    }
    let resolved: string;
    if (confined) {
        if (/%(?:2f|5c)/i.test(pathname) || rel.includes("\\")) return new Response("Not found", { status: 404 });
        try {
            resolved = await boardFileAccess.authorizeInsideRoot(root, rel);
        } catch {
            return new Response("Not found", { status: 404 });
        }
    } else {
        // Legacy grants retain the historical traversal behavior through migration.
        resolved = path.resolve(root, rel);
    }
    const mime = mimeTypeForPath(resolved);

    let response: Response;
    try {
        response = await net.fetch(pathToFileURL(resolved).toString(), {
            bypassCustomProtocolHandlers: true,
        });
    } catch {
        if (mime === "text/html") logBoardDocMissing(root, rel, "not found");
        return new Response("Not found", { status: 404 });
    }
    if (!response.ok) {
        if (mime === "text/html") logBoardDocMissing(root, rel, `status ${response.status}`);
        return new Response("Not found", { status: response.status || 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", boardContentType(mime));
    headers.set("Cache-Control", "no-store"); // boards are local; keeps edit→reload instant
    if (mime === "text/html") {
        headers.set("Content-Security-Policy", BOARD_CSP);
        if (grant?.isDeclared()) headers.set("Permissions-Policy", "local-fonts=()");
        // Inject, in order, into <head> (before any author script/stylesheet):
        //   1. the `--p-*` palette `<style>` → first paint is themed (no white flash);
        //   2. `window.__persephoneBoot` → initial theme/tokens + host origin;
        //   3. the bridge shim → defines `window.persephone` synchronously.
        const html = await response.text();
        const design = hostToDesign.get(host);
        const headFragment = buildThemeStyle(design) + buildBootScript(design) + buildShimScript();
        return new Response(injectHead(html, headFragment), {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

/** Register the single `board://` handler on the host renderer's shared session.
 *  Call once at startup (the main window uses `appPartition`). The handler routes
 *  every request by its URL host → board root (`hostToRoot`); the registry is
 *  populated by `registerBoard`. */
export function initBoardProtocol(partition: string): void {
    const ses = session.fromPartition(partition);
    ses.protocol.handle("board", (request) => serveBoardFile(request));
}

/** Map a board into the host-routed registry; returns its stable `board://` host.
 *  Idempotent — re-registering the same root refreshes its design and returns the
 *  same host. The handler itself is already registered (`initBoardProtocol`).
 *  `hostOrigin` is the calling renderer's origin, baked into the shim for the 
 *  handshake check. */
export function registerBoard(
    boardRoot: string,
    theme: BoardThemePalette,
    tokens: Record<string, string>,
    i18n: BoardI18nContext,
    hostText: BoardHostText,
    hostOrigin: string,
): string {
    const root = BoardRoot.from(boardRoot);
    const host = boardHost(root);
    hostToRoot.set(host, root.path);
    hostToDesign.set(host, { theme, tokens, i18n, hostText, hostOrigin });
    hostRefCount.set(host, (hostRefCount.get(host) ?? 0) + 1);
    return host;
}

/** Drop a board from the registry on unmount/close. No session teardown — the host
 *  session is shared and long-lived, with storage handled by Electron's session.
 */
export function unregisterBoard(host: string): void {
    const n = (hostRefCount.get(host) ?? 0) - 1;
    if (n > 0) {
        hostRefCount.set(host, n);
        return; // another frame still uses this host — keep the mapping
    }
    hostRefCount.delete(host);
    hostToRoot.delete(host);
    hostToDesign.delete(host);
}

export interface BoardRegistrationSnapshot {
    host: string;
    root: string;
    refCount: number;
}

/** Return only the live board registration identity, not protocol design internals. */
export function getBoardRegistrationSnapshot(): {
    registeredCount: number;
    registrations: BoardRegistrationSnapshot[];
} {
    return {
        registeredCount: hostToRoot.size,
        registrations: [...hostToRoot.entries()].map(([host, root]) => ({
            host,
            root,
            refCount: hostRefCount.get(host) ?? 0,
        })),
    };
}

/** Resolve a `board://` host → its absolute board root. Used by the per-board port
 *  bridge to default `execute()` cwd + relative file paths. */
export function getBoardRootForHost(host: string): string | undefined {
    return hostToRoot.get(host);
}

/** Refresh the stored palette for every live board on a host theme switch. The theme
 *  is app-global, so all boards get the same palette. Without this, the design stored
 *  at registration goes stale and a board that reloads after a switch paints the old
 *  theme (the serve-time injection would use the registration-time palette). Metrics
 *  are theme-independent, so only the color palette changes. */
export function updateAllBoardThemes(theme: BoardThemePalette): void {
    for (const design of hostToDesign.values()) {
        design.theme = theme;
    }
}
