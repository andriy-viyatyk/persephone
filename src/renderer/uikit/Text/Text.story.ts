import { Text } from "./Text";
import { Story } from "../../editors/storybook/storyTypes";

export const textStory: Story = {
    id: "text",
    name: "Text",
    section: "Bootstrap",
    component: Text as any,
    props: [
        { name: "children", type: "string", default: "Sample text" },
        { name: "variant", type: "enum", options: ["default", "uppercased"], default: "default" },
        { name: "color",   type: "enum", options: ["default", "light", "dark", "inherit", "error", "warning", "success", "primary"], default: "default" },
        { name: "size",    type: "enum", options: ["xs", "sm", "md", "base", "lg", "xl", "xxl"], default: "base" },
        { name: "italic",  type: "boolean", default: false },
        { name: "bold",    type: "boolean", default: false },
        { name: "nowrap",  type: "boolean", default: false },
        { name: "preWrap", type: "boolean", default: false },
    ],
};
