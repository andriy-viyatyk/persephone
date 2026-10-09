import { ButtonView } from "../../uikit/Button/ButtonView";
import { DialogContentView } from "../../uikit/Dialog/DialogContentView";
import { DialogView } from "../../uikit/Dialog/DialogView";
import { SpinnerView } from "../../uikit/Spinner/SpinnerView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { TorIcon } from "../../theme/language-icons";
import { GlobeIcon } from "../../theme/icons";
import type { DialogViewProps } from "./dialog-view-registry";
import type { TorInfoDialogModel } from "./TorInfoDialog";
import { t } from "../../../shared/i18n/t";
import "../../uikit/Button/Button.css";
import "../../uikit/Dialog/Dialog.css";
import "../../uikit/Spinner/Spinner.css";

function formatLocation(info: { city?: string; region?: string; country?: string }): string {
    const parts = [info.city, info.region, info.country].filter(Boolean);
    return parts.length ? parts.join(", ") : t("dialogs.torUnknownValue");
}

export class TorInfoDialogView extends VanillaView<DialogViewProps> {
    private readonly model: TorInfoDialogModel;
    private readonly dialogView: DialogView;
    private readonly contentView: DialogContentView;
    private readonly spinnerView: SpinnerView;
    private readonly closeButton: ButtonView;
    private readonly busyPanel: HTMLDivElement;
    private readonly busyText: HTMLSpanElement;
    private readonly infoPanel: HTMLDivElement;
    private readonly ipValue: HTMLSpanElement;
    private readonly locationValue: HTMLSpanElement;
    private readonly orgRow: HTMLDivElement;
    private readonly orgValue: HTMLSpanElement;
    private readonly torValue: HTMLSpanElement;
    /** Proxy mode (US-1557): no Tor verdict, no Reconnect, and "through the proxy" wording. */
    private readonly isTor: boolean;
    private readonly errorElement: HTMLSpanElement;
    private readonly warningElement: HTMLSpanElement;
    private readonly noteElement: HTMLSpanElement;
    private readonly geoElement: HTMLSpanElement;
    private readonly reconnectButton: ButtonView;

    public constructor(props: DialogViewProps) {
        const model = props.model as TorInfoDialogModel;
        const { mode, proxyLabel } = model.state.get();
        const isTor = mode === "tor";
        const spinnerView = new SpinnerView({ size: 16 });
        const busyText = createTextElement(isTor ? t("dialogs.torLookingUp") : t("dialogs.proxyLookingUp"), {
            size: "sm",
            color: "light",
        });
        const busyPanel = createPanelElement(
            { direction: "row", gap: "md", align: "center" },
            [spinnerView.root, busyText],
        );
        const ipValue = createTextElement("");
        const locationValue = createTextElement("");
        const orgValue = createTextElement("");
        const torValue = createTextElement("");
        const torRow = createPanelElement(
            { direction: "row", gap: "md", align: "baseline" },
            [
                createPanelElement({ width: 130, shrink: false }, [
                    createTextElement(t("dialogs.torExitingThrough"), { size: "sm", color: "light" }),
                ]),
                torValue,
            ],
        );
        torRow.hidden = !isTor;
        const orgRow = createPanelElement(
            { direction: "row", gap: "md", align: "baseline" },
            [
                createPanelElement({ width: 130, shrink: false }, [
                    createTextElement(isTor ? t("dialogs.torExitNode") : t("dialogs.proxyNetwork"), { size: "sm", color: "light" }),
                ]),
                orgValue,
            ],
        );
        const proxyRow = createPanelElement(
            { direction: "row", gap: "md", align: "baseline" },
            [
                createPanelElement({ width: 130, shrink: false }, [
                    createTextElement(t("dialogs.proxyLabel"), { size: "sm", color: "light" }),
                ]),
                createTextElement(proxyLabel),
            ],
        );
        proxyRow.hidden = isTor;
        const infoPanel = createPanelElement(
            { direction: "column", gap: "sm" },
            [
                proxyRow,
                createPanelElement(
                    { direction: "row", gap: "md", align: "baseline" },
                    [
                        createPanelElement({ width: 130, shrink: false }, [
                            createTextElement(t("dialogs.ipAddressLabel"), { size: "sm", color: "light" }),
                        ]),
                        ipValue,
                    ],
                ),
                createPanelElement(
                    { direction: "row", gap: "md", align: "baseline" },
                    [
                        createPanelElement({ width: 130, shrink: false }, [
                            createTextElement(t("dialogs.locationLabel"), { size: "sm", color: "light" }),
                        ]),
                        locationValue,
                    ],
                ),
                orgRow,
                torRow,
            ],
        );
        const errorElement = createTextElement("", { size: "sm", color: "error" });
        const warningElement = createTextElement(
            t("dialogs.torCheckWarning"),
            { size: "sm", color: "warning" },
        );
        const noteElement = createTextElement("", { size: "sm", color: "light" });
        const geoElement = createTextElement("", { size: "xs", color: "light" });
        const explanationElement = createTextElement(
            t("dialogs.torReconnectExplanation"),
            { size: "xs", color: "light" },
        );
        explanationElement.hidden = !isTor;
        const bodyPanel = createPanelElement(
            { direction: "column", gap: "md", paddingX: "xxl", paddingY: "xl" },
            [busyPanel, infoPanel, errorElement, warningElement, noteElement, geoElement, explanationElement],
        );
        const reconnectButton = new ButtonView({
            variant: "primary",
            disabled: true,
            hidden: !isTor,
            onClick: () => { void model.reconnect(); },
            children: t("dialogs.torReconnect"),
        });
        const closeButton = new ButtonView({
            onClick: () => { void model.close(undefined); },
            children: t("dialogs.torClose"),
        });
        const buttonsPanel = createPanelElement(
            { direction: "row", justify: "end", gap: "sm", padding: "md" },
            [closeButton.root, reconnectButton.root],
        );
        const contentChildren = document.createDocumentFragment();
        contentChildren.append(bodyPanel, buttonsPanel);
        const icon = isTor ? TorIcon.createElement() : GlobeIcon.createElement();
        const contentView = new DialogContentView({
            title: isTor ? t("dialogs.torTitle") : t("dialogs.proxyTitle"),
            icon,
            onClose: () => { void model.close(undefined); },
            minWidth: 460,
            maxWidth: 620,
            children: contentChildren,
        });
        const dialogView = new DialogView({
            name: "tor-info-dialog",
            onEscape: () => { void model.close(undefined); },
            children: contentView.root,
        });

        super(props, dialogView.root);
        this.model = model;
        this.isTor = isTor;
        this.dialogView = this.child(dialogView);
        this.contentView = this.child(contentView);
        this.spinnerView = this.child(spinnerView);
        this.reconnectButton = this.child(reconnectButton);
        this.closeButton = this.child(closeButton);
        this.busyPanel = busyPanel;
        this.busyText = busyText;
        this.infoPanel = infoPanel;
        this.ipValue = ipValue;
        this.locationValue = locationValue;
        this.orgRow = orgRow;
        this.orgValue = orgValue;
        this.torValue = torValue;
        this.errorElement = errorElement;
        this.warningElement = warningElement;
        this.noteElement = noteElement;
        this.geoElement = geoElement;
        this.own(model.disposeView);
    }

