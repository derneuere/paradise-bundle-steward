// Public surface of the overlay-internal selection module. See
// `selection.ts`, `theme.ts`, and `useInstancedSelection.ts` for the
// load-bearing decisions.

export {
	defineSelectionCodec,
	selectionKey,
} from './selection';
export type { Selection, SelectionCodec } from './selection';

export { SELECTION_THEME } from './theme';

export { useInstancedSelection } from './useInstancedSelection';

export { useBatchedSelection } from './useBatchedSelection';

export { isDragRelease } from './dragGuard';
