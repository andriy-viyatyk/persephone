import { applicationProfileName } from "./application-profile";
import { app, Menu, Tray } from 'electron';
import { getAssetPath } from './utils';
import { openWindows } from './open-windows';
import { t } from '../shared/i18n/t';
import { getAudioCaptureCount, subscribeAudioCaptureCount } from './audio-capture-state';
import { isLinux } from '../shared/platform';
import { TrayAvailabilityLinux } from './tray-availability-linux';

let tray: Tray | null = null;
let unsubscribeAudioCaptureCount: (() => void) | undefined;
const trayAvailability = new TrayAvailabilityLinux();

export function setupTray() {
    openWindows.setTrayAvailability(trayAvailability);
    if (!tray) {
        try {
            tray = new Tray(getAssetPath('icon.png'));
            trayAvailability.setTrayCreated(true);
        } catch (error) {
            trayAvailability.setTrayCreated(false);
            if (!isLinux) throw error;
            return;
        }
    }
    unsubscribeAudioCaptureCount?.();
    unsubscribeAudioCaptureCount = subscribeAudioCaptureCount(rebuildTray);
    rebuildTray();
    tray.on('click', () => {
        if (openWindows.anyVisible()) {
            openWindows.hideWindows();
        } else {
            openWindows.showWindows();
        }
    });
    if (isLinux) void trayAvailability.refresh();
}

export function rebuildTray(): void {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        {
            label: t('main.trayShowApp'),
            click: () => {
                openWindows.showWindows();
            },
        },
        {
            label: t('main.trayQuit'),
            click: () => {
                openWindows.doQuit = true;
                app.quit();
            },
        },
    ]);
    const profile = applicationProfileName();
    const captureActive = getAudioCaptureCount().count > 0;
    tray.setToolTip(`Persephone${profile ? ` — ${profile}` : ''}${captureActive ? ` — ${t('shell.audioCaptureActive')}` : ''}`);
    tray.setContextMenu(contextMenu);
}
