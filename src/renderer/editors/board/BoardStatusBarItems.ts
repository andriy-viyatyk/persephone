import type { BoardStatusBarItem } from "../../../ipc/board-bridge/ui-catalog";
import type { BoardChromeWarning as Warning } from "./chrome/board-chrome-protocol";
import type { BoardChromeCatalog, BoardChromeOwner } from "./model/BoardFrameChrome";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { IconRef } from "../../uikit/shared/slots";
import type { BoardEditorModel } from "./BoardEditorModel";
import { resolveBoardToolbarIcon } from "./board-toolbar-icon";
import { errMessage } from "../../../shared/utils";
import "./BoardStatusBarItems.css";

interface RecordView {
    readonly root: HTMLElement;
    readonly button?: ButtonView;
    readonly icon?: IconRef;
    updateWarning(warning: Warning): void;
    dispose(): void;
}

interface BoardStatusBarItemsProps {
    model: BoardEditorModel;
    onAction: (event: { id: string }, generation: number) => void;
    onChange: () => void;
}

export class BoardStatusBarItems extends VanillaView<BoardStatusBarItemsProps> {
    private readonly records = new Map<string, { item: BoardStatusBarItem; view: RecordView }>();
    private frameGeneration: number | undefined;
    readonly endRoot: HTMLElement;

    constructor(props: BoardStatusBarItemsProps) {
        super(props, document.createElement("span"));
        this.root.dataset.part = "board-status-start";
        this.endRoot = document.createElement("span");
        this.endRoot.dataset.part = "board-status-end";
    }

    protected onMount(): void {
        this.bind(
            this.props.model.chrome.state,
            (state) => ({ owner: state.owner, catalog: state.status }),
            this.renderCatalog,
        );
    }

    private readonly renderCatalog = (snapshot: {
        owner: BoardChromeOwner | undefined;
        catalog: BoardChromeCatalog<BoardStatusBarItem> | undefined;
    }): void => {
        this.frameGeneration = snapshot.owner?.generation;
        const warning = snapshot.catalog?.warning ?? (() => {});
        const next = new Map<string, { item: BoardStatusBarItem; view: RecordView }>();
        for (const item of snapshot.catalog?.items ?? []) {
            const existing = this.records.get(item.id);
            if (existing && existing.item === item) {
                existing.view.updateWarning(warning);
                next.set(item.id, existing);
            } else {
                existing?.view.dispose();
                next.set(item.id, { item, view: this.createRecord(item, warning) });
            }
        }
        for (const [id, record] of this.records) {
            if (next.get(id) !== record) record.view.dispose();
        }
        this.records.clear();
        for (const [id, record] of next) this.records.set(id, record);
        this.renderOrder();
        this.props.onChange();
    };

    protected onDispose(): void {
        for (const { view } of this.records.values()) view.dispose();
        this.records.clear();
        this.root.replaceChildren();
        this.endRoot.replaceChildren();
    }

    private createRecord(item: BoardStatusBarItem, warning: Warning): RecordView {
        const warningRef = { current: warning };
        const reportWarning = (message: string): void => warningRef.current(message);
        const tone = item.tone ?? "normal";
        let root: HTMLElement;
        let button: ButtonView | undefined;
        let icon: IconRef | undefined;
        const onClick = (): void => {
            if (item.type !== "button" || item.hidden || item.disabled
                || this.frameGeneration === undefined) return;
            this.props.onAction({ id: item.id }, this.frameGeneration);
        };
        if (item.type === "text") {
            root = createTextElement(item.text, { size: "sm" });
            root.dataset.name = `board-status-bar-item-${item.id}`;
            root.dataset.type = "text";
            root.dataset.variant = item.variant ?? "plain";
            root.title = item.title ?? "";
        } else {
            button = new ButtonView({
                name: `board-status-bar-item-${item.id}`,
                size: "sm",
                variant: "ghost",
                title: item.title ?? item.text,
                disabled: item.disabled,
                children: item.text,
                onClick,
            });
            root = button.root;
            button.mount();
            if (item.icon) {
                void resolveBoardToolbarIcon(item.icon, this.props.model.boardRoot ?? "").then((resolved) => {
                if (!root.isConnected || !resolved) return;
                icon = resolved;
                button?.update({
                    name: `board-status-bar-item-${item.id}`,
                    size: "sm",
                    variant: "ghost",
                    title: item.title ?? item.text,
                    disabled: item.disabled,
                    icon: resolved,
                    children: item.text,
                    onClick,
                });
                }).catch((error: unknown) => reportWarning(
                    `Ignored board status-bar icon for "${item.id}": `
                        + `${errMessage(error, "invalid icon")}.`,
                ));
            }
        }
        root.dataset.tone = tone;
        root.dataset.align = item.align ?? "start";
        root.title = item.title ?? (item.type === "text" ? "" : item.text);
        return {
            root,
            button,
            get icon() { return icon; },
            updateWarning: (nextWarning) => { warningRef.current = nextWarning; },
            dispose: () => button?.dispose(),
        };
    }

    private renderOrder(): void {
        this.root.replaceChildren();
        this.endRoot.replaceChildren();
        for (const { item, view } of this.records.values()) {
            if (item.hidden) continue;
            (item.align === "end" ? this.endRoot : this.root).append(view.root);
        }
    }

    get hasStartItems(): boolean {
        return [...this.records.values()].some(({ item }) => !item.hidden && item.align !== "end");
    }

    get hasEndItems(): boolean {
        return [...this.records.values()].some(({ item }) => !item.hidden && item.align === "end");
    }
}
