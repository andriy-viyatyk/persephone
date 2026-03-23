import { debounce } from "../../../shared/utils";
import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import {
    BodyType,
    CachedResponse,
    FormDataEntry,
    RawLanguage,
    RestClientData,
    RestHeader,
    RestRequest,
    RestResponse,
    createDefaultRequest,
} from "./restClientTypes";

// =============================================================================
// Helpers
// =============================================================================

function isBinaryContentType(contentType: string): boolean {
    const ct = contentType.toLowerCase();
    if (ct.startsWith("text/")) return false;
    if (ct.includes("json")) return false;
    if (ct.includes("xml")) return false;
    if (ct.includes("javascript")) return false;
    if (ct.includes("css")) return false;
    if (ct.includes("html")) return false;
    if (ct.includes("yaml")) return false;
    if (ct.includes("form-urlencoded")) return false;
    // Everything else (image/*, audio/*, video/*, application/octet-stream, application/pdf, etc.)
    if (ct.startsWith("image/") || ct.startsWith("audio/") || ct.startsWith("video/")) return true;
    if (ct.includes("octet-stream") || ct.includes("pdf") || ct.includes("zip") || ct.includes("gzip")) return true;
    // Default: if no content-type or unknown, treat as text
    return false;
}

// =============================================================================
// Content-Type mapping
// =============================================================================

const LANGUAGE_CONTENT_TYPES: Record<RawLanguage, string> = {
    plaintext: "text/plain",
    json: "application/json",
    javascript: "application/javascript",
    html: "text/html",
    xml: "application/xml",
};

// =============================================================================
// State
// =============================================================================

export const defaultRestClientEditorState = {
    data: { type: "rest-client", requests: [] } as RestClientData,
    error: undefined as string | undefined,
    selectedRequestId: "" as string,
    leftPanelWidth: 250,
    // Execution state
    executing: false,
    response: null as RestResponse | null,
    responseTime: 0,
};

export type RestClientEditorState = typeof defaultRestClientEditorState;

// =============================================================================
// View Model
// =============================================================================

export class RestClientViewModel extends ContentViewModel<RestClientEditorState> {
    private lastSerializedData: RestClientData | null = null;
    private skipNextContentUpdate = false;
    private selectionRestored = false;
    private static cacheName = "rest-client";
    private static responseCacheName = "rest-client-responses";

    /** In-memory response cache keyed by request ID. */
    private responseCache: Record<string, CachedResponse> = {};

    constructor(host: IContentHost) {
        super(host, defaultRestClientEditorState);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        this.addSubscription(this.state.subscribe(() => {
            this.onDataChangedDebounced();
        }));

        const content = this.host.state.get().content || "";
        this.loadData(content);
    }

    protected onContentChanged(content: string): void {
        if (this.skipNextContentUpdate) {
            this.skipNextContentUpdate = false;
            return;
        }
        this.loadData(content);
    }

    protected onDispose(): void {
        this.onDataChanged();
    }

    // =========================================================================
    // Serialization (file content)
    // =========================================================================

    private onDataChanged = () => {
        const { data, error } = this.state.get();
        if (error) return;
        if (data.requests !== this.lastSerializedData?.requests) {
            this.lastSerializedData = data;
            // Strip empty trailing header/formData rows before serializing
            const cleanData: RestClientData = {
                ...data,
                requests: data.requests.map((r) => ({
                    ...r,
                    headers: r.headers.filter((h) => h.key || h.value),
                    formData: r.formData.filter((f) => f.key || f.value),
                    formDataEntries: r.formDataEntries.filter((f) => f.key || f.value),
                })),
            };
            const content = JSON.stringify(cleanData, null, 4);
            // Only update host if content actually changed (avoid false dirty on load)
            const currentContent = this.host.state.get().content || "";
            if (content !== currentContent) {
                this.skipNextContentUpdate = true;
                this.host.changeContent(content, true);
            }
        }
    };

    private onDataChangedDebounced = debounce(this.onDataChanged, 300);

    // =========================================================================
    // Selection state cache
    // =========================================================================

    private restoreSelectionState = async () => {
        const cached = await this.host.stateStorage.getState(
            this.host.id, RestClientViewModel.cacheName,
        );
        if (!cached) return;
        try {
            const saved = JSON.parse(cached);
            if (saved.selectedRequestId) {
                const exists = this.state.get().data.requests.some(
                    (r) => r.id === saved.selectedRequestId,
                );
                if (exists) {
                    this.state.update((s) => {
                        s.selectedRequestId = saved.selectedRequestId;
                    });
                    this.restoreResponseForSelected();
                }
            }
        } catch {
            // ignore corrupted cache
        }
    };

