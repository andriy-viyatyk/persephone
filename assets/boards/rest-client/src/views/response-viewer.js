import * as CodeMirror from "../../lib/codemirror.js";
import { createLanguagePicker } from "../components/select.js";
import { createSegmented } from "../components/segmented.js";
import { createIconButton } from "../components/icons.js";
import { RESPONSE_LANGUAGES, contentTypeExtension, formatByteSize, formatResponseBody, inferResponseLanguage } from "../response-utils.js";
import { base64ToBytes } from "../request-execution.js";

const theme = CodeMirror.EditorView.theme({
    "&": { height: "100%", color: "var(--p-text, #d4d4d4)", backgroundColor: "var(--p-bg, #1e1e1e)" },
    ".cm-gutters": { color: "var(--p-text-muted, #999)", backgroundColor: "transparent", border: "none" },
});

function responseBytes(response) {
    return response.isBinary ? base64ToBytes(response.body) : new TextEncoder().encode(response.body);
}

function modeFor(language) {
    if (language === "css" && typeof CodeMirror.css === "function") return CodeMirror.css();
    if (language === "yaml" && typeof CodeMirror.yaml === "function") return CodeMirror.yaml();
    return ({ json: CodeMirror.json, html: CodeMirror.html, xml: CodeMirror.xml, javascript: CodeMirror.javascript })[language]?.() ?? [];
}

