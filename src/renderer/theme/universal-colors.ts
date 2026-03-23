/**
 * Theme-independent colors that are readable on both dark and light backgrounds.
 *
 * Use for data visualization, status indicators, script output, and anywhere
 * color must maintain identity regardless of the active theme.
 *
 * Do NOT use these for themed UI elements — use `color.ts` tokens instead.
 */

/** Semantic colors for common indicator use cases. */
const universalColors = {
    http: {
        success: "mediumseagreen",
        redirect: "dodgerblue",
        clientError: "orange",
        serverError: "tomato",
        method: {
            get: "dodgerblue",
            post: "mediumseagreen",
            put: "orange",
            patch: "mediumaquamarine",
            delete: "tomato",
            head: "mediumpurple",
            options: "steelblue",
        },
    },

    /**
     * Indexed palette for charts, graphs, and multi-series data.
     * All colors are named CSS colors, readable on both dark and light backgrounds.
     */
    palette: [
        "lightseagreen",
        "dodgerblue",
        "hotpink",
        "olive",
        "mediumpurple",
        "orange",
        "darkkhaki",
        "deepskyblue",
        "tomato",
        "limegreen",
        "cornflowerblue",
        "sienna",
        "lightslategray",
        "plum",
        "darkcyan",
        "fuchsia",
        "darkgray",
        "lightpink",
        "violet",
        "yellowgreen",
        "cadetblue",
        "salmon",
        "mediumseagreen",
        "royalblue",
        "indianred",
        "forestgreen",
        "lightskyblue",
        "olivedrab",
        "steelblue",
        "mediumaquamarine",
        "slateblue",
    ] as const,
};

export default universalColors;
