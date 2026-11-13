import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { IconButtonView, type IconButtonProps } from "../../uikit/IconButton/IconButtonView";
import { openMenu, type MenuHandle, type MenuAttachOptions } from "../../uikit/Menu/attach-menu";
import type { MenuItem } from "../../uikit/Menu/types";
import { restoreFocus } from "../../uikit/shared/focus-restore";
import { DrawIcon } from "../../theme/language-icons";
import { createIconComponentElement } from "../../theme/icons";
import { t } from "../../../shared/i18n/t";
import { notifyEditCapabilityFailure } from "../../api/capability-feedback";
import { ui } from "../../api/ui";
import { errMessage } from "../../../shared/utils";
import { guard } from "../../core/utils/guard";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { ImageActionSource, ImageActions } from "./image-actions";

export type ImageToolbarAction = "draw" | "save" | "copy";
export type ImageMenuAction = "save-as-png" | "open-in-image-view" | "edit-image";

export type ImageToolbarItem =
    | { kind: "action"; action: ImageToolbarAction }
    | { kind: "control"; key: string; props: IconButtonProps }
    | {
        kind: "menu";
        buttonName: string;
        menuName: string;
        title: string;
        icon: IconButtonProps["icon"];
        entries: ReadonlyArray<
            | { kind: "action"; action: ImageMenuAction }
            | { kind: "entry"; key: string; item: MenuItem }
        >;
    };

export interface ImageActionsToolbarViewProps {
    model: ImageActionSource & { imageActions: ImageActions; state?: { get(): unknown; subscribe(listener: () => void): () => void } };
    items: ReadonlyArray<ImageToolbarItem>;
    namePrefix: "svg-" | "mermaid-" | "html-" | "image-";
    menuActionDelayMs?: number;
    onCopyToClipboard?: () => void;
}

export class ImageActionsToolbarView extends VanillaView<ImageActionsToolbarViewProps> {
    private readonly controls: Array<{ key: string; button: IconButtonView }> = [];
    private readonly menus = new Map<string, MenuState>();
    private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
    private model: ImageActionsToolbarViewProps["model"];
    private focusedBeforeMenu: HTMLElement | null = null;

    public constructor(props: ImageActionsToolbarViewProps, root: HTMLElement = createContentsElement()) {
        super(props, root);
        this.model = props.model;
    }

    protected onMount(): void {
        for (const item of this.props.items) {
            const key = item.kind === "action" ? item.action : item.kind === "control" ? item.key : item.buttonName;
            const button = new IconButtonView(this.buttonProps(item));
            this.controls.push({ key, button: this.child(button) });
            this.root.append(button.root);
            button.mount();
            if (item.kind === "menu") this.menus.set(item.buttonName, { item, handle: undefined });
        }
        this.own(() => {
            for (const menu of this.menus.values()) menu.handle?.dispose();
            this.menus.clear();
            this.pendingTimers.forEach(clearTimeout);
            this.pendingTimers.clear();
            this.focusedBeforeMenu = null;
        });
    }

    protected onUpdate(props: ImageActionsToolbarViewProps): void {
        this.model = props.model;
        props.items.forEach((item, index) => {
            this.controls[index]?.button.update(this.buttonProps(item));
            if (item.kind === "menu") {
                const menu = this.menus.get(item.buttonName);
                if (menu) {
                    menu.item = item;
                    if (item.buttonName === "image-save" && !this.modelStateUrl) {
                        void guard("Failed to close image save menu", () => menu.handle?.dispose());
                        menu.handle = undefined;
                        this.focusedBeforeMenu = null;
                    } else {
                        menu.handle?.update(this.menuOptions(menu));
                    }
                }
            }
        });
    }

    private buttonProps(item: ImageToolbarItem): IconButtonProps {
        if (item.kind === "control") return item.props;
        if (item.kind === "menu") {
            const capturing = this.modelState.capturing ?? false;
            return {
                name: item.buttonName,
                size: "sm",
                title: item.title,
                icon: item.icon,
                hidden: item.buttonName === "image-save" && !this.modelStateUrl,
                disabled: item.buttonName === "html-more" && capturing,
                onClick: this.handleMenuClick(item.buttonName),
            };
        }
        const prefix = this.props.namePrefix;
        const action = item.action;
        const icon = action === "draw"
            ? (prefix === "image-" ? DrawIcon.createElement() : createIconComponentElement(DrawIcon))
            : action === "save" ? "save" : "copy";
        const title = action === "draw"
            ? t("editors.openInDrawingEditor")
            : action === "save" ? t("editors.saveAsPng")
                : prefix === "html-" ? t("editors.copyImageToClipboard")
                    : t("editors.copyImageWithShortcut", { shortcut: "Ctrl+C" });
        return {
            name: `${prefix}${action === "draw" ? "open-draw" : action}`,
            size: "sm",
            title,
            icon,
            disabled: (prefix === "mermaid-" && !this.modelStateUrl)
                || (prefix === "html-" && action === "copy" && (this.modelState.capturing ?? false)),
            onClick: action === "draw" ? this.openDrawingEditor : action === "save" ? this.saveAsPng : this.handleCopy,
        };
    }

