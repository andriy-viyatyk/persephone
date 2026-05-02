import { Spinner } from "./Spinner";
import { Story } from "../../editors/storybook/storyTypes";

export const spinnerStory: Story = {
    id: "spinner",
    name: "Spinner",
    section: "Bootstrap",
    component: Spinner as any,
    props: [
        { name: "size", type: "number", default: 32, min: 12, max: 96, step: 2 },
        { name: "color", type: "string", default: "" },
    ],
};
