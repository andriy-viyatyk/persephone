import type { BoardStatusBarItem, BoardStatusBarPatch, BoardStatusBarTone, BoardToolbarIcon } from "../../../ipc/board-bridge-channels";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { IconRef } from "../../uikit/shared/slots";
import type { BoardEditorModel } from "./BoardEditorModel";
import { resolveBoardToolbarIcon } from "./board-toolbar-icon";
import { errMessage } from "../../../shared/utils";
import "./BoardStatusBarItems.css";

export const BOARD_STATUS_BAR_ITEM_LIMIT = 8;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TONES = new Set<BoardStatusBarTone>(["normal", "muted", "error", "accent"]);
type Warning = (message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeItem(value: unknown, warning: Warning): BoardStatusBarItem | undefined {
    if (!isRecord(value) || typeof value.id !== "string" || !SAFE_ID.test(value.id)
        || (value.type !== "text" && value.type !== "button") || typeof value.text !== "string") {
        warning("Ignored an invalid board status-bar item descriptor.");
        return undefined;
    }
    const id = value.id;
    const allowed = value.type === "text"
        ? ["id", "type", "text", "tone", "title", "align", "hidden"]
        : ["id", "type", "text", "tone", "title", "align", "hidden", "disabled", "icon"];
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
        warning(`Ignored unknown fields on board status-bar item "${id}".`);
        return undefined;
    }
    if (value.tone !== undefined && (typeof value.tone !== "string" || !TONES.has(value.tone as BoardStatusBarTone))
        || value.title !== undefined && typeof value.title !== "string"
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
        return { ...common, type: "text" };
    }
    let icon: BoardToolbarIcon | undefined;
    if (value.icon !== undefined) {
        const raw = value.icon;
        if (!isRecord(raw)) { warning(`Ignored invalid icon on board status-bar item "${id}".`); return undefined; }
        const keys = Object.keys(raw).filter((key) => key !== "preserveColors");
        if (keys.length !== 1 || !["name", "svg", "file"].includes(keys[0])
            || typeof raw[keys[0]] !== "string" || !raw[keys[0]]
            || raw.preserveColors !== undefined && typeof raw.preserveColors !== "boolean") {
            warning(`Ignored invalid icon on board status-bar item "${id}".`); return undefined;
        }
        const key = keys[0] as "name" | "svg" | "file";
        const preserveColors = raw.preserveColors as boolean | undefined;
        if (key === "name") icon = { name: raw.name as string };
        else if (key === "svg") icon = { svg: raw.svg as string, ...(preserveColors !== undefined ? { preserveColors } : {}) };
        else icon = { file: raw.file as string, ...(preserveColors !== undefined ? { preserveColors } : {}) };
    }
    return { ...common, type: "button", ...(value.disabled === true ? { disabled: true } : {}), ...(icon ? { icon } : {}) };
}

export function normalizeBoardStatusBarSet(value: unknown, warning: Warning): BoardStatusBarItem[] {
    if (!Array.isArray(value)) { warning("Ignored invalid board status-bar item set."); return []; }
    if (value.length > BOARD_STATUS_BAR_ITEM_LIMIT) warning(`Board status-bar item set exceeds the ${BOARD_STATUS_BAR_ITEM_LIMIT}-item limit.`);
    const result: BoardStatusBarItem[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        const item = normalizeItem(entry, warning);
        if (!item) continue;
        if (seen.has(item.id)) { warning(`Ignored duplicate board status-bar item "${item.id}".`); continue; }
        seen.add(item.id);
        if (result.length < BOARD_STATUS_BAR_ITEM_LIMIT) result.push(item);
    }
    return result;
}

export function normalizeBoardStatusBarPatches(value: unknown, warning: Warning): BoardStatusBarPatch[] {
    if (!Array.isArray(value)) { warning("Ignored invalid board status-bar update."); return []; }
    const result: BoardStatusBarPatch[] = [];
    for (const entry of value) {
        if (!isRecord(entry) || typeof entry.id !== "string" || !SAFE_ID.test(entry.id)) {
            warning("Ignored invalid board status-bar patch."); continue;
        }
        const fields = ["type", "text", "tone", "title", "disabled", "icon", "align", "hidden"];
        if (Object.keys(entry).some((key) => key !== "id" && !fields.includes(key))) {
            warning(`Ignored unknown fields in board status-bar patch for "${entry.id}".`); continue;
        }
        if (entry.type !== undefined && entry.type !== "text" && entry.type !== "button"
            || entry.text !== undefined && typeof entry.text !== "string"
            || entry.tone !== undefined && (typeof entry.tone !== "string" || !TONES.has(entry.tone as BoardStatusBarTone))
            || entry.title !== undefined && typeof entry.title !== "string"
            || entry.disabled !== undefined && typeof entry.disabled !== "boolean"
            || entry.align !== undefined && entry.align !== "end"
            || entry.hidden !== undefined && typeof entry.hidden !== "boolean") {
            warning(`Ignored malformed board status-bar patch for "${entry.id}".`); continue;
        }
        const candidate: Record<string, unknown> = { id: entry.id };
        for (const key of fields) if (entry[key] !== undefined) candidate[key] = entry[key];
        const inferredType = candidate.type ?? (candidate.icon !== undefined || candidate.disabled !== undefined ? "button" : "text");
        const probe = normalizeItem({ ...candidate, type: inferredType, text: candidate.text ?? "" }, warning);
        if (!probe) continue;
        result.push(candidate as BoardStatusBarPatch);
    }
    return result;
}

