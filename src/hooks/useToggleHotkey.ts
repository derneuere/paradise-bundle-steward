// Toggle a boolean state via a single-character hotkey on `window`.
//
// Skips when the target is an editable element (input, textarea, select,
// contentEditable) so typing the key into a field doesn't flip the
// toggle. Skips when any modifier (Ctrl/Cmd/Alt/Shift) is held — only a
// plain keypress toggles. preventDefault is called so the browser
// doesn't also use the key for its own shortcut.

import { useEffect } from 'react';

export function useToggleHotkey(
	key: string,
	setEnabled: React.Dispatch<React.SetStateAction<boolean>>,
): void {
	const keyLower = key.toLowerCase();
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() !== keyLower) return;
			if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName;
			if (
				target?.isContentEditable ||
				tag === 'INPUT' ||
				tag === 'TEXTAREA' ||
				tag === 'SELECT'
			) {
				return;
			}
			e.preventDefault();
			setEnabled((v) => !v);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [keyLower, setEnabled]);
}
