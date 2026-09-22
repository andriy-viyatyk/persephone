import { pagesModel } from "../../../api/pages";
import { ui } from "../../../api/ui";
import type { BrowserProfile } from "../../../api/settings";
import type { ISettings } from "../../../api/types/settings";
import { createElements } from "ai-vision/dom";
import type { IAiElementDeclaration, IAiMember, IAiVisionDescriptor } from "ai-vision";
import { SETTINGS_CATALOG, type SettingsCatalogRow, type SettingsCatalogSection } from "../../../editors/settings/settings-catalog";

function createSettingsElements(catalog: readonly SettingsCatalogSection[]): readonly IAiElementDeclaration[] {
    return [
        ...catalog.flatMap((section) =>
            section.rows.map((row: SettingsCatalogRow) => ({
            name: row.key,
            purpose: `${row.label}: ${row.purpose}`,
            selector: `[data-name="${section.elementName}"]`,
            where: row.where ?? section.where,
            })),
        ),
        { name: "settings-view-file", purpose: "Open the Settings file in an editor.", where: "bottom of Settings content" },
    ];
}

const SETTINGS_ELEMENTS = createSettingsElements(SETTINGS_CATALOG);

const SETTINGS_NO_ROW_ERRORS: Readonly<Record<string, string>> = {
    "tab-recent-languages": "Setting \"tab-recent-languages\" is a real setting, but it has no row on the Settings page. Use settings.get(\"tab-recent-languages\") or settings.set(\"tab-recent-languages\", value); it is owned by each page tab's language menu.",
    "search-max-file-size": "Setting \"search-max-file-size\" is a real setting, but it has no row on the Settings page. Use settings.get(\"search-max-file-size\") or settings.set(\"search-max-file-size\", value); it is owned by File Search behavior.",
    "pinned-editors": "Setting \"pinned-editors\" is a real setting, but it has no row on the Settings page. Use settings.get(\"pinned-editors\") or settings.set(\"pinned-editors\", value); it is owned by the + new-page menu.",
    "visualizer-effect": "Setting \"visualizer-effect\" is a real setting, but it has no row on the Settings page. Use settings.get(\"visualizer-effect\") or settings.set(\"visualizer-effect\", value); it is owned by the audio visualizer in the Video Player.",
    "audio-shuffle": "Setting \"audio-shuffle\" is a real setting, but it has no row on the Settings page. Use settings.get(\"audio-shuffle\") or settings.set(\"audio-shuffle\", value); it is owned by the Shuffle control in the Video Player.",
};

/**
 * Keys an agent may not switch off through `call`, because doing so severs the very channel the
 * call arrived on — and nothing on the far side can switch them back. Found by US-1307's acceptance
 * run: asked only WHERE the MCP server is turned off, the test agent highlighted the right control
 * and then set `mcp.enabled` to false, disconnecting itself. Recovery needed a hand-edit of
 * appSettings.json, which no agent can reach once its transport is gone.
 *
 * This is a one-way door, so it is refused rather than cautioned. `app.settings.set` is untouched:
 * the user's own scripts, and the Settings page itself, still turn these off normally.
 */
const SELF_SEVERING_KEYS: Readonly<Record<string, string>> = {
    "mcp.enabled": "the MCP server you are calling through",
    "mcp.port": "the MCP server's port, which drops your connection",
};

function getOwnRecordValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

const SETTINGS_PAGE_ROOT_SELECTOR = '[data-name="settings-root"]';
const SETTINGS_HIGHLIGHT_ATTEMPTS = 120;

function hasOnScreenBox(element: HTMLElement): boolean {
    const rectangle = element.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.height > 0 && element.offsetParent !== null;
}

