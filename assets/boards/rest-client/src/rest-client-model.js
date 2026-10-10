import { createDefaultRequest } from "./rest-client-types.js";
import { serializeRestClientData } from "./rest-client-serializer.js";
import { ResponseCache } from "./response-cache.js";
import { CONTENT_TYPES } from "./http-constants.js";
import { executeRequest } from "./request-execution.js";
import { t } from "./i18n.js";

const copyRequest = request => request && ({
    ...request,
    headers: request.headers.map(row => ({ ...row })),
    formData: request.formData.map(row => ({ ...row })),
    formDataEntries: request.formDataEntries.map(row => ({ ...row })),
});
const copyResponse = response => response && ({ ...response, headers: response.headers.map(row => ({ ...row })) });
const contentType = language => CONTENT_TYPES[language] || "text/plain";
function setContentType(headers, value) {
    const existing = headers.find(header => header.key.trim().toLowerCase() === "content-type");
    if (existing) { existing.value = value; existing.enabled = true; }
    else headers.push({ key: "Content-Type", value, enabled: true });
}

/** @typedef {import("./rest-client-types.js").RestClientData} RestClientData */

function parseContent(content) {
    const parsed = JSON.parse(content);
    if (!parsed || parsed.type !== "rest-client" || !Array.isArray(parsed.requests)) {
        throw new Error(t("errors.notCollection"));
    }
    return parsed;
}

function applyOperation(requests, operation) {
    switch (operation.type) {
        case "add":
            return requests.some(request => request.id === operation.request.id)
                ? requests
                : [...requests, operation.request];
        case "update":
            return requests.map(request => request.id === operation.id
                ? { ...request, ...operation.changes }
                : request);
        case "delete":
            return requests.filter(request => request.id !== operation.id);
        case "deleteCollection":
            return requests.filter(request => request.collection !== operation.collection);
        case "move": {
            const movedIndex = requests.findIndex(request => request.id === operation.fromId);
            const targetIndex = requests.findIndex(request => request.id === operation.toId);
            if (movedIndex < 0 || movedIndex === targetIndex) return requests;
            const next = [...requests];
            const [moved] = next.splice(movedIndex, 1);
            if (operation.collection !== undefined) moved.collection = operation.collection;
            if (targetIndex < 0) next.push(moved);
            else next.splice(targetIndex > movedIndex ? targetIndex - 1 : targetIndex, 0, moved);
            return next;
        }
        default:
            return requests;
    }
}

export class RestClientModel {
    /** @type {RestClientData} */
    data = { type: "rest-client", requests: [createDefaultRequest()] };
    selectedRequestId = "";
    error = "";
    hasContentHost = false;
    loaded = false;
    headersMode = "Table";
    headersJsonInvalid = false;
    executing = false;
    response = null;
    responseTime = 0;
    responseCache;
    #listeners = new Set();
    #unsubscribeContent = null;
    #unsubscribeState = null;
    #saveTimer;
    #pendingOperations = [];
    #disposed = false;
    #permanentlyDisposed = false;
    #saveQueue = Promise.resolve();
    #requestController;

    /** @param {typeof persephone} bridge */
    constructor(bridge) {
        this.bridge = bridge;
        this.responseCache = new ResponseCache(bridge);
    }

    async openRequestIntent(intent) {
        if (!intent || intent.id !== "http.request.open" || intent.version !== 1) {
            throw new Error("Unsupported REST Client capability request.");
        }
        const payload = intent.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new Error("http.request.open expects an object payload.");
        }
        if (typeof payload.url !== "string" || !payload.url.trim()) {
            throw new Error("http.request.open requires a non-empty url string.");
        }
        if (payload.method !== undefined && typeof payload.method !== "string") {
            throw new Error("http.request.open method must be a string.");
        }
        if (payload.headers !== undefined && (
            !payload.headers || typeof payload.headers !== "object" || Array.isArray(payload.headers)
        )) {
            throw new Error("http.request.open headers must be an object of string values.");
        }
        if (payload.body !== undefined && typeof payload.body !== "string") {
            throw new Error("http.request.open body must be a string.");
        }
        if (payload.title !== undefined && typeof payload.title !== "string") {
            throw new Error("http.request.open title must be a string.");
        }
        for (const [key, value] of Object.entries(payload.headers ?? {})) {
            if (typeof value !== "string") {
                throw new Error(`http.request.open header ${key} must have a string value.`);
            }
        }
        if (!this.hasContentHost) {
            throw new Error("http.request.open requires a content-host page.");
        }

