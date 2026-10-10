import { app } from "../../api/app";
import { t, englishMessage, untranslated } from "../../../shared/i18n/t";
import type { IContentPipe } from "../../api/types/io.pipe";
import { PagePipeStatusView } from "../../components/pipe-status/PagePipeStatusView";
import { subscribePagePipe } from "../../components/pipe-status/page-pipe";
import color from "../../theme/color";
import { DEFAULT_BROWSER_COLOR, MEMORY_ICON_COLOR } from "../../theme/palette-colors";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { DividerView } from "../../uikit/Divider/DividerView";
import { fillSlot, type SlotContent } from "../../uikit/shared/fill-slot";
import { createIconElement } from "../../uikit/shared/slots";
import { SpacerView } from "../../uikit/Spacer/SpacerView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { EditorModel } from "./EditorModel";
import { EditorToolbarView } from "./EditorToolbarView";
import type { TextFileModel } from "../text/TextEditorModel";
import "../../uikit/Button/Button.css";
import "../../uikit/Divider/Divider.css";
import "../../uikit/Spacer/Spacer.css";
import "./EditorStatusBar.css";

export interface EditorStatusBarViewProps {
    /** `data-name` of the bar. Text hosts keep the historical `text-chrome-footer`. */
    name: string;
    /** The editor whose page the bar reports on (pipe status, provider badge). */
    model: EditorModel;
    /** Text host: adds the script toggle and the encoding label. */
    host?: TextFileModel | null;
    contributions?: SlotContent;
    boardStart?: SlotContent;
    boardEnd?: SlotContent;
}

interface ProviderMeta {
    label: string;
    createIcon: () => SVGElement;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
    file: {
        label: t("editors.localFile"),
        createIcon: () => createIconElement("folder-open", { width: 16, height: 16, color: color.text.light }),
    },
    http: {
        label: untranslated("HTTP"),
        createIcon: () => createIconElement("globe", { width: 16, height: 16, color: DEFAULT_BROWSER_COLOR }),
    },
    mneme: {
        label: englishMessage("editors.mneme"),
        createIcon: () => createIconElement("memory", { width: 16, height: 16, color: MEMORY_ICON_COLOR }),
    },
};

/**
 * Shared editor footer: [script] … [contributions] [pipe status] [provider badge] | [encoding].
 * The pipe status and provider badge follow the page's pipe; the script toggle and encoding
 * appear only for a text host. The owned toolbar root is the public footer root.
 */
export class EditorStatusBarView extends VanillaView<EditorStatusBarViewProps> {
    private readonly toolbar: EditorToolbarView;
    private contributionsHost: HTMLSpanElement | undefined;
    private contentHost: HTMLSpanElement | undefined;
    private spacer: SpacerView | undefined;
    private boardStartHost: HTMLSpanElement | undefined;
    private boardEndHost: HTMLSpanElement | undefined;
    private boardStartCleanup: (() => void) | undefined;
    private boardEndCleanup: (() => void) | undefined;
    private badgeHost: HTMLSpanElement | undefined;
    private contributionCleanup: (() => void) | undefined;
    private currentPipe: IContentPipe | null | undefined;

    public constructor(props: EditorStatusBarViewProps) {
        const toolbar = new EditorToolbarView({ name: props.name, borderTop: true });
        super(props, toolbar.root);
        this.toolbar = toolbar;
        this.root.dataset.statusBar = "";
    }