export function renderResponseViewer(model, root) {
    const section = document.createElement("section"); section.className = "response-viewer";
    const response = model.response;
    let editor;
    let objectUrl;
    const dispose = () => { editor?.destroy(); editor = undefined; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined; };
    const header = document.createElement("div"); header.className = "band pane-header response-pane-header";
    const title = document.createElement("span"); title.className = "section-title"; title.textContent = "Response";
    const spacer = document.createElement("span"); spacer.className = "spacer";
    header.append(title, spacer); section.append(header);
    if (!response) {
        const message = document.createElement("span"); message.className = "empty-message";
        message.textContent = model.executing ? "Sending request..." : "Send a request to see the response.";
        section.append(message); root.append(section); return { dispose };
    }
    const size = response.isBinary ? base64ToBytes(response.body).byteLength : new TextEncoder().encode(response.body).byteLength;
    const status = document.createElement("span"); status.className = "response-status";
    status.dataset.statusClass = response.status === 0 ? "5" : String(Math.min(5, Math.max(2, Math.floor(response.status / 100))));
    status.textContent = response.status === 0 ? "Error" : `${response.status} ${response.statusText}`;
    const time = document.createElement("span"); time.className = "response-metadata"; time.textContent = `${model.responseTime}ms`;
    const sizeLabel = document.createElement("span"); sizeLabel.className = "response-metadata"; sizeLabel.textContent = formatByteSize(size);
    header.append(status, time, sizeLabel);

    const tabs = createSegmented({
        options: [
            { value: "Body", label: `Body (${formatByteSize(size)})` },
            { value: "Headers", label: `Headers (${response.headers.length})` },
        ],
        value: model.responseTab || "Body", dataName: "response-tab-select", label: "Response view",
    });
    const mode = createSegmented({ options: ["Table", "JSON"], value: model.responseHeadersMode || "Table", dataName: "response-headers-view", label: "Response headers view" });
    const copy = createIconButton({ icon: "copy", name: "response-copy-headers", title: "Copy headers as JSON" });
    copy.addEventListener("click", async () => {
        try { await persephone.clipboard.writeText(JSON.stringify(Object.fromEntries(response.headers.map(row => [row.key, row.value])), null, 2)); }
        catch (error) { persephone.notify(error?.message || "Unable to copy response headers.", "error"); }
    });
    const detected = inferResponseLanguage(response.contentType);
    const availableLanguages = RESPONSE_LANGUAGES.filter(language => !["css", "yaml"].includes(language) || typeof CodeMirror[language] === "function");
    const { wrapper: languagePicker, select: language } = createLanguagePicker({ options: availableLanguages, value: availableLanguages.includes(model.responseLanguage) ? model.responseLanguage : availableLanguages.includes(detected) ? detected : "plaintext", dataName: "response-language", label: "Response language" });
    const open = createIconButton({ icon: "new-window", name: "response-open-in-tab", title: "Open in new tab" }); open.hidden = !!response.isBinary;
    open.addEventListener("click", async () => {
        try { await persephone.openContent({ editor: "monaco", language: language.value, title: "Response", content: formatResponseBody(response.body, language.value) }); }
        catch (error) { persephone.notify(error?.message || "Unable to open response.", "error"); }
    });
    const controls = document.createElement("div"); controls.className = "response-controls";
    const controlsSpacer = document.createElement("span"); controlsSpacer.className = "spacer";
    controls.append(tabs, controlsSpacer, open, languagePicker, mode, copy); section.append(controls);
    const content = document.createElement("div"); content.className = "response-content"; section.append(content);
    const renderContent = () => {
        dispose(); content.replaceChildren();
        const headersActive = tabs.value === "Headers";
        mode.hidden = !headersActive; copy.hidden = !headersActive; languagePicker.hidden = headersActive || !!response.isBinary; open.hidden = headersActive || !!response.isBinary;
        if (headersActive && mode.value === "Table") {
            const table = document.createElement("table"); table.className = "response-headers-table";
            for (const row of response.headers) { const tr = document.createElement("tr"); const key = document.createElement("th"); key.textContent = row.key; const value = document.createElement("td"); value.textContent = row.value; tr.append(key, value); table.append(tr); }
            content.append(table); return;
        }
        if (headersActive) {
            const headersObject = Object.fromEntries(response.headers.map(row => [row.key, row.value]));
            const surface = document.createElement("div"); surface.className = "cm-surface response-cm-surface";
            editor = new CodeMirror.EditorView({ state: CodeMirror.EditorState.create({ doc: JSON.stringify(headersObject, null, 2), extensions: [CodeMirror.basicSetup, CodeMirror.EditorState.readOnly.of(true), theme, CodeMirror.json()] }), parent: surface });
            content.append(surface); return;
        }
        if (response.isBinary) {
            const bytes = responseBytes(response);
            const summary = document.createElement("div"); summary.className = "binary-summary";
            const description = document.createElement("p"); description.textContent = `${response.contentType || "Unknown content type"} · ${formatByteSize(bytes.byteLength)}`;
            const save = document.createElement("button"); save.type = "button"; save.className = "text-btn"; save.textContent = "Save to File";
            save.addEventListener("click", async () => saveBinary(bytes, response.contentType));
            summary.append(description, save);
            if ((response.contentType || "").toLowerCase().startsWith("image/")) {
                objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.contentType }));
                const image = document.createElement("img"); image.className = "response-image-preview"; image.alt = "Response image preview"; image.src = objectUrl;
                const openImage = document.createElement("button"); openImage.type = "button"; openImage.className = "text-btn"; openImage.textContent = "Open in Image Viewer";
                openImage.addEventListener("click", () => persephone.openRawLink(`data:${response.contentType};base64,${response.body}`, { editor: "image-view" })); summary.append(openImage); content.append(image);
            }
            content.prepend(summary); return;
        }
        const surface = document.createElement("div"); surface.className = "cm-surface response-cm-surface";
        const body = formatResponseBody(response.body, language.value);
        editor = new CodeMirror.EditorView({ state: CodeMirror.EditorState.create({ doc: body, extensions: [CodeMirror.basicSetup, CodeMirror.EditorState.readOnly.of(true), theme, modeFor(language.value)] }), parent: surface });
        content.append(surface);
    };
    const saveBinary = async (bytes, contentType) => {
        try {
            const path = await persephone.saveFileDialog({ defaultPath: `response.${contentTypeExtension(contentType)}` });
            if (!path) return;
            await persephone.writeFile(path, bytes, { encoding: "binary" });
            persephone.notify("Response saved.", "success");
        } catch (error) { persephone.notify(error?.message || "Unable to save response.", "error"); }
    };
    tabs.addEventListener("change", () => { model.responseTab = tabs.value; renderContent(); });
    mode.addEventListener("change", () => { model.responseHeadersMode = mode.value; renderContent(); });
    language.addEventListener("change", () => { model.responseLanguage = language.value; renderContent(); });
    renderContent(); root.append(section);
    return { dispose };
}