    private saveSelectionState = () => {
        const { selectedRequestId } = this.state.get();
        const cached = JSON.stringify({ selectedRequestId });
        this.host.stateStorage.setState(
            this.host.id, RestClientViewModel.cacheName, cached,
        );
    };

    private saveSelectionStateDebounced = debounce(this.saveSelectionState, 300);

    // =========================================================================
    // Response cache
    // =========================================================================

    private restoreResponseCache = async () => {
        const cached = await this.host.stateStorage.getState(
            this.host.id, RestClientViewModel.responseCacheName,
        );
        if (!cached) return;
        try {
            this.responseCache = JSON.parse(cached);
            this.restoreResponseForSelected();
        } catch {
            this.responseCache = {};
        }
    };

    private saveResponseCache = () => {
        const data = JSON.stringify(this.responseCache);
        this.host.stateStorage.setState(
            this.host.id, RestClientViewModel.responseCacheName, data,
        );
    };

    private saveResponseCacheDebounced = debounce(this.saveResponseCache, 500);

    private restoreResponseForSelected = () => {
        const { selectedRequestId } = this.state.get();
        const cached = this.responseCache[selectedRequestId];
        if (cached) {
            this.state.update((s) => {
                s.response = cached.response;
                s.responseTime = cached.responseTime;
            });
        }
    };

    // =========================================================================
    // Data Loading
    // =========================================================================

    private loadData = (content: string) => {
        if (!content || content.trim() === "") {
            this.state.update((s) => {
                s.data = { type: "rest-client", requests: [] };
                s.error = undefined;
                s.selectedRequestId = "";
            });
            this.lastSerializedData = this.state.get().data;
            return;
        }

        try {
            const parsed = JSON.parse(content);
            const requests: RestRequest[] = Array.isArray(parsed.requests)
                ? parsed.requests.map((r: any) => ({
                    id: r.id || crypto.randomUUID(),
                    name: r.name ?? "",
                    collection: r.collection || "",
                    method: r.method || "GET",
                    url: r.url || "",
                    headers: Array.isArray(r.headers) ? r.headers : [],
                    body: r.body || "",
                    bodyType: r.bodyType || (r.body ? "raw" : "none"),
                    bodyLanguage: r.bodyLanguage || "plaintext",
                    formData: Array.isArray(r.formData) ? r.formData : [],
                    binaryFilePath: r.binaryFilePath || "",
                    formDataEntries: Array.isArray(r.formDataEntries) ? r.formDataEntries : [],
                }))
                : [];

            const data: RestClientData = { type: "rest-client", requests };

            this.state.update((s) => {
                s.data = data;
                s.error = undefined;
                if (!requests.some((r) => r.id === s.selectedRequestId)) {
                    s.selectedRequestId = requests[0]?.id || "";
                }
            });
            this.lastSerializedData = data;

            if (!this.selectionRestored) {
                this.selectionRestored = true;
                this.restoreSelectionState();
                this.restoreResponseCache();
            }

            // Ensure selected request has empty last rows (for UI)
            const selectedId = this.state.get().selectedRequestId;
            if (selectedId) {
                this.ensureEmptyLastHeader(selectedId);
                this.ensureEmptyLastFormData(selectedId);
            }
        } catch (e: any) {
            this.state.update((s) => {
                s.error = `Failed to parse JSON: ${e.message}`;
            });
        }
    };

    // =========================================================================
    // Request CRUD
    // =========================================================================

    get selectedRequest(): RestRequest | undefined {
        const { data, selectedRequestId } = this.state.get();
        return data.requests.find((r) => r.id === selectedRequestId);
    }

    selectRequest = (id: string) => {
        this.state.update((s) => {
            s.selectedRequestId = id;
            const cached = this.responseCache[id];
            s.response = cached?.response ?? null;
            s.responseTime = cached?.responseTime ?? 0;
            s.executing = false;
        });
        this.ensureEmptyLastHeader(id);
        this.ensureEmptyLastFormData(id);
        this.saveSelectionStateDebounced();
    };

    addRequest = (name?: string, collection?: string) => {
        // Default to selected request's collection
        if (collection === undefined) {
            collection = this.selectedRequest?.collection || "";
        }
        const request = createDefaultRequest(name, collection);
        this.state.update((s) => {
            s.data = {
                ...s.data,
                requests: [...s.data.requests, request],
            };
            s.selectedRequestId = request.id;
            s.response = null;
            s.responseTime = 0;
        });
        this.saveSelectionStateDebounced();
        return request;
    };

