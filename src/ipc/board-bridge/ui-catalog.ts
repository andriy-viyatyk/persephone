

export type BoardToolbarControlType = "button" | "toggle" | "menu" | "select" | "segmented" | "input" | "breadcrumb";

export type BoardToolbarIcon =
    | { name: string }
    | { svg: string; preserveColors?: boolean }
    | { file: string; preserveColors?: boolean };

export type BoardToolbarControlDescriptor =
    | {
        id: string;
        type: "button";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        disabled?: boolean;
        /** `"start"` draws the button at the left of the toolbar, before the text slot. Fixed at `set()`. */
        placement?: "toolbar" | "start";
    }
    | {
        id: string;
        type: "toggle";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        value: boolean;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "menu";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        items: readonly { id: string; label: string; disabled?: boolean }[];
        disabled?: boolean;
        /** `"board-menu"` adds the items to the top of Persephone's own … menu instead of drawing a
         *  menu button; `"start"` draws the menu button at the left of the toolbar, before the text
         *  slot. Fixed at `set()`; `update()` cannot move a control. */
        placement?: "toolbar" | "board-menu" | "start";
    }
    | {
        id: string;
        type: "select";
        label?: string;
        title?: string;
        options: readonly { value: string; label: string }[];
        value: string;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "segmented";
        label?: string;
        title?: string;
        /** One button per option; each needs a `label`, an `icon`, or both. */
        options: readonly BoardToolbarSegment[];
        value: string;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "breadcrumb";
        label?: never;
        rootLabel: string;
        value: string;
        separators?: string;
        title?: string;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "input";
        label?: string;
        title?: string;
        value: string;
        placeholder?: string;
        disabled?: boolean;
    };

/** One option of a `segmented` toolbar control. */
export interface BoardToolbarSegment {
    value: string;
    label?: string;
    title?: string;
    icon?: BoardToolbarIcon;
    disabled?: boolean;
}

export type BoardToolbarControlPatch = {
    id: string;
    type?: BoardToolbarControlType;
    label?: string;
    title?: string;
    icon?: BoardToolbarIcon;
    disabled?: boolean;
    value?: boolean | string;
    items?: readonly { id: string; label: string; disabled?: boolean }[];
    /** Select options (`label` required, no icons) or segmented options. */
    options?: readonly BoardToolbarSegment[];
    placeholder?: string;
    rootLabel?: string;
    separators?: string;
};

export type BoardStatusBarTone = "normal" | "muted" | "error" | "accent";
/** Text item look: `plain` (default) is bare text; `chip` is a bordered, filled pill that does not stretch. */
export type BoardStatusBarTextVariant = "plain" | "chip";
export interface BoardStatusBarTextItem {
    id: string; type: "text"; text: string; tone?: BoardStatusBarTone; title?: string;
    variant?: BoardStatusBarTextVariant; align?: "end"; hidden?: boolean;
}
export interface BoardStatusBarButtonItem {
    id: string; type: "button"; text: string; tone?: BoardStatusBarTone; title?: string;
    disabled?: boolean; icon?: BoardToolbarIcon; align?: "end"; hidden?: boolean;
}
export type BoardStatusBarItem = BoardStatusBarTextItem | BoardStatusBarButtonItem;
export type BoardStatusBarPatch = { id: string; type?: "text" | "button"; text?: string;
    tone?: BoardStatusBarTone; title?: string; disabled?: boolean; icon?: BoardToolbarIcon;
    variant?: BoardStatusBarTextVariant; align?: "end"; hidden?: boolean };