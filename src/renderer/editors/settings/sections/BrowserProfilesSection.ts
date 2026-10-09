import { settings, type BrowserProfile } from "../../../api/settings";
import type { BrowserNetwork } from "../../../../ipc/browser-network-ipc";
import { fpBasename } from "../../../core/utils/file-path";
import { createComponentModelDriver, type ComponentModelDriver } from "../../../core/state/model";
import { DEFAULT_BROWSER_COLOR, TAG_COLORS } from "../../../theme/palette-colors";
import { IncognitoIcon, TorIcon } from "../../../theme/language-icons";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import type { CheckboxProps } from "../../../uikit/Checkbox/CheckboxView";
import { DotView } from "../../../uikit/Dot/DotView";
import { IconButtonView } from "../../../uikit/IconButton/IconButtonView";
import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { KeyedList } from "../../../uikit/shared/keyed-list";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { openMenu, type MenuHandle } from "../../../uikit/Menu/attach-menu";
import type { MenuItem } from "../../../uikit/Menu/types";
import { ProfileNetworkLineView } from "./ProfileNetworkLineView";
import { BrowserProfilesSectionModel, defaultBrowserProfilesSectionState, type BrowserProfilesSectionProps, type BrowserProfilesSectionState } from "./BrowserProfilesSectionModel";
import type { BrowserPermissionDecisionEntry } from "../../../../ipc/browser-ipc";
import { t } from "../../../../shared/i18n/t";
import { createSectionRoot, panel, settingsFieldLabel, settingsLabel, settingsLink, settingsPlaceholder, text } from "./settings-native";
import "../../../uikit/Button/Button.css";
import "../../../uikit/Checkbox/Checkbox.css";
import "../../../uikit/Dot/Dot.css";
import "../../../uikit/IconButton/IconButton.css";
import "../../../uikit/Input/Input.css";

interface BookmarksFileLineProps {
    filePath: string;
    onBrowse: () => void;
    onClear: () => void;
}

function groupPermissionDecisions(entries: BrowserPermissionDecisionEntry[]): Array<[string, BrowserPermissionDecisionEntry[]]> {
    const grouped = new Map<string, BrowserPermissionDecisionEntry[]>();
    for (const entry of entries) {
        const group = grouped.get(entry.origin) ?? [];
        group.push(entry);
        grouped.set(entry.origin, group);
    }
    return [...grouped.entries()];
}

class BookmarksFileLineView extends VanillaView<BookmarksFileLineProps> {
    private clearButton: IconButtonView | undefined;

    public constructor(props: BookmarksFileLineProps) {
        super(props, panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" }));
    }

    protected onMount(): void {
        this.listen(this.root, "click", this.onBrowseClick);
        this.renderLine(this.props);
    }

    protected onUpdate(props: BookmarksFileLineProps): void {
        this.renderLine(props);
    }

    protected onDispose(): void {
        this.clearButton = undefined;
    }

    private renderLine(props: BookmarksFileLineProps): void {
        if (this.clearButton) {
            this.releaseChild(this.clearButton);
            this.clearButton = undefined;
        }
        this.root.replaceChildren();
        const filename = props.filePath ? fpBasename(props.filePath) : "";
        if (filename) this.root.append(settingsLabel(t("settings.bookmarkFileLabel")));
        this.root.append(settingsLabel("📁"));
        if (filename) {
            const link = settingsLink(filename);
            link.title = props.filePath;
            this.root.append(link);
            this.clearButton = this.child(new IconButtonView({
                size: "sm", icon: "close", title: t("settings.removeBookmarksFile"), onClick: props.onClear,
            }));
            this.root.append(this.clearButton.root);
            this.clearButton.mount();
        } else {
            const placeholder = settingsPlaceholder(t("settings.noBookmarksFile"));
            this.root.append(placeholder);
        }
    }

    private readonly onBrowseClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest('[data-type="settings-link"], [data-type="settings-placeholder"]')) return;
        this.props.onBrowse();
    };
}

interface ProfileHeaderProps {
    name: string;
    color: string;
    isDefault: boolean;
    cleared: boolean;
    model: BrowserProfilesSectionModel;
}

class ProfileHeaderView extends VanillaView<ProfileHeaderProps> {
    private readonly header: HTMLDivElement;
    private menuHandle: MenuHandle | undefined;
    private colorDot: DotView | undefined;
    private defaultButton: ButtonView | undefined;
    private clearButton: ButtonView | undefined;
    private permissionsButton: ButtonView | undefined;
    private removeButton: IconButtonView | undefined;

