import type {
    BoardToolbarControlDescriptor,
    BoardToolbarControlPatch,
    BoardToolbarIcon,
    BoardToolbarControlType,
    BoardToolbarSegment,
} from "../../../ipc/board-bridge-channels";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { InputView } from "../../uikit/Input/InputView";
import { SelectView, type SelectViewProps } from "../../uikit/Select/SelectView";
import { SwitchView, type SwitchProps } from "../../uikit/Switch/SwitchView";
import {
    SegmentedControlView,
    type ISegment,
    type SegmentedControlViewProps,
} from "../../uikit/SegmentedControl/SegmentedControlView";
import "../../uikit/SegmentedControl/SegmentedControl.css";
import { openMenu, type MenuHandle } from "../../uikit/Menu/attach-menu";
import type { MenuItem } from "../../uikit/Menu/types";
import type { IListBoxItem } from "../../uikit/ListBox/types";
import { fillSlot } from "../../uikit/shared/fill-slot";
import type { IconRef } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { BoardEditorModel } from "./BoardEditorModel";
import {
    createToolbarIconFallback,
    invalidateBoardToolbarIcons,
    resolveBoardToolbarIcon,
} from "./board-toolbar-icon";
import { errMessage } from "../../../shared/utils";

export const BOARD_TOOLBAR_CONTROL_LIMIT = 8;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CONTROL_TYPES = new Set<BoardToolbarControlType>(["button", "toggle", "menu", "select", "segmented", "input"]);

export type ToolbarAction = {
    readonly id: string;
    readonly type: BoardToolbarControlType;
    readonly value?: boolean | string;
};

type ToolbarWarning = (message: string) => void;
type BoardToolbarToggleDescriptor = Extract<BoardToolbarControlDescriptor, { type: "toggle" }>;
type BoardToolbarSelectDescriptor = Extract<BoardToolbarControlDescriptor, { type: "select" }>;
type BoardToolbarSegmentedDescriptor = Extract<BoardToolbarControlDescriptor, { type: "segmented" }>;
type ToolbarRecordView = IconButtonView | SwitchView | SelectView<IListBoxItem> | SegmentedControlView | InputView;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
    return value === undefined ? undefined : typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
    return value === undefined ? undefined : typeof value === "boolean" ? value : undefined;
}

function safeId(value: unknown): value is string {
    return typeof value === "string" && SAFE_ID.test(value);
}

function normalizeIcon(value: unknown): BoardToolbarIcon | undefined {
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

function normalizeMenuItems(value: unknown, warning: ToolbarWarning): Array<{ id: string; label: string; disabled?: boolean }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const items: Array<{ id: string; label: string; disabled?: boolean }> = [];
    for (const item of value) {
        if (!isRecord(item) || !safeId(item.id) || typeof item.label !== "string" || seen.has(item.id)) {
            warning("Ignored an invalid or duplicate board toolbar menu item.");
            continue;
        }
        seen.add(item.id);
        items.push({ id: item.id, label: item.label, ...(typeof item.disabled === "boolean" ? { disabled: item.disabled } : {}) });
    }
    return items;
}

/**
 * Options of a `select` or `segmented` control. A patch does not name its type, so this accepts
 * the wider segmented shape; `normalizeToolbarControl` then applies the per-type rules (a select
 * option needs a label and drops icons; a segment needs a label or an icon).
 */
