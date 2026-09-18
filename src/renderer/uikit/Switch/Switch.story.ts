import type { Story } from "../../editors/storybook/storyTypes";
import { SwitchView, type SwitchProps } from "./SwitchView";

export const switchStory: Story<SwitchProps> = {
    id: "switch",
    name: "Switch",
    section: "Bootstrap",
    view: SwitchView,
    props: [
        { name: "label", type: "string", default: "Enable service" },
        { name: "checked", type: "boolean", default: false },
        { name: "size", type: "enum", options: ["sm", "md"], default: "sm" },
        { name: "disabled", type: "boolean", default: false },
    ],
    defaultProps: {
        onChange: () => {},
    },
};
