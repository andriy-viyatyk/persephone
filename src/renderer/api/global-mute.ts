import { ipcRenderer } from "electron";
import { GLOBAL_MUTE_CHANGED, GLOBAL_MUTE_RELEASE_ALL, GLOBAL_MUTE_SNAPSHOT, type GlobalMuteSnapshot } from "../../ipc/global-mute-channels";

export const globalMuteClient = {
    snapshot: (): Promise<GlobalMuteSnapshot> => ipcRenderer.invoke(GLOBAL_MUTE_SNAPSHOT),
    releaseAll: (): Promise<GlobalMuteSnapshot> => ipcRenderer.invoke(GLOBAL_MUTE_RELEASE_ALL),
    subscribe(listener: (snapshot: GlobalMuteSnapshot) => void): () => void {
        const handler = (_event: Electron.IpcRendererEvent, snapshot: GlobalMuteSnapshot): void => listener(snapshot);
        ipcRenderer.on(GLOBAL_MUTE_CHANGED, handler);
        return () => ipcRenderer.removeListener(GLOBAL_MUTE_CHANGED, handler);
    },
};
