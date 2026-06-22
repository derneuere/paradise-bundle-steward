// Container layout for BrnGui::ProfileManager::ProfileStoredData. The save body
// (everything after any platform header) is a fixed sequence of
// FixedSizeOpaqueBuffer<T> chunks at platform-specific offsets. Each variant
// tiles its body exactly; the codec splits the body into these chunks (each one
// is byte-exact on its own) and decodes the ones it understands.
//
// Source: docs/save-profile/container.md (wiki "Profile/Burnout Paradise").

import type { Endian } from './binio';

export type HeaderKind = 'rgmh' | 'mc02' | 'none';

export type ChunkKey =
	| 'progression'
	| 'liveRevenge'
	| 'options'
	| 'cagney'
	| 'cagneyOptions'
	| 'davis'
	| 'recentPlayers'
	| 'pdlc'
	| 'cop'
	| 'island'
	| 'padding';

export type ChunkDef = {
	key: ChunkKey;
	name: string;
	offset: number;
	size: number;
	addedIn?: string; // game version that introduced it
};

export type ProfileVariantId = 'ps3' | 'xbox360' | 'pc' | 'ps4' | 'pc-remastered' | 'switch';

export type ProfileVariant = {
	id: ProfileVariantId;
	label: string;
	header: HeaderKind;
	endian: Endian;
	bodyLength: number; // sum of all chunk sizes
	chunks: ChunkDef[];
};

const C = (key: ChunkKey, name: string, offset: number, size: number, addedIn?: string): ChunkDef =>
	({ key, name, offset, size, addedIn });

