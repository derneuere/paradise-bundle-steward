// ZoneList parser and writer (resource type 0xB000)
//
// The ZoneList is the artist-authored streaming PVS (one per `PVS.BNDL`).
// Each zone is a quad of points with explicit safe/unsafe neighbour lists.
// Layout reference: docs/zone-list-spec.md (which is itself derived from
// https://burnout.wiki/wiki/Zone_List, refined via observation of the PC
// fixture `example/PVS.BNDL`).
//
// Scope: 32-bit PC, little-endian. The wiki documents 64-bit (Paradise
// Remastered) and big-endian variants too; both are unimplemented for now,
// matching the existing scope of streetData / trafficData.
//
// Round-trip strategy:
//  - On read, raw pointers (Neighbour.mpZone, Zone.mpSafeNeighbours, etc.)
//    are resolved to integer indices in the model. The writer recomputes
//    them from scratch based on the layout it lays out.
//  - Each on-disk Vector2 occupies 16 bytes — the spec calls it Vector2*,
//    but the actual stride is padded for SIMD alignment. Trailing pad bytes
//    are read verbatim into `_padA / _padB` so byte-exact round-trip holds
//    even if those slots ever turn out to carry side-band data.
//  - Sections are emitted in the order the fixture uses:
//        header → pad16 → zones → neighbours → points → starts → counts → pad16

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type Vec2Padded = {
	x: number;
	y: number;
	// f32 × 2 trailing pad — preserved verbatim for byte-exact round-trip.
	_padA: number;
	_padB: number;
};

export const NEIGHBOUR_FLAGS = {
	NONE: 0x0,
	RENDER: 0x1,
	IMMEDIATE: 0x2,
} as const;

export type Neighbour = {
	zoneIndex: number;     // resolved from on-disk Zone* pointer
	muFlags: number;       // bitfield of NEIGHBOUR_FLAGS
	// 8 bytes of trailing pad on disk — preserved verbatim.
	_padA: number;
	_padB: number;
};

export type Zone = {
	muZoneId: bigint;
	miZoneType: number;
	miNumPoints: number;       // always 4 in retail
	muFlags: number;           // unused per spec
	points: Vec2Padded[];      // miNumPoints entries
	safeNeighbours: Neighbour[];
	unsafeNeighbours: Neighbour[];
	// Header padding bytes for the zone record — preserved verbatim.
	_pad0C: number;
	_pad24: [number, number, number];
};