        const request = createDefaultRequest(requestName(payload.url));
        request.url = payload.url;
        if (payload.method) request.method = payload.method;
        if (payload.headers) {
            request.headers = Object.entries(payload.headers).map(([key, value]) => ({
                key,
                value: String(value),
                enabled: true,
            }));
        }
        if (payload.body) {
            request.body = payload.body;
            request.bodyType = "raw";
            const contentType = payload.headers?.["Content-Type"]
                || payload.headers?.["content-type"] || "";
            if (contentType.includes("json")) request.bodyLanguage = "json";
            else if (contentType.includes("xml")) request.bodyLanguage = "xml";
            else if (contentType.includes("html")) request.bodyLanguage = "html";
            else if (contentType.includes("javascript")) request.bodyLanguage = "javascript";
        }

        const data = { type: "rest-client", requests: [request] };
        await this.bridge.host.setContent(serializeRestClientData(data));
        this.data = data;
        this.selectedRequestId = request.id;
        this.error = "";
        this.bridge.state.merge({ selectedRequestId: request.id });
        this.#pruneCachedRequests();
        this.#restoreSelectedResponse();
        this.#notify();
    }

    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #notify() {
        for (const listener of this.#listeners) listener(this);
    }

    async load({ initializeState = false } = {}) {
        if (initializeState) {
            this.bridge.state.init({ selectedRequestId: null }, { restorableKeys: ["selectedRequestId"] });
        }
        let content;
        try {
            content = await this.bridge.host.getContent();
            this.hasContentHost = true;
        } catch {
            // Standalone boards have no content host; keep their default request in memory.
            this.hasContentHost = false;
        }
        if (this.hasContentHost) {
            try {
                if (content.trim()) this.data = parseContent(content);
                this.error = "";
            } catch (error) {
                this.error = error?.message || t("errors.notCollection");
            }
        }

        const sharedState = await this.bridge.state.get();
        this.selectedRequestId = sharedState.selectedRequestId || this.data.requests[0]?.id || "";
        this.#selectFirst();
        await this.responseCache.load();
        this.#pruneCachedRequests();
        this.#restoreSelectedResponse();
        this.#unsubscribeState = this.bridge.state.onChange(state => {
            if (state.selectedRequestId !== this.selectedRequestId) {
                this.selectedRequestId = state.selectedRequestId || "";
                this.#selectFirst();
                this.#restoreSelectedResponse();
                this.#notify();
            }
        });
        if (this.hasContentHost) {
            this.#unsubscribeContent = this.bridge.host.onContentChange(content => this.#onContentChange(content));
        }
        this.loaded = true;
        this.#notify();
    }

    #onContentChange(content) {
        try {
            const next = parseContent(content);
            const requests = this.#pendingOperations.reduce((items, operation) => applyOperation(items, operation), next.requests);
            // The echo of this board's own save changes nothing on screen; re-rendering it would
            // rebuild the editor under the user's cursor and drop focus from the field being typed in.
            if (!this.error && this.#matchesCurrent({ ...next, requests })) return;
            this.data = { ...next, requests };
            this.error = "";
            this.#selectFirst();
            this.#pruneCachedRequests();
            this.#restoreSelectedResponse();
            if (this.#pendingOperations.length) this.#scheduleContentSave();
        } catch (error) {
            this.error = error?.message || t("errors.notCollection");
        }
        this.#notify();
    }

    #matchesCurrent(data) {
        return serializeRestClientData(data) === serializeRestClientData(this.data);
    }

    #selectFirst() {
        if (!this.data.requests.some(request => request.id === this.selectedRequestId)) {
            this.selectedRequestId = this.data.requests[0]?.id ?? "";
            this.bridge.state.merge({ selectedRequestId: this.selectedRequestId || null });
        }
    }

    selectRequest(id) {
        if (!this.data.requests.some(request => request.id === id)) return;
        this.bridge.state.merge({ selectedRequestId: id });
    }

    #restoreSelectedResponse() {
        const cached = this.responseCache.get(this.selectedRequestId);
        this.response = cached?.response ?? null;
        this.responseTime = cached?.responseTime ?? 0;
    }

    #pruneCachedRequests() {
        const requestIds = new Set(this.data.requests.map(request => request.id));
        for (const [id] of this.responseCache.entries()) if (!requestIds.has(id)) this.responseCache.delete(id);
    }

    refresh() { this.#notify(); }

    get selectedRequest() {
        return this.data.requests.find(request => request.id === this.selectedRequestId) ?? null;
    }

    #commit(operation, { selectId } = {}) {
        const previousRequests = this.data.requests;
        this.data = { ...this.data, requests: applyOperation(previousRequests, operation) };
        if (operation.type === "delete") this.responseCache.delete(operation.id);
        if (operation.type === "deleteCollection") this.#pruneCachedRequests();
        if (selectId !== undefined) {
            this.selectedRequestId = selectId;
            this.bridge.state.merge({ selectedRequestId: selectId || null });
            this.#restoreSelectedResponse();
        } else if (!this.data.requests.some(request => request.id === this.selectedRequestId)) {
            this.selectedRequestId = this.data.requests[0]?.id ?? "";
            this.bridge.state.merge({ selectedRequestId: this.selectedRequestId || null });
            this.#restoreSelectedResponse();
        }
        this.#pendingOperations.push(operation);
        this.#notify();
        this.#scheduleContentSave();
    }

    addRequest(name, collection) {
        if (collection === undefined) collection = this.selectedRequest?.collection || "";
        const request = createDefaultRequest(name, collection);
        this.#commit({ type: "add", request }, { selectId: request.id });
        return request;
    }

    updateSelected(changes, { notify = true } = {}) {
        const selectedId = this.selectedRequestId;
        if (!selectedId || this.error) return;
        const operation = { type: "update", id: selectedId, changes };
        this.data = { ...this.data, requests: applyOperation(this.data.requests, operation) };
        this.#pendingOperations.push(operation);
        if (notify) this.#notify();
        this.#scheduleContentSave();
    }

    updateRequest(id, changes) { this.#commit({ type: "update", id, changes }); }

    updateBodyType(id, bodyType) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        const headers = request.headers.map(row => ({ ...row }));
        if (bodyType === "form-urlencoded") setContentType(headers, "application/x-www-form-urlencoded");
        else if (bodyType === "raw") setContentType(headers, contentType(request.bodyLanguage));
        else if (bodyType === "binary") setContentType(headers, "application/octet-stream");
        const formDataEntries = bodyType === "form-data" && !request.formDataEntries.length
            ? [{ key: "", value: "", type: "text", enabled: true }]
            : request.formDataEntries.map(row => ({ ...row }));
        this.updateRequest(id, { bodyType, headers, formDataEntries });
    }

    updateBodyLanguage(id, language) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        const headers = request.headers.map(row => ({ ...row }));
        setContentType(headers, contentType(language));
        this.updateRequest(id, { bodyLanguage: language, headers });
    }

    updateHeader(id, index, changes) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        const headers = request.headers.map(row => ({ ...row }));
        if (!headers[index]) throw new Error(`REST Client header unavailable at index ${index}.`);
        headers[index] = { ...headers[index], ...changes };
        this.updateRequest(id, { headers });
    }

    toggleHeader(id, index) {
        const row = this.data.requests.find(item => item.id === id)?.headers[index];
        if (!row) throw new Error(`REST Client header unavailable at index ${index}.`);
        this.updateHeader(id, index, { enabled: !row.enabled });
    }

    deleteHeader(id, index) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        if (!request.headers[index]) throw new Error(`REST Client header unavailable at index ${index}.`);
        this.updateRequest(id, { headers: request.headers.filter((_, rowIndex) => rowIndex !== index).map(row => ({ ...row })) });
    }

    updateFormData(id, index, changes) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        const formData = request.formData.map(row => ({ ...row }));
        if (!formData[index]) throw new Error(`REST Client form field unavailable at index ${index}.`);
        formData[index] = { ...formData[index], ...changes };
        this.updateRequest(id, { formData });
    }

    toggleFormData(id, index) {
        const row = this.data.requests.find(item => item.id === id)?.formData[index];
        if (!row) throw new Error(`REST Client form field unavailable at index ${index}.`);
        this.updateFormData(id, index, { enabled: !row.enabled });
    }

    deleteFormData(id, index) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        if (!request.formData[index]) throw new Error(`REST Client form field unavailable at index ${index}.`);
        this.updateRequest(id, { formData: request.formData.filter((_, rowIndex) => rowIndex !== index).map(row => ({ ...row })) });
    }

    updateFormDataEntry(id, index, changes) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        const formDataEntries = request.formDataEntries.map(row => ({ ...row }));
        if (!formDataEntries[index]) throw new Error(`REST Client multipart field unavailable at index ${index}.`);
        formDataEntries[index] = { ...formDataEntries[index], ...changes };
        if (changes.type !== undefined && changes.type !== request.formDataEntries[index].type) formDataEntries[index].value = "";
        this.updateRequest(id, { formDataEntries });
    }

    toggleFormDataEntry(id, index) {
        const row = this.data.requests.find(item => item.id === id)?.formDataEntries[index];
        if (!row) throw new Error(`REST Client multipart field unavailable at index ${index}.`);
        this.updateFormDataEntry(id, index, { enabled: !row.enabled });
    }

    deleteFormDataEntry(id, index) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        if (!request.formDataEntries[index]) throw new Error(`REST Client multipart field unavailable at index ${index}.`);
        this.updateRequest(id, { formDataEntries: request.formDataEntries.filter((_, rowIndex) => rowIndex !== index).map(row => ({ ...row })) });
    }

    async sendRequest(isDisposed = () => false) {
        const request = this.selectedRequest;
        if (!request || !request.url || this.executing) throw new Error(t("errors.sendPrerequisite"));
        if (this.headersJsonInvalid) throw new Error(t("errors.invalidHeadersBeforeSend"));
        this.#requestController = new AbortController();
        this.executing = true;
        this.response = null;
        this.#notify();
        const result = await executeRequest(copyRequest(request), this.#requestController.signal);
        this.#requestController = undefined;
        if (this.#permanentlyDisposed || this.#disposed || isDisposed()) return copyResponse(result.response);
        this.responseCache.set(request.id, result);
        if (this.selectedRequestId === request.id) {
            this.response = result.response;
            this.responseTime = result.responseTime;
        } else this.#restoreSelectedResponse();
        this.executing = false;
        this.#notify();
        return copyResponse(result.response);
    }

    cancelRequest() { this.#requestController?.abort(); }

    renameRequest(id, name) { this.#commit({ type: "update", id, changes: { name } }); }
    updateRequestCollection(id, collection) { this.#commit({ type: "update", id, changes: { collection } }); }

    duplicateRequest(id) {
        const request = this.data.requests.find(item => item.id === id);
        if (!request) return null;
        const duplicate = {
            ...request,
            id: crypto.randomUUID(),
            name: `${request.name} (copy)`,
            headers: [...request.headers],
            formData: [...request.formData],
            formDataEntries: [...request.formDataEntries],
        };
        this.#commit({ type: "add", request: duplicate }, { selectId: duplicate.id });
        return duplicate;
    }

    deleteRequest(id) {
        const index = this.data.requests.findIndex(request => request.id === id);
        if (index < 0) return;
        const requests = this.data.requests.filter(request => request.id !== id);
        const nextId = this.selectedRequestId === id
            ? requests[Math.min(index, requests.length - 1)]?.id ?? ""
            : this.selectedRequestId;
        this.#commit({ type: "delete", id }, { selectId: nextId });
    }

    deleteCollection(collection) {
        const requests = this.data.requests.filter(request => request.collection !== collection);
        const selectedRemoved = !requests.some(request => request.id === this.selectedRequestId);
        this.#commit({ type: "deleteCollection", collection }, {
            selectId: selectedRemoved ? requests[0]?.id ?? "" : this.selectedRequestId,
        });
    }

    moveRequest(fromId, toId, collection) {
        this.#commit({ type: "move", fromId, toId, collection });
    }

    #scheduleContentSave() {
        if (!this.hasContentHost || this.#disposed) return;
        clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => { void this.#flushContentOperations(); }, 500);
    }

    #flushContentOperations() {
        if (!this.#pendingOperations.length || this.#disposed) return this.#saveQueue;
        const operations = this.#pendingOperations.splice(0);
        this.#saveQueue = this.#saveQueue.then(async () => {
            const currentContent = await this.bridge.host.getContent();
            const latest = currentContent.trim() ? parseContent(currentContent) : { type: "rest-client", requests: [] };
            const requests = operations.reduce((items, operation) => applyOperation(items, operation), latest.requests);
            const data = { ...latest, requests };
            const serialized = serializeRestClientData(data);
            if (serialized !== currentContent) await this.bridge.host.setContent(serialized);
            // Edits typed while this save was in flight are still pending; keep them in view.
            const current = { ...data, requests: this.#pendingOperations.reduce((items, operation) => applyOperation(items, operation), data.requests) };
            // Saving only what is already on screen must not re-render (see #onContentChange).
            if (this.#matchesCurrent(current)) return;
            this.data = current;
            this.#selectFirst();
            this.#pruneCachedRequests();
            this.#restoreSelectedResponse();
            this.#notify();
        }).catch(error => {
            this.#pendingOperations.unshift(...operations);
            this.bridge.notify(error?.message || t("errors.saveCollection"), "warning");
        });
        return this.#saveQueue;
    }

    dispose() {
        this.#permanentlyDisposed = true;
        this.#disposed = true;
        this.#unsubscribeContent?.();
        this.#unsubscribeState?.();
        clearTimeout(this.#saveTimer);
        if (this.#pendingOperations.length) {
            this.#disposed = false;
            void this.#flushContentOperations().finally(() => { this.#disposed = true; });
        }
        this.responseCache.dispose();
        this.#listeners.clear();
    }
}

function requestName(url) {
    try {
        const parsed = new URL(url);
        const segments = parsed.pathname.split("/").filter(Boolean);
        return segments.length > 0 ? segments[segments.length - 1] : parsed.hostname;
    } catch {
        return t("request.default.name");
    }
}