function normalizeOptions(value: unknown, warning: ToolbarWarning): BoardToolbarSegment[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const options: BoardToolbarSegment[] = [];
    for (const option of value) {
        const icon = isRecord(option) && option.icon !== undefined ? normalizeIcon(option.icon) : undefined;
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

export function normalizeToolbarControl(value: unknown, warning: ToolbarWarning): BoardToolbarControlDescriptor | undefined {
    if (!isRecord(value) || !safeId(value.id) || typeof value.type !== "string" || !CONTROL_TYPES.has(value.type as BoardToolbarControlType)) {
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
    const icon = value.icon === undefined ? undefined : normalizeIcon(value.icon);
    if (value.icon !== undefined && !icon) {
        warning(`Ignored invalid icon on board toolbar control "${id}".`);
        return undefined;
    }
    if (type === "button") return { ...common, type, ...(icon ? { icon } : {}) };
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
        return { ...common, type, items, ...(icon ? { icon } : {}) };
    }
    if (type === "select") {
        const options = normalizeOptions(value.options, warning);
        if (!options || typeof value.value !== "string") {
            warning(`Ignored board toolbar select "${id}" without options and a string value.`);
            return undefined;
        }
        const labelled = options.flatMap((option) => option.label === undefined ? [] : [{ value: option.value, label: option.label }]);
        if (labelled.length !== options.length) warning(`Ignored board toolbar select options without a label on "${id}".`);
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

export function normalizeToolbarControlSet(value: unknown, warning: ToolbarWarning): BoardToolbarControlDescriptor[] {
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
            warning(`Ignored board toolbar control "${control.id}" because only ${BOARD_TOOLBAR_CONTROL_LIMIT} controls can be rendered.`);
            continue;
        }
        seen.add(control.id);
        controls.push(control);
    }
    return controls;
}

export function normalizeToolbarControlPatches(value: unknown, warning: ToolbarWarning): BoardToolbarControlPatch[] {
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
        if (entry.type !== undefined && (typeof entry.type !== "string" || !CONTROL_TYPES.has(entry.type as BoardToolbarControlType))) {
            warning(`Ignored invalid type in board toolbar update for "${entry.id}".`);
            continue;
        }
        const patch: BoardToolbarControlPatch = { id: entry.id };
        for (const key of ["label", "title", "placeholder"] as const) {
            if (entry[key] !== undefined) {
                if (typeof entry[key] !== "string") {
                    warning(`Ignored invalid ${key} in board toolbar update for "${entry.id}".`);
                    continue;
                }
                patch[key] = entry[key];
            }
        }
        if (entry.type !== undefined) patch.type = entry.type as BoardToolbarControlType;
        if (entry.disabled !== undefined && typeof entry.disabled === "boolean") patch.disabled = entry.disabled;
        if (entry.value !== undefined && (typeof entry.value === "boolean" || typeof entry.value === "string")) patch.value = entry.value;
        if (entry.icon !== undefined) {
            const icon = normalizeIcon(entry.icon);
            if (icon) patch.icon = icon;
            else warning(`Ignored invalid icon in board toolbar update for "${entry.id}".`);
        }
        if (entry.items !== undefined) patch.items = normalizeMenuItems(entry.items, warning) ?? [];
        if (entry.options !== undefined) patch.options = normalizeOptions(entry.options, warning) ?? [];
        patches.push(patch);
    }
    return patches;
}

function titleOf(descriptor: BoardToolbarControlDescriptor): string {
    return descriptor.title ?? descriptor.label ?? descriptor.id;
}

function labelOf(descriptor: BoardToolbarControlDescriptor): string {
    return descriptor.label ?? descriptor.title ?? descriptor.id;
}

function menuItems(
    descriptor: Extract<BoardToolbarControlDescriptor, { type: "menu" }>,
    onClick: (id: string) => void,
): MenuItem[] {
    return descriptor.items.map((item) => ({
        label: item.label,
        disabled: item.disabled,
        onClick: () => onClick(item.id),
    }));
}

function hasField(patch: BoardToolbarControlPatch, field: string): boolean {
    return Object.prototype.hasOwnProperty.call(patch, field);
}

function mergePatch(
    descriptor: BoardToolbarControlDescriptor,
    patch: BoardToolbarControlPatch,
    warning: ToolbarWarning,
): BoardToolbarControlDescriptor | undefined {
    if (patch.type !== undefined && patch.type !== descriptor.type) {
        warning(`Ignored type change for board toolbar control "${descriptor.id}".`);
        return undefined;
    }
    const forbidden = descriptor.type === "button"
        ? ["value", "items", "options", "placeholder"]
        : descriptor.type === "toggle"
            ? ["items", "options", "placeholder"]
            : descriptor.type === "menu"
                ? ["value", "options", "placeholder"]
                : descriptor.type === "select" || descriptor.type === "segmented"
                    ? ["items", "placeholder", "icon"]
                    : ["items", "options", "icon"];
    if (forbidden.some((field) => hasField(patch, field))) {
        warning(`Ignored type-incompatible fields in board toolbar update for "${descriptor.id}".`);
    }
    const next = { ...descriptor } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
        if (key === "id" || key === "type" || forbidden.includes(key)) continue;
        if (value !== undefined) next[key] = value;
    }
    if (descriptor.type === "menu" && hasField(patch, "items")) next.items = patch.items;
    if ((descriptor.type === "select" || descriptor.type === "segmented") && hasField(patch, "options")) next.options = patch.options;
    if (descriptor.type === "input" && hasField(patch, "value")) next.value = patch.value;
    if (descriptor.type === "toggle" && hasField(patch, "value")) next.value = patch.value;
    return normalizeToolbarControl(next, warning);
}

