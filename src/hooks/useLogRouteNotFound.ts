// Log a 404 to console.error whenever the not-found page mounts at a new
// pathname. The router renders this page for any URL that didn't match;
// the log helps surface dead links or stale bookmarks in dev.

import { useEffect } from 'react';

export function useLogRouteNotFound(pathname: string): void {
	useEffect(() => {
		console.error(
			'404 Error: User attempted to access non-existent route:',
			pathname,
		);
	}, [pathname]);
}
