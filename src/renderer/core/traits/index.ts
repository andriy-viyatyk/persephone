export { TraitKey, TraitSet, traited, isTraited, resolveTraited } from './traits';
export type { Traited, TraitType, PartialTraitType } from './traits';
export { TraitTypeId, traitRegistry } from './TraitRegistry';
export {
    setTraitDragData,
    getTraitDragData,
    hasTraitDragData,
    resolveTraits,
    allowDrop,
} from './dnd';
export type { TraitDragPayload } from './dnd';
