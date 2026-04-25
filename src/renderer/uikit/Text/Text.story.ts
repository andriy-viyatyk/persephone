import { Text } from "./Text";
import { Story } from "../../editors/storybook/storyTypes";

export const textStory: Story = {
    id: "text",
    name: "Text",
    section: "Bootstrap",
    component: Text as any,
    props: [
        { name: "children", type: "string", default: "Sample text" },
        { name: "variant", type: "enum", options: ["heading", "body", "caption", "code"], default: "body" },
    ],
};