    deleteRequest = (id: string) => {
        this.state.update((s) => {
            const idx = s.data.requests.findIndex((r) => r.id === id);
            if (idx === -1) return;
            const requests = s.data.requests.filter((r) => r.id !== id);
            s.data = { ...s.data, requests };
            if (s.selectedRequestId === id) {
                const newIdx = Math.min(idx, requests.length - 1);
                s.selectedRequestId = requests[newIdx]?.id || "";
                const cached = this.responseCache[s.selectedRequestId];
                s.response = cached?.response ?? null;
                s.responseTime = cached?.responseTime ?? 0;
            }
        });
        delete this.responseCache[id];
        this.saveSelectionStateDebounced();
        this.saveResponseCacheDebounced();
    };

    renameRequest = (id: string, name: string) => {
        this.state.update((s) => {
            s.data = {
                ...s.data,
                requests: s.data.requests.map((r) =>
                    r.id === id ? { ...r, name } : r
                ),
            };
        });
    };

    updateRequestCollection = (id: string, collection: string) => {
        this.state.update((s) => {
            s.data = {
                ...s.data,
                requests: s.data.requests.map((r) =>
                    r.id === id ? { ...r, collection } : r
                ),
            };
        });
    };

    deleteCollection = (collectionName: string) => {
        const ids = this.state.get().data.requests
            .filter((r) => r.collection === collectionName)
            .map((r) => r.id);

        this.state.update((s) => {
            const requests = s.data.requests.filter((r) => r.collection !== collectionName);
            s.data = { ...s.data, requests };
            if (ids.includes(s.selectedRequestId)) {
                s.selectedRequestId = requests[0]?.id || "";
                const cached = this.responseCache[s.selectedRequestId];
                s.response = cached?.response ?? null;
                s.responseTime = cached?.responseTime ?? 0;
            }
        });
        for (const id of ids) {
            delete this.responseCache[id];
        }
        this.saveSelectionStateDebounced();
        this.saveResponseCacheDebounced();
    };

    moveRequest = (fromId: string, toId: string, newCollection?: string) => {
        this.state.update((s) => {
            const requests = [...s.data.requests];
            const fromIdx = requests.findIndex((r) => r.id === fromId);
            const toIdx = requests.findIndex((r) => r.id === toId);
            if (fromIdx === -1 || fromIdx === toIdx) return;

            const [moved] = requests.splice(fromIdx, 1);
            if (newCollection !== undefined) {
                moved.collection = newCollection;
            }

            if (toIdx === -1) {
                // toId is a collection node — append to end
                requests.push(moved);
            } else {
                // Adjust index after removal
                const adjustedIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
                requests.splice(adjustedIdx, 0, moved);
            }
            s.data = { ...s.data, requests };
        });
    };

    updateRequest = (id: string, changes: Partial<RestRequest>) => {
        // Auto-sync bodyType when method changes
        if (changes.method) {
            const req = this.state.get().data.requests.find((r) => r.id === id);
            if (req) {
                const wasNoBody = ["GET", "HEAD"].includes(req.method);
                const isNoBody = ["GET", "HEAD"].includes(changes.method);
                if (!wasNoBody && isNoBody && req.bodyType !== "none") {
                    changes.bodyType = "none";
                } else if (wasNoBody && !isNoBody && req.bodyType === "none") {
                    changes.bodyType = "raw";
                }
            }
        }

        this.state.update((s) => {
            s.data = {
                ...s.data,
                requests: s.data.requests.map((r) =>
                    r.id === id ? { ...r, ...changes } : r
                ),
            };
        });
    };

    // =========================================================================
    // Body type & language
    // =========================================================================

    updateBodyType = (requestId: string, bodyType: BodyType) => {
        this.updateRequest(requestId, { bodyType });

        if (bodyType === "form-urlencoded") {
            this.autoSetContentType(requestId, "application/x-www-form-urlencoded");
            this.ensureEmptyLastFormData(requestId);
        } else if (bodyType === "raw") {
            const req = this.state.get().data.requests.find((r) => r.id === requestId);
            if (req) {
                this.autoSetContentType(requestId, LANGUAGE_CONTENT_TYPES[req.bodyLanguage]);
            }
        } else if (bodyType === "form-data") {
            this.ensureEmptyLastFormDataEntry(requestId);
            // Don't auto-set Content-Type — it's set with boundary at send time
        } else if (bodyType === "binary") {
            this.autoSetContentType(requestId, "application/octet-stream");
        }
        // "none" — don't change Content-Type
    };

