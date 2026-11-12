import { TModel } from "../../../core/state/model";
import { TComponentState } from "../../../core/state/state";
import { fs } from "../../../api/fs";
import { parseObject } from "../../../core/utils/parse-utils";
import { debounce } from "../../../../shared/utils";

export interface ScriptPanelState {
    content: string;
    open: boolean;
    height: number;
    hasSelection: boolean;
    selectedScript: string | null;
    dirty: boolean;
}

export const defaultScriptPanelState: ScriptPanelState = {
    content: "return page.content",
    open: false,
    height: 160,
    hasSelection: false,
    selectedScript: null,
    dirty: false,
};

export class ScriptPanelModel extends TModel<ScriptPanelState> {
    id: string | undefined;
    name = "script";
    private skipSave = false;
    private selectionReader: (() => string) | undefined;

    constructor() {
        super(new TComponentState(defaultScriptPanelState));
        this.own(this.state.subscribe(this.saveStateDebounced));
    }

    restore = async (id: string): Promise<void> => {
        this.id = id;
        const data = await fs.getCacheFile(id, this.name);
        const restored = parseObject(data) as Partial<ScriptPanelState> | undefined;
        this.skipSave = true;
        const merged = { ...defaultScriptPanelState, ...restored };
        if (!merged.selectedScript) merged.dirty = true;
        this.state.set(merged);
    };

    private saveState = async (): Promise<void> => {
        if (this.skipSave) {
            this.skipSave = false;
            return;
        }
        if (!this.id) return;
        await fs.saveCacheFile(this.id, JSON.stringify(this.state.get()), this.name);
    };

    private saveStateDebounced = debounce(this.saveState, 300);

    changeContent = (content: string): void => {
        this.state.update((state) => {
            state.content = content;
            state.dirty = true;
        });
    };

    toggleOpen = (): void => {
        this.state.update((state) => { state.open = !state.open; });
    };

    setHeight = (height: number): void => {
        this.state.update((state) => { state.height = height; });
    };

    setHasSelection = (hasSelection: boolean): void => {
        if (this.state.get().hasSelection === hasSelection) return;
        this.state.update((state) => { state.hasSelection = hasSelection; });
    };

    handleEditorChange = (content: string): void => {
        this.changeContent(content);
    };

    setSelectionReader = (reader: (() => string) | undefined): void => {
        this.selectionReader = reader;
    };

    clearSelectionReader = (reader: (() => string) | undefined): void => {
        if (this.selectionReader === reader) this.selectionReader = undefined;
    };

    getSelectedText = (): string => this.selectionReader?.() ?? "";
}
