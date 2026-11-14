import { settings } from "../../../api/settings";
import { settingRange, type AppSettingsKey, type BrowserProfile } from "../../../api/settings-schema";
import type { BrowserNetwork } from "../../../../ipc/browser-network-ipc";
import { createComponentModelDriver, type ComponentModelDriver } from "../../../core/state/model";
import { DEFAULT_BROWSER_COLOR, TAG_COLORS } from "../../../theme/palette-colors";
import { IncognitoIcon, TorIcon } from "../../../theme/language-icons";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { DotView } from "../../../uikit/Dot/DotView";
import { IconButtonView } from "../../../uikit/IconButton/IconButtonView";
import { InputView } from "../../../uikit/Input/InputView";
import { KeyedList } from "../../../uikit/shared/keyed-list";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { openMenu, type MenuHandle } from "../../../uikit/Menu/attach-menu";
import type { MenuItem } from "../../../uikit/Menu/types";
import { ProfileNetworkLineView } from "./ProfileNetworkLineView";
import { BrowserProfilesSectionModel, defaultBrowserProfilesSectionState, type BrowserProfilesSectionProps, type BrowserProfilesSectionState } from "./BrowserProfilesSectionModel";
import { browserProfiles } from "../../../api/browser-profiles";
import type { BrowserPermissionDecisionEntry } from "../../../../ipc/browser-ipc";
import { t } from "../../../../shared/i18n/t";
import { listBrowserTranslationTargets } from "../../../ui/translation/TranslationWorkflow";
import { PathField } from "../fields/PathField";
import { PortField } from "../fields/PortField";
import { CheckboxField } from "../fields/CheckboxField";
import { ChoiceField } from "../fields/ChoiceField";
import type { ChoiceFieldItem, ChoiceFieldProps } from "../fields/ChoiceField";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";

const PROFILE_COLOR_MESSAGE_KEYS: Record<string, Parameters<typeof t>[0]> = {
    "Dodger Blue": "browser.profileColorDodgerBlue",
    "Hot Pink": "browser.profileColorHotPink",
    Olive: "browser.profileColorOlive",
    "Medium Purple": "browser.profileColorMediumPurple",
    Orange: "browser.profileColorOrange",
    "Dark Khaki": "browser.profileColorDarkKhaki",
    "Deep Sky Blue": "browser.profileColorDeepSkyBlue",
    Tomato: "browser.profileColorTomato",
    "Lime Green": "browser.profileColorLimeGreen",
    "Cornflower Blue": "browser.profileColorCornflowerBlue",
    Sienna: "browser.profileColorSienna",
};

function profileColorLabel(name: string): string {
    const key = PROFILE_COLOR_MESSAGE_KEYS[name];
    return key ? t(key) : name;
}

function profileColorMenuId(name: string): string {
    return `profile-color-${name.toLowerCase().replace(/\s+/g, "-")}`;
}
import { createSectionRoot, helpIcon, panel, settingsFieldLabel, settingsLabel, text } from "./settings-native";
import "../../../uikit/Button/Button.css";
import "../../../uikit/Dot/Dot.css";
import "../../../uikit/IconButton/IconButton.css";
import "../../../uikit/Input/Input.css";
import "../../../uikit/Select/Select.css";

function groupPermissionDecisions(entries: BrowserPermissionDecisionEntry[]): Array<[string, BrowserPermissionDecisionEntry[]]> {
    const grouped = new Map<string, BrowserPermissionDecisionEntry[]>();
    for (const entry of entries) {
        const group = grouped.get(entry.origin) ?? [];
        group.push(entry);
        grouped.set(entry.origin, group);
    }
    return [...grouped.entries()];
}

function profileBookmarksStore(name: string): SettingsStore<string> {
    return {
        get: () => browserProfiles.list().find((profile) => profile.name === name)?.bookmarksFile ?? "",
        subscribe: (_id, callback) => settings.watch("browser-profiles", (profiles) => {
            callback(profiles.find((profile) => profile.name === name)?.bookmarksFile ?? "");
        }),
        set: (_id, value) => browserProfiles.setBookmarksFile(name, value || undefined),
    };
}