    protected onMount(): void {
        this.child(this.toolbar);
        this.toolbar.mount();

        const content = document.createElement("span");
        content.dataset.part = "footer-content";
        // Let EditorToolbarView own the toolbar slot transition.
        this.toolbar.update({ name: this.props.name, borderTop: true, children: content });
        this.contentHost = content;

        const host = this.props.host;
        if (host?.script) {
            const scriptLabel = document.createElement("span");
            scriptLabel.dataset.part = "script-label";
            scriptLabel.textContent = t("editors.script");
            const scriptButton = this.child(new ButtonView({
                name: "text-toggle-script",
                variant: "ghost",
                size: "sm",
                onClick: host.script.toggleOpen,
                children: scriptLabel,
            }));
            content.append(scriptButton.root);
            scriptButton.mount();
            this.bind(host.script.state, (state) => state.open, (open) => {
                scriptLabel.dataset.state = open ? "open" : "closed";
            });
        }

        const spacer = this.child(new SpacerView({}));
        this.spacer = spacer;
        content.append(spacer.root);
        spacer.mount();

        const contributionsHost = document.createElement("span");
        contributionsHost.dataset.part = "footer-contributions";
        this.contributionsHost = contributionsHost;
        content.append(contributionsHost);

        const pageId = this.props.model.page?.id;
        const page = pageId ? app.pages.findPage(pageId) : undefined;
        if (page) {
            const status = this.child(new PagePipeStatusView({ page }));
            content.append(status.root);
            status.mount();
        }

        const badgeHost = document.createElement("span");
        badgeHost.dataset.part = "provider-slot";
        this.badgeHost = badgeHost;
        content.append(badgeHost);
        if (page) this.own(subscribePagePipe(page, this.renderProvider));

        if (host) {
            const divider = this.child(new DividerView({ orientation: "vertical" }));
            content.append(divider.root);
            divider.mount();

            const encodingLabel = document.createElement("span");
            encodingLabel.dataset.part = "encoding-label";
            content.append(encodingLabel);
            this.bind(host.state, (state) => state.encoding, (encoding) => {
                encodingLabel.textContent = encoding || "utf-8";
            });
        }

        this.updateContributions(this.props.contributions);
        this.updateBoardSlots(this.props.boardStart, this.props.boardEnd);
        this.own(() => {
            this.contributionCleanup?.();
            this.contributionCleanup = undefined;
        });
    }

    protected onUpdate(props: EditorStatusBarViewProps): void {
        this.updateContributions(props.contributions);
        this.updateBoardSlots(props.boardStart, props.boardEnd);
    }

    protected onDispose(): void {
        this.contributionsHost = undefined;
        this.badgeHost = undefined;
        this.contentHost = undefined;
        this.spacer = undefined;
        this.boardStartHost = undefined;
        this.boardEndHost = undefined;
    }

    private updateContributions(contributions: SlotContent | undefined): void {
        if (!this.contributionsHost) return;
        this.contributionCleanup = fillSlot(this.contributionsHost, contributions);
    }

    private updateBoardSlots(start: SlotContent | undefined, end: SlotContent | undefined): void {
        const content = this.contentHost;
        const spacer = this.spacer;
        const contributions = this.contributionsHost;
        if (!content || !spacer || !contributions) return;
        const hasStart = start !== undefined && start !== null;
        spacer.update({ size: hasStart ? 0 : undefined });
        if (hasStart) {
            if (!this.boardStartHost) {
                this.boardStartHost = document.createElement("span");
                this.boardStartHost.dataset.part = "board-status-start-slot";
                content.insertBefore(this.boardStartHost, spacer.root);
            }
            this.boardStartCleanup = fillSlot(this.boardStartHost, start);
        } else {
            this.boardStartCleanup?.();
            this.boardStartCleanup = undefined;
            this.boardStartHost?.remove();
            this.boardStartHost = undefined;
        }
        if (end !== undefined && end !== null) {
            if (!this.boardEndHost) {
                this.boardEndHost = document.createElement("span");
                this.boardEndHost.dataset.part = "board-status-end-slot";
                content.insertBefore(this.boardEndHost, contributions.nextSibling);
            }
            this.boardEndCleanup = fillSlot(this.boardEndHost, end);
        } else {
            this.boardEndCleanup?.();
            this.boardEndCleanup = undefined;
            this.boardEndHost?.remove();
            this.boardEndHost = undefined;
        }
    }

    private readonly renderProvider = (pipe: IContentPipe | null): void => {
        if (pipe === this.currentPipe || !this.badgeHost) return;
        this.currentPipe = pipe;
        this.badgeHost.replaceChildren();
        if (!pipe) return;

        const meta = PROVIDER_META[pipe.provider.type];
        const isArchive = pipe.transformers.some((transformer) => transformer.type === "archive");
        if (!meta && !isArchive) return;

        const title = [meta?.label, isArchive ? "Archive" : null].filter(Boolean).join(" · ")
            + (pipe.provider.sourceUrl ? ` — ${pipe.provider.sourceUrl}` : "");
        const badge = document.createElement("span");
        badge.dataset.part = "provider-badge";
        badge.title = title;
        if (meta) badge.append(meta.createIcon());
        if (isArchive) badge.append(createIconElement("archive", { width: 16, height: 16 }));
        this.badgeHost.append(badge);
    };
}