    private get modelStateUrl(): string | undefined {
        return this.modelState.url ?? this.modelState.svgUrl;
    }

    private get modelState(): { url?: string; capturing?: boolean; svgUrl?: string } {
        return this.model.state?.get() as { url?: string; capturing?: boolean; svgUrl?: string } ?? {};
    }

    private readonly openDrawingEditor = (): void => {
        void this.model.imageActions.openInDrawingEditor().catch((error: unknown) => {
            const prefix = this.props.namePrefix;
            const fallback = prefix === "svg-"
                ? "Failed to open SVG in Drawing Editor"
                : prefix === "mermaid-" ? "Failed to open Mermaid in Drawing Editor" : "Failed to open image in Drawing Editor";
            notifyEditCapabilityFailure(error, "image.edit", fallback);
        });
    };

    private readonly saveAsPng = (): void => {
        void this.model.imageActions.saveAsPng();
    };

    private readonly copy = (): void => {
        void this.model.imageActions.copy().catch((error: unknown) => {
            const key = this.props.namePrefix === "svg-" ? "editors.failedToCopySvgImage" : "editors.failedToCopyMermaidImage";
            if (this.props.namePrefix === "svg-" || this.props.namePrefix === "mermaid-") {
                ui.notify(t(key, { error: errMessage(error) }), "error");
            }
        });
    };

    private readonly handleCopy = (): void => {
        if (this.props.namePrefix === "image-" && this.props.onCopyToClipboard) {
            this.props.onCopyToClipboard();
            return;
        }
        this.copy();
    };

    private handleMenuClick(buttonName: string): (event: MouseEvent) => void {
        return (event) => {
            if (!(event.currentTarget instanceof Element)) return;
            const menu = this.menus.get(buttonName);
            if (!menu) return;
            this.focusedBeforeMenu = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (menu.handle) menu.handle.update(this.menuOptions(menu));
            else menu.handle = openMenu(event.currentTarget, this.menuOptions(menu));
        };
    }

    private menuOptions(menu: MenuState): MenuAttachOptions {
        return {
            name: menu.item.menuName,
            items: menu.item.entries.map((entry) => entry.kind === "entry" ? entry.item : this.menuActionItem(entry.action, menu.item.menuName)),
            placement: "bottom-start",
            offset: [-4, 4],
            onClose: () => {
                menu.handle = undefined;
                if (this.focusedBeforeMenu) restoreFocus(this.focusedBeforeMenu);
                this.focusedBeforeMenu = null;
            },
        };
    }

    private menuActionItem(action: ImageMenuAction, menuName: string): MenuItem {
        const imageMenu = menuName === "image-save-menu";
        const item: MenuItem = {
            id: action,
            label: action === "save-as-png"
                ? t(imageMenu ? "editors.saveAsPngFile" : "editors.saveAsPng")
                : action === "open-in-image-view" ? t("editors.openInImageView") : t("editors.editImage"),
            ...(action === "save-as-png" && !imageMenu ? { icon: "save" as const } : {}),
            ...(action === "open-in-image-view" ? { icon: "open-file" as const } : {}),
            ...(action === "edit-image" ? { icon: createIconComponentElement(DrawIcon) } : {}),
            onClick: () => this.runAfterMenuClose(() => {
                if (action === "save-as-png") void this.model.imageActions.saveAsPng();
                else if (action === "open-in-image-view") void this.model.imageActions.openInImageView();
                else void this.model.imageActions.editImage();
            }),
        };
        return item;
    }

    private runAfterMenuClose(run: () => void): void {
        const delay = this.props.menuActionDelayMs ?? 0;
        if (delay <= 0) {
            run();
            return;
        }
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            run();
        }, delay);
        this.pendingTimers.add(timer);
    }
}

interface MenuState {
    item: Extract<ImageToolbarItem, { kind: "menu" }>;
    handle: MenuHandle | undefined;
}