interface FocusSnapshot {
    id?: string;
    element?: HTMLElement;
    selection?: { start: number | null; end: number | null; direction: "forward" | "backward" | "none" | null };
    scroll: Array<{ element: HTMLElement; top: number; left: number }>;
}

class ToolbarControlRecord {
    readonly root: HTMLElement;
    readonly view: ToolbarRecordView;
    descriptor: BoardToolbarControlDescriptor;
    private readonly emit: (event: ToolbarAction) => void;
    private readonly boardRoot: string;
    private readonly warning: ToolbarWarning;
    private readonly labelElement: HTMLSpanElement | undefined;
    private readonly iconHost: HTMLSpanElement | undefined;
    private iconRef: IconRef = createToolbarIconFallback();
    /** Resolved segment icons by option value; a segment renders without its icon until resolved. */
    private segmentIcons = new Map<string, IconRef>();
    private menu: MenuHandle | undefined;
    private inputDebounce: ReturnType<typeof setTimeout> | undefined;
    private iconRequest = 0;
    private disposed = false;

    constructor(
        descriptor: BoardToolbarControlDescriptor,
        boardRoot: string,
        emit: (event: ToolbarAction) => void,
        warning: ToolbarWarning,
    ) {
        this.descriptor = descriptor;
        this.boardRoot = boardRoot;
        this.emit = emit;
        this.warning = warning;
        const label = descriptor.type === "button" || descriptor.type === "menu" || descriptor.type === "toggle"
            ? descriptor.label
            : undefined;
        this.labelElement = label === undefined ? undefined : createTextElement(label, { size: "sm" });
        this.iconHost = descriptor.type === "toggle" ? document.createElement("span") : undefined;
        if (this.iconHost) this.iconHost.dataset.part = "icon";

        if (descriptor.type === "select") {
            this.view = new SelectView<IListBoxItem>(this.selectProps(descriptor));
            this.root = this.view.root;
        } else if (descriptor.type === "segmented") {
            this.view = new SegmentedControlView(this.segmentedProps(descriptor));
            this.root = this.view.root;
        } else if (descriptor.type === "input") {
            this.view = new InputView({
                name: this.dataName(), value: descriptor.value, placeholder: descriptor.placeholder,
                disabled: descriptor.disabled, size: "sm", "aria-label": labelOf(descriptor),
                onChange: (value) => this.inputChanged(value),
            });
            this.root = this.view.root;
        } else if (descriptor.type === "toggle") {
            const toggle = new SwitchView(this.switchProps(descriptor));
            this.view = toggle;
            this.root = createPanelElement({ direction: "row", align: "center", gap: "xs", shrink: false });
            if (this.iconHost) this.root.append(this.iconHost);
            this.root.append(toggle.root);
            if (this.labelElement) this.root.append(this.labelElement);
        } else {
            const button = new IconButtonView(this.buttonProps());
            this.view = button;
            this.root = createPanelElement({ direction: "row", align: "center", gap: "xs", shrink: false }, [button.root]);
            if (this.labelElement) this.root.append(this.labelElement);
        }
    }

    mount(): void {
        this.view.mount();
        this.startIconResolution();
    }

