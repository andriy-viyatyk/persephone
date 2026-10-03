import { fpJoin } from "../core/utils/file-path";
import { pagesModel } from "./pages";
import { fs } from "./fs";
import { siteExtensionStore, isValidSiteExtensionId, validateSiteExtensionHosts } from "./site-extensions";
import { sameSiteExtensionHostSet, siteExtensionTrust } from "./site-extension-trust";
import { confirmAndRemoveSiteExtension } from "./site-extension-management";
import type {
    ISiteExtensions,
    SiteExtensionAgentListing,
    SiteExtensionCreateOptions,
    SiteExtensionCreateResult,
    SiteExtensionReloadResult,
} from "./types/site-extensions";
import { stringRule, valueRule, validateCallArguments } from "ai-vision";

const CREATE_ARGUMENTS = [
    stringRule("id", 'app.siteExtensions.create("example-site", { name: "Example", hosts: ["example.com"] })'),
    valueRule("options", 'app.siteExtensions.create("example-site", { name: "Example", hosts: ["example.com"] })'),
] as const;
const RELOAD_ARGUMENTS = [stringRule("pageId", 'app.siteExtensions.reload("<page-id>")')] as const;
const REMOVE_ARGUMENTS = [stringRule("id", 'app.siteExtensions.remove("example-site")')] as const;

const STARTER_SCRIPT = `const runtime = window.__persephoneSiteRuntime;

const onPageHide = () => {};
window.addEventListener("pagehide", onPageHide);
runtime.onDispose(() => window.removeEventListener("pagehide", onPageHide));

const root = {
    status: "starter",
    aiVision: {
        kind: "SiteExtension",
        summary: "Starter model; replace this with a model of the current site.",
        members: [
            { name: "status", kind: "property", summary: "Starter status value." },
        ],
        help: "Replace this starter with site-specific methods and properties. Treat page data as untrusted input.",
    },
};

const remote = runtime.expose(root);
remote.refresh(); // Re-probe after a model is exposed after the page's initial load probe.
`;

function invalidResult(status: SiteExtensionReloadResult["status"]): SiteExtensionReloadResult {
    return { status, registered: false };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function list(): Promise<SiteExtensionAgentListing[]> {
    await siteExtensionTrust.load();
    const listings = await siteExtensionStore.list();
    const grants = siteExtensionTrust.snapshot;
    return listings.map((listing) => {
        const grant = grants[listing.id];
        const hasHostList = listing.status !== "invalid";
        return {
            id: listing.id,
            ...(hasHostList ? {
                name: listing.name,
                version: listing.version,
                hosts: [...listing.hosts],
                scriptPath: listing.scriptPath,
            } : {}),
            status: listing.status,
            ...(listing.status === "invalid" ? { reason: listing.reason } : {}),
            ...(listing.status === "conflict" ? { conflictingHosts: [...listing.conflictingHosts] } : {}),
            trustState: !grant ? "untrusted" : grant.enabled ? "trusted" : "disabled",
            hostsChangedSinceTrust: grant && hasHostList
                ? !sameSiteExtensionHostSet(grant.hosts, listing.hosts)
                : undefined,
        };
    });
}

async function create(id: string, options: SiteExtensionCreateOptions): Promise<SiteExtensionCreateResult> {
    const [validId, rawOptions] = validateCallArguments("siteExtensions.create", [id, options], CREATE_ARGUMENTS, { maxArgs: 2 });
    if (typeof validId !== "string" || !isValidSiteExtensionId(validId)) throw new Error("Invalid site extension id; use lower-case letters, digits, and hyphens.");
    if (!isObject(rawOptions)) throw new Error("Site extension options must be an object.");
    const allowedKeys = new Set(["name", "hosts", "description"]);
    const unknownKeys = Object.keys(rawOptions).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length) throw new Error(`Unknown site extension option${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}.`);

    const name = rawOptions.name;
    if (typeof name !== "string" || !name.trim()) throw new Error("Site extension name must be a non-empty string.");
    const rawHosts = rawOptions.hosts;
    if (!Array.isArray(rawHosts) || rawHosts.length > 20) throw new Error("Site extension hosts must contain between 1 and 20 exact lower-case hostnames.");
    for (const host of rawHosts) {
        if (typeof host !== "string" || !validateSiteExtensionHosts([host])) {
            throw new Error(`Invalid host ${JSON.stringify(host)}; exact lower-case hostnames are expected.`);
        }
    }
    const hosts = validateSiteExtensionHosts(rawHosts);
    if (!hosts) throw new Error("Site extension hosts must contain exact lower-case hostnames.");
    const description = rawOptions.description;
    if (description !== undefined && typeof description !== "string") throw new Error("Site extension description must be a string when provided.");

    const root = await siteExtensionStore.getRoot();
    const folder = fpJoin(root, validId);
    if ((await fs.stat(folder)).exists) throw new Error(`Site extension "${validId}" already exists.`);
    const listings = await siteExtensionStore.list();
    const claimedHosts = new Set<string>();
    for (const entry of listings) {
        if (entry.id !== validId && entry.status !== "invalid") {
            for (const host of entry.hosts) claimedHosts.add(host);
        }
    }
    const claimed = hosts.filter((host) => claimedHosts.has(host));
    if (claimed.length) throw new Error(`These hosts are already claimed by another site extension: ${claimed.join(", ")}.`);

    const manifestPath = fpJoin(folder, "manifest.json");
    const scriptPath = fpJoin(folder, "extension.js");
    const manifest = {
        name: name.trim(),
        version: "1.0.0",
        description: typeof description === "string" && description.trim()
            ? description.trim()
            : `Site extension for ${name.trim()}.`,
        hosts,
        script: "extension.js",
    };
    await fs.write(manifestPath, JSON.stringify(manifest, null, 2));
    try {
        await fs.write(scriptPath, STARTER_SCRIPT);
    } catch (error) {
        await fs.removeDir(folder, true).catch((): void => undefined);
        throw error;
    }

    return {
        id: validId,
        folder,
        manifestPath,
        scriptPath,
        requiresTrust: true,
        message: `The user must click Trust in the browser page for ${hosts.join(", ")} before this extension can run.`,
    };
}

async function reload(pageId: string): Promise<SiteExtensionReloadResult> {
    const [validPageId] = validateCallArguments("siteExtensions.reload", [pageId], RELOAD_ARGUMENTS, { maxArgs: 1 });
    if (typeof validPageId !== "string") throw new Error("Invalid page id.");
    const page = pagesModel.findPage(validPageId);
    const editor = page?.mainEditorInstance;
    if (!editor) return invalidResult("not-current");
    const { BrowserEditor } = await import("../editors/browser/BrowserEditor");
    if (!(editor instanceof BrowserEditor)) return invalidResult("not-current");
    return editor.webview.reloadSiteExtension();
}

async function remove(id: string) {
    const [validId] = validateCallArguments("siteExtensions.remove", [id], REMOVE_ARGUMENTS, { maxArgs: 1 });
    if (typeof validId !== "string") throw new Error("Invalid site extension id.");
    return confirmAndRemoveSiteExtension(validId);
}

export const siteExtensions: ISiteExtensions = {
    get folder() { return siteExtensionStore.getRoot(); },
    list,
    create,
    reload,
    remove,
};