    public constructor(props: ProfileHeaderProps) {
        const header = panel({ direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs" });
        super(props, header);
        this.header = header;
    }

    protected onMount(): void {
        this.renderHeader(this.props);
    }

    protected onUpdate(props: ProfileHeaderProps): void {
        this.renderHeader(props);
    }

    protected onDispose(): void {
        this.menuHandle?.dispose();
        this.menuHandle = undefined;
        this.colorDot = undefined;
        this.defaultButton = undefined;
        this.clearButton = undefined;
        this.permissionsButton = undefined;
        this.removeButton = undefined;
    }

    private renderHeader(props: ProfileHeaderProps): void {
        this.menuHandle?.dispose();
        this.menuHandle = undefined;
        [this.colorDot, this.defaultButton, this.clearButton, this.permissionsButton, this.removeButton].forEach((view) => {
            if (view) this.releaseChild(view);
        });
        this.colorDot = undefined;
        this.defaultButton = undefined;
        this.clearButton = undefined;
        this.permissionsButton = undefined;
        this.removeButton = undefined;
        this.header.replaceChildren();

        const colorDot = this.child(new DotView({
            size: "md", color: props.color, bordered: true, onClick: props.name
                ? (event) => this.openColorMenu(event.currentTarget as Element)
                : undefined,
            title: props.name ? t("settings.changeColor") : undefined,
        }));
        this.colorDot = colorDot;
        this.header.append(colorDot.root);
        colorDot.mount();
        const namePanel = panel({ flex: true });
        namePanel.append(text(props.name || t("settings.defaultProfile"), { size: "sm" }));
        this.header.append(namePanel);
        if (props.isDefault) {
            this.header.append(this.badge(t("settings.defaultBadge")));
        } else {
            this.defaultButton = this.child(new ButtonView({
                variant: "ghost", size: "sm", background: "light", onClick: () => props.model.handleSetDefault(props.name), children: t("settings.setDefault"),
            }));
            this.header.append(this.defaultButton.root);
            this.defaultButton.mount();
        }
        if (props.cleared) this.header.append(text(t("settings.profileCleared"), { color: "success", size: "xs" }));
        this.clearButton = this.child(new ButtonView({
            variant: "ghost", size: "sm", background: "light", onClick: () => void props.model.handleClearData(props.name), children: t("settings.clearData"),
        }));
        this.header.append(this.clearButton.root);
        this.clearButton.mount();
        const permissionsButton: ButtonView = this.child(new ButtonView({
            name: "browser-profile-permissions", variant: "ghost", size: "sm", background: "light",
            onClick: (): void => { void this.openPermissionsMenu(permissionsButton.root); }, children: t("settings.sitePermissions"),
        }));
        this.permissionsButton = permissionsButton;
        this.header.append(permissionsButton.root);
        permissionsButton.mount();
        if (props.name) {
            this.removeButton = this.child(new IconButtonView({
                size: "sm", icon: "close", title: t("settings.removeProfile"), onClick: () => void props.model.handleRemoveProfile(props.name),
            }));
            this.header.append(this.removeButton.root);
            this.removeButton.mount();
        }
    }

    private badge(value: string): HTMLSpanElement {
        const badge = document.createElement("span");
        badge.dataset.type = "settings-badge";
        badge.textContent = value;
        return badge;
    }

    private openColorMenu(anchor: Element): void {
        const profileName = this.props.name;
        const items: MenuItem[] = TAG_COLORS.map((tagColor) => ({
            label: tagColor.name,
            icon: this.createTagColorIcon(tagColor.hex),
            selected: this.props.color === tagColor.hex,
            onClick: () => this.props.model.handleColorChange(profileName, tagColor.hex),
        }));
        this.menuHandle?.dispose();
        this.menuHandle = openMenu(anchor, {
            items,
            onClose: () => { this.menuHandle = undefined; },
        });
    }

    private async openPermissionsMenu(anchor: Element): Promise<void> {
        const decisions = await this.props.model.getPermissionDecisions(this.props.name);
        if (this.isDisposed) return;
        const items: MenuItem[] = decisions.length
            ? [
                { label: t("settings.revokeSitePermissions"), startGroup: true, onClick: () => void this.props.model.clearPermissionDecisions(this.props.name) },
                ...groupPermissionDecisions(decisions).map(([origin, entries]) => ({
                    label: origin,
                    items: entries.map((entry) => ({
                        label: t("settings.permissionDecision", { permission: entry.permission, decision: entry.decision }),
                        onClick: (): void => { void this.props.model.removePermissionDecision(this.props.name, entry); },
                    })),
                })),
            ]
            : [{ label: t("settings.noSavedSitePermissions"), disabled: true }];
        this.menuHandle?.dispose();
        this.menuHandle = openMenu(anchor, { items, onClose: () => { this.menuHandle = undefined; } });
    }

    private createTagColorIcon(tagColor: string): HTMLSpanElement {
        const icon = document.createElement("span");
        icon.dataset.type = "dot";
        icon.style.setProperty("--dot-size", "10px");
        icon.style.setProperty("--dot-color", tagColor);
        return icon;
    }
}

interface ProfileRowProps {
    profile: BrowserProfile;
    defaultProfile: string;
    clearedProfile: string | null;
    model: BrowserProfilesSectionModel;
}

class ProfileRowView extends VanillaView<ProfileRowProps> {
    private readonly header: ProfileHeaderView;
    private readonly bookmarks: BookmarksFileLineView;
    private readonly network: ProfileNetworkLineView;

    public constructor(props: ProfileRowProps) {
        const root = panel({ direction: "column", rounded: "sm", background: "dark" });
        super(props, root);
        this.header = this.child(new ProfileHeaderView({
            name: props.profile.name,
            color: props.profile.color,
            isDefault: props.defaultProfile === props.profile.name,
            cleared: props.clearedProfile === props.profile.name,
            model: props.model,
        }));
        this.bookmarks = this.child(new BookmarksFileLineView({
            filePath: props.profile.bookmarksFile || "",
            onBrowse: () => void props.model.handleBrowseProfileBookmarks(props.profile.name),
            onClear: () => props.model.handleClearProfileBookmarks(props.profile.name),
        }));
        this.network = this.child(new ProfileNetworkLineView(this.networkProps(props)));
    }

    protected onMount(): void {
        this.root.append(this.header.root, this.bookmarks.root, this.network.root);
        this.header.mount();
        this.bookmarks.mount();
        this.network.mount();
    }

    private networkProps(props: ProfileRowProps) {
        return { network: props.profile.network, onChange: (network: BrowserNetwork) => props.model.handleProfileNetworkChange(props.profile.name, network) };
    }

    protected onUpdate(props: ProfileRowProps): void {
        this.header.update({
            name: props.profile.name,
            color: props.profile.color,
            isDefault: props.defaultProfile === props.profile.name,
            cleared: props.clearedProfile === props.profile.name,
            model: props.model,
        });
        this.bookmarks.update({
            filePath: props.profile.bookmarksFile || "",
            onBrowse: () => void props.model.handleBrowseProfileBookmarks(props.profile.name),
            onClear: () => props.model.handleClearProfileBookmarks(props.profile.name),
        });
        this.network.update(this.networkProps(props));
    }
}

interface TorProfileRowProps {
    model: BrowserProfilesSectionModel;
    torPortValue: string | null;
}

class TorProfileRowView extends VanillaView<TorProfileRowProps> {
    private exePanel: HTMLDivElement | undefined;
    private portInput: InputView | undefined;
    private bookmarks: BookmarksFileLineView | undefined;
    private exeClearButton: IconButtonView | undefined;

    public constructor(props: TorProfileRowProps) {
        const root = panel({ direction: "column", rounded: "sm", background: "dark" });
        super(props, root);
    }

    protected onMount(): void {
        const header = panel({ direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs" });
        const icon = TorIcon.createElement({ width: 14, height: 14 });
        icon.style.flexShrink = "0";
        header.append(icon, panel({ flex: true }, text(t("settings.tor"), { size: "sm" })));
        this.root.append(header);
        this.exePanel = panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" });
        this.root.append(this.exePanel);
        this.listen(this.exePanel, "click", this.onExecutableClick);
        const portInput = this.child(new InputView(this.inputProps(this.props)));
        this.portInput = portInput;
        const portPanel = panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" });
        portPanel.append(settingsFieldLabel(t("settings.portLabel")), portInput.root);
        this.root.append(portPanel);
        const bookmarks = this.child(new BookmarksFileLineView({
            filePath: this.props.model.props.torBookmarksFile,
            onBrowse: () => void this.props.model.handleBrowseTorBookmarks(),
            onClear: this.props.model.handleClearTorBookmarks,
        }));
        this.bookmarks = bookmarks;
        this.root.append(bookmarks.root);
        portInput.mount();
        bookmarks.mount();
        this.renderExecutable(this.props);
    }

    protected onUpdate(props: TorProfileRowProps): void {
        this.renderExecutable(props);
        this.portInput?.update(this.inputProps(props));
        this.bookmarks?.update({
            filePath: props.model.props.torBookmarksFile,
            onBrowse: () => void props.model.handleBrowseTorBookmarks(),
            onClear: props.model.handleClearTorBookmarks,
        });
    }

    protected onDispose(): void {
        this.exeClearButton = undefined;
    }

    private renderExecutable(props: TorProfileRowProps): void {
        if (this.exeClearButton) {
            this.releaseChild(this.exeClearButton);
            this.exeClearButton = undefined;
        }
        this.exePanel?.replaceChildren(settingsFieldLabel(t("settings.torExeLabel")));
        const filePath = props.model.props.torExePath;
        const filename = filePath ? fpBasename(filePath) : "";
        const target = document.createElement("div");
        target.style.display = "contents";
        if (filename) {
            const link = settingsLink(filename);
            link.title = filePath;
            target.append(link);
            this.exeClearButton = this.child(new IconButtonView({ size: "sm", icon: "close", title: t("settings.removeTorExePath"), onClick: props.model.handleClearTorExe }));
            target.append(this.exeClearButton.root);
            this.exeClearButton.mount();
        } else {
            const placeholder = settingsPlaceholder(t("settings.notConfiguredValue"));
            target.append(placeholder);
        }
        this.exePanel?.append(target);
    }

    private readonly onExecutableClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest('[data-type="settings-link"], [data-type="settings-placeholder"]')) return;
        void this.props.model.handleBrowseTorExe();
    };

    private inputProps(props: TorProfileRowProps): InputProps {
        return {
            size: "sm", width: 56, type: "text",
            value: props.torPortValue ?? String(props.model.props.torSocksPort),
            onChange: props.model.setTorPortValue,
            onBlur: props.model.handleTorPortBlur,
            onKeyDown: (event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); },
        };
    }
}

export class BrowserProfilesSectionView extends VanillaView<Record<string, never>> {
    private driver: ComponentModelDriver<BrowserProfilesSectionState, BrowserProfilesSectionProps, BrowserProfilesSectionModel> | undefined;
    private model: BrowserProfilesSectionModel | undefined;
    private profilesList: KeyedList<BrowserProfile, string, HTMLElement> | undefined;
    private profileListHost: HTMLDivElement | undefined;
    private defaultHeader: ProfileHeaderView | undefined;
    private defaultBookmarks: BookmarksFileLineView | undefined;
    private defaultNetwork: ProfileNetworkLineView | undefined;
    private incognitoBookmarks: BookmarksFileLineView | undefined;
    private incognitoNetwork: ProfileNetworkLineView | undefined;
    private torRow: TorProfileRowView | undefined;
    private newNameInput: InputView | undefined;
    private addButton: ButtonView | undefined;
    private colorDots: DotView[] = [];
    private windowsSso: CheckboxView | undefined;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    private windowsSsoProps(): CheckboxProps {
        return {
            checked: settings.get("browser-windows-sso"),
            onChange: () => settings.set("browser-windows-sso", !settings.get("browser-windows-sso")),
            children: t("settings.allowWindowsSso"),
        };
    }

