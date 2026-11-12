import { settings as appSettings } from "./settings";
import { applyThemePreservingPreview, clearThemePreview, getNextThemeId } from "../theme/themes";

class ThemeService {
    private stopWatching: (() => void) | undefined;

    start(settings: typeof appSettings): void {
        if (this.stopWatching) return;
        applyThemePreservingPreview(settings.theme);
        this.stopWatching = settings.watch("theme", (themeId) => applyThemePreservingPreview(themeId));
    }

    select(id: string): void {
        clearThemePreview();
        appSettings.set("theme", id);
    }

    cycle(direction: 1 | -1): void {
        this.select(getNextThemeId(direction));
    }
}

export const themeService = new ThemeService();
