/** Tree-selection shape shared by tree-provider editors through their host trait.
 *  Relocated from PageModel to remove its final residual editor→concrete-PageModel type coupling. */
export interface NavigationState {
    /** Currently selected item href (shared between SecondaryViews and secondary views). */
    selectedHref: string | null;
}
