import { app } from "../api/app";
import { fpResolve, isArchivePath, isAsarPath, isPlainLocalPath } from "../core/utils/file-path";
import { resolveActionablePoint, resolveElementLocator, runOnLocator } from "./locator";
import { checkElement, clickElement, uncheckElement } from "./mouse";
import { pressKey, typeMappedCharacter } from "./input";
import { typeText } from "./synthetic";
import { getRefSessionId, parseRef } from "./ref";
import { errMessage } from "../../shared/utils";
import type { IAutomationTarget, ISyntheticInputHost } from "./types";
import type { ActionablePoint, ElementLocator, RefLocator, MouseActionOptions } from "./locator";


export interface TypeActionOptions extends MouseActionOptions {
    slowly?: boolean;
    submit?: boolean;
}
export type FillFormField =
    | { name: string; locator: string | RefLocator; action: "type"; value: string; options?: TypeActionOptions }
    | { name: string; locator: string | RefLocator; action: "select"; value: string | string[]; options?: MouseActionOptions }
    | { name: string; locator: string | RefLocator; action: "check" | "uncheck"; options?: MouseActionOptions };
async function selectEditableContent(
    cdp: ActionablePoint["cdp"], locator: ElementLocator, nth: number | undefined,
    sessionId: string | undefined, kind: string,
): Promise<void> {
    if (kind === "contenteditable") {
        const ownsSelection = await runOnLocator<boolean>(cdp, locator, nth, `
            const selection = window.getSelection();
            return document.activeElement === this || (!!selection?.anchorNode && this.contains(selection.anchorNode));
        `);
        if (!ownsSelection) throw new Error("The contenteditable element does not own focus or the current selection.");
        await pressKey(cdp, "Control+a", { sessionId });
    } else {
        // Select on the located element itself, in its own frame. `document.activeElement` in the
        // top document is the <iframe> for a frame ref, so selecting it there selected nothing and
        // the typed text was inserted at the click point instead of replacing the value.
        await runOnLocator<void>(cdp, locator, nth, `
            if (typeof this.select === 'function') { try { this.select(); } catch {} }
        `);
    }
}

interface EditableElementDetails {
    tag: string;
    type: string;
    contentEditable: boolean;
    id: string;
    role: string;
    label: string;
}

async function getEditableElementDetails(action: ActionablePoint, locator: ElementLocator, nth?: number): Promise<EditableElementDetails> {
    return runOnLocator<EditableElementDetails>(action.cdp, locator, nth, `
        const el = this;
        const label = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.closest('label')?.innerText || '';
        return { tag: el.localName, type: (el.type || '').toLowerCase(), contentEditable: el.isContentEditable || el.getAttribute('contenteditable') === 'true', id: el.id || '', role: el.getAttribute('role') || '', label: label.trim() };
    `);
}

function validateEditableElement(details: EditableElementDetails): void {
    if (details.tag === "input" && details.type === "file") throw new Error("Cannot type into a file input; use setInputFiles.");
    const textTypes = new Set(["text", "search", "email", "url", "tel", "password", "number"]);
    const nativeTypes = new Set(["date", "time", "datetime-local", "month", "week", "color", "range"]);
    const isTextControl = details.tag === "textarea" || (details.tag === "input" && textTypes.has(details.type || "text"));
    const isNativeControl = details.tag === "input" && nativeTypes.has(details.type);
    if (!isTextControl && !isNativeControl && !details.contentEditable) {
        const context = [details.id ? `#${details.id}` : "", details.role ? `role=${details.role}` : "", details.label ? `label=${JSON.stringify(details.label)}` : ""].filter(Boolean).join(", ");
        throw new Error(`Cannot type into non-editable <${details.tag}>${context ? ` (${context})` : ""}.`);
    }
}

