import { TruncatedText } from "./TruncatedText";
import { Story } from "../../editors/storybook/storyTypes";

export const truncatedTextStory: Story = {
    id: "truncated-text",
    name: "TruncatedText",
    section: "Bootstrap",
    component: TruncatedText as any,
    props: [
        { name: "children", type: "string", default: "Some very long text that will overflow its container when constrained" },
        { name: "name", type: "string", default: "" },
    ],
};
