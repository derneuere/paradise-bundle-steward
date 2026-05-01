// Dispose a three.js GPU resource (geometry, material, texture, render
// target — anything with a `.dispose()` method) when the component
// unmounts or the resource identity changes.
//
// Standard pattern for tying GPU lifetime to React lifetime: pass the
// resource into the hook each render; the hook re-binds disposal when
// the identity changes (a fresh geometry triggers cleanup of the old
// one) and on final unmount.

import { useEffect } from 'react';

type Disposable = { dispose: () => void };

export function useDisposeOnUnmount<T extends Disposable>(resource: T): void {
	useEffect(() => {
		return () => {
			resource.dispose();
		};
	}, [resource]);
}
