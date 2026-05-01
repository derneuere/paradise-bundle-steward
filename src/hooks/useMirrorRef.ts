// Mirror a value into a caller-owned ref after each commit.
//
// Use case: a child component reads something from React context (e.g.
// `useThree().camera`, only valid inside <Canvas>) and needs to expose
// it to a parent that can't call the same hook itself. The parent
// passes a ref down; the child stashes the value into it via this
// hook. See CameraStash inside RotationVisualizer.tsx for the canonical
// example.
//
// Sister hook: useLatestRef — same write-after-commit shape, but
// creates the ref internally for callers who don't need to expose it
// across a component boundary.

import { useEffect } from 'react';

export function useMirrorRef<T>(
	ref: React.MutableRefObject<T>,
	value: T,
): void {
	useEffect(() => {
		ref.current = value;
	}, [ref, value]);
}
