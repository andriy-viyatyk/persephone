import type { ThemeColorVar } from "../theme-color-vars";

export interface ThemeDefinition {
    id: string;
    name: string;
    isDark: boolean;
    colors: Record<ThemeColorVar, string>;
    monaco: {
        base: "vs-dark" | "vs" | "hc-black";
        colors: Record<string, string>;
    };
}
