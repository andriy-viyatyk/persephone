export type LanguageMessage = string | Partial<Record<"zero" | "one" | "two" | "few" | "many" | "other", string>>;

export interface LanguagePageOptions {
    offset?: number;
    limit?: number;
}

export interface LanguageSummary {
    code: string;
    name: string;
    englishName: string;
    completeness: number;
    builtIn: boolean;
    user: boolean;
    overridesBuiltIn: boolean;
}

export interface LanguageMetadata extends Omit<LanguageSummary, "completeness"> {
    counts: { user: number; builtIn: number; total: number };
}

export interface LanguageMessageEntry {
    key: string;
    message: LanguageMessage;
    from: "user" | "builtIn";
}

export interface LanguageMessagePage {
    area: string;
    total: number;
    offset: number;
    entries: LanguageMessageEntry[];
    next?: number;
}

export interface LanguageAreaSummary {
    area: string;
    count: number;
}

export interface EnglishCatalogEntryView {
    key: string;
    message: LanguageMessage;
    placeholders: string[];
    note?: string;
    sourceHash: string;
}

export interface EnglishMessagePage {
    area: string;
    total: number;
    offset: number;
    entries: EnglishCatalogEntryView[];
    next?: number;
}

export interface LanguageAudit {
    code: string;
    area?: string;
    keys: string[];
    count: number;
    warning?: string;
}

export interface StaleLanguageAudit extends LanguageAudit {
    unverified: number;
}

export interface PackValidationView {
    valid: boolean;
    pack?: {
        schemaVersion: 1;
        code: string;
        name: string;
        englishName: string;
        direction?: "ltr";
        messages: Record<string, LanguageMessage>;
        source?: Record<string, string>;
    };
    warnings: string[];
}

export interface BoardValidationView {
    boardRoot: string;
    code: string;
    defaultCode: string | null;
    valid: boolean;
    warnings: string[];
    /** Default-pack message keys this pack does not translate; they fall back and do not affect `valid`. */
    missing: string[];
}

export interface LanguageSaveResult {
    code?: string;
    path?: string;
    saved: boolean;
    warnings: string[];
}

export interface LanguageDeleteResult {
    code: string;
    deleted: boolean;
}

export interface LanguageApplyResult {
    code: string;
    scheduled: true;
}

export interface LanguageSaveOptions {
    /** Merge incoming keys into the existing user pack. The default replaces it. */
    merge?: boolean;
}

export interface ILanguages {
    /** Read the effective language and the saved selection that produced it. */
    readonly current: { code: string; requested: string; selection: "auto" | "setting" };
    /** List available packs plus synthetic English. */
    list(): Promise<LanguageSummary[]>;
    /** Read pack metadata, or one translated-message page when area is supplied. */
    get(code: string): Promise<LanguageMetadata | undefined>;
    get(code: string, area: string, options?: LanguagePageOptions): Promise<LanguageMessagePage | undefined>;
    /** List English catalog areas and their entry counts. */
    areas(): LanguageAreaSummary[];
    /** Read one bounded page of English source messages for an area. */
    english(area: string, options?: LanguagePageOptions): EnglishMessagePage;
    /** List English keys absent from the effective merged pack. */
    missing(code: string, area?: string): Promise<LanguageAudit>;
    /** List source-hash mismatches and count translated messages without hashes. */
    stale(code: string, area?: string): Promise<StaleLanguageAudit>;
    /** Validate a pack using the same validator as on-disk language packs. */
    validate(pack: unknown): PackValidationView;
    /** Validate one board language pack against that board's declared default. */
    validateBoard(boardRoot: string, code: string): Promise<BoardValidationView>;
    /**
     * Save a validated pack to user language storage. By default, replaces the user pack;
     * pass `{ merge: true }` to preserve its other messages. Any validation warning refuses
     * the write. Built-in English (`en`) and synthetic pseudo-English (`en-XA`) are protected.
     */
    save(pack: unknown, options?: LanguageSaveOptions): Promise<LanguageSaveResult>;
    /** Delete only a user language pack; built-in packs are never removed. */
    delete(code: string): Promise<LanguageDeleteResult>;
    /**
     * Apply `auto`, `en`, or an available pack. Applying reloads every window; an agent must
     * ask the user first. `en-XA` is accepted only in development.
     */
    apply(code: string): Promise<LanguageApplyResult>;
}
