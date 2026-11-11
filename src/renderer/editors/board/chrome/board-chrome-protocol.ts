import type {
    BoardStatusBarItem,
    BoardStatusBarPatch,
    BoardStatusBarTextVariant,
    BoardStatusBarTone,
    BoardToolbarControlDescriptor,
    BoardToolbarControlPatch,
    BoardToolbarControlType,
    BoardToolbarIcon,
    BoardToolbarSegment,
} from "../../../../ipc/board-bridge/ui-catalog";

export type BoardChromeWarning = (message: string) => void;
export type ToolbarAction = {
    readonly id: string;
    readonly type: BoardToolbarControlType;
    readonly value?: boolean | string;
};
export const BOARD_TOOLBAR_CONTROL_LIMIT = 8;
export const BOARD_STATUS_BAR_ITEM_LIMIT = 8;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CONTROL_TYPES = new Set<BoardToolbarControlType>([
    "button", "toggle", "menu", "select", "segmented", "input", "breadcrumb",
]);

function safeId(value: unknown): value is string {
    return typeof value === "string" && SAFE_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
    return value === undefined ? undefined : typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
    return value === undefined ? undefined : typeof value === "boolean" ? value : undefined;
}

export function normalizeBoardIcon(value: unknown): BoardToolbarIcon | undefined {
    if (!isRecord(value)) return undefined;
    const keys = Object.keys(value);
    const sourceKeys = keys.filter((key) => key !== "preserveColors");
    if (sourceKeys.length !== 1 || !["name", "svg", "file"].includes(sourceKeys[0])) return undefined;
    if (value.preserveColors !== undefined && typeof value.preserveColors !== "boolean") return undefined;
    const preserveColors = value.preserveColors as boolean | undefined;
    const source = sourceKeys[0];
    if (typeof value[source] !== "string" || !value[source]) return undefined;
    if (source === "name") return { name: value[source] as string };
    return source === "svg"
        ? { svg: value[source] as string, ...(preserveColors !== undefined ? { preserveColors } : {}) }
        : { file: value[source] as string, ...(preserveColors !== undefined ? { preserveColors } : {}) };
}

function normalizeMenuItems(
    value: unknown,
    warning: BoardChromeWarning,
): Array<{ id: string; label: string; disabled?: boolean }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const items: Array<{ id: string; label: string; disabled?: boolean }> = [];
    for (const item of value) {
        if (!isRecord(item) || !safeId(item.id) || typeof item.label !== "string" || seen.has(item.id)) {
            warning("Ignored an invalid or duplicate board toolbar menu item.");
            continue;
        }
        seen.add(item.id);
        items.push({
            id: item.id,
            label: item.label,
            ...(typeof item.disabled === "boolean" ? { disabled: item.disabled } : {}),
        });
    }
    return items;
}

/**
 * Options of a `select` or `segmented` control. A patch does not name its type, so this accepts
 * the wider segmented shape; `normalizeToolbarControl` then applies the per-type rules (a select
 * option needs a label and drops icons; a segment needs a label or an icon).
 */
function normalizeOptions(value: unknown, warning: BoardChromeWarning): BoardToolbarSegment[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const options: BoardToolbarSegment[] = [];
    for (const option of value) {
        const icon = isRecord(option) && option.icon !== undefined ? normalizeBoardIcon(option.icon) : undefined;
        if (!isRecord(option) || typeof option.value !== "string" || seen.has(option.value)
            || option.label !== undefined && typeof option.label !== "string"
            || option.title !== undefined && typeof option.title !== "string"
            || option.disabled !== undefined && typeof option.disabled !== "boolean"
            || option.icon !== undefined && !icon) {
            warning("Ignored an invalid or duplicate board toolbar option.");
            continue;
        }
        seen.add(option.value);
        options.push({
            value: option.value,
            ...(option.label !== undefined ? { label: option.label as string } : {}),
            ...(option.title !== undefined ? { title: option.title as string } : {}),
            ...(icon ? { icon } : {}),
            ...(option.disabled !== undefined ? { disabled: option.disabled as boolean } : {}),
        });
    }
    return options;
}

