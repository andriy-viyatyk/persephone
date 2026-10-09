import { getActiveLocale } from "../../../shared/i18n/active-locale";

type NumberFormatOptions = Intl.NumberFormatOptions;
type DateTimeFormatOptions = Intl.DateTimeFormatOptions;
type RelativeTimeFormatOptions = Intl.RelativeTimeFormatOptions;
type RelativeTimeUnit = Intl.RelativeTimeFormatUnit;
type Unit = NonNullable<NumberFormatOptions["unit"]>;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function effectiveLocale(): string {
    const locale = getActiveLocale();
    return locale === "en-XA" ? "en" : locale;
}

function cacheKey(locale: string, options: object): string {
    return `${locale}:${JSON.stringify(options)}`;
}

function getDateFormatter(options: DateTimeFormatOptions): Intl.DateTimeFormat {
    const locale = effectiveLocale();
    const key = cacheKey(locale, options);
    let formatter = dateFormatters.get(key);
    if (!formatter) {
        try {
            formatter = new Intl.DateTimeFormat(locale, options);
        } catch {
            formatter = new Intl.DateTimeFormat("en", options);
        }
        dateFormatters.set(key, formatter);
    }
    return formatter;
}

function getNumberFormatter(options: NumberFormatOptions): Intl.NumberFormat {
    const locale = effectiveLocale();
    const key = cacheKey(locale, options);
    let formatter = numberFormatters.get(key);
    if (!formatter) {
        try {
            formatter = new Intl.NumberFormat(locale, options);
        } catch {
            formatter = new Intl.NumberFormat("en", options);
        }
        numberFormatters.set(key, formatter);
    }
    return formatter;
}

function getRelativeTimeFormatter(options: RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
    const locale = effectiveLocale();
    const key = cacheKey(locale, options);
    let formatter = relativeTimeFormatters.get(key);
    if (!formatter) {
        try {
            formatter = new Intl.RelativeTimeFormat(locale, options);
        } catch {
            formatter = new Intl.RelativeTimeFormat("en", options);
        }
        relativeTimeFormatters.set(key, formatter);
    }
    return formatter;
}

export function formatDate(value: Date | number): string {
    return getDateFormatter({ year: "numeric", month: "short", day: "numeric" }).format(value);
}

export function formatDateTime(value: Date | number): string {
    return getDateFormatter({ dateStyle: "medium", timeStyle: "short" }).format(value);
}

export function formatTime(value: Date | number): string {
    return getDateFormatter({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
}

export function formatRelativeTime(
    value: number,
    unit: RelativeTimeUnit,
    options: RelativeTimeFormatOptions = {},
): string {
    return getRelativeTimeFormatter({ numeric: "auto", ...options }).format(value, unit);
}

export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
    return getNumberFormatter(options).format(value);
}

export function formatUnit(value: number, unit: Unit, unitDisplay: NonNullable<NumberFormatOptions["unitDisplay"]>): string {
    return getNumberFormatter({ style: "unit", unit, unitDisplay }).format(value);
}

function formatByteCount(bytes: number): string {
    const text = getNumberFormatter({ style: "unit", unit: "byte", unitDisplay: "short" }).format(bytes);
    // Some locales (en, ja, be) have no short form and spell out an English "byte"; use "B" there.
    return text.includes("byte") ? `${formatNumber(bytes)} B` : text;
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return formatByteCount(0);
    if (bytes < 1024) return formatByteCount(Math.round(bytes));

    const units: Unit[] = ["kilobyte", "megabyte", "gigabyte", "terabyte"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return getNumberFormatter({
        style: "unit",
        unit: units[unitIndex],
        unitDisplay: "short",
        maximumFractionDigits: unitIndex === 0 ? 0 : 1,
    }).format(value);
}
