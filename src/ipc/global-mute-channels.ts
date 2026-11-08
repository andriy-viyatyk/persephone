export const GLOBAL_MUTE_SNAPSHOT = "global-mute:snapshot";
export const GLOBAL_MUTE_RELEASE_ALL = "global-mute:release-all";
export const GLOBAL_MUTE_CHANGED = "global-mute:changed";

export interface GlobalMuteSnapshot {
    revision: number;
    active: boolean;
    holders: string[];
    contents: Array<{ id: number; type: string; localMuted: boolean; effectiveMuted: boolean }>;
}