export function normalizeToolbarControl(
    value: unknown,
    warning: BoardChromeWarning,
): BoardToolbarControlDescriptor | undefined {
    if (!isRecord(value) || !safeId(value.id) || typeof value.type !== "string"
        || !CONTROL_TYPES.has(value.type as BoardToolbarControlType)) {
        warning("Ignored an invalid board toolbar control descriptor.");
        return undefined;
    }
    const id = value.id;
    const type = value.type as BoardToolbarControlType;
    const common = {
        id,
        label: optionalString(value.label),
        title: optionalString(value.title),
        disabled: optionalBoolean(value.disabled),
    };
    if (value.label !== undefined && common.label === undefined
        || value.title !== undefined && common.title === undefined
        || value.disabled !== undefined && common.disabled === undefined) {
        warning(`Ignored invalid fields on board toolbar control "${id}".`);
        return undefined;
    }
    const icon = value.icon === undefined ? undefined : normalizeBoardIcon(value.icon);
    if (value.icon !== undefined && !icon) {
        warning(`Ignored invalid icon on board toolbar control "${id}".`);
        return undefined;
    }
    if (type === "button") {
        if (value.placement !== undefined && value.placement !== "toolbar" && value.placement !== "start") {
            warning(`Ignored board toolbar button "${id}" with an unknown placement; use "toolbar" or "start".`);
            return undefined;
        }
        const placement = value.placement === "start" ? { placement: "start" as const } : {};
        return { ...common, type, ...(icon ? { icon } : {}), ...placement };
    }
    if (type === "toggle") {
        if (typeof value.value !== "boolean") {
            warning(`Ignored board toolbar toggle "${id}" without a boolean value.`);
            return undefined;
        }
        return { ...common, type, value: value.value, ...(icon ? { icon } : {}) };
    }
    if (type === "menu") {
        const items = normalizeMenuItems(value.items, warning);
        if (!items) {
            warning(`Ignored board toolbar menu "${id}" without an items array.`);
            return undefined;
        }
        if (value.placement !== undefined && value.placement !== "toolbar"
            && value.placement !== "board-menu" && value.placement !== "start") {
            warning(
                `Ignored board toolbar menu "${id}" with an unknown placement; `
                    + `use "toolbar", "board-menu", or "start".`,
            );
            return undefined;
        }
        const placement = value.placement === "board-menu" || value.placement === "start"
            ? { placement: value.placement as "board-menu" | "start" } : {};
        return { ...common, type, items, ...(icon ? { icon } : {}), ...placement };
    }
    if (type === "select") {
        const options = normalizeOptions(value.options, warning);
        if (!options || typeof value.value !== "string") {
            warning(`Ignored board toolbar select "${id}" without options and a string value.`);
            return undefined;
        }
        const labelled = options.flatMap((option) => option.label === undefined
            ? [] : [{ value: option.value, label: option.label }]);
        if (labelled.length !== options.length) {
            warning(`Ignored board toolbar select options without a label on "${id}".`);
        }
        return { ...common, type, options: labelled, value: value.value };
    }
    if (type === "segmented") {
        const options = normalizeOptions(value.options, warning);
        if (!options || typeof value.value !== "string") {
            warning(`Ignored board toolbar segmented control "${id}" without options and a string value.`);
            return undefined;
        }
        const shown = options.filter((option) => option.label !== undefined || option.icon !== undefined);
        if (shown.length !== options.length) warning(`Ignored segmented options without a label or icon on "${id}".`);
        return { ...common, type, options: shown, value: value.value };
    }
    if (type === "breadcrumb") {
        if (typeof value.rootLabel !== "string" || typeof value.value !== "string"
            || value.separators !== undefined && (typeof value.separators !== "string" || !value.separators)) {
            warning(`Ignored invalid board toolbar breadcrumb "${id}".`);
            return undefined;
        }
        return { id, type, rootLabel: value.rootLabel, value: value.value,
            separators: value.separators as string | undefined, title: common.title, disabled: common.disabled };
    }
    if (typeof value.value !== "string") {
        warning(`Ignored board toolbar input "${id}" without a string value.`);
        return undefined;
    }
    if (value.placeholder !== undefined && typeof value.placeholder !== "string") {
        warning(`Ignored invalid placeholder on board toolbar input "${id}".`);
        return undefined;
    }
    return { ...common, type, value: value.value, placeholder: optionalString(value.placeholder) };
}

