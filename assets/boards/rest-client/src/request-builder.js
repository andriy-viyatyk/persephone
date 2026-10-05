import * as CodeMirror from "../lib/codemirror.js";
import { createSelect, createLanguagePicker } from "./components/select.js";
import { createSegmented } from "./components/segmented.js";
import { createIconButton } from "./components/icons.js";
import { createKeyValueTable } from "./components/key-value-table.js";
import { createFormDataTable } from "./components/form-data-table.js";
import { createSplitter } from "./components/splitter.js";
import { CONTENT_TYPES, HTTP_METHODS } from "./http-constants.js";
import { createCopyMenu } from "./request-copy.js";
import { parseClipboardRequest } from "./request-parser.js";
import { confirmDialog } from "./components/confirm.js";

const BODY_OPTIONS = ["none", "form-data", "form-urlencoded", "raw", "binary"];
const RAW_LANGUAGES = ["plaintext", "json", "javascript", "html", "xml"];
const editorTheme = CodeMirror.EditorView.theme({
    "&": { height: "100%", color: "var(--p-text, #d4d4d4)", backgroundColor: "var(--p-bg, #1e1e1e)" },
    ".cm-content": { caretColor: "var(--p-text, #d4d4d4)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--p-text, #d4d4d4)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--p-selection-bg, #264f78)" },
    ".cm-gutters": { color: "var(--p-text-muted, #999)", backgroundColor: "transparent", border: "none" },
});

function rawLanguageExtension(language) {
    return ({ json: CodeMirror.json, javascript: CodeMirror.javascript, html: CodeMirror.html, xml: CodeMirror.xml })[language]?.() ?? [];
}

function setContentType(headers, value) {
    const existing = headers.find(header => header.key.trim().toLowerCase() === "content-type");
    if (existing) { existing.value = value; existing.enabled = true; }
    else headers.push({ key: "Content-Type", value, enabled: true });
}

function updateRequest(model, changes) {
    void model.updateSelected(changes, { notify: false });
}

