import { applicationProfileName } from "./application-profile";
import { app, Menu, Tray } from 'electron';
import { getAssetPath } from './utils';
import { openWindows } from './open-windows';
import { t } from '../shared/i18n/t';
import { getAudioCaptureCount, subscribeAudioCaptureCount } from './audio-capture-state';

let tray: Tray | null = null;
let unsubscribeAudioCaptureCount: (() => void) | undefined;

export function setupTray() {
    if (!tray) tray = new Tray(getAssetPath('icon.png'));
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
