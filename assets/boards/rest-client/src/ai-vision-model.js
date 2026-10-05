import { serializeAsCurlBash, serializeAsCurlCmd, serializeAsFetch, serializeAsFetchNodeJs } from "./request-copy.js";
import { CONTENT_TYPES } from "./http-constants.js";

const cloneRequest = request => request && ({ ...request,
    headers: request.headers.map(row => ({ ...row })),
    formData: request.formData.map(row => ({ ...row })),
    formDataEntries: request.formDataEntries.map(row => ({ ...row })),
});
const cloneResponse = response => response && ({ ...response, headers: response.headers.map(row => ({ ...row })) });
function mapResponse(response) {
    if (!response) return undefined;
    const bytes = response.isBinary
        ? Math.floor(response.body.length * 3 / 4)
        : new Blob([response.body]).size;
    return { ...cloneResponse(response), size: bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB` };
}

const names = [
    ["method-label", "Choose the selected request HTTP method.", "main"], ["url-input", "Locate and edit the selected request URL.", "main"],
    ["rest-send", "Send the selected request to its real service; this operation is asynchronous and network-affecting.", "main"],
    ["request-header-collection", "Edit the selected request collection name.", "main"], ["request-header-name", "Rename the selected request.", "main"],
    ["request-copy-as", "Copy the selected request as code.", "main"], ["request-delete", "Delete the selected request.", "main"],
    ["headers-view", "Switch the request headers between table and JSON presentation by clicking a segment.", "main"],
    ["headers-copy", "Copy the selected request headers as JSON.", "main"], ["kv-row-key", "Edit a header or form-urlencoded key.", "main"],
    ["kv-row-value", "Locate a visible header or form-urlencoded value.", "main"], ["kv-row-delete", "Delete a header or form-urlencoded row.", "main"],
    ["request-body-splitter", "Resize the Headers and Body sections.", "main"], ["body-type-select", "Choose the selected request body type by clicking a segment.", "main"],
    ["body-language", "Choose the raw request body language.", "main"], ["form-data-key", "Edit a multipart field name.", "main"],
    ["form-data-type-toggle", "Toggle a multipart row between text and file.", "main"], ["form-data-value", "Locate a visible multipart text value.", "main"],
    ["form-data-browse", "Browse for a multipart file value.", "main"], ["form-data-delete", "Delete a multipart row.", "main"],
    ["rest-detail-splitter", "Resize the request pane above the response pane.", "main"], ["response-tab-select", "Switch between the response body and headers by clicking a segment.", "main"],
    ["response-headers-view", "Switch response headers between table and JSON presentation by clicking a segment.", "main"],
    ["response-copy-headers", "Copy the response headers as JSON.", "main"], ["response-language", "Choose a response language override; the override is local to the response view.", "main"],
    ["response-open-in-tab", "Open the displayed response in a new editor tab; this is a view-owned action.", "main"],
    ["rest-client-tree", "View and manage the REST request tree.", "requests"], ["rest-tree-add", "Add a request to the REST request tree.", "requests"],
    ["request-tree-collection", "Expand a collection or open its collection actions.", "requests"], ["request-tree-item", "Select a request or open its request actions.", "requests"],
    ["request-tree-duplicate", "Duplicate a request.", "requests"], ["request-tree-delete", "Delete a request.", "requests"],
    ["collection-tree-add", "Add a request to a collection.", "requests"], ["collection-tree-delete", "Delete all requests in a collection.", "requests"],
    ["confirm-dialog-main", "Confirm a request deletion.", "main"], ["confirm-cancel-main", "Cancel the request deletion confirmation.", "main"],
    ["confirm-ok-main", "Confirm the request deletion.", "main"], ["confirm-dialog-requests", "Confirm a request or collection deletion.", "requests"],
    ["confirm-cancel-requests", "Cancel the deletion confirmation.", "requests"], ["confirm-ok-requests", "Confirm the deletion.", "requests"],
];
export const elements = names.map(([name, purpose, view]) => ({ name, purpose, selector: `[data-name="${name}"]`, view }));
const memberRows = [
    ["id", "property", "The model kind marker rest-client; a board page's concrete editor id is board-editor:<root>."],
    ["name", "property", "The editor's registry display name."], ["requests", "property", "All REST requests as fresh copied snapshots, or undefined without an attached page model."],
    ["selectedRequestId", "property", "The selected request id, or undefined without a selection or attached model."],
    ["selectedRequest", "property", "The selected REST request as a fresh copied snapshot, or undefined without selection/model."],
    ["response", "property", "The selected request response as a fresh copied snapshot, or undefined before a response/model."],
    ["responseTime", "property", "Response time in milliseconds, including a real zero, or undefined before a response/model."],
    ["executing", "property", "Whether the selected request is executing, or undefined without a selected request/model."],
    ["headersJsonInvalid", "property", "Whether the selected request's JSON headers editor is invalid, or undefined without selection/model."],
    ["error", "property", "The REST collection parse error, or undefined when parsing succeeds or without a model."],
];
const methods = [
    ["selectRequest", "selectRequest(id: string): void", "Select a request by id; the id must exist."], ["addRequest", "addRequest(name?: string, collection?: string): IRestRequest", "Add REST request data and return its copied snapshot."],
    ["deleteRequest", "deleteRequest(id: string): void", "Delete a REST request by id."], ["deleteCollection", "deleteCollection(collectionName: string): void", "Delete all REST requests in a collection."],
    ["renameRequest", "renameRequest(id: string, name: string): void", "Rename a REST request."], ["updateRequestCollection", "updateRequestCollection(id: string, collection: string): void", "Change a REST request collection."],
    ["moveRequest", "moveRequest(fromId: string, toId: string, newCollection?: string): void", "Reorder or move a REST request."],
    ["setRequestMethod", "setRequestMethod(id: string, method: string): void", "Change a REST request method without accepting a payload."], ["setRequestUrl", "setRequestUrl(id: string, url: string): void", "Change a REST request target URL."],
    ["setBodyType", "setBodyType(id: string, bodyType: IRestBodyType): void", "Change a REST request body type without accepting a body value."], ["setBodyLanguage", "setBodyLanguage(id: string, language: IRestRawLanguage): void", "Change raw REST request body metadata."],
    ["setHeaderKey", "setHeaderKey(id: string, index: number, key: string): void", "Change a request header key without accepting its value."], ["toggleHeader", "toggleHeader(id: string, index: number): void", "Toggle a request header's enabled state."],
    ["deleteHeader", "deleteHeader(id: string, index: number): void", "Delete a request header row."], ["setFormDataKey", "setFormDataKey(id: string, index: number, key: string): void", "Change a form-urlencoded key without accepting its value."],
    ["toggleFormData", "toggleFormData(id: string, index: number): void", "Toggle a form-urlencoded row's enabled state."], ["deleteFormData", "deleteFormData(id: string, index: number): void", "Delete a form-urlencoded row."],
    ["setFormDataEntryKey", "setFormDataEntryKey(id: string, index: number, key: string): void", "Change a multipart key without accepting its value."], ["toggleFormDataEntry", "toggleFormDataEntry(id: string, index: number): void", "Toggle a multipart row's enabled state."],
    ["setFormDataEntryType", 'setFormDataEntryType(id: string, index: number, type: "text" | "file"): void', "Change a multipart row type without accepting its value."],
    ["deleteFormDataEntry", "deleteFormDataEntry(id: string, index: number): void", "Delete a multipart row."],
    ["send", "send(): Promise<IRestResponse>", "Send the selected request and return the completed response snapshot."],
    ["duplicateRequest", "duplicateRequest(id: string): IRestRequest | undefined", "Duplicate a REST request."],
    ["copyAs", 'copyAs(format: "curl-bash" | "curl-cmd" | "fetch" | "fetch-node"): string', "Serialize the selected request as code."],
];
const members = [...memberRows.map(([name, kind, summary]) => ({ name, kind, summary })),
    ...methods.map(([name, signature, summary]) => ({ name, kind: "method", signature, summary,
        ...(name === "send" ? { caution: "sends the user's real headers/body and visible credentials to the user's real service" } : {}) })),
];

const help = `Access the REST Client board model through pages[i].editor.app after selecting a board page whose editor.id begins with "board-editor:". The id property is the model kind marker, "rest-client"; it does not change the page editor id. The bundled board guide is installed-boards/rest-client/index.md; About/MCP list paths use installed-boards/<mount-id>/....\n\nThe model exposes copied collection, selected-request, and response snapshots. On an attached board requests is always an array, including []; selectedRequestId and selectedRequest are undefined without a selection; response and responseTime are undefined before a response; executing and headersJsonInvalid are undefined without a selected request; error is undefined when parsing succeeds. A detached model's getters return undefined.\n\nIRestRequest snapshots contain id, name, collection, method, url, headers [{key,value,enabled}], body, bodyType, bodyLanguage, formData [{key,value,enabled}], binaryFilePath, and formDataEntries [{key,value,type,enabled}]. IRestResponse snapshots contain status, statusText, copied headers, body, optional isBinary/contentType, and formatted size. Page content still contains the full .rest.json data, including credentials.\n\nThe supported root is { type: "rest-client", requests: [...] }; request ids must be unique, collection groups requests, bodyType is none/raw/form-urlencoded/binary/form-data, and raw bodyLanguage is plaintext/json/javascript/html/xml. Use send() deliberately: it sends the selected request's real headers and body to the real service and awaits completion. HTTP error statuses are normal responses; transport or body failures resolve with a status-0 response.\n\nRequest-targeted actions validate ids and throw a diagnostic for an unknown request. There are no setters for header values, body values, or form values because those arguments would copy secrets into MCP history. Board additions are duplicateRequest(id) and copyAs(format), which serializes without changing clipboard state. Binary response entries are session-only; persisted text response cache is capped at 9 MiB. Upload bodies are capped at 32 MiB, checked after readFile allocates the file because the bridge has no file-size query. Open in New Editor is unavailable for board request rows, and the board-local tree does not accept native Persephone link/trait drops. Open in Image Viewer opens a data URL directly in a blob-URL Image Viewer page titled "Image"; only Save to File asks for a path.\n\nElements report live matches. Repeated selectors match multiple controls and do not identify a row index. Segmented controls are div[role=radiogroup]; click a matching [data-value] button. method-label, body-language, and response-language are native selects. Response controls are view-owned; response state is read through this model.`;

export function createAiVisionModel(model) {
    const elementApi = persephone.aiVision.createElements(elements);
    const surface = {
        aiVision: {
            kind: "RestClientEditor", summary: "REST client request and response model.",
            members: [...members, ...elementApi.members], help, elements, provide: elementApi.provide,
            summarize: () => ({ kind: "RestClientEditor", id: surface.id, name: surface.name,
                requestCount: surface.requests?.length, selectedRequestId: surface.selectedRequestId,
                hasResponse: surface.response !== undefined }),
        },
        get id() { return "rest-client"; }, get name() { return "Rest Client"; },
        get requests() { return model.loaded ? model.data.requests.map(cloneRequest) : undefined; },
        get selectedRequestId() { return model.loaded && model.selectedRequestId ? model.selectedRequestId : undefined; },
        get selectedRequest() { return model.loaded ? cloneRequest(model.selectedRequest) : undefined; },
        get response() { return model.loaded ? mapResponse(model.response) : undefined; },
        get responseTime() { return model.loaded && model.response ? model.responseTime : undefined; },
        get executing() { return model.loaded && model.selectedRequest ? model.executing : undefined; },
        get headersJsonInvalid() { return model.loaded && model.selectedRequest ? model.headersJsonInvalid : undefined; },
        get error() { return model.loaded && model.error ? model.error : undefined; },
        selectRequest(id) { requireRequest(id); model.selectRequest(id); },
        addRequest(name, collection) { requireAttached(); return cloneRequest(model.addRequest(name, collection)); },
        deleteRequest(id) { requireRequest(id); model.deleteRequest(id); },
        deleteCollection(collection) { requireAttached(); model.deleteCollection(collection); },
        renameRequest(id, name) { requireRequest(id); model.renameRequest(id, name); },
        updateRequestCollection(id, collection) { requireRequest(id); model.updateRequestCollection(id, collection); },
        moveRequest(fromId, toId, collection) { requireRequest(fromId); if (toId && !String(toId).startsWith("__col__")) requireRequest(toId); model.moveRequest(fromId, toId, collection); },
        setRequestMethod(id, method) {
            const request = requireRequest(id);
            const bodyType = ["GET", "HEAD"].includes(method) ? "none" : request.bodyType === "none" ? "raw" : request.bodyType;
            const headers = request.headers.map(row => ({ ...row }));
            if (request.bodyType === "none" && bodyType === "raw") setType(headers, request.bodyLanguage);
            model.updateRequest(id, { method, bodyType, headers });
        },
        setRequestUrl(id, url) { requireRequest(id); model.updateRequest(id, { url }); },
        setBodyType(id, bodyType) { requireRequest(id); model.updateBodyType(id, bodyType); },
        setBodyLanguage(id, language) { requireRequest(id); model.updateBodyLanguage(id, language); },
        setHeaderKey(id, index, key) { requireRequest(id); model.updateHeader(id, index, { key }); },
        toggleHeader(id, index) { requireRequest(id); model.toggleHeader(id, index); }, deleteHeader(id, index) { requireRequest(id); model.deleteHeader(id, index); },
        setFormDataKey(id, index, key) { requireRequest(id); model.updateFormData(id, index, { key }); },
        toggleFormData(id, index) { requireRequest(id); model.toggleFormData(id, index); }, deleteFormData(id, index) { requireRequest(id); model.deleteFormData(id, index); },
        setFormDataEntryKey(id, index, key) { requireRequest(id); model.updateFormDataEntry(id, index, { key }); },
        toggleFormDataEntry(id, index) { requireRequest(id); model.toggleFormDataEntry(id, index); },
        setFormDataEntryType(id, index, type) { requireRequest(id); model.updateFormDataEntry(id, index, { type }); },
        deleteFormDataEntry(id, index) { requireRequest(id); model.deleteFormDataEntry(id, index); },
        async send() { requireAttached(); return mapResponse(await model.sendRequest()); },
        duplicateRequest(id) { requireAttached(); if (!model.data.requests.some(item => item.id === id)) return undefined; return cloneRequest(model.duplicateRequest(id)); },
        copyAs(format) {
            const request = model.selectedRequest;
            if (!request) throw new Error("REST Client action unavailable: no request is selected.");
            const serializers = { "curl-bash": serializeAsCurlBash, "curl-cmd": serializeAsCurlCmd, fetch: serializeAsFetch, "fetch-node": serializeAsFetchNodeJs };
            if (!serializers[format]) throw new Error(`Unsupported request serialization format: ${format}.`);
            return serializers[format](cloneRequest(request));
        },
    };
    function requireAttached() { if (!model.loaded) throw new Error("REST Client action unavailable: no page model attached."); }
    function requireRequest(id) {
        requireAttached();
        const request = model.data.requests.find(item => item.id === id);
        if (!request) throw new Error(`REST Client request unavailable: no request with id ${JSON.stringify(id)}.`);
        return request;
    }
    return surface;
}

function setType(headers, language) {
    const value = CONTENT_TYPES[language] || "text/plain";
    const existing = headers.find(header => header.key.trim().toLowerCase() === "content-type");
    if (existing) { existing.value = value; existing.enabled = true; }
    else headers.push({ key: "Content-Type", value, enabled: true });
}
