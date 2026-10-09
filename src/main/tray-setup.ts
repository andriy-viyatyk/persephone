import { app, Menu, Tray } from 'electron';
import { getAssetPath } from './utils';
import { openWindows } from './open-windows';
import { t } from '../shared/i18n/t';

let tray: Tray | null = null;

export function setupTray() {
    if (!tray) tray = new Tray(getAssetPath('icon.png'));
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
    tray.setToolTip('Persephone');
    tray.setContextMenu(contextMenu);
}