function createBookmarksField(config: {
    store: SettingsStore<string>;
    id: string;
    host: HTMLDivElement;
    browse: () => void | Promise<void>;
    clear: () => void | Promise<void>;
}): PathField {
    return new PathField({
        store: config.store,
        variant: "link-or-placeholder",
        id: config.id,
        title: t("settings.bookmarkFileLabel"),
        emptyText: t("settings.noBookmarksFile"),
        browse: config.browse,
        clear: config.clear,
        clearLabel: t("settings.removeBookmarksFile"),
        clearTitle: t("settings.removeBookmarksFile"),
        showPathTitle: true,
        host: config.host,
        leadingContent: (hasValue) => [
            ...(hasValue ? [settingsLabel(t("settings.bookmarkFileLabel"))] : []),
            settingsLabel("📁"),
        ],
        fallback: "",
        onError: (_operation, error) => { throw error; },
    });
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
            id: profileColorMenuId(tagColor.name),
            label: profileColorLabel(tagColor.name),
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
    private readonly bookmarks: PathField;
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
        this.bookmarks = this.child(createBookmarksField({
            store: profileBookmarksStore(props.profile.name),
            id: props.profile.name,
            host: panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" }),
            browse: () => props.model.handleBrowseProfileBookmarks(props.profile.name),
            clear: () => props.model.handleClearProfileBookmarks(props.profile.name),
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
        this.network.update(this.networkProps(props));
    }
}

interface TorProfileRowProps {
    model: BrowserProfilesSectionModel;
}

class TorProfileRowView extends VanillaView<TorProfileRowProps> {
    private exePanel: HTMLDivElement | undefined;
    private portField: PortField | undefined;
    private bookmarks: PathField | undefined;
    private exePath: PathField | undefined;

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
        const exeTarget = document.createElement("div");
        exeTarget.style.display = "contents";
        this.exePanel.append(settingsFieldLabel(t("settings.torExeLabel")), exeTarget);
        const exePath = this.child(new PathField({
            store: appSettingsStore as SettingsStore<string>,
            variant: "link-or-placeholder",
            id: "tor.exe-path",
            title: t("settings.torExeLabel"),
            emptyText: t("settings.notConfiguredValue"),
            browse: () => this.props.model.handleBrowseTorExe(),
            clear: this.props.model.handleClearTorExe,
            clearLabel: t("settings.removeTorExePath"),
            clearTitle: t("settings.removeTorExePath"),
            showPathTitle: true,
            host: exeTarget,
            fallback: "",
            onError: (_operation, error) => { throw error; },
        }));
        this.exePath = exePath;
        const portField = this.child(new PortField({
            store: appSettingsStore as SettingsStore<number>,
            id: "tor.socks-port",
            range: settingRange("tor.socks-port"),
            width: 56,
            fallback: settings.get("tor.socks-port"),
        }));
        this.portField = portField;
        const portPanel = panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" });
        portPanel.append(settingsFieldLabel(t("settings.portLabel")), portField.root);
        this.root.append(portPanel);
        const bookmarks = this.child(createBookmarksField({
            store: appSettingsStore as SettingsStore<string>,
            id: "tor.bookmarks-file",
            host: panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" }),
            browse: () => this.props.model.handleBrowseTorBookmarks(),
            clear: this.props.model.handleClearTorBookmarks,
        }));
        this.bookmarks = bookmarks;
        this.root.append(bookmarks.root);
        exePath.mount();
        portField.mount();
        bookmarks.mount();
    }

    protected onDispose(): void {
        this.exePanel = undefined;
        this.portField = undefined;
        this.bookmarks = undefined;
        this.exePath = undefined;
    }
}

export class BrowserProfilesSectionView extends VanillaView<Record<string, never>> {
    private driver: ComponentModelDriver<BrowserProfilesSectionState, BrowserProfilesSectionProps, BrowserProfilesSectionModel> | undefined;
    private model: BrowserProfilesSectionModel | undefined;
    private profilesList: KeyedList<BrowserProfile, string, HTMLElement> | undefined;
    private profileListHost: HTMLDivElement | undefined;
    private defaultHeader: ProfileHeaderView | undefined;
    private defaultBookmarks: PathField | undefined;
    private defaultNetwork: ProfileNetworkLineView | undefined;
    private incognitoBookmarks: PathField | undefined;
    private incognitoNetwork: ProfileNetworkLineView | undefined;
    private torRow: TorProfileRowView | undefined;
    private newNameInput: InputView | undefined;
    private addButton: ButtonView | undefined;
    private colorDots: DotView[] = [];
    private windowsSso: CheckboxField | undefined;
    private translateTarget: ChoiceField<string> | undefined;
    private translationTargets: ChoiceFieldItem<string>[] = [{ value: "app", label: t("translation.appLanguage") }];

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
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
        );
        const profilePanel = panel({ direction: "column", gap: "sm", paddingBottom: "lg" });
        this.translateTarget = this.child(new ChoiceField({
            store: appSettingsStore as SettingsStore<string>,
            id: "browser-translate-target",
            name: "browser-translate-target",
            size: "sm",
            items: this.translationTargets,
            fallbackToFirst: true,
        }));
        const translateTargetRow = panel({ direction: "row", align: "center", gap: "md", paddingTop: "sm", paddingBottom: "sm" },
            panel({ flex: true }, settingsFieldLabel(t("translation.targetSetting"))),
            panel({ width: 220 }, this.translateTarget.root),
        );
        profilePanel.append(translateTargetRow);
        this.translateTarget.mount();
        const defaultPanel = panel({ direction: "column", rounded: "sm", background: "dark" });
        this.defaultHeader = this.child(new ProfileHeaderView({ name: "", color: DEFAULT_BROWSER_COLOR, isDefault: model.props.defaultProfile === "", cleared: false, model }));
        this.defaultBookmarks = this.child(createBookmarksField({
            store: appSettingsStore as SettingsStore<string>,
            id: "browser-default-bookmarks-file",
            host: panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" }),
            browse: () => model.handleBrowseDefaultBookmarks(),
            clear: () => settings.set("browser-default-bookmarks-file", ""),
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
        this.incognitoBookmarks = this.child(createBookmarksField({
            store: appSettingsStore as SettingsStore<string>,
            id: "browser-incognito-bookmarks-file",
            host: panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" }),
            browse: () => model.handleBrowseIncognitoBookmarks(),
            clear: () => settings.set("browser-incognito-bookmarks-file", ""),
        }));
        this.incognitoNetwork = this.child(new ProfileNetworkLineView({ network: settings.get("browser-incognito-network"), onChange: model.handleIncognitoNetworkChange }));
        incognitoPanel.append(this.incognitoBookmarks.root, this.incognitoNetwork.root);
        this.incognitoBookmarks.mount();
        this.incognitoNetwork.mount();
        profilePanel.append(incognitoPanel);

        this.torRow = this.child(new TorProfileRowView({ model }));
        profilePanel.append(this.torRow.root);
        this.torRow.mount();
        this.root.append(profilePanel);
        void this.refreshTranslationTargets();

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
            const dot = this.child(new DotView({ size: "lg", color: tagColor.hex, selected: model.state.get().newColor === tagColor.hex, title: profileColorLabel(tagColor.name), onClick: () => model.setNewColor(tagColor.hex) }));
            this.colorDots.push(dot);
            colorPanel.append(dot.root);
            dot.mount();
        });
        addPanel.append(colorPanel);
        this.root.append(addPanel);

        const ssoPanel = panel({ direction: "row", align: "center", paddingTop: "lg" });
        this.windowsSso = this.child(new CheckboxField({
            store: appSettingsStore as SettingsStore<boolean>,
            id: "browser-windows-sso",
            label: t("settings.allowWindowsSso"),
        }));
        ssoPanel.append(
            this.windowsSso.root,
            helpIcon(t("settings.allowWindowsSso"), t("settings.windowsSsoExplanation"), (cleanup) => this.own(cleanup)).root,
        );
        this.windowsSso.mount();
        this.root.append(ssoPanel);

        driver.mount();

        const refresh = (key: AppSettingsKey): void => {
            if (this.isRelevantSetting(key)) {
                driver.update(this.currentProps());
                this.sync(model.state.get());
            }
        };
        const settingsKeys = [
            "browser-profiles", "browser-default-profile", "browser-default-network", "browser-incognito-network",
        ] as const satisfies readonly AppSettingsKey[];
        for (const key of settingsKeys) this.own(settings.watch(key, () => refresh(key)));
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
        this.translateTarget = undefined;
        this.newNameInput = undefined;
        this.addButton = undefined;
        this.colorDots = [];
    }

    private currentProps(): BrowserProfilesSectionProps {
        return {
            profiles: browserProfiles.list(),
            defaultProfile: settings.get("browser-default-profile"),
        };
    }

    private isRelevantSetting(key: string): boolean {
        return ["browser-profiles", "browser-default-profile", "browser-default-network", "browser-incognito-network"].includes(key);
    }

    private sync(state: BrowserProfilesSectionState): void {
        const model = this.model;
        if (!model) return;
        this.defaultHeader?.update({ name: "", color: DEFAULT_BROWSER_COLOR, isDefault: model.props.defaultProfile === "", cleared: state.clearedProfile === "", model });
        this.defaultNetwork?.update({ network: settings.get("browser-default-network"), onChange: model.handleDefaultNetworkChange });
        this.incognitoNetwork?.update({ network: settings.get("browser-incognito-network"), onChange: model.handleIncognitoNetworkChange });
        this.profilesList?.update(model.props.profiles);
        this.newNameInput?.update({ size: "sm", placeholder: t("settings.profileNamePlaceholder"), value: state.newName, onChange: model.setNewName, onKeyDown: model.handleKeyDown });
        this.addButton?.update({ variant: "default", size: "sm", background: "light", disabled: !model.canAdd, onClick: model.handleAddProfile, children: t("settings.profileAdd") });
        this.colorDots.forEach((dot, index) => dot.update({ size: "lg", color: TAG_COLORS[index].hex, selected: state.newColor === TAG_COLORS[index].hex, title: profileColorLabel(TAG_COLORS[index].name), onClick: () => model.setNewColor(TAG_COLORS[index].hex) }));
    }

    private translateTargetProps(): ChoiceFieldProps<string> {
        return {
            store: appSettingsStore as SettingsStore<string>,
            id: "browser-translate-target",
            name: "browser-translate-target",
            size: "sm",
            items: this.translationTargets,
            fallbackToFirst: true,
        };
    }

    private async refreshTranslationTargets(): Promise<void> {
        this.translationTargets = await listBrowserTranslationTargets();
        this.translateTarget?.update(this.translateTargetProps());
    }
}