export function normalizeToolbarControlSet(
    value: unknown,
    warning: BoardChromeWarning,
): BoardToolbarControlDescriptor[] {
    if (!Array.isArray(value)) {
        warning("Ignored a non-array board toolbar control catalog.");
        return [];
    }
    const controls: BoardToolbarControlDescriptor[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        const control = normalizeToolbarControl(entry, warning);
        if (!control) continue;
        if (seen.has(control.id)) {
            warning(`Ignored duplicate board toolbar control "${control.id}".`);
            continue;
        }
        if (controls.length >= BOARD_TOOLBAR_CONTROL_LIMIT) {
            warning(
                `Ignored board toolbar control "${control.id}" because only ${BOARD_TOOLBAR_CONTROL_LIMIT} controls `
                    + "can be rendered.",
            );
            continue;
        }
        seen.add(control.id);
        controls.push(control);
    }
    return controls;
}

export function normalizeToolbarControlPatches(
    value: unknown,
    warning: BoardChromeWarning,
): BoardToolbarControlPatch[] {
    if (!Array.isArray(value)) {
        warning("Ignored a non-array board toolbar update.");
        return [];
    }
    const patches: BoardToolbarControlPatch[] = [];
    for (const entry of value) {
        if (!isRecord(entry) || !safeId(entry.id)) {
            warning("Ignored an invalid board toolbar update entry.");
            continue;
        }
        if (entry.type !== undefined && (typeof entry.type !== "string"
            || !CONTROL_TYPES.has(entry.type as BoardToolbarControlType))) {
            warning(`Ignored invalid type in board toolbar update for "${entry.id}".`);
            continue;
        }
        if (entry.placement !== undefined) {
            warning(`Ignored placement in board toolbar update for "${entry.id}".`);
        }
        const patch: BoardToolbarControlPatch = { id: entry.id };
        for (const key of ["label", "title", "placeholder", "rootLabel", "separators"] as const) {
            if (entry[key] !== undefined) {
                if (typeof entry[key] !== "string" || key === "separators" && !entry[key]) {
                    warning(`Ignored invalid ${key} in board toolbar update for "${entry.id}".`);
                    continue;
                }
                patch[key] = entry[key];
            }
        }
        if (entry.type !== undefined) patch.type = entry.type as BoardToolbarControlType;
        if (entry.disabled !== undefined && typeof entry.disabled === "boolean") patch.disabled = entry.disabled;
        if (entry.value !== undefined && (typeof entry.value === "boolean" || typeof entry.value === "string")) {
            patch.value = entry.value;
        }
        if (entry.icon !== undefined) {
            const icon = normalizeBoardIcon(entry.icon);
            if (icon) patch.icon = icon;
            else warning(`Ignored invalid icon in board toolbar update for "${entry.id}".`);
        }
        if (entry.items !== undefined) patch.items = normalizeMenuItems(entry.items, warning) ?? [];
        if (entry.options !== undefined) patch.options = normalizeOptions(entry.options, warning) ?? [];
        patches.push(patch);
    }
    return patches;
}

function hasField(patch: BoardToolbarControlPatch, field: string): boolean {
    return Object.prototype.hasOwnProperty.call(patch, field);
}

