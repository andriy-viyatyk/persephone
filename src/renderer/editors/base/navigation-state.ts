/** Tree-selection shape shared by the tree-provider editors (Explorer,
 *  Archive, Link) and read by CategoryEditor's ITreeProviderHost duck-type.
 *  Relocated from PageModel to remove its final residual
 *  editor→concrete-PageModel type coupling. */
export interface NavigationState {
    /** Currently selected item href (shared between SecondaryViews and secondary views). */
    selectedHref: string | null;
}
