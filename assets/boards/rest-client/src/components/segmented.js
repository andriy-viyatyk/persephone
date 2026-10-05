/**
 * Segmented button group — the app's SegmentedControl. Mirrors the <select> contract the views
 * already use: a `value` property and a bubbling "change" event when the user picks a segment.
 */
export function createSegmented({ options, value, dataName, label }) {
    const element = document.createElement("div");
    element.className = "segmented";
    element.setAttribute("role", "radiogroup");
    if (dataName) element.dataset.name = dataName;
    if (label) element.setAttribute("aria-label", label);
    let current = value;
    const buttons = options.map((optionData) => {
        const optionValue = typeof optionData === "string" ? optionData : optionData.value;
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.value = optionValue;
        button.setAttribute("role", "radio");
        button.textContent = typeof optionData === "string" ? optionData : optionData.label;
        button.addEventListener("click", () => {
            if (current === optionValue) return;
            current = optionValue;
            sync();
            element.dispatchEvent(new Event("change", { bubbles: true }));
        });
        return button;
    });
    const sync = () => {
        for (const button of buttons) {
            const selected = button.dataset.value === current;
            button.classList.toggle("selected", selected);
            button.setAttribute("aria-checked", String(selected));
        }
    };
    Object.defineProperty(element, "value", {
        get: () => current,
        set: (next) => { current = next; sync(); },
    });
    element.append(...buttons);
    sync();
    return element;
}