    protected onMount(): void {
        const driver = createComponentModelDriver(
            this.currentProps(),
            BrowserProfilesSectionModel,
            defaultBrowserProfilesSectionState,
        );
        this.driver = driver;
        const model = driver.model;
        this.model = model;
        this.own(() => driver.dispose());

        this.root.append(
            panel({ paddingBottom: "lg" }, text(t("settings.browserProfilesTitle"), { bold: true, size: "sm" })),
            panel({ paddingBottom: "md" }, text(t("settings.browserProfilesDescription"), { color: "light", size: "xs" })),
        );
        const profilePanel = panel({ direction: "column", gap: "sm", paddingBottom: "lg" });
        const defaultPanel = panel({ direction: "column", rounded: "sm", background: "dark" });
        this.defaultHeader = this.child(new ProfileHeaderView({ name: "", color: DEFAULT_BROWSER_COLOR, isDefault: model.props.defaultProfile === "", cleared: false, model }));
        this.defaultBookmarks = this.child(new BookmarksFileLineView({
            filePath: settings.get("browser-default-bookmarks-file"),
            onBrowse: () => void model.handleBrowseDefaultBookmarks(),
            onClear: () => settings.set("browser-default-bookmarks-file", ""),
        }));
        this.defaultNetwork = this.child(new ProfileNetworkLineView({ network: settings.get("browser-default-network"), onChange: model.handleDefaultNetworkChange }));
        defaultPanel.append(this.defaultHeader.root, this.defaultBookmarks.root, this.defaultNetwork.root);
        this.defaultHeader.mount();
        this.defaultBookmarks.mount();
        this.defaultNetwork.mount();
        profilePanel.append(defaultPanel);

        this.profileListHost = document.createElement("div");
        this.profileListHost.style.display = "contents";
        profilePanel.append(this.profileListHost);
        const rowViews = new Map<string, ProfileRowView>();
        this.profilesList = new KeyedList(this.profileListHost, {
            keyOf: (profile) => profile.name,
            create: (profile) => {
                const view = new ProfileRowView({ profile, defaultProfile: model.props.defaultProfile, clearedProfile: model.state.get().clearedProfile, model });
                rowViews.set(profile.name, view);
                view.mount();
                return view.root;
            },
            update: (_element, profile) => {
                rowViews.get(profile.name)?.update({ profile, defaultProfile: model.props.defaultProfile, clearedProfile: model.state.get().clearedProfile, model });
            },
            remove: (_element, profile) => {
                const view = rowViews.get(profile.name);
                rowViews.delete(profile.name);
                view?.dispose();
            },
        });
        this.own(() => this.profilesList?.dispose());

        const incognitoPanel = panel({ direction: "column", rounded: "sm", background: "dark" });
        const incognitoHeader = panel({ direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs" });
        const incognitoIcon = IncognitoIcon.createElement({ width: 14, height: 14 });
        incognitoIcon.style.flexShrink = "0";
        incognitoHeader.append(incognitoIcon, panel({ flex: true }, text(t("settings.incognito"), { size: "sm" })));
        incognitoPanel.append(incognitoHeader);
        this.incognitoBookmarks = this.child(new BookmarksFileLineView({
            filePath: settings.get("browser-incognito-bookmarks-file"),
            onBrowse: () => void model.handleBrowseIncognitoBookmarks(),
            onClear: () => settings.set("browser-incognito-bookmarks-file", ""),
        }));
        this.incognitoNetwork = this.child(new ProfileNetworkLineView({ network: settings.get("browser-incognito-network"), onChange: model.handleIncognitoNetworkChange }));
        incognitoPanel.append(this.incognitoBookmarks.root, this.incognitoNetwork.root);
        this.incognitoBookmarks.mount();
        this.incognitoNetwork.mount();
        profilePanel.append(incognitoPanel);

        this.torRow = this.child(new TorProfileRowView({ model, torPortValue: model.state.get().torPortValue }));
        profilePanel.append(this.torRow.root);
        this.torRow.mount();
        this.root.append(profilePanel);

        const addPanel = panel({ direction: "column", gap: "md" });
        const addRow = panel({ direction: "row", align: "center", gap: "md" });
        const namePanel = panel({ flex: true });
        this.newNameInput = this.child(new InputView({ size: "sm", placeholder: t("settings.profileNamePlaceholder"), value: model.state.get().newName, onChange: model.setNewName, onKeyDown: model.handleKeyDown }));
        namePanel.append(this.newNameInput.root);
        addRow.append(namePanel);
        this.addButton = this.child(new ButtonView({ variant: "default", size: "sm", background: "light", disabled: !model.canAdd, onClick: model.handleAddProfile, children: t("settings.profileAdd") }));
        addRow.append(this.addButton.root);
        this.newNameInput.mount();
        this.addButton.mount();
        addPanel.append(addRow, text(t("settings.profileColor"), { color: "light", size: "xs" }));
        const colorPanel = panel({ direction: "row", wrap: true, gap: "md" });
        TAG_COLORS.forEach((tagColor) => {
            const dot = this.child(new DotView({ size: "lg", color: tagColor.hex, selected: model.state.get().newColor === tagColor.hex, title: tagColor.name, onClick: () => model.setNewColor(tagColor.hex) }));
            this.colorDots.push(dot);
            colorPanel.append(dot.root);
            dot.mount();
        });
        addPanel.append(colorPanel);
        this.root.append(addPanel);

        const ssoPanel = panel({ direction: "column", gap: "xs", paddingTop: "lg" });
        this.windowsSso = this.child(new CheckboxView(this.windowsSsoProps()));
        ssoPanel.append(
            this.windowsSso.root,
            text(t("settings.windowsSsoExplanation"), { color: "light", size: "xs" }),
        );
        this.windowsSso.mount();
        this.root.append(ssoPanel);

        driver.mount();

        const subscription = settings.onChanged.subscribe(({ key }) => {
            if (key === "browser-windows-sso") this.windowsSso?.update(this.windowsSsoProps());
            if (this.isRelevantSetting(key)) {
                driver.update(this.currentProps());
                this.sync(model.state.get());
            }
        });
        this.own(subscription);
        this.profilesList.update(model.props.profiles);
        this.sync(model.state.get());
    }

    protected onDispose(): void {
        this.driver = undefined;
        this.model = undefined;
        this.profilesList = undefined;
        this.profileListHost = undefined;
        this.defaultHeader = undefined;
        this.defaultBookmarks = undefined;
        this.defaultNetwork = undefined;
        this.incognitoBookmarks = undefined;
        this.incognitoNetwork = undefined;
        this.torRow = undefined;
        this.windowsSso = undefined;
        this.newNameInput = undefined;
        this.addButton = undefined;
        this.colorDots = [];
    }

    private currentProps(): BrowserProfilesSectionProps {
        return {
            profiles: settings.get("browser-profiles"),
            defaultProfile: settings.get("browser-default-profile"),
            torExePath: settings.get("tor.exe-path"),
            torSocksPort: settings.get("tor.socks-port"),
            torBookmarksFile: settings.get("tor.bookmarks-file"),
        };
    }

    private isRelevantSetting(key: string): boolean {
        return [
            "browser-profiles", "browser-default-profile", "browser-default-bookmarks-file", "browser-default-network", "browser-incognito-network",
            "browser-incognito-bookmarks-file", "tor.exe-path", "tor.socks-port", "tor.bookmarks-file",
        ].includes(key);
    }

    private sync(state: BrowserProfilesSectionState): void {
        const model = this.model;
        if (!model) return;
        this.defaultHeader?.update({ name: "", color: DEFAULT_BROWSER_COLOR, isDefault: model.props.defaultProfile === "", cleared: state.clearedProfile === "", model });
        this.defaultBookmarks?.update({ filePath: settings.get("browser-default-bookmarks-file"), onBrowse: () => void model.handleBrowseDefaultBookmarks(), onClear: () => settings.set("browser-default-bookmarks-file", "") });
        this.defaultNetwork?.update({ network: settings.get("browser-default-network"), onChange: model.handleDefaultNetworkChange });
        this.incognitoNetwork?.update({ network: settings.get("browser-incognito-network"), onChange: model.handleIncognitoNetworkChange });
        this.incognitoBookmarks?.update({ filePath: settings.get("browser-incognito-bookmarks-file"), onBrowse: () => void model.handleBrowseIncognitoBookmarks(), onClear: () => settings.set("browser-incognito-bookmarks-file", "") });
        this.profilesList?.update(model.props.profiles);
        this.torRow?.update({ model, torPortValue: state.torPortValue });
        this.newNameInput?.update({ size: "sm", placeholder: t("settings.profileNamePlaceholder"), value: state.newName, onChange: model.setNewName, onKeyDown: model.handleKeyDown });
        this.addButton?.update({ variant: "default", size: "sm", background: "light", disabled: !model.canAdd, onClick: model.handleAddProfile, children: t("settings.profileAdd") });
        this.colorDots.forEach((dot, index) => dot.update({ size: "lg", color: TAG_COLORS[index].hex, selected: state.newColor === TAG_COLORS[index].hex, title: TAG_COLORS[index].name, onClick: () => model.setNewColor(TAG_COLORS[index].hex) }));
    }
}

export { BrowserProfilesSectionView as BrowserProfilesSection };
