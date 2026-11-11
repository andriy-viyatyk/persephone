import type { BoardToolbarControlDescriptor } from "../../../ipc/board-bridge/ui-catalog";
import {
    type BoardChromeWarning as ToolbarWarning,
    type ToolbarAction,
} from "./chrome/board-chrome-protocol";
import type { BoardChromeCatalog, BoardChromeOwner } from "./model/BoardFrameChrome";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { ButtonView, type ButtonViewProps } from "../../uikit/Button/ButtonView";
import "../../uikit/Button/Button.css";
import { BreadcrumbView, type BreadcrumbProps } from "../../uikit/Breadcrumb/BreadcrumbView";
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
import { t } from "../../../shared/i18n/t";

type BoardToolbarToggleDescriptor = Extract<BoardToolbarControlDescriptor, { type: "toggle" }>;
type BoardToolbarSelectDescriptor = Extract<BoardToolbarControlDescriptor, { type: "select" }>;
type BoardToolbarSegmentedDescriptor = Extract<BoardToolbarControlDescriptor, { type: "segmented" }>;
type BoardToolbarInputDescriptor = Extract<BoardToolbarControlDescriptor, { type: "input" }>;
type BoardToolbarBreadcrumbDescriptor = Extract<BoardToolbarControlDescriptor, { type: "breadcrumb" }>;
type ToolbarRecordView =
    | BreadcrumbView
    | IconButtonView
    | ButtonView
    | SwitchView
    | SelectView<IListBoxItem>
    | SegmentedControlView
    | InputView;

function titleOf(descriptor: BoardToolbarControlDescriptor): string {
    return descriptor.title ?? descriptor.label ?? descriptor.id;
}

function inBoardMenu(descriptor: BoardToolbarControlDescriptor): boolean {
    return descriptor.type === "menu" && descriptor.placement === "board-menu";
}

/** A `placement: "start"` button or menu sits at the left of the toolbar, before the text slot. */
function atStart(descriptor: BoardToolbarControlDescriptor): boolean {
    return (descriptor.type === "button" || descriptor.type === "menu") && descriptor.placement === "start";
}

function hasTextLabel(descriptor: BoardToolbarControlDescriptor): boolean {
    return (descriptor.type === "button" || descriptor.type === "menu") && !!descriptor.label;
}

function labelOf(descriptor: BoardToolbarControlDescriptor): string {
    return descriptor.label ?? descriptor.title ?? descriptor.id;
}