function waitForSettingsSection(selector: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = (): void => {
            attempts += 1;
            const settingsRoot = document.querySelector<HTMLElement>(SETTINGS_PAGE_ROOT_SELECTOR);
            const section = document.querySelector<HTMLElement>(selector);
            if (!settingsRoot) {
                if (attempts >= SETTINGS_HIGHLIGHT_ATTEMPTS) {
                    reject(new Error("Settings page did not mount in time."));
                    return;
                }
                requestAnimationFrame(check);
                return;
            }
            if (section && hasOnScreenBox(section)) {
                resolve();
                return;
            }
            if (attempts >= SETTINGS_HIGHLIGHT_ATTEMPTS) {
                reject(new Error("the section for this key is not on screen."));
                return;
            }
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

const highlightSettingsElement = async (selector: string, message?: string) => {
    await pagesModel.showSettingsPage();
    await waitForSettingsSection(selector);
    const result = await ui.highlightElement(selector, message);
    if (!result.found) {
        throw new Error(`The Settings section selector ${JSON.stringify(selector)} was not found by the highlighter.`);
    }
    return result;
};

const settingsElements = createElements(SETTINGS_ELEMENTS, highlightSettingsElement, {
    itemLabel: "setting key",
    validNamesLabel: "Valid setting keys",
    unknownNameError: (name) => getOwnRecordValue(SETTINGS_NO_ROW_ERRORS, name),
});

const SETTINGS_MEMBERS: readonly IAiMember[] = [
    { name: "theme", kind: "property", summary: "Current theme name; readonly." },
    { name: "get", kind: "method", signature: "get<T = any>(key: string)", summary: "Read a setting; unknown keys return undefined." },
    { name: "set", kind: "method", signature: "set<T = any>(key: string, value: T)", summary: "Persist a setting automatically after a debounce. Asking WHERE a setting is changed is not asking to change it — for that, use settings.highlight(key) and leave the value alone.", caution: "changes application configuration and may actuate services through onChanged; a few keys are refused here because they would disconnect you" },
    { name: "onChanged", kind: "property", summary: "Change notification event; the event object is not an AiVision node." },
    { name: "browserProfiles", kind: "property", summary: "Configured browser profile names; readonly projection of the browser-profiles setting." },
    { name: "defaultBrowserProfile", kind: "property", summary: "Configured default browser profile name; an empty string selects the built-in default." },
    { name: "sections", kind: "property", summary: "The Settings page's grouped sections and hand-written setting-key rows." },
    ...settingsElements.members,
];

export function describeSettings(instance: unknown): IAiVisionDescriptor {
    const settings = instance as ISettings;
    return {
        kind: "Settings",
        summary: "Read and persist application configuration with change notifications.",
        members: SETTINGS_MEMBERS,
        elements: SETTINGS_ELEMENTS,
        provide: (name) => {
            if (name === "sections") return { value: SETTINGS_CATALOG };
            if (name === "set") {
                return {
                    value: (key: string, value: unknown): void => {
                        const what = getOwnRecordValue(SELF_SEVERING_KEYS, key);
                        if (what && (value === false || typeof value === "number")) {
                            throw new Error(
                                `Refusing to change ${JSON.stringify(key)} from here: it controls ${what},`
                                + " and once it is gone you cannot undo this. If the user asked WHERE this is"
                                + ` changed, show them instead with settings.highlight(${JSON.stringify(key)}).`
                                + " If they genuinely want it off, ask them to do it on the Settings page.",
                            );
                        }
                        settings.set(key, value);
                    },
                };
            }
            if (name === "browserProfiles") {
                return { value: settings.get<BrowserProfile[]>("browser-profiles").map((profile) => profile.name) };
            }
            if (name === "defaultBrowserProfile") {
                return { value: settings.get<string>("browser-default-profile") };
            }
            return settingsElements.provide(name);
        },
        help: `The Settings page exposes a grouped section catalog and generated setting-row elements. Read sections to find the hand-written setting-key catalog, and use highlight(key) to open or activate Settings and point at a supported key's section. highlight points and returns; to point and wait for the user, pass the selector from settings.elements to ui.guide.step. The five real settings without a Settings-page row remain available through get/set. browserProfiles and defaultBrowserProfile are convenient read-only projections for choosing browser profiles. Use set only when you intend to persist an application change.`,
        summarize: () => ({ kind: "Settings", theme: settings.theme }),
    };
}
