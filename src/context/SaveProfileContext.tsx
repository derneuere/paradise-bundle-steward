// State for the standalone Burnout Paradise save-profile editor (/save). The
// profile is NOT a BND2 bundle, so it lives outside WorkspaceContext entirely.
//
// Edits mutate the parsed model's chunk bytes in place (the codec patches at
// known offsets, preserving every untouched byte). React can't see in-place
// mutation, so a monotonically increasing `version` is bumped on every edit to
// trigger re-decode / re-render.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
	parseProfileSave, writeProfileSave, getChunk,
	editChunkField, editChunkBit, editHeaderString, editHeaderGuid,
	UnknownProfileError,
	type ProfileSave, type Path, type LeafValue, type RgmhStringField,
} from '@/lib/core/profileSave';

type SaveProfileContextValue = {
	save: ProfileSave | null;
	fileName: string | null;
	dirty: boolean;
	version: number;
	error: string | null;
	load: (file: File) => Promise<void>;
	download: () => void;
	editField: (chunkKey: string, path: Path, value: LeafValue) => void;
	editBit: (chunkKey: string, path: Path, bit: number, on: boolean) => void;
	setHeaderString: (field: RgmhStringField, value: string) => void;
	setHeaderGuid: (guid: string) => void;
};

const SaveProfileContext = createContext<SaveProfileContextValue | null>(null);

export function SaveProfileProvider({ children }: { children: ReactNode }) {
	const [save, setSave] = useState<ProfileSave | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [version, setVersion] = useState(0);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async (file: File) => {
		try {
			const buf = await file.arrayBuffer();
			const parsed = parseProfileSave(new Uint8Array(buf));
			setSave(parsed);
			setFileName(file.name);
			setDirty(false);
			setVersion(0);
			setError(null);
			toast.success(`Loaded ${file.name}`, {
				description: `${parsed.variant.label} · ${parsed.chunks.length} chunks`,
			});
		} catch (e) {
			const msg = e instanceof UnknownProfileError ? e.message : e instanceof Error ? e.message : 'Failed to parse file';
			setError(msg);
			setSave(null);
			setFileName(null);
			toast.error('Could not load profile', { description: msg });
		}
	}, []);

	const download = useCallback(() => {
		if (!save) return;
		const bytes = writeProfileSave(save);
		const blob = new Blob([bytes], { type: 'application/octet-stream' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName ?? 'Profile.BurnoutParadiseSave';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
		toast.success('Saved profile', { description: `${(bytes.byteLength / 1024).toFixed(1)} KB` });
	}, [save, fileName]);

	const editField = useCallback((chunkKey: string, path: Path, value: LeafValue) => {
		setSave((s) => {
			if (!s) return s;
			const chunk = getChunk(s, chunkKey);
			if (chunk) editChunkField(s, chunk, path, value);
			return s;
		});
		setDirty(true);
		setVersion((v) => v + 1);
	}, []);

	const editBit = useCallback((chunkKey: string, path: Path, bit: number, on: boolean) => {
		setSave((s) => {
			if (!s) return s;
			const chunk = getChunk(s, chunkKey);
			if (chunk) editChunkBit(s, chunk, path, bit, on);
			return s;
		});
		setDirty(true);
		setVersion((v) => v + 1);
	}, []);

	const setHeaderString = useCallback((field: RgmhStringField, value: string) => {
		setSave((s) => { if (s) editHeaderString(s, field, value); return s; });
		setDirty(true);
		setVersion((v) => v + 1);
	}, []);

	const setHeaderGuid = useCallback((guid: string) => {
		setSave((s) => { if (s) editHeaderGuid(s, guid); return s; });
		setDirty(true);
		setVersion((v) => v + 1);
	}, []);

	const value = useMemo<SaveProfileContextValue>(
		() => ({ save, fileName, dirty, version, error, load, download, editField, editBit, setHeaderString, setHeaderGuid }),
		[save, fileName, dirty, version, error, load, download, editField, editBit, setHeaderString, setHeaderGuid],
	);

	return <SaveProfileContext.Provider value={value}>{children}</SaveProfileContext.Provider>;
}

export function useSaveProfile(): SaveProfileContextValue {
	const ctx = useContext(SaveProfileContext);
	if (!ctx) throw new Error('useSaveProfile must be used within SaveProfileProvider');
	return ctx;
}