async function fillResolvedElement(
    action: ActionablePoint, locator: ElementLocator, text: string, options: TypeActionOptions,
    details: EditableElementDetails,
): Promise<void> {
    const nth = options.nth;
    const nativeTypes = new Set(["date", "time", "datetime-local", "month", "week", "color", "range"]);
    const isNativeControl = details.tag === "input" && nativeTypes.has(details.type);
    validateEditableElement(details);
    if (isNativeControl) {
        const valid = await runOnLocator<boolean>(action.cdp, locator, nth, `
            const type = this.type;
            const probe = document.createElement('input'); probe.type = type; probe.value = ${JSON.stringify(text)};
            if (probe.value !== ${JSON.stringify(text)}) return false;
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            descriptor?.set?.call(this, ${JSON.stringify(text)});
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        `);
        if (!valid) throw new Error(`Invalid value for <input type="${details.type}">.`);
        if (options.submit) await pressKey(action.cdp, "Enter", { sessionId: action.sessionId });
        return;
    }
    const kind = details.contentEditable ? "contenteditable" : "form";
    await selectEditableContent(action.cdp, locator, nth, action.sessionId, kind);
    if (!text) {
        await pressKey(action.cdp, "Delete", { sessionId: action.sessionId });
    } else if (options.slowly) {
        for (const character of text) {
            if (!await typeMappedCharacter(action.cdp, character, action.sessionId)) {
                await action.cdp.send("Input.insertText", { text: character }, action.sessionId);
            }
        }
    } else {
        await action.cdp.send("Input.insertText", { text }, action.sessionId);
    }
    if (options.submit) await pressKey(action.cdp, "Enter", { sessionId: action.sessionId });
}

/** Fill a text-editable element using trusted CDP input by default. */
export async function typeTextInto(
    target: IAutomationTarget & ISyntheticInputHost,
    locator: ElementLocator,
    text: string,
    options: TypeActionOptions = {},
): Promise<void> {
    if (options.synthetic) {
        await typeText(target, { selector: "selector" in locator ? locator.selector : undefined,
            ref: "ref" in locator ? locator.ref : undefined, text, tabId: options.tabId,
            slowly: options.slowly, submit: options.submit, synthetic: true });
        return;
    }
    const action = await resolveActionablePoint(target, locator, options);
    const details = await getEditableElementDetails(action, locator, options.nth);
    validateEditableElement(details);
    await clickElement(target, locator, options);
    await fillResolvedElement(action, locator, text, options, details);
}

export async function selectOption(
    target: IAutomationTarget,
    locator: ElementLocator,
    value: string | string[],
    options: MouseActionOptions = {},
): Promise<void> {
    // Programmatic (Playwright semantics): visible + enabled + stable, but no pointer hit-test.
    const action = await resolveActionablePoint(target, locator, { ...options, hitTest: false });
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) throw new Error("At least one select value is required.");
    const selected = await runOnLocator<boolean>(action.cdp, locator, options.nth, `
        if (this.localName !== 'select') throw new Error('Expected a <select> element.');
        const options = [...this.options];
        for (const value of ${JSON.stringify(values)}) {
            if (!options.some(option => option.value === value)) throw new Error('No option with value ' + JSON.stringify(value) + '.');
        }
        if (!this.multiple && ${JSON.stringify(values)}.length > 1) throw new Error('Cannot select multiple values on a single-select element.');
        const requested = new Set(${JSON.stringify(values)});
        for (const option of options) option.selected = requested.has(option.value);
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    `);
    if (!selected) throw new Error("Select failed.");
}