export function renderRequestBuilder(model, root, { onSend, onCancel }) {
    const request = model.selectedRequest;
    const disposers = [];
    const section = document.createElement("section"); section.className = "request-editor";
    const heading = document.createElement("span"); heading.className = "empty-message"; heading.textContent = request?.name || "No request selected";
    const requestHeader = document.createElement("div"); requestHeader.className = "band pane-header request-pane-header";
    if (!request) { requestHeader.append(heading); section.append(requestHeader); root.append(section); return { dispose() {} }; }
    const collection = document.createElement("input");
    collection.className = "crumb crumb-collection";
    collection.value = request.collection;
    collection.placeholder = "Collection";
    collection.dataset.name = "request-header-collection";
    collection.setAttribute("aria-label", "Collection");
    collection.addEventListener("change", () => model.updateRequestCollection(request.id, collection.value));
    const name = document.createElement("input");
    name.className = "crumb crumb-name";
    name.value = request.name;
    name.placeholder = "Request name";
    name.dataset.name = "request-header-name";
    name.setAttribute("aria-label", "Request name");
    name.addEventListener("change", () => model.renameRequest(request.id, name.value));
    const copy = createIconButton({ icon: "copy", name: "request-copy-as", title: "Copy request as..." });
    let copyMenu;
    copy.addEventListener("click", () => {
        copyMenu?.remove();
        copyMenu = createCopyMenu(model, copy);
    });
    const deleteRequest = createIconButton({ icon: "delete", name: "request-delete", title: "Delete request" });
    deleteRequest.addEventListener("click", () => {
        void confirmDialog(`Delete "${request.name || "(empty)"}"?`, { view: "main" }).then((ok) => { if (ok) model.deleteRequest(request.id); });
    });
    const separator = document.createElement("span"); separator.className = "crumb-separator"; separator.textContent = "/";
    const spacer = document.createElement("span"); spacer.className = "spacer";
    requestHeader.append(collection, separator, name, spacer, copy, deleteRequest);
    const bar = document.createElement("div"); bar.className = "band request-bar";
    const method = createSelect({ options: HTTP_METHODS, value: request.method, dataName: "method-label", label: "HTTP method", className: "method-select" });
    const setMethodColor = () => { method.dataset.method = method.value; };
    setMethodColor();
    const url = document.createElement("input"); url.className = "url-input"; url.value = request.url; url.placeholder = "Enter request URL"; url.dataset.name = "url-input"; url.setAttribute("aria-label", "Request URL");
    url.addEventListener("input", () => updateRequest(model, { url: url.value }));
    const send = document.createElement("button"); send.type = "button"; send.className = "text-btn primary"; send.dataset.name = "rest-send";
    send.textContent = model.executing ? "Sending..." : "Send"; send.disabled = model.executing || !request.url;
    url.addEventListener("input", () => { send.disabled = model.executing || !url.value; });
    send.addEventListener("click", () => onSend());
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "text-btn"; cancel.textContent = "Cancel"; cancel.hidden = !model.executing; cancel.addEventListener("click", () => onCancel());
    bar.append(method, url, send, cancel);
    method.addEventListener("change", () => {
        const next = method.value;
        setMethodColor();
        const current = model.selectedRequest ?? request;
        const bodyType = ["GET", "HEAD"].includes(next) ? "none" : current.bodyType === "none" ? "raw" : current.bodyType;
        if (bodyType === "raw" && current.bodyType === "none") setContentType(current.headers, CONTENT_TYPES[current.bodyLanguage] || "text/plain");
        updateRequest(model, { method: next, bodyType, headers: current.headers });
        model.refresh();
    });

    url.addEventListener("paste", event => {
        const pasted = event.clipboardData?.getData("text") ?? "";
        const trimmed = pasted.trim();
        if (!trimmed.startsWith("fetch(") && !/^curl\s/i.test(trimmed)) return;
        const parsed = parseClipboardRequest(pasted);
        if (!parsed) return;
        event.preventDefault();
        model.updateSelected({
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            body: parsed.body,
            bodyType: parsed.bodyType,
            bodyLanguage: parsed.bodyLanguage,
            formData: parsed.formData,
        });
    });

    const headersBlock = document.createElement("section"); headersBlock.className = "request-subpanel";
    const subheading = document.createElement("div"); subheading.className = "band section-header";
    const headersTitle = document.createElement("span"); headersTitle.className = "section-title"; headersTitle.textContent = "Headers";
    const headersSpacer = document.createElement("span"); headersSpacer.className = "spacer";
    const headersMode = createSegmented({ options: ["Table", "JSON"], value: model.headersMode, dataName: "headers-view", label: "Headers view" });
    const copyHeaders = createIconButton({ icon: "copy", name: "headers-copy", title: "Copy headers as JSON" });
    copyHeaders.addEventListener("click", async () => {
        try {
            const headers = model.selectedRequest?.headers ?? [];
            await persephone.clipboard.writeText(JSON.stringify(Object.fromEntries(headers.filter(row => row.enabled && row.key.trim()).map(row => [row.key.trim(), row.value])), null, 2));
        }
        catch (error) { persephone.notify(error?.message || "Unable to copy headers.", "error"); }
    });
    subheading.append(headersTitle, headersSpacer, headersMode, copyHeaders); headersBlock.append(subheading);
    let headerEditor;
    let headerTable;
    const renderHeaders = () => {
        headerEditor?.destroy(); headerEditor = undefined; headerTable?.dispose(); headerTable = undefined;
        headersBlock.querySelector(".headers-content")?.remove();
        const content = document.createElement("div"); content.className = "headers-content";
        if (model.headersMode === "JSON") {
            const surface = document.createElement("div"); surface.className = "cm-surface headers-json-surface";
            const headers = model.selectedRequest?.headers ?? [];
            const text = JSON.stringify(Object.fromEntries(headers.filter(row => row.key || row.value).map(row => [row.key, row.value])), null, 2);
            headerEditor = new CodeMirror.EditorView({ state: CodeMirror.EditorState.create({ doc: text, extensions: [CodeMirror.basicSetup, editorTheme] }), parent: surface });
            headerEditor.contentDOM.setAttribute("aria-label", "Request headers JSON");
            headerEditor.contentDOM.addEventListener("input", () => {
                try {
                    const parsed = JSON.parse(headerEditor.state.doc.toString());
                    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Headers JSON must be an object.");
                    updateRequest(model, { headers: Object.entries(parsed).map(([key, value]) => ({ key, value: String(value), enabled: true })) });
                    model.headersJsonInvalid = false;
                } catch { model.headersJsonInvalid = true; }
            });
            content.append(surface);
        } else {
            headerTable = createKeyValueTable({ rows: model.selectedRequest?.headers ?? [], mode: "headers", onChange: rows => updateRequest(model, { headers: rows }) });
            content.append(headerTable.element);
        }
        headersBlock.append(content);
    };
    headersMode.addEventListener("change", () => {
        if (headersMode.value === "Table" && model.headersJsonInvalid) { persephone.notify("Fix invalid JSON in headers before switching to Table", "warning"); headersMode.value = "JSON"; return; }
        model.headersMode = headersMode.value; renderHeaders();
    });
    renderHeaders();

    const bodyBlock = document.createElement("section"); bodyBlock.className = "request-subpanel body-block";
    const bodyHeading = document.createElement("div"); bodyHeading.className = "band section-header";
    const bodyTitle = document.createElement("span"); bodyTitle.className = "section-title"; bodyTitle.textContent = "Body";
    const bodyType = createSegmented({ options: BODY_OPTIONS.map(value => ({ value, label: value === "form-urlencoded" ? "x-www-form-urlencoded" : value })), value: request.bodyType, dataName: "body-type-select", label: "Body type" });
    const { wrapper: languagePicker, select: language } = createLanguagePicker({ options: RAW_LANGUAGES, value: request.bodyLanguage, dataName: "body-language", label: "Body language" });
    languagePicker.hidden = request.bodyType !== "raw";
    bodyHeading.append(bodyTitle, bodyType, languagePicker); bodyBlock.append(bodyHeading);
    const bodyContent = document.createElement("div"); bodyContent.className = "body-content";
    let bodyEditor;
    let bodyTable;
    let formDataTable;
    const renderBody = () => {
        bodyEditor?.destroy(); bodyEditor = undefined; bodyTable?.dispose(); bodyTable = undefined; formDataTable?.dispose(); formDataTable = undefined;
        bodyContent.replaceChildren(); languagePicker.hidden = request.bodyType !== "raw";
        if (request.bodyType === "raw") {
            const surface = document.createElement("div"); surface.className = "cm-surface body-cm-surface";
            const extensions = [CodeMirror.basicSetup, editorTheme, rawLanguageExtension(request.bodyLanguage), CodeMirror.EditorView.updateListener.of(update => {
                if (update.docChanged) updateRequest(model, { body: update.state.doc.toString() });
            })];
            bodyEditor = new CodeMirror.EditorView({ state: CodeMirror.EditorState.create({ doc: request.body, extensions }), parent: surface });
            bodyContent.append(surface);
        } else if (request.bodyType === "form-urlencoded") {
            bodyTable = createKeyValueTable({ rows: request.formData, mode: "form", onChange: rows => updateRequest(model, { formData: rows }) }); bodyContent.append(bodyTable.element);
        } else if (request.bodyType === "form-data") {
            formDataTable = createFormDataTable({
                rows: request.formDataEntries,
                onChange: rows => updateRequest(model, { formDataEntries: rows }),
                onBrowse: async () => {
                    try { return (await persephone.openFileDialog({ properties: ["openFile"] }))?.[0]; }
                    catch (error) { persephone.notify(error?.message || "Unable to select a file.", "error"); return undefined; }
                },
            });
            bodyContent.append(formDataTable.element);
        } else if (request.bodyType === "binary") {
            const fileRow = document.createElement("div"); fileRow.className = "binary-file-row";
            const filePath = document.createElement("span"); filePath.textContent = request.binaryFilePath || "No file selected";
            const browse = document.createElement("button"); browse.type = "button"; browse.className = "text-btn"; browse.textContent = "Browse"; browse.addEventListener("click", async () => {
                try { const selected = (await persephone.openFileDialog({ properties: ["openFile"] }))?.[0]; if (selected) { updateRequest(model, { binaryFilePath: selected }); filePath.textContent = selected; } }
                catch (error) { persephone.notify(error?.message || "Unable to select a file.", "error"); }
            });
            fileRow.append(filePath, browse); bodyContent.append(fileRow);
        } else {
            const message = document.createElement("span"); message.className = "empty-message"; message.textContent = "This request has no body.";
            bodyContent.append(message);
        }
        bodyBlock.append(bodyContent);
    };
    bodyType.addEventListener("change", () => {
        const next = bodyType.value;
        const current = model.selectedRequest ?? request;
        if (next === "form-urlencoded") setContentType(current.headers, "application/x-www-form-urlencoded");
        else if (next === "raw") setContentType(current.headers, CONTENT_TYPES[current.bodyLanguage] || "text/plain");
        else if (next === "binary") setContentType(current.headers, "application/octet-stream");
        updateRequest(model, { bodyType: next, headers: current.headers, formDataEntries: next === "form-data" && !current.formDataEntries.length ? [{ key: "", value: "", type: "text", enabled: true }] : current.formDataEntries });
        model.refresh();
    });
    language.addEventListener("change", () => {
        const current = model.selectedRequest ?? request;
        updateRequest(model, { bodyLanguage: language.value });
        setContentType(current.headers, CONTENT_TYPES[language.value] || "text/plain");
        updateRequest(model, { headers: current.headers }); model.refresh();
    });
    renderBody();
    const vertical = document.createElement("div"); vertical.className = "request-body-layout";
    const bodySplitter = createSplitter({ name: "request-body-splitter", orientation: "horizontal", initial: 60 });
    vertical.append(headersBlock, bodySplitter.element, bodyBlock);
    bodySplitter.refresh();
    subheading.addEventListener("dblclick", bodySplitter.toggle); bodyHeading.addEventListener("dblclick", bodySplitter.toggle);
    section.append(requestHeader, bar, vertical); root.append(section);
    disposers.push(() => copyMenu?.remove(), () => bodyEditor?.destroy(), () => headerEditor?.destroy(), () => headerTable?.dispose(), () => formDataTable?.dispose(), () => bodyTable?.dispose(), () => bodySplitter.dispose());
    return { dispose() { for (const dispose of disposers) dispose(); section.remove(); } };
}