    updateDescriptor(descriptor: BoardToolbarControlDescriptor): void {
        const previousDescriptor = this.descriptor;
        this.descriptor = descriptor;
        if (previousDescriptor.type === "input" && descriptor.type === "input"
            && previousDescriptor.value !== descriptor.value && this.inputDebounce !== undefined) {
            clearTimeout(this.inputDebounce);
            this.inputDebounce = undefined;
        }
        if (this.view instanceof IconButtonView) this.view.update(this.buttonProps());
        else if (this.view instanceof SwitchView && descriptor.type === "toggle") this.view.update(this.switchProps(descriptor));
        else if (this.view instanceof SelectView && descriptor.type === "select") {
            this.view.update(this.selectProps(descriptor));
        } else if (this.view instanceof SegmentedControlView && descriptor.type === "segmented") {
            this.view.update(this.segmentedProps(descriptor));
        } else if (this.view instanceof InputView && descriptor.type === "input") this.view.update({
            name: this.dataName(), value: descriptor.value, placeholder: descriptor.placeholder,
            disabled: descriptor.disabled, size: "sm", "aria-label": labelOf(descriptor),
            onChange: (value) => this.inputChanged(value),
        });
        if (this.labelElement) this.labelElement.textContent = descriptor.label ?? "";
        if (this.menu && descriptor.type === "menu") {
            this.menu.update({ items: menuItems(descriptor, (id) => this.menuChanged(id)), placement: "bottom-start", offset: [0, 2], onClose: this.menuClosed });
        }
        this.startIconResolution();
    }

    focusTarget(): HTMLElement | undefined {
        if (this.view instanceof InputView) return this.view.inputElement;
        if (this.view instanceof SelectView) return this.view.inputElement ?? this.view.root.querySelector<HTMLElement>("input");
        return this.view.root;
    }

    captureScroll(): Array<{ element: HTMLElement; top: number; left: number }> {
        const elements = [this.root, ...Array.from(this.root.querySelectorAll<HTMLElement>("*"))];
        return elements
            .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0
                || element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
            .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    }

    disposeResources(): void {
        this.disposed = true;
        if (this.inputDebounce !== undefined) clearTimeout(this.inputDebounce);
        this.inputDebounce = undefined;
        this.menu?.dispose();
        this.menu = undefined;
    }

    private dataName(): string {
        return `board-toolbar-control-${this.descriptor.id}`;
    }

    private switchProps(descriptor: BoardToolbarToggleDescriptor): SwitchProps {
        return {
            name: this.dataName(), label: labelOf(descriptor), checked: descriptor.value,
            disabled: descriptor.disabled, size: "sm", onChange: (value) => this.toggleChanged(value),
        };
    }

    private selectProps(descriptor: BoardToolbarSelectDescriptor): SelectViewProps<IListBoxItem> {
        const items = descriptor.options.map((option) => ({ value: option.value, label: option.label }));
        return {
            name: this.dataName(), items, value: items.find((item) => item.value === descriptor.value) ?? null,
            onChange: (item) => this.selectChanged(String(item.value)), disabled: descriptor.disabled,
            placeholder: descriptor.title ?? descriptor.label, size: "sm", "aria-label": labelOf(descriptor),
        };
    }

    private segmentedProps(descriptor: BoardToolbarSegmentedDescriptor): SegmentedControlViewProps {
        const items: ISegment[] = descriptor.options.map((option) => ({
            value: option.value,
            // SegmentedControlView falls back to the value as text; an icon-only segment has none.
            label: option.label ?? "",
            icon: this.segmentIcons.get(option.value),
            title: option.title ?? option.label,
            disabled: option.disabled,
        }));
        return {
            name: this.dataName(), items, value: descriptor.value, size: "sm", disabled: descriptor.disabled,
            onChange: (value) => this.segmentedChanged(value),
        };
    }

    private startSegmentIconResolution(request: number): void {
        const descriptor = this.descriptor;
        if (descriptor.type !== "segmented") return;
        const withIcons = descriptor.options.filter((option) => option.icon);
        this.segmentIcons = new Map([...this.segmentIcons]
            .filter(([value]) => withIcons.some((option) => option.value === value)));
        for (const option of withIcons) {
            void resolveBoardToolbarIcon(option.icon, this.boardRoot).then((resolved) => {
                if (this.disposed || request !== this.iconRequest || !resolved) return;
                this.segmentIcons.set(option.value, resolved);
                if (this.view instanceof SegmentedControlView && this.descriptor.type === "segmented") {
                    this.view.update(this.segmentedProps(this.descriptor));
                }
            }).catch((error: unknown) => {
                if (!this.disposed && request === this.iconRequest) {
                    this.warning(`Ignored icon of segment "${option.value}" on "${descriptor.id}": ${errMessage(error, "invalid icon")}.`);
                }
            });
        }
    }

