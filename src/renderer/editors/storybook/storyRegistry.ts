import { Story } from "./storyTypes";

// Layout
import { panelStory }   from "../../uikit/Panel/Panel.story";
import { spacerStory }  from "../../uikit/Spacer/Spacer.story";
import { toolbarStory } from "../../uikit/Toolbar/Toolbar.story";

// Bootstrap
import { buttonStory }           from "../../uikit/Button/Button.story";
import { iconButtonStory }       from "../../uikit/IconButton/IconButton.story";
import { inputStory }            from "../../uikit/Input/Input.story";
import { labelStory }            from "../../uikit/Label/Label.story";
import { checkboxStory }         from "../../uikit/Checkbox/Checkbox.story";
import { dividerStory }          from "../../uikit/Divider/Divider.story";
import { textStory }             from "../../uikit/Text/Text.story";
import { segmentedControlStory } from "../../uikit/SegmentedControl/SegmentedControl.story";
import { radioGroupStory }       from "../../uikit/RadioGroup/RadioGroup.story";
import { spinnerStory }          from "../../uikit/Spinner/Spinner.story";
import { textareaStory }         from "../../uikit/Textarea/Textarea.story";
import { pathInputStory }        from "../../uikit/PathInput/PathInput.story";

// Overlay
import { popoverStory }          from "../../uikit/Popover/Popover.story";
import { tooltipStory }          from "../../uikit/Tooltip/Tooltip.story";

// Lists
import { listBoxStory }          from "../../uikit/ListBox/ListBox.story";
import { selectStory }           from "../../uikit/Select/Select.story";

export const ALL_STORIES: Story[] = [
    panelStory, spacerStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory, radioGroupStory, spinnerStory, textareaStory, pathInputStory,
    popoverStory, tooltipStory,
    listBoxStory, selectStory,
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