function merge(item: BoardStatusBarItem, patch: BoardStatusBarPatch, warning: Warning): BoardStatusBarItem | undefined {
    if (patch.type !== undefined && patch.type !== item.type) { warning(`Ignored type change for board status-bar item "${item.id}".`); return undefined; }
    const next = { ...item, ...patch } as unknown;
    return normalizeItem(next, warning);
}

interface RecordView { readonly root: HTMLElement; readonly button?: ButtonView; readonly icon?: IconRef; dispose(): void }

export class BoardStatusBarItems extends VanillaView<{ model: BoardEditorModel; onAction: (event: { id: string }, generation: number) => void; onChange: () => void }> {
    private readonly records = new Map<string, { item: BoardStatusBarItem; view: RecordView }>();
    private frameGeneration: number | undefined;
    readonly endRoot: HTMLElement;

    constructor(props: { model: BoardEditorModel; onAction: (event: { id: string }, generation: number) => void; onChange: () => void }) {
        super(props, document.createElement("span"));
        this.root.dataset.part = "board-status-start";
        this.endRoot = document.createElement("span");
        this.endRoot.dataset.part = "board-status-end";
    }

    set(items: readonly BoardStatusBarItem[], generation: number, warning: Warning): void {
        this.frameGeneration = generation;
        for (const { view } of this.records.values()) view.dispose();
        this.records.clear();
        this.root.replaceChildren();
        for (const item of items) {
            const record = this.createRecord(item, warning);
            this.records.set(item.id, { item, view: record });
        }
        this.renderOrder();
        this.publish();
        this.props.onChange();
    }

    updateCatalog(patches: readonly BoardStatusBarPatch[], generation: number, warning: Warning): void {
        if (this.frameGeneration !== generation) return;
        for (const patch of patches) {
            const current = this.records.get(patch.id);
            if (!current) { warning(`Ignored board status-bar update for unknown item "${patch.id}".`); continue; }
            const item = merge(current.item, patch, warning);
            if (!item) continue;
            current.view.dispose();
            const view = this.createRecord(item, warning);
            this.records.set(item.id, { item, view });
        }
        this.renderOrder();
        this.publish();
        this.props.onChange();
    }

    clear(generation: number): void {
        if (this.frameGeneration !== generation) return;
        for (const { view } of this.records.values()) view.dispose();
        this.records.clear(); this.root.replaceChildren(); this.endRoot.replaceChildren(); this.frameGeneration = undefined;
        this.props.model.clearStatusBarItemsForFrame(generation);
        this.props.onChange();
    }

    protected onDispose(): void { if (this.frameGeneration !== undefined) this.clear(this.frameGeneration); }

    private createRecord(item: BoardStatusBarItem, warning: Warning): RecordView {
        const tone = item.tone ?? "normal";
        let root: HTMLElement;
        let button: ButtonView | undefined;
        let icon: IconRef | undefined;
        if (item.type === "text") {
            root = createTextElement(item.text, { size: "sm" });
            root.dataset.name = `board-status-bar-item-${item.id}`;
            root.dataset.type = "text";
            root.title = item.title ?? "";
        } else {
            button = new ButtonView({ name: `board-status-bar-item-${item.id}`, size: "sm", variant: "ghost",
                title: item.title ?? item.text, disabled: item.disabled, children: item.text,
                onClick: () => { if (!item.hidden && !item.disabled && this.frameGeneration !== undefined) this.props.onAction({ id: item.id }, this.frameGeneration); } });
            root = button.root;
            button.mount();
            if (item.icon) void resolveBoardToolbarIcon(item.icon, this.props.model.boardRoot ?? "").then((resolved) => {
                if (!root.isConnected || !resolved) return;
                icon = resolved; button?.update({ name: `board-status-bar-item-${item.id}`, size: "sm", variant: "ghost",
                    title: item.title ?? item.text, disabled: item.disabled, icon: resolved, children: item.text,
                    onClick: () => { if (!item.hidden && !item.disabled && this.frameGeneration !== undefined) this.props.onAction({ id: item.id }, this.frameGeneration); } });
            }).catch((error: unknown) => warning(`Ignored board status-bar icon for "${item.id}": ${errMessage(error, "invalid icon")}.`));
        }
        root.dataset.tone = tone;
        root.dataset.align = item.align ?? "start";
        root.title = item.title ?? (item.type === "text" ? "" : item.text);
        return { root, button, get icon() { return icon; }, dispose: () => button?.dispose() };
    }

    private renderOrder(): void {
        this.root.replaceChildren();
        this.endRoot.replaceChildren();
        for (const { item, view } of this.records.values()) {
            if (item.hidden) continue;
            (item.align === "end" ? this.endRoot : this.root).append(view.root);
        }
    }

    private publish(): void {
        if (this.frameGeneration === undefined) return;
        this.props.model.setLiveStatusBarElementDeclarations(this.frameGeneration, [...this.records.values()]
            .filter(({ item }) => !item.hidden).map(({ item }) => ({
                name: `board-status-bar-item-${item.id}`, purpose: `Board status-bar item ${item.id}`,
                where: "Board footer status bar", selector: `[data-name="board-status-bar-item-${item.id}"]`,
            })));
    }

    get hasStartItems(): boolean { return [...this.records.values()].some(({ item }) => !item.hidden && item.align !== "end"); }
    get hasEndItems(): boolean { return [...this.records.values()].some(({ item }) => !item.hidden && item.align === "end"); }
}