/** Agents often pass the locator first (`pressKey({ ref }, "Enter")`); say how to call it. */
/** Fill named fields in order, stopping at and naming the first failure. */
export async function fillForm(target: IAutomationTarget & ISyntheticInputHost, fields: FillFormField[]): Promise<void> {
    if (!Array.isArray(fields)) throw new Error("fillForm expects an array of fields.");
    for (const field of fields) {
        if (!field || typeof field.name !== "string" || !field.name.trim()) throw new Error("Every fillForm field requires a human-readable name.");
        try {
            const locator = resolveElementLocator(field.locator);
            switch (field.action) {
                case "type":
                    if (typeof field.value !== "string") throw new Error("type action requires a string value.");
                    await typeTextInto(target, locator, field.value, field.options);
                    break;
                case "select":
                    if (typeof field.value !== "string" && (!Array.isArray(field.value) || field.value.some(value => typeof value !== "string"))) {
                        throw new Error("select action requires a string or string array value.");
                    }
                    await selectOption(target, locator, field.value, field.options);
                    break;
                case "check": await checkElement(target, locator, field.options); break;
                case "uncheck": await uncheckElement(target, locator, field.options); break;
                default: throw new Error("action must be type, select, check, or uncheck.");
            }
        } catch (error: unknown) {
            throw new Error(`fillForm field ${JSON.stringify(field.name)}: ${errMessage(error, "Operation failed.")}`);
        }
    }
}

/** Assign validated local paths directly to one file input, including hidden inputs. */
export async function setInputFiles(
    target: IAutomationTarget, locator: ElementLocator, paths: string[], options: { tabId?: string } = {},
): Promise<void> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => typeof path !== "string" || !path.trim())) {
        throw new Error("setInputFiles expects one or more local file paths.");
    }
    const cdp = target.cdp(options.tabId);
    const sessionId = "ref" in locator ? getRefSessionId(cdp, locator.ref) : undefined;
    // DOM.getDocument first: it enables the DOM agent, which every DOM.* call below needs.
    // CSS-only DOM.querySelectorAll, not DOM.performSearch — the latter is also a plain-text
    // search, so "#f" could match text in a script and break the strictness count.
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 }, sessionId);
    let backendNodeId: number;
    if ("ref" in locator) {
        backendNodeId = parseRef(locator.ref).backendNodeId;
    } else {
        const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: locator.selector }, sessionId);
        const count = (nodeIds as number[] | undefined)?.length ?? 0;
        if (count !== 1) {
            throw new Error(count === 0
                ? `Element not found: ${locator.selector}`
                : `Ambiguous selector "${locator.selector}": ${count} matches. Use a ref or narrow the selector.`);
        }
        const described = await cdp.send("DOM.describeNode", { nodeId: nodeIds[0] }, sessionId);
        backendNodeId = described.node.backendNodeId;
    }
    const node = await cdp.send("DOM.describeNode", { backendNodeId }, sessionId);
    const attributes = node.node?.attributes as string[] | undefined;
    const typeIndex = attributes?.findIndex((value, index) => index % 2 === 0 && value === "type") ?? -1;
    const inputType = typeIndex >= 0 ? attributes?.[typeIndex + 1]?.toLowerCase() : "text";
    if (node.node?.nodeName?.toLowerCase() !== "input" || inputType !== "file") {
        throw new Error("setInputFiles requires an <input type=\"file\"> element.");
    }
    const files: string[] = [];
    for (const suppliedPath of paths) {
        if (!isPlainLocalPath(suppliedPath)) {
            throw new Error(`Upload path must be an ordinary local file: ${suppliedPath}`);
        }
        const filePath = fpResolve(suppliedPath);
        if (isArchivePath(filePath) || isAsarPath(filePath)) {
            throw new Error(`Upload path must be an ordinary local file: ${suppliedPath}`);
        }
        const stat = await app.fs.stat(filePath);
        if (!stat.exists) throw new Error(`Upload file does not exist: ${filePath}`);
        if (stat.isDirectory) throw new Error(`Upload path is a directory: ${filePath}`);
        files.push(filePath);
    }
    await cdp.send("DOM.setFileInputFiles", { files, backendNodeId }, sessionId);
}

export async function clearElement(target: IAutomationTarget & ISyntheticInputHost, locator: ElementLocator, options: MouseActionOptions = {}): Promise<void> {
    await typeTextInto(target, locator, "", options);
}

/** Evaluate an expression in the selected target tab. */