    updateBodyLanguage = (requestId: string, bodyLanguage: RawLanguage) => {
        this.updateRequest(requestId, { bodyLanguage });
        this.autoSetContentType(requestId, LANGUAGE_CONTENT_TYPES[bodyLanguage]);
    };

    private autoSetContentType = (requestId: string, contentType: string) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;

        const headers = [...req.headers];
        const ctIndex = headers.findIndex(
            (h) => h.key.toLowerCase() === "content-type" && h.key !== "",
        );

        if (ctIndex >= 0) {
            headers[ctIndex] = { ...headers[ctIndex], value: contentType };
        } else {
            // Insert before the empty last row
            const insertAt = headers.length > 0 && !headers[headers.length - 1].key && !headers[headers.length - 1].value
                ? headers.length - 1
                : headers.length;
            headers.splice(insertAt, 0, { key: "Content-Type", value: contentType, enabled: true });
        }

        this.updateRequest(requestId, { headers });
        this.ensureEmptyLastHeader(requestId);
    };

    // =========================================================================
    // Header CRUD
    // =========================================================================

    /** Ensure the last header row is always empty (auto-add pattern). */
    private ensureEmptyLastHeader = (requestId: string) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const last = req.headers[req.headers.length - 1];
        if (!last || last.key || last.value) {
            this.updateRequest(requestId, {
                headers: [...req.headers, { key: "", value: "", enabled: true }],
            });
        }
    };

    deleteHeader = (requestId: string, index: number) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const headers = req.headers.filter((_, i) => i !== index);
        this.updateRequest(requestId, { headers });
        this.ensureEmptyLastHeader(requestId);
    };

    toggleHeader = (requestId: string, index: number) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const headers = req.headers.map((h, i) =>
            i === index ? { ...h, enabled: !h.enabled } : h
        );
        this.updateRequest(requestId, { headers });
    };

    updateHeader = (requestId: string, index: number, changes: Partial<RestHeader>) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const headers = req.headers.map((h, i) =>
            i === index ? { ...h, ...changes } : h
        );
        this.updateRequest(requestId, { headers });
        this.ensureEmptyLastHeader(requestId);
    };

    // =========================================================================
    // Form Data CRUD
    // =========================================================================

    private ensureEmptyLastFormData = (requestId: string) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const last = req.formData[req.formData.length - 1];
        if (!last || last.key || last.value) {
            this.updateRequest(requestId, {
                formData: [...req.formData, { key: "", value: "", enabled: true }],
            });
        }
    };

    deleteFormData = (requestId: string, index: number) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const formData = req.formData.filter((_, i) => i !== index);
        this.updateRequest(requestId, { formData });
        this.ensureEmptyLastFormData(requestId);
    };

    toggleFormData = (requestId: string, index: number) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const formData = req.formData.map((f, i) =>
            i === index ? { ...f, enabled: !f.enabled } : f
        );
        this.updateRequest(requestId, { formData });
    };

    updateFormData = (requestId: string, index: number, changes: Partial<RestHeader>) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const formData = req.formData.map((f, i) =>
            i === index ? { ...f, ...changes } : f
        );
        this.updateRequest(requestId, { formData });
        this.ensureEmptyLastFormData(requestId);
    };

    // =========================================================================
    // Form Data Entries CRUD (multipart/form-data)
    // =========================================================================

    ensureEmptyLastFormDataEntry = (requestId: string) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const last = req.formDataEntries[req.formDataEntries.length - 1];
        if (!last || last.key || last.value) {
            this.updateRequest(requestId, {
                formDataEntries: [...req.formDataEntries, { key: "", value: "", type: "text", enabled: true }],
            });
        }
    };

    deleteFormDataEntry = (requestId: string, index: number) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const formDataEntries = req.formDataEntries.filter((_, i) => i !== index);
        this.updateRequest(requestId, { formDataEntries });
        this.ensureEmptyLastFormDataEntry(requestId);
    };

    toggleFormDataEntry = (requestId: string, index: number) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const formDataEntries = req.formDataEntries.map((f, i) =>
            i === index ? { ...f, enabled: !f.enabled } : f
        );
        this.updateRequest(requestId, { formDataEntries });
    };

    updateFormDataEntry = (requestId: string, index: number, changes: Partial<FormDataEntry>) => {
        const req = this.state.get().data.requests.find((r) => r.id === requestId);
        if (!req) return;
        const formDataEntries = req.formDataEntries.map((f, i) =>
            i === index ? { ...f, ...changes } : f
        );
        this.updateRequest(requestId, { formDataEntries });
        this.ensureEmptyLastFormDataEntry(requestId);
    };

    // =========================================================================
    // Paste from clipboard
    // =========================================================================

    pasteRequest = async (clipboardText: string): Promise<boolean> => {
        const { parseClipboardRequest } = await import("./parseClipboardRequest");
        const parsed = parseClipboardRequest(clipboardText);
        if (!parsed) return false;

        const requestId = this.state.get().selectedRequestId;
        if (!requestId) return false;

        this.updateRequest(requestId, {
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            body: parsed.body,
            bodyType: parsed.bodyType,
            bodyLanguage: parsed.bodyLanguage,
            formData: parsed.formData,
        });
        this.ensureEmptyLastHeader(requestId);
        if (parsed.bodyType === "form-urlencoded") {
            this.ensureEmptyLastFormData(requestId);
        }
        return true;
    };

    // =========================================================================
    // Request execution
    // =========================================================================

    sendRequest = async () => {
        const request = this.selectedRequest;
        if (!request || !request.url) return;

        this.state.update((s) => {
            s.executing = true;
            s.response = null;
            s.responseTime = 0;
        });

        const startTime = Date.now();

        try {
            const { nodeFetch } = await import("../../api/node-fetch");
            const headers: Record<string, string> = {};
            for (const h of request.headers) {
                if (h.enabled && h.key.trim()) headers[h.key.trim()] = h.value;
            }

            // Build body based on bodyType
            let body: string | ReadableStream | undefined;
            if (request.bodyType === "raw") {
                body = request.body || undefined;
            } else if (request.bodyType === "form-urlencoded") {
                const pairs = request.formData
                    .filter((f) => f.enabled && f.key.trim())
                    .map((f) => `${encodeURIComponent(f.key.trim())}=${encodeURIComponent(f.value)}`);
                body = pairs.length > 0 ? pairs.join("&") : undefined;
            } else if (request.bodyType === "binary") {
                if (request.binaryFilePath) {
                    const fs = require("fs") as typeof import("fs");
                    if (!fs.existsSync(request.binaryFilePath)) {
                        throw new Error(`File not found: ${request.binaryFilePath}`);
                    }
                    const nodeStream = fs.createReadStream(request.binaryFilePath);
                    body = new ReadableStream({
                        start(controller) {
                            nodeStream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
                            nodeStream.on("end", () => controller.close());
                            nodeStream.on("error", (err: Error) => controller.error(err));
                        },
                    });
                }
            } else if (request.bodyType === "form-data") {
                const { buildMultipartBody } = await import("./multipartBuilder");
                const result = buildMultipartBody(request.formDataEntries);
                headers["Content-Type"] = `multipart/form-data; boundary=${result.boundary}`;
                body = result.stream;
            }
            // "none" → body stays undefined

            const res = await nodeFetch(request.url, {
                method: request.method,
                headers,
                body,
            });

            const responseHeaders: RestHeader[] = [];
            res.headers.forEach((v, k) => {
                responseHeaders.push({ key: k, value: v, enabled: true });
            });

            const contentType = res.headers.get("content-type") || "";
            const isBinary = isBinaryContentType(contentType);

            let responseBody: string;
            if (isBinary) {
                const buf = await res.arrayBuffer();
                responseBody = Buffer.from(buf).toString("base64");
            } else {
                responseBody = await res.text();
            }

            const responseTime = Date.now() - startTime;

            const response: RestResponse = {
                status: res.status,
                statusText: res.statusText,
                headers: responseHeaders,
                body: responseBody,
                isBinary,
                contentType,
            };

            // Don't persist binary responses to stateStorage (too large)
            this.responseCache[request.id] = { response, responseTime };
            if (!isBinary) {
                this.saveResponseCacheDebounced();
            }

            this.state.update((s) => {
                s.executing = false;
                s.response = response;
                s.responseTime = responseTime;
            });
        } catch (err: any) {
            const responseTime = Date.now() - startTime;
            const response: RestResponse = {
                status: 0,
                statusText: "Error",
                headers: [],
                body: err.message || String(err),
            };

            this.responseCache[request.id] = { response, responseTime };
            this.saveResponseCacheDebounced();

            this.state.update((s) => {
                s.executing = false;
                s.response = response;
                s.responseTime = responseTime;
            });
        }
    };

    // =========================================================================
    // Layout
    // =========================================================================

    setLeftPanelWidth = (width: number) => {
        const clamped = Math.max(150, Math.min(500, width));
        this.state.update((s) => {
            s.leftPanelWidth = clamped;
        });
    };
}

export function createRestClientViewModel(host: IContentHost): ContentViewModel<any> {
    return new RestClientViewModel(host);
}
