import { Checkbox } from "./Checkbox";
import { Story } from "../../editors/storybook/storyTypes";

export const checkboxStory: Story = {
    id: "checkbox",
    name: "Checkbox",
    section: "Bootstrap",
    component: Checkbox as any,
    props: [
        { name: "checked", type: "boolean", default: false },
        { name: "children", type: "string", default: "Checkbox label" },
        { name: "disabled", type: "boolean", default: false },
    ],
    defaultProps: {
        onChange: () => {},
    },
};
