window.__persephoneSiteRuntime.expose({
    heading() {
        return mockPage.text("h1");
    },
    items() {
        return mockPage.texts("ul[aria-label='Items'] li");
    },
    // Required: expose() rejects a root without an aiVision descriptor
    // ("The exposed root must carry an AiVision descriptor.").
    aiVision: {
        kind: "MockListPage",
        summary: "Test model of the starter suite's mock list page.",
        members: [
            { name: "heading", kind: "method", signature: "heading()", summary: "The page heading text." },
            { name: "items", kind: "method", signature: "items()", summary: "The list item texts, in order." },
        ],
    },
});
