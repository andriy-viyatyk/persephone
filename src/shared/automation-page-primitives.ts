/** Page-side visibility rule shared by automation and site-extension models. */
function displayed(element: Element): boolean {
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
}

function visible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && displayed(element);
}

export function isVisibleElement(element: Element): boolean {
    return visible(element);
}

/** Source used by serialized automation snippets, generated from the same functions above. */
export const VISIBLE_FN = `const displayed = ${displayed.toString()};\nconst visible = ${visible.toString()};`;

/** Native controlled-input update used by both automation and site-extension helpers. */
export function setNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("The native value setter is unavailable for this control.");
    setter.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}
