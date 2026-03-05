/**
 * ISvgEditor — script interface for the SVG preview.
 *
 * Obtained via `page.asSvg()`. Only for text pages with SVG content.
 *
 * @example
 * const svg = await page.asSvg();
 * console.log(svg.svg); // the SVG source
 */
export interface ISvgEditor {
    /** The SVG source content. */
    readonly svg: string;
}
