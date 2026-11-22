export interface SiteExtensionCreateOptions {
    name: string;
    hosts: string[];
    fetchHosts?: string[];
    description?: string;
}

export interface SiteExtensionCreateResult {
    id: string;
    folder: string;
    manifestPath: string;
    scriptPath: string;
    requiresTrust: true;
    message: string;
}

export interface SiteExtensionRemoveResult {
    /** Whether an extension folder was deleted. */
    removed: boolean;
    /** Whether an existing user trust grant was revoked. */
    revokedTrust: boolean;
}

export interface SiteExtensionAgentListing {
    id: string;
    name?: string;
    version?: string;
    hosts?: string[];
    fetchHosts?: string[];
    scriptPath?: string;
    status: "valid" | "invalid" | "conflict";
    reason?: string;
    conflictingHosts?: string[];
    trustState: "untrusted" | "trusted" | "disabled";
    hostsChangedSinceTrust: boolean | undefined;
}

export interface SiteExtensionReloadResult {
    status: "injected" | "waiting-for-user" | "disabled" | "no-extension" | "extension-error" | "not-current";
    registered: boolean;
    error?: string;
}

/**
 * Inspect and manage injected AiVision models for HTTPS sites.
 * Creating an extension writes files without granting trust. The agent may trust
 * extensions it built on the user's request; other extensions remain the user's decision
 * unless the agent reviews and trusts them when asked.
 *
 * @example
 * const created = await app.siteExtensions.create("example-site", {
 *     name: "Example Site", hosts: ["example.com"],
 * });
 * await app.fs.write(created.scriptPath, "// Replace the starter extension script.");
 * const result = await app.siteExtensions.reload(pageId);
 */
export interface ISiteExtensions {
    /** Effective site-extension root folder. Read-only; await the promise to get its path. */
    readonly folder: Promise<string>;
    /** List extension validation, conflict, and derived trust state. */
    list(): Promise<SiteExtensionAgentListing[]>;
    /** Scaffold an extension. Trust follows the extension's origin and explicit request context. */
    create(id: string, options: SiteExtensionCreateOptions): Promise<SiteExtensionCreateResult>;
    /** Re-inject the trusted extension into the browser page's current document. */
    reload(pageId: string): Promise<SiteExtensionReloadResult>;
    /** Ask before deleting extension files and revoking its trust grant. */
    remove(id: string): Promise<SiteExtensionRemoveResult>;
}

/** Metadata published by a trusted site extension. */
export interface SiteAction {
    id: string;
    label: string;
    icon?: "play" | "file-text" | "image" | "table" | "link";
    children?: SiteAction[];
}

/** An action definition in an extension script. Branches have children; leaves have run. */
export type SiteActionDefinition = Omit<SiteAction, "children"> & (
    | { children: SiteActionDefinition[]; run?: never }
    | { children?: never; run: () => SiteActionResult | Promise<SiteActionResult> }
);

export type SiteActionResult =
    | { kind: "video"; items: { label: string; url: string; headers?: { Referer?: string; Origin?: string } }[] }
    | { kind: "text"; title: string; format: "markdown" | "json" | "csv" | "plain"; content: string }
    | { kind: "url"; url: string }
    | { kind: "links"; title: string; items: { title: string; url: string }[] }
    | { kind: "message"; text: string };

/** Result of running an action or selecting a previously returned video choice. */
export type SiteActionOutcome =
    | { status: "opened" | "busy" | "not-current" }
    | { status: "message"; text: string }
    | { status: "error"; error: string }
    | { status: "choice-required"; token: string; choices: { label: string }[] };

/** Action publication provided by window.__persephoneSiteRuntime in an injected script. */
export interface SiteExtensionActionRuntime {
    readonly schemaVersion: number;
    setActions(items: SiteActionDefinition[]): void;
    /** Fetch cookieless HTTPS text from a separately trusted host. */
    fetchText(url: string): Promise<string>;
    /** Return an element as an ordinary browser automation ref. Main-document elements only. */
    ref(element: Element): { ref: string };
    /** Match the shared automation visibility rule: sized, displayed, and not hidden by visibility. */
    visible(element: Element): boolean;
    /** Synchronous accessible-name approximation; snapshots use Chromium's accessibility name instead. */
    accessibleName(element: Element): string;
    /** Set an input or textarea through its native value setter and synthetic input/change events. */
    setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void;
    /** Poll immediately, then every 100 ms by default, until truthy or the 5000 ms timeout. */
    waitFor<T>(predicate: () => T | Promise<T>, options?: { timeout?: number; interval?: number }): Promise<Awaited<T>>;
    /** Run after the reply has been produced; use allowNavigation if navigation still wins. */
    afterReturn(callback: () => void): void;
    onDispose(callback: () => void): void;
    dispose(): void;
}