    protected onMount(): void {
        this.spinnerView.mount();
        this.closeButton.mount();
        this.reconnectButton.mount();
        this.contentView.mount();
        this.dialogView.mount();
        this.bind(this.model.state, (state) => JSON.stringify(state), () => this.syncState());
        this.syncState();
    }

    private syncState(): void {
        const state = this.model.state.get();
        const busy = state.loading || state.reconnecting;
        const info = state.info;
        this.busyPanel.hidden = !busy;
        this.busyText.textContent = state.reconnecting
            ? t("dialogs.torRestarting")
            : this.isTor
                ? t("dialogs.torLookingUp")
                : t("dialogs.proxyLookingUp");
        this.infoPanel.hidden = busy || !info;
        if (info) {
            this.ipValue.textContent = info.ip || t("dialogs.torUnknownValue");
            this.locationValue.textContent = formatLocation(info);
            this.orgValue.textContent = info.org ?? "";
            this.orgRow.hidden = !info.org;
            this.torValue.textContent = info.isTor === null
                ? t("dialogs.torVerificationUnavailable")
                : info.isTor ? t("dialogs.torYes") : t("dialogs.torNo");
        }
        this.errorElement.hidden = busy || !info?.error;
        this.errorElement.textContent = info?.error ?? "";
        this.warningElement.hidden = busy || info?.isTor !== false;
        this.noteElement.hidden = !state.note;
        this.noteElement.textContent = state.note === "tor-reconnect-failed"
            ? t("dialogs.torReconnectFailed")
            : state.note === "tor-reconnected-lookup-failed"
                ? t("dialogs.torReconnectedLookupFailed")
                : state.note === "tor-same-exit-node"
                    ? t("dialogs.torSameExitNode")
                    : state.note === "tor-new-exit-node"
                        ? t("dialogs.torNewExitNode")
                        : state.note;
        this.geoElement.hidden = busy || !info?.geoSource;
        this.geoElement.textContent = info?.geoSource
            ? t("dialogs.torGeoSource", { source: info.geoSource, route: this.isTor ? t("dialogs.torRoute") : t("dialogs.proxyRoute") })
            : "";
        this.reconnectButton.update({
            variant: "primary",
            disabled: busy,
            hidden: !this.isTor,
            onClick: () => { void this.model.reconnect(); },
            children: t("dialogs.torReconnect"),
        });
    }
}