export function mergePatch(
    descriptor: BoardToolbarControlDescriptor,
    patch: BoardToolbarControlPatch,
    warning: BoardChromeWarning,
): BoardToolbarControlDescriptor | undefined {
    if (patch.type !== undefined && patch.type !== descriptor.type) {
        warning(`Ignored type change for board toolbar control "${descriptor.id}".`);
        return undefined;
    }
    const breadcrumbFields = descriptor.type === "breadcrumb" ? [] : ["rootLabel", "separators"];
    const forbidden = [...breadcrumbFields, ...(descriptor.type === "breadcrumb"
        ? ["label", "icon", "items", "options", "placeholder"]
        : descriptor.type === "button"
        ? ["value", "items", "options", "placeholder"]
        : descriptor.type === "toggle"
            ? ["items", "options", "placeholder"]
            : descriptor.type === "menu"
                ? ["value", "options", "placeholder"]
                : descriptor.type === "select" || descriptor.type === "segmented"
                    ? ["items", "placeholder", "icon"]
                    : ["items", "options", "icon"])];
    if (forbidden.some((field) => hasField(patch, field))) {
        warning(`Ignored type-incompatible fields in board toolbar update for "${descriptor.id}".`);
    }
    const next = { ...descriptor } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
        if (key === "id" || key === "type" || forbidden.includes(key)) continue;
        if (value !== undefined) next[key] = value;
    }
    if (descriptor.type === "menu" && hasField(patch, "items")) next.items = patch.items;
    if ((descriptor.type === "select" || descriptor.type === "segmented") && hasField(patch, "options")) {
        next.options = patch.options;
    }
    if (descriptor.type === "input" && hasField(patch, "value")) next.value = patch.value;
    if (descriptor.type === "toggle" && hasField(patch, "value")) next.value = patch.value;
    return normalizeToolbarControl(next, warning);
}

const TONES = new Set<BoardStatusBarTone>(["normal", "muted", "error", "accent"]);
const TEXT_VARIANTS = new Set<BoardStatusBarTextVariant>(["plain", "chip"]);

function normalizeItem(value: unknown, warning: BoardChromeWarning): BoardStatusBarItem | undefined {
    if (!isRecord(value) || typeof value.id !== "string" || !safeId(value.id)
        || (value.type !== "text" && value.type !== "button") || typeof value.text !== "string") {
        warning("Ignored an invalid board status-bar item descriptor.");
        return undefined;
    }
    const id = value.id;
    const allowed = value.type === "text"
        ? ["id", "type", "text", "tone", "title", "variant", "align", "hidden"]
        : ["id", "type", "text", "tone", "title", "align", "hidden", "disabled", "icon"];
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
        warning(`Ignored unknown fields on board status-bar item "${id}".`);
        return undefined;
    }
    if (value.tone !== undefined && (typeof value.tone !== "string" || !TONES.has(value.tone as BoardStatusBarTone))
        || value.title !== undefined && typeof value.title !== "string"
        || value.variant !== undefined && !TEXT_VARIANTS.has(value.variant as BoardStatusBarTextVariant)
        || value.align !== undefined && value.align !== "end"
        || value.hidden !== undefined && typeof value.hidden !== "boolean"
        || value.type === "button" && value.disabled !== undefined && typeof value.disabled !== "boolean") {
        warning(`Ignored invalid fields on board status-bar item "${id}".`);
        return undefined;
    }
    const common = { id, text: value.text, ...(value.tone ? { tone: value.tone as BoardStatusBarTone } : {}),
        ...(value.title !== undefined ? { title: value.title as string } : {}),
        ...(value.align === "end" ? { align: "end" as const } : {}),
        ...(value.hidden !== undefined ? { hidden: value.hidden as boolean } : {}) };
    if (value.type === "text") {
        if (value.icon !== undefined || value.disabled !== undefined) {
            warning(`Ignored button-only fields on board status-bar text item "${id}".`);
            return undefined;
        }
        return {
            ...common,
            type: "text",
            ...(value.variant ? { variant: value.variant as BoardStatusBarTextVariant } : {}),
        };
    }
    const icon = value.icon === undefined ? undefined : normalizeBoardIcon(value.icon);
    if (value.icon !== undefined && !icon) {
        warning(`Ignored invalid icon on board status-bar item "${id}".`);
        return undefined;
    }
    return {
        ...common,
        type: "button",
        ...(value.disabled === true ? { disabled: true } : {}),
        ...(icon ? { icon } : {}),
    };
}

