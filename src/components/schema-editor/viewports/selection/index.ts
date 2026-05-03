// Public surface of the overlay-internal selection module. See
// `selection.ts`, `theme.ts`, and `useInstancedSelection.ts` for the
// load-bearing decisions.

export {
	defineSelectionCodec,
	selectionEquals,
	selectionKey,
} from './selection';
export type { Selection, SelectionCodec } from './selection';

export { SELECTION_THEME } from './theme';
export type { SelectionTheme } from './theme';

export {
	computeInstanceState,
	useInstancedSelection,
} from './useInstancedSelection';
export type {
	InstancedSelectionState,
	UseInstancedSelectionOpts,
	UseInstancedSelectionResult,
} from './useInstancedSelection';

export { useBatchedSelection } from './useBatchedSelection';
export type {
	UseBatchedSelectionOpts,
	UseBatchedSelectionResult,
} from './useBatchedSelection';