export type ParsedZoneList = {
	zones: Zone[];
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE_32 = 0x18;
const ZONE_RECORD_SIZE_32 = 0x30;
const NEIGHBOUR_RECORD_SIZE_32 = 0x10;
const POINT_RECORD_SIZE = 0x10; // Vector2 padded to 16 bytes
const POINT_COUNT_PER_ZONE = 4;

// =============================================================================
// Reader
// =============================================================================

export function parseZoneListData(raw: Uint8Array, littleEndian = true): ParsedZoneList {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// Header
	const ptrPoints = r.readU32();
	const ptrZones = r.readU32();
	const ptrZonePointStarts = r.readU32();
	const ptrZonePointCounts = r.readU32();
	const muTotalZones = r.readU32();
	const muTotalPoints = r.readU32();

	if (muTotalZones === 0) return { zones: [] };

	// Read all zonePointStarts up-front so we can slice the points pool.
	const zonePointStarts: number[] = [];
	r.position = ptrZonePointStarts;
	for (let i = 0; i < muTotalZones; i++) zonePointStarts.push(r.readU32());

	const zonePointCounts: number[] = [];
	r.position = ptrZonePointCounts;
	for (let i = 0; i < muTotalZones; i++) zonePointCounts.push(r.readI16());

	// Read all points up-front.
	const allPoints: Vec2Padded[] = [];
	r.position = ptrPoints;
	for (let i = 0; i < muTotalPoints; i++) {
		const x = r.readF32();
		const y = r.readF32();
		const padA = r.readF32();
		const padB = r.readF32();
		allPoints.push({ x, y, _padA: padA, _padB: padB });
	}

	// Read all zone records. Resolve their pointer fields to indices later
	// (we need every zone's offset before we can resolve mpZone references).
	type RawZone = {
		mpPoints: number;
		mpSafe: number;
		mpUnsafe: number;
		_pad0C: number;
		muZoneId: bigint;
		miZoneType: number;
		miNumPoints: number;
		miNumSafe: number;
		miNumUnsafe: number;
		muFlags: number;
		_pad24: [number, number, number];
	};
	const rawZones: RawZone[] = [];
	r.position = ptrZones;
	for (let i = 0; i < muTotalZones; i++) {
		const mpPoints = r.readU32();
		const mpSafe = r.readU32();
		const mpUnsafe = r.readU32();
		const _pad0C = r.readU32();
		const muZoneId = r.readU64();
		const miZoneType = r.readI16();
		const miNumPoints = r.readI16();
		const miNumSafe = r.readI16();
		const miNumUnsafe = r.readI16();
		const muFlags = r.readU32();
		const _pad24a = r.readU32();
		const _pad24b = r.readU32();
		const _pad24c = r.readU32();
		rawZones.push({
			mpPoints, mpSafe, mpUnsafe, _pad0C, muZoneId,
			miZoneType, miNumPoints, miNumSafe, miNumUnsafe, muFlags,
			_pad24: [_pad24a, _pad24b, _pad24c],
		});
	}

	// Map a Zone* pointer to its zone index. Pointers are stored as raw byte
	// offsets into the resource payload so a cheap base-offset / stride
	// inversion suffices.
	const ptrToZoneIndex = (p: number): number => {
		if (p === 0) return -1;
		const idx = (p - ptrZones) / ZONE_RECORD_SIZE_32;
		if (!Number.isInteger(idx) || idx < 0 || idx >= muTotalZones) {
			throw new Error(`ZoneList: neighbour pointer 0x${p.toString(16)} doesn't land on a zone record (zones at 0x${ptrZones.toString(16)}, count ${muTotalZones})`);
		}
		return idx;
	};

	// Read each zone's neighbour slices. Order on disk: safe block then
	// unsafe block, contiguous, per-zone-index.
	const zones: Zone[] = [];
	for (let zi = 0; zi < muTotalZones; zi++) {
		const rz = rawZones[zi];

		const safeNeighbours: Neighbour[] = [];
		if (rz.miNumSafe > 0) {
			r.position = rz.mpSafe;
			for (let n = 0; n < rz.miNumSafe; n++) {
				const mpZone = r.readU32();
				const muFlags = r.readU32();
				const padA = r.readU32();
				const padB = r.readU32();
				safeNeighbours.push({
					zoneIndex: ptrToZoneIndex(mpZone),
					muFlags, _padA: padA, _padB: padB,
				});
			}
		}
		const unsafeNeighbours: Neighbour[] = [];
		if (rz.miNumUnsafe > 0) {
			r.position = rz.mpUnsafe;
			for (let n = 0; n < rz.miNumUnsafe; n++) {
				const mpZone = r.readU32();
				const muFlags = r.readU32();
				const padA = r.readU32();
				const padB = r.readU32();
				unsafeNeighbours.push({
					zoneIndex: ptrToZoneIndex(mpZone),
					muFlags, _padA: padA, _padB: padB,
				});
			}
		}

		// Slice this zone's points out of the shared pool.
		const startIdx = zonePointStarts[zi];
		const count = zonePointCounts[zi];
		const points: Vec2Padded[] = [];
		for (let pi = 0; pi < count; pi++) {
			const p = allPoints[startIdx + pi];
			if (!p) throw new Error(`ZoneList: zone ${zi} references point ${startIdx + pi} but pool only has ${allPoints.length}`);
			points.push(p);
		}

		zones.push({
			muZoneId: rz.muZoneId,
			miZoneType: rz.miZoneType,
			miNumPoints: rz.miNumPoints,
			muFlags: rz.muFlags,
			points,
			safeNeighbours,
			unsafeNeighbours,
			_pad0C: rz._pad0C,
			_pad24: rz._pad24,
		});
	}

	return { zones };
}

// =============================================================================
// Writer
// =============================================================================

function padTo16(w: BinWriter) {
	const mod = w.offset % 16;
	if (mod !== 0) w.writeZeroes(16 - mod);
}

export function writeZoneListData(model: ParsedZoneList, littleEndian = true): Uint8Array {
	const zones = model.zones;
	const muTotalZones = zones.length;

	// Compute total-point count and the contiguous starts/counts arrays.
	let muTotalPoints = 0;
	const zonePointStarts: number[] = [];
	const zonePointCounts: number[] = [];
	for (const z of zones) {
		zonePointStarts.push(muTotalPoints);
		zonePointCounts.push(z.miNumPoints);
		muTotalPoints += z.points.length;
		if (z.points.length !== z.miNumPoints) {
			throw new Error(`ZoneList: zone has miNumPoints=${z.miNumPoints} but ${z.points.length} entries in points[]`);
		}
	}

	// Pre-compute fixed offsets so we can patch pointers in one pass.
	const pad8 = HEADER_SIZE_32 % 16 === 0 ? 0 : 16 - (HEADER_SIZE_32 % 16);
	const offZones = HEADER_SIZE_32 + pad8;                                  // 0x20
	const zonesByteLength = muTotalZones * ZONE_RECORD_SIZE_32;
	const offNeighbours = offZones + zonesByteLength;
	let totalNeighbours = 0;
	for (const z of zones) totalNeighbours += z.safeNeighbours.length + z.unsafeNeighbours.length;
	const neighboursByteLength = totalNeighbours * NEIGHBOUR_RECORD_SIZE_32;
	const offPoints = offNeighbours + neighboursByteLength;
	const pointsByteLength = muTotalPoints * POINT_RECORD_SIZE;
	const offZonePointStarts = offPoints + pointsByteLength;
	const offZonePointCounts = offZonePointStarts + muTotalZones * 4;
	const totalBeforeFinalPad = offZonePointCounts + muTotalZones * 2;
	const finalPad = totalBeforeFinalPad % 16 === 0 ? 0 : 16 - (totalBeforeFinalPad % 16);
	const totalSize = totalBeforeFinalPad + finalPad;

	const w = new BinWriter(totalSize, littleEndian);

	// --- Header (with pointer fields seeded to the offsets we computed) ---
	w.writeU32(offPoints);
	w.writeU32(offZones);
	w.writeU32(offZonePointStarts);
	w.writeU32(offZonePointCounts);
	w.writeU32(muTotalZones);
	w.writeU32(muTotalPoints);

	// Pad to 16-byte boundary before zones.
	if (pad8 > 0) w.writeZeroes(pad8);
	if (w.offset !== offZones) throw new Error(`ZoneList writer: zones offset mismatch ${w.offset} vs ${offZones}`);

	// --- Zones (with placeholder pointers for safe/unsafe; patched below) ---
	const zoneRecordOff: number[] = [];
	const zoneSafePtrSlots: number[] = [];
	const zoneUnsafePtrSlots: number[] = [];
	for (let zi = 0; zi < muTotalZones; zi++) {
		const z = zones[zi];
		zoneRecordOff.push(w.offset);
		w.writeU32(offPoints + zonePointStarts[zi] * POINT_RECORD_SIZE);  // mpPoints
		zoneSafePtrSlots.push(w.offset);
		w.writeU32(0); // mpSafeNeighbours placeholder
		zoneUnsafePtrSlots.push(w.offset);
		w.writeU32(0); // mpUnsafeNeighbours placeholder
		w.writeU32(z._pad0C);
		w.writeU64(z.muZoneId);
		w.writeI16(z.miZoneType);
		w.writeI16(z.miNumPoints);
		w.writeI16(z.safeNeighbours.length);
		w.writeI16(z.unsafeNeighbours.length);
		w.writeU32(z.muFlags);
		w.writeU32(z._pad24[0]);
		w.writeU32(z._pad24[1]);
		w.writeU32(z._pad24[2]);
	}
	if (w.offset !== offNeighbours) throw new Error(`ZoneList writer: neighbour offset mismatch ${w.offset} vs ${offNeighbours}`);

	// --- Neighbour pool: per zone, safe first then unsafe ---
	for (let zi = 0; zi < muTotalZones; zi++) {
		const z = zones[zi];
		// Safe block — patch zone's mpSafeNeighbours to point here.
		if (z.safeNeighbours.length > 0) {
			w.setU32(zoneSafePtrSlots[zi], w.offset);
			for (const n of z.safeNeighbours) {
				const targetOff = n.zoneIndex >= 0 ? zoneRecordOff[n.zoneIndex] : 0;
				w.writeU32(targetOff);
				w.writeU32(n.muFlags);
				w.writeU32(n._padA);
				w.writeU32(n._padB);
			}
		} // else leave as 0
		// Unsafe block — same pattern.
		if (z.unsafeNeighbours.length > 0) {
			w.setU32(zoneUnsafePtrSlots[zi], w.offset);
			for (const n of z.unsafeNeighbours) {
				const targetOff = n.zoneIndex >= 0 ? zoneRecordOff[n.zoneIndex] : 0;
				w.writeU32(targetOff);
				w.writeU32(n.muFlags);
				w.writeU32(n._padA);
				w.writeU32(n._padB);
			}
		}
	}
	if (w.offset !== offPoints) throw new Error(`ZoneList writer: points offset mismatch ${w.offset} vs ${offPoints}`);

	// --- Points (16 bytes each: x, y, _padA, _padB as f32) ---
	for (const z of zones) {
		for (const p of z.points) {
			w.writeF32(p.x);
			w.writeF32(p.y);
			w.writeF32(p._padA);
			w.writeF32(p._padB);
		}
	}
	if (w.offset !== offZonePointStarts) throw new Error(`ZoneList writer: zonePointStarts offset mismatch ${w.offset} vs ${offZonePointStarts}`);

	// --- zonePointStarts ---
	for (const s of zonePointStarts) w.writeU32(s);
	if (w.offset !== offZonePointCounts) throw new Error(`ZoneList writer: zonePointCounts offset mismatch ${w.offset} vs ${offZonePointCounts}`);

	// --- zonePointCounts ---
	for (const c of zonePointCounts) w.writeI16(c);

	// --- Final 16-byte pad ---
	padTo16(w);

	return w.bytes;
}