export function normalizeBoardStatusBarSet(value: unknown, warning: BoardChromeWarning): BoardStatusBarItem[] {
    if (!Array.isArray(value)) {
        warning("Ignored invalid board status-bar item set.");
        return [];
    }
    if (value.length > BOARD_STATUS_BAR_ITEM_LIMIT) {
        warning(`Board status-bar item set exceeds the ${BOARD_STATUS_BAR_ITEM_LIMIT}-item limit.`);
    }
    const result: BoardStatusBarItem[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        const item = normalizeItem(entry, warning);
        if (!item) continue;
        if (seen.has(item.id)) {
            warning(`Ignored duplicate board status-bar item "${item.id}".`);
            continue;
        }
        seen.add(item.id);
        if (result.length < BOARD_STATUS_BAR_ITEM_LIMIT) result.push(item);
    }
    return result;
}

export function normalizeBoardStatusBarPatches(value: unknown, warning: BoardChromeWarning): BoardStatusBarPatch[] {
    if (!Array.isArray(value)) {
        warning("Ignored invalid board status-bar update.");
        return [];
    }
    const result: BoardStatusBarPatch[] = [];
    for (const entry of value) {
        if (!isRecord(entry) || typeof entry.id !== "string" || !safeId(entry.id)) {
            warning("Ignored invalid board status-bar patch.");
            continue;
        }
        const fields = ["type", "text", "tone", "title", "disabled", "icon", "variant", "align", "hidden"];
        if (Object.keys(entry).some((key) => key !== "id" && !fields.includes(key))) {
            warning(`Ignored unknown fields in board status-bar patch for "${entry.id}".`);
            continue;
        }
        if (entry.type !== undefined && entry.type !== "text" && entry.type !== "button"
            || entry.text !== undefined && typeof entry.text !== "string"
            || entry.tone !== undefined && (typeof entry.tone !== "string"
                || !TONES.has(entry.tone as BoardStatusBarTone))
            || entry.title !== undefined && typeof entry.title !== "string"
            || entry.variant !== undefined && !TEXT_VARIANTS.has(entry.variant as BoardStatusBarTextVariant)
            || entry.disabled !== undefined && typeof entry.disabled !== "boolean"
            || entry.align !== undefined && entry.align !== "end"
            || entry.hidden !== undefined && typeof entry.hidden !== "boolean") {
            warning(`Ignored malformed board status-bar patch for "${entry.id}".`);
            continue;
        }
        const candidate: Record<string, unknown> = { id: entry.id };
        for (const key of fields) if (entry[key] !== undefined) candidate[key] = entry[key];
        const inferredType = candidate.type ?? (candidate.icon !== undefined || candidate.disabled !== undefined
            ? "button" : "text");
        const probe = normalizeItem({ ...candidate, type: inferredType, text: candidate.text ?? "" }, warning);
        if (!probe) continue;
        result.push(candidate as BoardStatusBarPatch);
    }
    return result;
}

export function mergeStatusBarPatch(
    item: BoardStatusBarItem,
    patch: BoardStatusBarPatch,
    warning: BoardChromeWarning,
): BoardStatusBarItem | undefined {
    if (patch.type !== undefined && patch.type !== item.type) {
        warning(`Ignored type change for board status-bar item "${item.id}".`);
        return undefined;
    }
    const next = { ...item, ...patch } as unknown;
    return normalizeItem(next, warning);
}

