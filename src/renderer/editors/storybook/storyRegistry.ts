import { Story } from "./storyTypes";

// Layout
import { flexStory }    from "../../uikit/Flex/Flex.story";
import { hstackStory }  from "../../uikit/Flex/HStack.story";
import { vstackStory }  from "../../uikit/Flex/VStack.story";
import { panelStory }   from "../../uikit/Panel/Panel.story";
import { cardStory }    from "../../uikit/Card/Card.story";
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

export const ALL_STORIES: Story[] = [
    flexStory, hstackStory, vstackStory, panelStory, cardStory, spacerStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory,
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
