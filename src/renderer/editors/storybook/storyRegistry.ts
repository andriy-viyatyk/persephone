import { Story } from "./storyTypes";

// Layout
import { panelStory }    from "../../uikit/Panel/Panel.story";
import { spacerStory }   from "../../uikit/Spacer/Spacer.story";
import { splitterStory } from "../../uikit/Splitter/Splitter.story";
import { toolbarStory }  from "../../uikit/Toolbar/Toolbar.story";

// Bootstrap
import { buttonStory }           from "../../uikit/Button/Button.story";
import { iconButtonStory }       from "../../uikit/IconButton/IconButton.story";
import { inputStory }            from "../../uikit/Input/Input.story";
import { labelStory }            from "../../uikit/Label/Label.story";
import { checkboxStory }         from "../../uikit/Checkbox/Checkbox.story";
import { dividerStory }          from "../../uikit/Divider/Divider.story";
import { dotStory }              from "../../uikit/Dot/Dot.story";
import { textStory }             from "../../uikit/Text/Text.story";
import { segmentedControlStory } from "../../uikit/SegmentedControl/SegmentedControl.story";
import { radioGroupStory }       from "../../uikit/RadioGroup/RadioGroup.story";
import { spinnerStory }          from "../../uikit/Spinner/Spinner.story";
import { textareaStory }         from "../../uikit/Textarea/Textarea.story";
import { pathInputStory }        from "../../uikit/PathInput/PathInput.story";
import { tagStory }              from "../../uikit/Tag/Tag.story";
import { tagsInputStory }        from "../../uikit/TagsInput/TagsInput.story";

// Overlay
import { popoverStory }          from "../../uikit/Popover/Popover.story";
import { tooltipStory }          from "../../uikit/Tooltip/Tooltip.story";
import { dialogStory }           from "../../uikit/Dialog/Dialog.story";
import { notificationStory }     from "../../uikit/Notification/Notification.story";
import { menuStory }             from "../../uikit/Menu/Menu.story";

// Lists
import { listBoxStory }          from "../../uikit/ListBox/ListBox.story";
import { selectStory }           from "../../uikit/Select/Select.story";
import { treeStory }             from "../../uikit/Tree/Tree.story";

export const ALL_STORIES: Story[] = [
    panelStory, spacerStory, splitterStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, dotStory, textStory,
    segmentedControlStory, radioGroupStory, spinnerStory, textareaStory, pathInputStory,
    tagStory, tagsInputStory,
    popoverStory, tooltipStory, dialogStory, notificationStory, menuStory,
    listBoxStory, selectStory, treeStory,
];

export function findStory(id: string): Story | undefined {
    return ALL_STORIES.find((s) => s.id === id);
}

export function storiesBySection(): Map<string, Story[]> {
    const out = new Map<string, Story[]>();
    for (const s of ALL_STORIES) {
        const list = out.get(s.section) ?? [];
        list.push(s);
        out.set(s.section, list);
    }
    return out;
}
