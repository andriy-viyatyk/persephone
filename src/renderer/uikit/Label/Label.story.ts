import { Label } from "./Label";
import { Story } from "../../editors/storybook/storyTypes";

export const labelStory: Story = {
    id: "label",
    name: "Label",
    section: "Bootstrap",
    component: Label as any,
    props: [
        { name: "children", type: "string", default: "Field label" },
        { name: "variant", type: "enum", options: ["default", "section", "error", "warning", "success"], default: "default" },
        { name: "required", type: "boolean", default: false },
        { name: "disabled", type: "boolean", default: false },
    ],
};