    private buttonProps(): IconButtonViewProps {
        const descriptor = this.descriptor;
        return {
            name: this.dataName(), icon: this.iconRef, title: titleOf(descriptor), disabled: descriptor.disabled,
            size: "sm", "aria-label": labelOf(descriptor),
            onClick: descriptor.type === "menu" ? this.openMenu : this.buttonClicked,
        };
    }

    private startIconResolution(): void {
        const request = ++this.iconRequest;
        this.startSegmentIconResolution(request);
        const descriptor = this.descriptor;
        const icon = "icon" in descriptor ? descriptor.icon : undefined;
        void resolveBoardToolbarIcon(icon, this.boardRoot).then((resolved) => {
            if (this.disposed || request !== this.iconRequest || !resolved) return;
            this.iconRef = resolved;
            if (this.view instanceof IconButtonView) this.view.update(this.buttonProps());
            else if (this.iconHost) fillSlot(this.iconHost, resolved);
        }).catch((error: unknown) => {
            if (!this.disposed && request === this.iconRequest) this.warning(`Ignored board toolbar icon for "${descriptor.id}": ${errMessage(error, "invalid icon")}.`);
        });
    }

    private readonly buttonClicked = (): void => {
        this.emit({ id: this.descriptor.id, type: "button" });
    };

    private readonly toggleChanged = (value: boolean): void => {
        if (this.descriptor.type !== "toggle") return;
        this.descriptor = { ...this.descriptor, value };
        // SwitchView is controlled, like SelectView below — write the new state back to it.
        if (this.view instanceof SwitchView) this.view.update(this.switchProps(this.descriptor));
        this.emit({ id: this.descriptor.id, type: "toggle", value });
    };

    private readonly selectChanged = (value: string): void => {
        if (this.descriptor.type !== "select") return;
        this.descriptor = { ...this.descriptor, value };
        // SelectView is controlled — it shows only the value it is given, so the pick has to
        // be written back or the control keeps displaying the previous option.
        if (this.view instanceof SelectView) this.view.update(this.selectProps(this.descriptor));
        this.emit({ id: this.descriptor.id, type: "select", value });
    };

    private readonly segmentedChanged = (value: string): void => {
        if (this.descriptor.type !== "segmented" || value === this.descriptor.value) return;
        this.descriptor = { ...this.descriptor, value };
        // SegmentedControlView is controlled too — write the pick back before telling the board.
        if (this.view instanceof SegmentedControlView) this.view.update(this.segmentedProps(this.descriptor));
        this.emit({ id: this.descriptor.id, type: "segmented", value });
    };

    private readonly inputChanged = (value: string): void => {
        if (this.descriptor.type !== "input") return;
        this.descriptor = { ...this.descriptor, value };
        if (this.inputDebounce !== undefined) clearTimeout(this.inputDebounce);
        this.inputDebounce = setTimeout(() => {
            this.inputDebounce = undefined;
            if (!this.disposed && this.descriptor.type === "input") {
                this.emit({ id: this.descriptor.id, type: "input", value: this.descriptor.value });
            }
        }, 500);
    };

    private readonly openMenu = (event: MouseEvent): void => {
        if (this.descriptor.type !== "menu" || this.descriptor.disabled || !(event.currentTarget instanceof Element)) return;
        this.menu?.dispose();
        this.menu = openMenu(event.currentTarget, {
            items: menuItems(this.descriptor, (id) => this.menuChanged(id)),
            placement: "bottom-start", offset: [0, 2], onClose: this.menuClosed,
        });
    };

    private readonly menuChanged = (value: string): void => {
        if (this.descriptor.type === "menu") this.emit({ id: this.descriptor.id, type: "menu", value });
    };

    private readonly menuClosed = (): void => {
        this.menu = undefined;
        this.focusTarget()?.focus({ preventScroll: true });
    };
}

