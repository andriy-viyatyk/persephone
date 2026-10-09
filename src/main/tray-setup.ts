import { app, Menu, Tray } from 'electron';
import { getAssetPath } from './utils';
import { openWindows } from './open-windows';

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
            label: 'Show App',
            click: () => {
                openWindows.showWindows();
            },
        },
        {
            label: 'Quit',
            click: () => {
                openWindows.doQuit = true;
                app.quit();
            },
        },
    ]);
    tray.setToolTip('Persephone');
    tray.setContextMenu(contextMenu);
}