function menuItems(
    descriptor: Extract<BoardToolbarControlDescriptor, { type: "menu" }>,
    onClick: (id: string) => void,
): MenuItem[] {
    return descriptor.items.map((item) => ({
        id: `board-control-${descriptor.id}-${item.id}`,
        label: item.label,
        disabled: item.disabled,
        onClick: () => onClick(item.id),
    }));
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
    private warning: ToolbarWarning;
    private readonly labelElement: HTMLSpanElement | undefined;
    private readonly iconHost: HTMLSpanElement | undefined;
    private iconRef: IconRef = createToolbarIconFallback();
    /** The declared icon resolved; until then a text button shows its label alone. */
    private iconResolved = false;
    /** Resolved segment icons by option value; a segment renders without its icon until resolved. */
    private segmentIcons = new Map<string, IconRef>();
    private menu: MenuHandle | undefined;
    private inputDebounce: ReturnType<typeof setTimeout> | undefined;
    /** An input's clear button, shown inside the field while it holds text. */
    private clearButton: IconButtonView | undefined;
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
        // A labelled button or menu is a text button (its icon optional), so the label is part of the
        // clickable control; only a toggle keeps its label beside the switch.
        const label = descriptor.type === "toggle" ? descriptor.label : undefined;
        this.labelElement = label === undefined ? undefined : createTextElement(label, { size: "sm" });
        this.iconHost = descriptor.type === "toggle" ? document.createElement("span") : undefined;
        if (this.iconHost) this.iconHost.dataset.part = "icon";

        if (descriptor.type === "breadcrumb") {
            this.view = new BreadcrumbView(this.breadcrumbProps(descriptor));
            this.root = this.view.root;
        } else if (descriptor.type === "select") {
            this.view = new SelectView<IListBoxItem>(this.selectProps(descriptor));
            this.root = this.view.root;
        } else if (descriptor.type === "segmented") {
            this.view = new SegmentedControlView(this.segmentedProps(descriptor));
            this.root = this.view.root;
        } else if (descriptor.type === "input") {
            this.clearButton = new IconButtonView({
                name: `${this.dataName()}-clear`, icon: "close", title: t("menus.clear"), size: "sm",
                onClick: this.clearInput,
            });
            this.view = new InputView(this.inputProps(descriptor));
            this.root = this.view.root;
        } else if (descriptor.type === "toggle") {
            const toggle = new SwitchView(this.switchProps(descriptor));
            this.view = toggle;
            this.root = createPanelElement({ direction: "row", align: "center", gap: "xs", shrink: false });
            if (this.iconHost) this.root.append(this.iconHost);
            this.root.append(toggle.root);
            if (this.labelElement) this.root.append(this.labelElement);
        } else if (hasTextLabel(descriptor)) {
            const button = new ButtonView(this.textButtonProps());
            this.view = button;
            this.root = button.root;
        } else {
            const button = new IconButtonView(this.buttonProps());
            this.view = button;
            this.root = createPanelElement(
                { direction: "row", align: "center", gap: "xs", shrink: false },
                [button.root],
            );
            if (this.labelElement) this.root.append(this.labelElement);
        }
    }

    mount(): void {
        this.clearButton?.mount();
        this.view.mount();
        this.syncBreadcrumbAttributes();
        this.startIconResolution();
    }

    /** Whether `descriptor` can be shown by this record's view; otherwise the record is rebuilt. */
    accepts(descriptor: BoardToolbarControlDescriptor): boolean {
        return descriptor.type === this.descriptor.type && hasTextLabel(descriptor) === hasTextLabel(this.descriptor)
            && inBoardMenu(descriptor) === inBoardMenu(this.descriptor)
            && atStart(descriptor) === atStart(this.descriptor);
    }

    /** Items this control adds to Persephone's … menu (a `placement: "board-menu"` menu only). */
    boardMenuItems(): MenuItem[] {
        const descriptor = this.descriptor;
        if (descriptor.type !== "menu" || !inBoardMenu(descriptor)) return [];
        return menuItems(descriptor, (id) => this.menuChanged(id))
            .map((item) => descriptor.disabled ? { ...item, disabled: true } : item);
    }

    updateDescriptor(descriptor: BoardToolbarControlDescriptor): void {
        const previousDescriptor = this.descriptor;
        this.descriptor = descriptor;
        if (previousDescriptor.type === "input" && descriptor.type === "input"
            && previousDescriptor.value !== descriptor.value && this.inputDebounce !== undefined) {
            clearTimeout(this.inputDebounce);
            this.inputDebounce = undefined;
        }
        if (this.view instanceof BreadcrumbView && descriptor.type === "breadcrumb") {
            this.view.update(this.breadcrumbProps(descriptor));
            this.syncBreadcrumbAttributes();
        } else if (this.view instanceof IconButtonView) this.view.update(this.buttonProps());
        else if (this.view instanceof ButtonView) this.view.update(this.textButtonProps());
        else if (this.view instanceof SwitchView && descriptor.type === "toggle") {
            this.view.update(this.switchProps(descriptor));
        }
        else if (this.view instanceof SelectView && descriptor.type === "select") {
            this.view.update(this.selectProps(descriptor));
        } else if (this.view instanceof SegmentedControlView && descriptor.type === "segmented") {
            this.view.update(this.segmentedProps(descriptor));
        } else if (this.view instanceof InputView && descriptor.type === "input") {
            this.view.update(this.inputProps(descriptor));
        }
        if (this.labelElement) this.labelElement.textContent = descriptor.label ?? "";
        if (this.menu && descriptor.type === "menu") {
            this.menu.update({
                items: menuItems(descriptor, (id) => this.menuChanged(id)),
                placement: "bottom-start",
                offset: [0, 2],
                onClose: this.menuClosed,
            });
        }
        this.startIconResolution();
    }

    updateWarning(warning: ToolbarWarning): void {
        this.warning = warning;
    }

    focusTarget(): HTMLElement | undefined {
        if (this.view instanceof InputView) return this.view.inputElement;
        if (this.view instanceof SelectView) {
            return this.view.inputElement ?? this.view.root.querySelector<HTMLElement>("input");
        }
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
        this.clearButton?.dispose();
        this.clearButton = undefined;
    }

    private dataName(): string {
        return `board-toolbar-control-${this.descriptor.id}`;
    }

    private breadcrumbProps(descriptor: BoardToolbarBreadcrumbDescriptor): BreadcrumbProps {
        return {
            name: this.dataName(), rootLabel: descriptor.rootLabel, value: descriptor.value,
            separators: descriptor.separators ?? "/", size: "sm", clipStart: true,
            onChange: this.breadcrumbChanged,
        };
    }

    private syncBreadcrumbAttributes(): void {
        if (this.descriptor.type !== "breadcrumb") return;
        this.root.title = this.descriptor.title ?? "";
        this.root.setAttribute("aria-disabled", String(!!this.descriptor.disabled));
    }

    private readonly breadcrumbChanged = (value: string): void => {
        if (this.descriptor.type !== "breadcrumb" || this.descriptor.disabled) return;
        this.descriptor = { ...this.descriptor, value };
        if (this.view instanceof BreadcrumbView) this.view.update(this.breadcrumbProps(this.descriptor));
        this.emit({ id: this.descriptor.id, type: "breadcrumb", value });
    };

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
                    this.warning(
                        `Ignored icon of segment "${option.value}" on "${descriptor.id}": `
                            + `${errMessage(error, "invalid icon")}.`,
                    );
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

    private textButtonProps(): ButtonViewProps {
        const descriptor = this.descriptor;
        const hasIcon = "icon" in descriptor && descriptor.icon !== undefined;
        return {
            name: this.dataName(), icon: hasIcon && this.iconResolved ? this.iconRef : undefined,
            children: descriptor.label ?? "", title: descriptor.title, disabled: descriptor.disabled,
            size: "sm", variant: "ghost",
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
            this.iconResolved = true;
            if (this.view instanceof IconButtonView) this.view.update(this.buttonProps());
            else if (this.view instanceof ButtonView) this.view.update(this.textButtonProps());
            else if (this.iconHost) fillSlot(this.iconHost, resolved);
        }).catch((error: unknown) => {
            if (!this.disposed && request === this.iconRequest) {
                this.warning(
                    `Ignored board toolbar icon for "${descriptor.id}": `
                        + `${errMessage(error, "invalid icon")}.`,
                );
            }
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

    private inputProps(descriptor: BoardToolbarInputDescriptor) {
        return {
            name: this.dataName(), value: descriptor.value, placeholder: descriptor.placeholder,
            disabled: descriptor.disabled, size: "sm" as const, "aria-label": labelOf(descriptor),
            onChange: this.inputChanged,
            // Every board input gets a clear button while it holds text.
            endSlot: descriptor.value && !descriptor.disabled ? this.clearButton?.root : undefined,
        };
    }

    /** Empties the field and tells the board at once, without the typing debounce. */
    private readonly clearInput = (): void => {
        if (this.descriptor.type !== "input" || this.disposed) return;
        if (this.inputDebounce !== undefined) clearTimeout(this.inputDebounce);
        this.inputDebounce = undefined;
        this.descriptor = { ...this.descriptor, value: "" };
        if (this.view instanceof InputView) {
            this.view.update(this.inputProps(this.descriptor));
            this.view.inputElement.focus();
        }
        this.emit({ id: this.descriptor.id, type: "input", value: "" });
    };

    private readonly inputChanged = (value: string): void => {
        if (this.descriptor.type !== "input") return;
        const hadText = !!this.descriptor.value;
        this.descriptor = { ...this.descriptor, value };
        // Show or hide the clear button as the field gains or loses its text.
        if (hadText !== !!value && this.view instanceof InputView) this.view.update(this.inputProps(this.descriptor));
        if (this.inputDebounce !== undefined) clearTimeout(this.inputDebounce);
        this.inputDebounce = setTimeout(() => {
            this.inputDebounce = undefined;
            if (!this.disposed && this.descriptor.type === "input") {
                this.emit({ id: this.descriptor.id, type: "input", value: this.descriptor.value });
            }
        }, 500);
    };

    private readonly openMenu = (event: MouseEvent): void => {
        if (this.descriptor.type !== "menu" || this.descriptor.disabled
            || !(event.currentTarget instanceof Element)) return;
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
    private previousOwner: BoardChromeOwner | undefined;
    /** Holds the `placement: "start"` controls; the toolbar places it before the text slot. */
    readonly startRoot = createPanelElement({
        name: "board-toolbar-start-controls", direction: "row", align: "center", gap: "sm", shrink: false,
    });

    readonly breadcrumbRoot = createPanelElement({
        name: "board-toolbar-breadcrumbs", direction: "row", align: "center", gap: "sm",
    });
    onBreadcrumbVisibilityChange: ((visible: boolean) => void) | undefined;

    constructor(props: { model: BoardEditorModel; onAction: (event: ToolbarAction) => void }) {
        super(props, createPanelElement({
            name: "board-toolbar-controls", direction: "row", align: "center", gap: "sm", shrink: false,
        }));
        this.model = props.model;
        this.startRoot.style.display = "none";
        this.breadcrumbRoot.style.display = "none";
    }

    protected onMount(): void {
        this.bind(
            this.model.chrome.state,
            (state) => ({ owner: state.owner, catalog: state.toolbar }),
            this.renderCatalog,
        );
    }

    private readonly renderCatalog = (snapshot: {
        owner: BoardChromeOwner | undefined;
        catalog: BoardChromeCatalog<BoardToolbarControlDescriptor> | undefined;
    }): void => {
        if (this.previousOwner && !ownersEqual(this.previousOwner, snapshot.owner)) {
            invalidateBoardToolbarIcons(this.model.boardRoot ?? "");
        }
        this.previousOwner = snapshot.owner;
        const warning = snapshot.catalog?.warning ?? (() => {});
        const controls = snapshot.catalog?.items ?? [];
        const previousFocus = this.captureFocus();
        const next = new Map<string, ToolbarControlRecord>();
        for (const descriptor of controls) {
            const existing = this.records.get(descriptor.id);
            if (existing && existing.accepts(descriptor)) {
                existing.updateWarning(warning);
                existing.updateDescriptor(descriptor);
                next.set(descriptor.id, existing);
            } else {
                if (existing) this.disposeRecord(existing);
                next.set(descriptor.id, this.createRecord(descriptor, warning));
            }
        }
        for (const [id, record] of this.records) {
            if (next.get(id) !== record) this.disposeRecord(record);
        }
        this.records.clear();
        for (const [id, record] of next) {
            this.records.set(id, record);
            record.root.hidden = inBoardMenu(record.descriptor);
            const host = atStart(record.descriptor) ? this.startRoot
                : record.descriptor.type === "breadcrumb" ? this.breadcrumbRoot : this.root;
            host.append(record.root);
        }
        this.restoreFocus(previousFocus);
        this.updateGroupVisibility();
    };

    /** The board's own entries for Persephone's … menu, in declaration order. */
    boardMenuItems(): MenuItem[] {
        return [...this.records.values()].flatMap((record) => record.boardMenuItems());
    }

    private createRecord(descriptor: BoardToolbarControlDescriptor, warning: ToolbarWarning): ToolbarControlRecord {
        const record = new ToolbarControlRecord(
            descriptor, this.model.boardRoot ?? "", (event) => this.emit(event), warning,
        );
        this.child(record.view);
        record.mount();
        record.root.hidden = inBoardMenu(descriptor);
        return record;
    }

    private disposeRecord(record: ToolbarControlRecord): void {
        record.disposeResources();
        this.releaseChild(record.view);
        record.root.remove();
    }

    private clearRecords(): void {
        for (const record of this.records.values()) {
            record.disposeResources();
            this.releaseChild(record.view);
            record.root.remove();
        }
        this.records.clear();
    }

    protected onDispose(): void {
        this.clearRecords();
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
                    selection = {
                        start: active.selectionStart,
                        end: active.selectionEnd,
                        direction: active.selectionDirection,
                    };
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

    private updateGroupVisibility(): void {
        // An empty start group would still take a toolbar gap, so it is shown only with controls in it.
        this.startRoot.style.display = this.startRoot.childElementCount ? "" : "none";
        const hasBreadcrumbs = this.breadcrumbRoot.childElementCount > 0;
        this.breadcrumbRoot.style.display = hasBreadcrumbs ? "" : "none";
        this.onBreadcrumbVisibilityChange?.(hasBreadcrumbs);
    }
}

function ownersEqual(left: BoardChromeOwner, right: BoardChromeOwner | undefined): boolean {
    return left.token === right?.token && left.generation === right.generation;
}
