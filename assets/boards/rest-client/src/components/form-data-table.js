import { createIconButton } from "./icons.js";

export function createFormDataTable({ rows, onChange, onBrowse }) {
    const root = document.createElement("div");
    root.className = "kv-editor form-data-editor";
    const entries = rows.map(row => ({ ...row }));
    if (!entries.length || entries.at(-1).key || entries.at(-1).value) entries.push({ key: "", value: "", type: "text", enabled: true });
    const commit = () => {
        if (entries.at(-1).key || entries.at(-1).value) entries.push({ key: "", value: "", type: "text", enabled: true });
        onChange(entries.map(entry => ({ ...entry })));
        draw();
    };
    const draw = () => {
        root.replaceChildren();
        entries.forEach((entry, index) => {
            const row = document.createElement("div"); row.className = "kv-row form-data-row";
            const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = entry.enabled !== false; enabled.setAttribute("aria-label", "Enable field");
            enabled.addEventListener("change", () => { entry.enabled = enabled.checked; onChange(entries.map(item => ({ ...item }))); });
            const key = document.createElement("input"); key.className = "kv-key"; key.value = entry.key; key.placeholder = "Key"; key.dataset.name = "form-data-key";
            key.addEventListener("input", () => { entry.key = key.value; onChange(entries.map(item => ({ ...item }))); });
            key.addEventListener("change", () => { if (index === entries.length - 1) commit(); });
            const type = document.createElement("button"); type.type = "button"; type.className = "text-btn ghost form-data-type"; type.textContent = entry.type === "file" ? "File" : "Text"; type.dataset.name = "form-data-type-toggle";
            type.title = "Switch between a text value and a file";
            type.addEventListener("click", () => { entry.type = entry.type === "file" ? "text" : "file"; entry.value = ""; commit(); });
            row.append(enabled, key, type);
            if (entry.type === "file") {
                const fileCell = document.createElement("div"); fileCell.className = "form-data-file";
                const path = document.createElement("span"); path.className = "file-path"; path.textContent = entry.value || "No file selected";
                const browse = document.createElement("button"); browse.type = "button"; browse.className = "text-btn"; browse.textContent = "Browse"; browse.dataset.name = "form-data-browse";
                browse.addEventListener("click", async () => { const selected = await onBrowse(); if (selected) { entry.value = selected; commit(); } });
                fileCell.append(path, browse); row.append(fileCell);
            } else {
                const value = document.createElement("input"); value.className = "kv-value"; value.value = entry.value; value.placeholder = "Value"; value.dataset.name = "form-data-value";
                value.addEventListener("input", () => { entry.value = value.value; onChange(entries.map(item => ({ ...item }))); });
                value.addEventListener("change", () => { if (index === entries.length - 1) commit(); });
                row.append(value);
            }
            if (index < entries.length - 1 || entry.key || entry.value) {
                row.append(createIconButton({ icon: "close", name: "form-data-delete", title: "Delete field", onClick: () => { entries.splice(index, 1); commit(); } }));
            }
            root.append(row);
        });
    };
    draw();
    return { element: root, dispose() { root.replaceChildren(); } };
}