export class BoardToolbarControls extends VanillaView<{
    model: BoardEditorModel;
    onAction: (event: ToolbarAction) => void;
}> {
    private readonly model: BoardEditorModel;
    private readonly records = new Map<string, ToolbarControlRecord>();
    private frameGeneration: number | undefined;

    constructor(props: { model: BoardEditorModel; onAction: (event: ToolbarAction) => void }) {
        super(props, createPanelElement({
            name: "board-toolbar-controls", direction: "row", align: "center", gap: "sm", shrink: false,
        }));
        this.model = props.model;
    }

    set(controls: readonly BoardToolbarControlDescriptor[], frameGeneration: number, warning: ToolbarWarning): void {
        this.frameGeneration = frameGeneration;
        const previousFocus = this.captureFocus();
        const next = new Map<string, ToolbarControlRecord>();
        for (const descriptor of controls) {
            const existing = this.records.get(descriptor.id);
            if (existing) {
                existing.updateDescriptor(descriptor);
                next.set(descriptor.id, existing);
            } else {
                const record = new ToolbarControlRecord(
                    descriptor, this.model.boardRoot ?? "", (event) => this.emit(event), warning,
                );
                this.child(record.view);
                record.mount();
                next.set(descriptor.id, record);
            }
        }
        for (const [id, record] of this.records) {
            if (!next.has(id)) {
                record.disposeResources();
                this.releaseChild(record.view);
                record.root.remove();
            }
        }
        this.records.clear();
        for (const [id, record] of next) {
            this.records.set(id, record);
            if (record.view.root.parentElement !== this.root) this.root.append(record.root);
        }
        this.restoreFocus(previousFocus);
        this.publishDeclarations();
    }

    updateCatalog(patches: readonly BoardToolbarControlPatch[], warning: ToolbarWarning): void {
        const previousFocus = this.captureFocus();
        for (const patch of patches) {
            const record = this.records.get(patch.id);
            if (!record) {
                warning(`Ignored board toolbar update for unknown control "${patch.id}".`);
                continue;
            }
            const next = mergePatch(record.descriptor, patch, warning);
            if (next) record.updateDescriptor(next);
        }
        this.restoreFocus(previousFocus);
        this.publishDeclarations();
    }

    clear(frameGeneration: number): void {
        if (this.frameGeneration !== frameGeneration) return;
        for (const record of this.records.values()) {
            record.disposeResources();
            this.releaseChild(record.view);
            record.root.remove();
        }
        this.records.clear();
        this.frameGeneration = undefined;
        // The retiring frame's `{ file }` icons are cached by board root + path; drop them so a
        // board that edited an icon on disk renders the new one after its reload (D7).
        invalidateBoardToolbarIcons(this.model.boardRoot ?? "");
        this.model.clearToolbarControlsForFrame(frameGeneration);
        this.publishDeclarations();
    }

    protected onDispose(): void {
        if (this.frameGeneration !== undefined) this.clear(this.frameGeneration);
    }

    private emit(event: ToolbarAction): void {
        this.props.onAction(event);
    }

    private captureFocus(): FocusSnapshot {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        let id: string | undefined;
        let element: HTMLElement | undefined;
        let selection: FocusSnapshot["selection"];
        const scroll: FocusSnapshot["scroll"] = [];
        for (const [recordId, record] of this.records) {
            if (active && record.root.contains(active)) {
                id = recordId;
                element = active;
                if (active instanceof HTMLInputElement) {
                    selection = { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection };
                }
            }
            scroll.push(...record.captureScroll());
        }
        return { id, element, selection, scroll };
    }

    private restoreFocus(snapshot: FocusSnapshot): void {
        if (snapshot.id) {
            const target = this.records.get(snapshot.id)?.focusTarget();
            if (target) {
                target.focus({ preventScroll: true });
                if (target instanceof HTMLInputElement && snapshot.selection) {
                    const length = target.value.length;
                    target.setSelectionRange(
                        Math.min(snapshot.selection.start ?? 0, length),
                        Math.min(snapshot.selection.end ?? 0, length),
                        snapshot.selection.direction ?? "none",
                    );
                }
            }
        }
        for (const position of snapshot.scroll) {
            if (position.element.isConnected) {
                position.element.scrollTop = position.top;
                position.element.scrollLeft = position.left;
            }
        }
    }

    private publishDeclarations(): void {
        if (this.frameGeneration === undefined) return;
        const declarations = [...this.records.values()].map((record) => ({
            name: `board-toolbar-control-${record.descriptor.id}`,
            selector: `[data-name="board-toolbar-control-${record.descriptor.id}"]`,
            purpose: `Locate the board toolbar ${record.descriptor.type} "${record.descriptor.label ?? record.descriptor.id}" control.`,
            where: "board toolbar, between the board path and Persephone controls",
        }));
        this.model.setLiveToolbarElementDeclarations(this.frameGeneration, declarations);
    }
}
