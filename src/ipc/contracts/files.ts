import type { TimeoutExemptions } from "../timeout-exemptions";
import type {
    CommonFolder,
    OpenFileDialogParams,
    OpenFolderDialogParams,
    SaveFileDialogParams,
} from "../api-param-types";
import type { LaunchInput } from "../../shared/launch-input";
import type { EventObject } from "./event-object";

export interface FilesApi {
    showOpenFileDialog: (
            params: OpenFileDialogParams
        ) => Promise<string[] | undefined>;
    showSaveFileDialog: (
            params: SaveFileDialogParams
        ) => Promise<string | undefined>;
    showOpenFolderDialog: (
            params: OpenFolderDialogParams
        ) => Promise<string[] | undefined>;
    getCommonFolder: (folder: CommonFolder) => Promise<string>;
    showItemInFolder: (path: string) => Promise<void>;
    showFolder: (path: string) => Promise<void>;
    openPath: (path: string, boardRoot?: string) => Promise<string>;
    getStartupInputs: () => Promise<LaunchInput[]>;
    getFileIcon: (filePath: string) => Promise<string>;
}

export interface FilesEvents {
    eOpenFile: EventObject<string>;
    eOpenDiff: EventObject<{ firstPath: string; secondPath: string }>;
    eOpenExternalUrl: EventObject<string>;
}


export const fileTimeoutExemptions = {
    showSaveFileDialog: "Native dialog waits for user choice or cancellation.",
    openPath: "OS shell completion has no request-level bound.",
    showOpenFolderDialog: "Native dialog waits for user choice or cancellation.",
    showOpenFileDialog: "Native dialog waits for user choice or cancellation.",
} satisfies TimeoutExemptions<FilesApi>;
