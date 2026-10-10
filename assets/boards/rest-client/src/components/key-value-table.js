import { COMMON_HEADERS } from "../http-constants.js";
import { createIconButton } from "./icons.js";
import { t } from "../i18n.js";

const dataNames = { key: "kv-row-key", value: "kv-row-value", remove: "kv-row-delete" };

export function createKeyValueTable({ rows, onChange, mode = "headers", readOnly = false }) {
    const root = document.createElement("div");
    root.className = "kv-editor";
    const normalizedRows = rows.map(row => ({ ...row }));
    if (!normalizedRows.length || normalizedRows.at(-1).key || normalizedRows.at(-1).value) {
        normalizedRows.push({ key: "", value: "", enabled: true });
    }
    const commit = () => {
        while (normalizedRows.length > 1) {
            const last = normalizedRows.at(-1);
            const previous = normalizedRows.at(-2);
            if (last.key || last.value || previous.key || previous.value) break;
            normalizedRows.pop();
        }
        if (normalizedRows.at(-1).key || normalizedRows.at(-1).value) normalizedRows.push({ key: "", value: "", enabled: true });
        onChange(normalizedRows.map(row => ({ ...row })));
        draw();
    };
    const draw = () => {
        root.replaceChildren();
        normalizedRows.forEach((row, index) => {
            const line = document.createElement("div");
            line.className = "kv-row";
            const enabled = document.createElement("input");
            enabled.type = "checkbox";
            enabled.checked = row.enabled !== false;
            enabled.setAttribute("aria-label", t(mode === "headers" ? "fields.header.enable" : "fields.field.enable"));
            enabled.addEventListener("change", () => { row.enabled = enabled.checked; onChange(normalizedRows.map(item => ({ ...item }))); });
            const key = document.createElement("input");
            key.className = "kv-key";
            key.value = row.key;
            key.placeholder = t(mode === "headers" ? "fields.header.name" : "fields.key");
            key.dataset.name = dataNames.key;
            if (mode === "headers") key.setAttribute("list", "rest-common-headers");
            key.disabled = readOnly;
            key.addEventListener("input", () => { row.key = key.value; onChange(normalizedRows.map(item => ({ ...item }))); });
            key.addEventListener("change", () => { if (index === normalizedRows.length - 1) commit(); });
            const value = document.createElement("input");
            value.className = "kv-value";
            value.value = row.value;
            value.placeholder = t("fields.value");
            value.dataset.name = dataNames.value;
            value.disabled = readOnly;
            value.addEventListener("input", () => { row.value = value.value; onChange(normalizedRows.map(item => ({ ...item }))); });
            value.addEventListener("change", () => { if (index === normalizedRows.length - 1) commit(); });
            line.append(enabled, key, value);
            // The trailing blank row has no delete button, like the built-in's.
            const isBlankTail = index === normalizedRows.length - 1 && !row.key && !row.value;
            if (!readOnly && !isBlankTail) {
                line.append(createIconButton({ icon: "close", name: dataNames.remove, title: t("fields.row.delete"), onClick: () => { normalizedRows.splice(index, 1); commit(); } }));
            }
            root.append(line);
        });
    };
    if (mode === "headers") {
        let datalist = document.getElementById("rest-common-headers");
        if (!datalist) {
            datalist = document.createElement("datalist"); datalist.id = "rest-common-headers";
            for (const header of COMMON_HEADERS) { const option = document.createElement("option"); option.value = header; datalist.append(option); }
            document.body.append(datalist);
        }
    }
    draw();
    return { element: root, getRows: () => normalizedRows.map(row => ({ ...row })), dispose() { root.replaceChildren(); } };
}