export const VARIANTS: ProfileVariant[] = [
	{
		id: 'ps3', label: 'PlayStation 3', header: 'none', endian: 'be', bodyLength: 0x40000,
		chunks: [
			C('progression', 'Progression Profile', 0x0, 0x1da30),
			C('liveRevenge', 'Live Revenge Profile', 0x1da30, 0x7540),
			C('options', 'Options Data Profile', 0x24f70, 0x7370),
			C('cagney', 'Cagney Profile', 0x2c2e0, 0xac0, '1.3'),
			C('cagneyOptions', 'Cagney Options Data Profile', 0x2cda0, 0x18, '1.3'),
			C('davis', 'Davis Profile', 0x2cdb8, 0x19c8, '1.4'),
			C('pdlc', 'PDLC Profile', 0x2e780, 0x1c60, '1.7'),
			C('cop', 'Cop Profile', 0x303e0, 0x268, '1.8'),
			C('island', 'Island Profile', 0x30648, 0x10a8, '1.9'),
			C('padding', 'Padding', 0x316f0, 0xe910),
		],
	},
	{
		id: 'xbox360', label: 'Xbox 360', header: 'mc02', endian: 'be', bodyLength: 0x40000,
		chunks: [
			C('progression', 'Progression Profile', 0x0, 0x1cd30),
			C('liveRevenge', 'Live Revenge Profile', 0x1cd30, 0x7540),
			C('options', 'Options Data Profile', 0x24270, 0x7370),
			C('cagney', 'Cagney Profile', 0x2b5e0, 0xac0, '1.3'),
			C('cagneyOptions', 'Cagney Options Data Profile', 0x2c0a0, 0x18, '1.3'),
			C('davis', 'Davis Profile', 0x2c0b8, 0x17c8, '1.4'),
			C('pdlc', 'PDLC Profile', 0x2d880, 0x1c60, '1.7'),
			C('cop', 'Cop Profile', 0x2f4e0, 0x268, '1.8'),
			C('island', 'Island Profile', 0x2f748, 0xfe0, '1.9'),
			C('padding', 'Padding', 0x30728, 0xf8d8),
		],
	},
	{
		id: 'pc', label: 'PC', header: 'rgmh', endian: 'le', bodyLength: 0x40000,
		chunks: [
			C('progression', 'Progression Profile', 0x0, 0x1cc00),
			C('liveRevenge', 'Live Revenge Profile', 0x1cc00, 0x6d68),
			C('options', 'Options Data Profile', 0x23968, 0x7780),
			C('cagney', 'Cagney Profile', 0x2b0e8, 0xac0, '1.3'),
			C('cagneyOptions', 'Cagney Options Data Profile', 0x2bba8, 0x18, '1.3'),
			C('davis', 'Davis Profile', 0x2bbc0, 0x19c8, '1.4'),
			C('recentPlayers', 'Recent Players Profile', 0x2d588, 0xc88),
			C('pdlc', 'PDLC Profile', 0x2e210, 0x1c68, '1.7'),
			C('padding', 'Padding', 0x2fe78, 0x10188),
		],
	},
	{
		id: 'ps4', label: 'PlayStation 4', header: 'none', endian: 'le', bodyLength: 0x80001,
		chunks: [
			C('progression', 'Progression Profile', 0x0, 0x66100),
			C('liveRevenge', 'Live Revenge Profile', 0x66100, 0x7d10),
			C('options', 'Options Data Profile', 0x6de10, 0x7778),
			C('cagney', 'Cagney Profile', 0x75588, 0xac0, '1.3'),
			C('cagneyOptions', 'Cagney Options Data Profile', 0x76048, 0x18, '1.3'),
			C('davis', 'Davis Profile', 0x76060, 0x1c48, '1.4'),
			C('pdlc', 'PDLC Profile', 0x77ca8, 0x1c68, '1.7'),
			C('cop', 'Cop Profile', 0x79910, 0x268, '1.8'),
			C('island', 'Island Profile', 0x79b78, 0x11e0, '1.9'),
			C('padding', 'Padding', 0x7ad58, 0x52a9),
		],
	},
	{
		id: 'pc-remastered', label: 'PC (Remastered)', header: 'rgmh', endian: 'le', bodyLength: 0x80000,
		chunks: [
			C('progression', 'Progression Profile', 0x0, 0x65da0),
			C('liveRevenge', 'Live Revenge Profile', 0x65da0, 0x7538),
			C('options', 'Options Data Profile', 0x6d2d8, 0x7778),
			C('cagney', 'Cagney Profile', 0x74a50, 0xac0, '1.3'),
			C('cagneyOptions', 'Cagney Options Data Profile', 0x75510, 0x18, '1.3'),
			C('davis', 'Davis Profile', 0x75528, 0x1c48, '1.4'),
			C('pdlc', 'PDLC Profile', 0x77170, 0x1c68, '1.7'),
			C('cop', 'Cop Profile', 0x78dd8, 0x268, '1.8'),
			C('island', 'Island Profile', 0x79040, 0x11d8, '1.9'),
			C('padding', 'Padding', 0x7a218, 0x5de8),
		],
	},
	{
		id: 'switch', label: 'Switch', header: 'none', endian: 'le', bodyLength: 0x80000,
		chunks: [
			C('progression', 'Progression Profile', 0x0, 0x66820),
			C('liveRevenge', 'Live Revenge Profile', 0x66820, 0x84e0),
			C('options', 'Options Data Profile', 0x6ed00, 0x7778),
			C('cagney', 'Cagney Profile', 0x76478, 0xac0, '1.3'),
			C('cagneyOptions', 'Cagney Options Data Profile', 0x76f38, 0x18, '1.3'),
			C('davis', 'Davis Profile', 0x76f50, 0x2048, '1.4'),
			C('pdlc', 'PDLC Profile', 0x78f98, 0x1c68, '1.7'),
			C('cop', 'Cop Profile', 0x7ac00, 0x268, '1.8'),
			C('island', 'Island Profile', 0x7ae68, 0x1360, '1.9'),
			C('padding', 'Padding', 0x7c1c8, 0x3e38),
		],
	},
];

export function variantById(id: ProfileVariantId): ProfileVariant {
	const v = VARIANTS.find((x) => x.id === id);
	if (!v) throw new Error(`unknown profile variant: ${id}`);
	return v;
}

/**
 * Pick the variant from the detected header kind and the body length. The pair
 * is unambiguous: PC / PC-Remastered carry RGMH, X360 carries MC02, and the
 * three header-less platforms (PS3 / PS4 / Switch) have distinct body sizes.
 */
export function detectVariant(header: HeaderKind, bodyLength: number): ProfileVariant | null {
	return (
		VARIANTS.find((v) => v.header === header && v.bodyLength === bodyLength) ?? null
	);
}
