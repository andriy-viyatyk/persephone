import { createIcon } from "./icons.js";

export function createSelect({ options, value, dataName, label, className, disabled = false }) {
    const element = document.createElement("select");
    if (className) element.className = className;
    if (dataName) element.dataset.name = dataName;
    if (label) element.setAttribute("aria-label", label);
    element.disabled = disabled;
    for (const optionData of options) {
        const option = document.createElement("option");
        option.value = typeof optionData === "string" ? optionData : optionData.value;
        option.textContent = typeof optionData === "string" ? optionData : optionData.label;
        option.disabled = typeof optionData === "object" && !!optionData.disabled;
        element.append(option);
    }
    element.value = value ?? "";
    return element;
}

/**
 * The "{} json" language picker the built-in shows as a ghost button. Returns the wrapper to place
 * and the <select> (which carries the data-name) to read and listen to.
 */
export function createLanguagePicker({ options, value, dataName, label }) {
    const wrapper = document.createElement("label");
    wrapper.className = "language-picker";
    const select = createSelect({ options, value, dataName, label, className: "ghost-select" });
    wrapper.append(createIcon("braces"), select);
    return { wrapper, select };
}
