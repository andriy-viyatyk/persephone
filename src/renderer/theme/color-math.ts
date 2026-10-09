export interface ParsedColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface OklchColor {
    l: number;
    c: number;
    h: number;
}

/** Parse only hex and comma-form rgb()/rgba() colors used by theme files. */
export function parseColor(value: string): ParsedColor | null {
    const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
    if (hex) {
        let digits = hex[1];
        if (digits.length === 3 || digits.length === 4) {
            digits = [...digits].map((digit) => digit + digit).join("");
        }
        const hasAlpha = digits.length === 8;
        return {
            r: Number.parseInt(digits.slice(0, 2), 16),
            g: Number.parseInt(digits.slice(2, 4), 16),
            b: Number.parseInt(digits.slice(4, 6), 16),
            a: hasAlpha ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
        };
    }

    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.exec(value);
    if (!rgb) return null;
    const [r, g, b] = rgb.slice(1, 4).map(Number);
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if ([r, g, b].some((channel) => channel > 255) || a < 0 || a > 1) return null;
    if (value.trim().toLowerCase().startsWith("rgba(") && rgb[4] === undefined) return null;
    if (value.trim().toLowerCase().startsWith("rgb(") && rgb[4] !== undefined) return null;
    return { r, g, b, a };
}

function byte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function formatAlpha(alpha: number): string {
    return Number(alpha.toFixed(4)).toString();
}

export function formatColor(color: ParsedColor): string {
    const r = byte(color.r);
    const g = byte(color.g);
    const b = byte(color.b);
    if (color.a < 1) return `rgba(${r}, ${g}, ${b}, ${formatAlpha(color.a)})`;
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function srgbToLinear(channel: number): number {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
    const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
    return value * 255;
}

export function relativeLuminance(color: ParsedColor): number {
    return 0.2126 * srgbToLinear(color.r)
        + 0.7152 * srgbToLinear(color.g)
        + 0.0722 * srgbToLinear(color.b);
}

/** Composite foreground over background in encoded sRGB, as CSS does. */
export function compositeColor(foreground: ParsedColor, background: ParsedColor): ParsedColor {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
    };
}

export function contrastRatio(foreground: ParsedColor, background: ParsedColor): number {
    const opaqueWhite: ParsedColor = { r: 255, g: 255, b: 255, a: 1 };
    const actualBackground = background.a < 1 ? compositeColor(background, opaqueWhite) : background;
    const actualForeground = foreground.a < 1 ? compositeColor(foreground, actualBackground) : foreground;
    const first = relativeLuminance(actualForeground);
    const second = relativeLuminance(actualBackground);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const lRoot = Math.cbrt(l);
    const mRoot = Math.cbrt(m);
    const sRoot = Math.cbrt(s);
    return [
        0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
        1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
        0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
    ];
}

export function toOklch(color: ParsedColor): OklchColor {
    const [l, a, b] = linearRgbToOklab(
        srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b)
    );
    const chroma = Math.hypot(a, b);
    return { l, c: chroma, h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
}

function oklchToLinearRgb(color: OklchColor): [number, number, number] {
    const radians = color.h * Math.PI / 180;
    const a = color.c * Math.cos(radians);
    const b = color.c * Math.sin(radians);
    const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b;
    const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b;
    const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b;
    const l = lRoot ** 3;
    const m = mRoot ** 3;
    const s = sRoot ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
}

function inGamut(rgb: [number, number, number]): boolean {
    return rgb.every((channel) => channel >= -1e-7 && channel <= 1 + 1e-7);
}

export function fromOklch(color: OklchColor, alpha = 1): ParsedColor {
    const lightness = Math.max(0, Math.min(1, color.l));
    let chroma = Math.max(0, color.c);
    let linear = oklchToLinearRgb({ ...color, l: lightness, c: chroma });
    if (!inGamut(linear)) {
        let low = 0;
        let high = chroma;
        for (let i = 0; i < 24; i++) {
            const middle = (low + high) / 2;
            const candidate = oklchToLinearRgb({ ...color, l: lightness, c: middle });
            if (inGamut(candidate)) low = middle;
            else high = middle;
        }
        chroma = low;
        linear = oklchToLinearRgb({ ...color, l: lightness, c: chroma });
    }
    return {
        r: linearToSrgb(Math.max(0, Math.min(1, linear[0]))),
        g: linearToSrgb(Math.max(0, Math.min(1, linear[1]))),
        b: linearToSrgb(Math.max(0, Math.min(1, linear[2]))),
        a: alpha,
    };
}

export function shiftOklch(value: string, deltaL: number, deltaC = 0): string {
    const parsed = parseColor(value);
    if (!parsed) return value;
    const lch = toOklch(parsed);
    return formatColor(fromOklch({ l: lch.l + deltaL, c: lch.c + deltaC, h: lch.h }, parsed.a));
}

/** Move a derived color toward black or white until it reaches the requested contrast. */
export function ensureContrast(value: string, background: string, target = 4.5): string {
    const source = parseColor(value);
    const surface = parseColor(background);
    if (!source || !surface || contrastRatio(source, surface) >= target) return value;
    const original = toOklch(source);
    const candidates = [0, 1].map((end) => {
        let result = fromOklch({ ...original, l: end }, source.a);
        let low = Math.min(original.l, end);
        let high = Math.max(original.l, end);
        for (let i = 0; i < 26; i++) {
            const middle = (low + high) / 2;
            // Judge the color as it will be written: rounding to whole RGB bytes can drop a
            // just-passing candidate back under the target.
            const color = parseColor(formatColor(fromOklch({ ...original, l: middle }, source.a)));
            if (!color) throw new Error("Could not parse a derived theme color");
            const enough = contrastRatio(color, surface) >= target;
            if (end > original.l) {
                if (enough) { result = color; high = middle; }
                else low = middle;
            } else if (enough) {
                result = color;
                low = middle;
            } else high = middle;
        }
        return result;
    }).filter((candidate) => contrastRatio(candidate, surface) >= target);
    const best = candidates.sort((first, second) =>
        Math.abs(toOklch(first).l - original.l) - Math.abs(toOklch(second).l - original.l)
    )[0];
    return best ? formatColor(best) : formatColor(fromOklch({ ...original, l: relativeLuminance(surface) > 0.5 ? 0 : 1 }, source.a));
}

/** Create a translucent CSS color string without first flattening it into a surface. */
export function withAlpha(value: string, alpha: number): string {
    const color = parseColor(value);
    return color ? formatColor({ ...color, a: Math.max(0, Math.min(1, alpha)) }) : value;
}

/** Alpha-composite two colors and serialize the resulting sRGB color. */
export function compositeColorString(foreground: string, background: string): string {
    const first = parseColor(foreground);
    const second = parseColor(background);
    return first && second ? formatColor(compositeColor(first, second)) : foreground;
}
