// Registry parser and writer (resource type 0xA000, CgsSound::Playback::Registry).
//
// (File is named soundRegistry.ts only because src/lib/core/registry/ is the
// handler-registry folder — `./registry` already resolves there. The handler
// key is 'registry', matching the wiki type name.)
//
// A Registry maps sound "entities" (name hash → typed payload) so the engine
// can find sounds and DSP features by name. PLAYBACKREGISTRY.BUNDLE describes
// the playback graph vocabulary (content classes/types, voice slots, feature
// schemas with their parameters); RWACFEATUREREGISTRY.BUNDLE describes the
// concrete RWAC DSP feature implementations (panning, filters, reverb, the
// Ginsu music player, …) those schemas bind to.
//
// On-disk layout (32-bit PC, little-endian):
//   0x00 u32 mu32EntityCount
//   0x04 u32 mu32EntityCapacity   — hash-table slots (0x800 in retail)
//   0x08 u32 muDataSize           — entity-data byte size
//   0x0C u32 mpu8Data             — entity-data END offset (fixed up at load)
//   0x10 u32 muStringTableSize
//   0x14 u32 mpcStringTable       — string-table END offset (= content end)
//   0x18 u32 muNameHashMask       — capacity - 1 (asserted)
//   0x1C     hash table: capacity u32 slots, 0 = empty, else file-relative
//            offset of one entity. Slot = (soundHash(name) >> 1) & mask with
//            forward linear probing on collision; insertion order is entity
//            disk order, so the parser rebuilds the table from the entities
//            and asserts it matches — the writer regenerates it the same way.
//            (Verified: GinsuSetPitch/GinsuSetShuffleWidth share home slot
//            1473 in PLAYBACKREGISTRY; the later-inserted one sits at 1474.)
//   then     entity data (entities packed back to back in insertion order)
//   then     string table: NUL-terminated strings, the plain-text names of
//            every hash the registry uses (a debug reverse-lookup pool —
//            order is arbitrary and strings need not match any entity)
//   then     zero pad to 16-byte alignment.
//
// Every entity starts with (mName u32, mTypeName u32) sound hashes; mTypeName
// selects the payload shape. Decoded payloads (validated against both retail
// fixtures):
//   ~ContentClass~      1F4F9B6F  no payload
//   ~ContentType~       9E25A791  u32 ContentClass name hash
//   ~SlotSchema~        EB396D83  u32 ContentClass name hash
//   ~ParameterSchema~   8D2C6829  f32 min, f32 max, u32 direction (0 in/1 out)
//   ~FeatureSchema~     CB8B64C5  u32 paramCount, u32 slotCount, u32
//                                 outputParamCount, then paramCount+slotCount
//                                 name hashes (params first, then slots)
//   ~GenericRwacFeatureImplementation~ B8083A05 (absent from the wiki):
//       u32 uninitialised (0xCDCDCDCD), u32 blockCount, u32 paramCount,
//       u32 slotCount, then blockCount × { u32 reversed-fourCC DSP block code
//       ('Pn21', 'Gns0', 'Rsp0', …), u32, u32 }, paramCount × { u32 param
//       name hash, u16 block index, u16 param index within block }, slotCount
//       × { u32 slot name hash, u32 slot class hash, u16 index, u16
//       uninitialised pad (0xCDCD) }.
// Any other type (~ContentSpec~, ~VoiceSchema~, ~VoiceSpec~ are known to
// exist in other retail registries but not in these fixtures) is preserved as
// a verbatim payload blob so unknown registries still round-trip byte-exact.
//
// Wiki divergences found against real bytes (burnout.wiki/wiki/Registry):
//  - ~ContentType~ / ~ContentClass~ type hashes and the entire
//    GenericRwacFeatureImplementation entity type are undocumented.
//  - The wiki's "ContentClass possible class values" hashes are actually the
//    NAMES of ContentType entities: 84D7FBE7 = ~SplicerContent::
//    SK_CONTENT_TYPE~, 7CCDA2E7 = ~GenericRwacWaveContent::
//    SK_WAVE_DATA_CONTENT_TYPE~.
//  - The hash-table slot function and probe order are undocumented ("randomly
//    placed").
//  - The wiki's VoiceSchema offsets (0x8/0x10/0x11/0x12 for four u32s) are
//    self-overlapping and cannot be the real layout.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Sound hash
// =============================================================================

/**
 * CgsSound::Playback::Name::MakeHash — the custom hash behind every Name in
 * sound resources (from the 2007-10-31 review-build debug symbols, via the
 * wiki's SoundHash gadget). NOT case-folded, unlike CgsID. Empty string has
 * no hash (the game returns -1); callers should treat '' as unhashable.
 */
export function soundHash(name: string): number {
	if (name.length === 0) return -1;
	let result = 0x09b66e03;
	let temp = 0;
	for (let i = 0; i < name.length; i++) {
		temp = Math.imul(result + (name.charCodeAt(i) & 0xff), 0x09b66c41);
		result = temp ^ 0x1de13c89;
	}
	if ((result & 1) === 0) result = temp ^ 0x9de13c88;
	return result >>> 0;
}

// =============================================================================
// Entity type-name hashes
// =============================================================================

export const REGISTRY_TYPE_HASHES = {
	CONTENT_CLASS: 0x1f4f9b6f, // soundHash('~ContentClass~')
	CONTENT_TYPE: 0x9e25a791, // soundHash('~ContentType~')
	SLOT_SCHEMA: 0xeb396d83, // soundHash('~SlotSchema~')
	PARAMETER_SCHEMA: 0x8d2c6829, // soundHash('~ParameterSchema~')
	FEATURE_SCHEMA: 0xcb8b64c5, // soundHash('~FeatureSchema~')
	RWAC_FEATURE: 0xb8083a05, // soundHash('~GenericRwacFeatureImplementation~')
	// Known from the wiki / string tables but not present in our fixtures —
	// parsed as verbatim payload blobs:
	CONTENT_SPEC: 0x511a448b, // soundHash('~ContentSpec~')
	VOICE_SCHEMA: 0xc7382281, // soundHash('~VoiceSchema~')
	VOICE_SPEC: 0x3597ad9b, // soundHash('~VoiceSpec~')
} as const;

export const REGISTRY_TYPE_LABELS: Record<number, string> = {
	[REGISTRY_TYPE_HASHES.CONTENT_CLASS]: 'ContentClass',
	[REGISTRY_TYPE_HASHES.CONTENT_TYPE]: 'ContentType',
	[REGISTRY_TYPE_HASHES.SLOT_SCHEMA]: 'SlotSchema',
	[REGISTRY_TYPE_HASHES.PARAMETER_SCHEMA]: 'ParameterSchema',
	[REGISTRY_TYPE_HASHES.FEATURE_SCHEMA]: 'FeatureSchema',
	[REGISTRY_TYPE_HASHES.RWAC_FEATURE]: 'RwacFeature',
	[REGISTRY_TYPE_HASHES.CONTENT_SPEC]: 'ContentSpec',
	[REGISTRY_TYPE_HASHES.VOICE_SCHEMA]: 'VoiceSchema',
	[REGISTRY_TYPE_HASHES.VOICE_SPEC]: 'VoiceSpec',
};

export const PARAMETER_DIRECTIONS = [
	{ value: 0, label: 'Input' },
	{ value: 1, label: 'Output' },
] as const;

// =============================================================================
// Types
// =============================================================================

export type RegistryParameterSchema = {
	mf32Minimum: number;
	mf32Maximum: number;
	/** EParameterDirection — 0 input, 1 output ("Get*" params are outputs). */
	mu32Direction: number;
};

export type RegistryFeatureSchema = {
	/** Always 0 in retail; meaning unverified (no fixture uses it). */
	mu32OutputParamCount: number;
	/** Name hashes of the feature's ParameterSchema entities. */
	parameterHashes: number[];
	/** Name hashes of the feature's SlotSchema entities. */
	slotHashes: number[];
};

export type RwacDspBlock = {
	/** 4-char DSP block code, human (reversed-byte) order: 'Pn21', 'Gns0', 'Rsp0', … */
	code: string;
	mUnknown04: number;
	mUnknown08: number;
};

export type RwacParamBinding = {
	/** Sound hash of the parameter name (matches a ParameterSchema in the playback registry). */
	mParamName: number;
	/** Which DSP block of this feature owns the parameter. */
	mu16BlockIndex: number;
	/** Parameter index within that block. */
	mu16ParamIndex: number;
};

export type RwacSlotBinding = {
	/** Sound hash of the slot name (matches a SlotSchema in the playback registry). */
	mSlotName: number;
	/** Sound hash of the slot implementation class (e.g. ~GenericRwacContentSlot~). */
	mSlotClass: number;
	mu16Index: number;
	/** Uninitialised tail pad (0xCDCD in retail) — preserved verbatim. */
	_pad0A: number;
};

export type RegistryRwacFeature = {
	/** Uninitialised u32 at payload start (0xCDCDCDCD in retail) — preserved verbatim. */
	_uninit08: number;
	blocks: RwacDspBlock[];
	params: RwacParamBinding[];
	slots: RwacSlotBinding[];
};

// Exactly one payload field is non-null, selected by mTypeName — except
// ContentClass entities (no payload), where all five are null. ContentType
// and SlotSchema share mpContentClass.
export type RegistryEntity = {
	/** Sound hash of the entity name (plain text usually in `strings`). */
	mName: number;
	/** Sound hash of the type name — selects the payload shape. */
	mTypeName: number;
	/** ContentType / SlotSchema payload: name hash of a ContentClass entity. */
	mpContentClass: number | null;
	parameterSchema: RegistryParameterSchema | null;
	featureSchema: RegistryFeatureSchema | null;
	rwacFeature: RegistryRwacFeature | null;
	/** Verbatim payload for type names this parser doesn't decode. */
	_unknownPayload: Uint8Array | null;
};

export type ParsedRegistry = {
	/** Hash-table slot count. 0x800 in retail; must stay a power of two. */
	mu32EntityCapacity: number;
	/** Always capacity - 1 (asserted on parse). */
	muNameHashMask: number;
	/** Entities in disk (= hash-table insertion) order. */
	entities: RegistryEntity[];
	/** Debug string pool — plain-text names of the hashes used above. */
	strings: string[];
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x1c;
const align16 = (n: number) => (n + 15) & ~15;

export function makeEmptyRegistryEntity(): RegistryEntity {
	return {
		mName: 0,
		mTypeName: REGISTRY_TYPE_HASHES.CONTENT_CLASS,
		mpContentClass: null,
		parameterSchema: null,
		featureSchema: null,
		rwacFeature: null,
		_unknownPayload: null,
	};
}

function entityPayloadSize(e: RegistryEntity): number {
	if (e.mpContentClass != null) return 4;
	if (e.parameterSchema != null) return 12;
	if (e.featureSchema != null) {
		return 12 + 4 * (e.featureSchema.parameterHashes.length + e.featureSchema.slotHashes.length);
	}
	if (e.rwacFeature != null) {
		const f = e.rwacFeature;
		return 16 + f.blocks.length * 12 + f.params.length * 8 + f.slots.length * 12;
	}
	if (e._unknownPayload != null) return e._unknownPayload.byteLength;
	return 0;
}

/** Home slot of a name hash in the registry's open-addressed table. */
export function registrySlotOf(nameHash: number, mask: number): number {
	return (nameHash >>> 1) & mask;
}

// =============================================================================
// Reader
// =============================================================================

export function parseRegistry(raw: Uint8Array, littleEndian = true): ParsedRegistry {
	// Copy up front — extractResourceRaw may hand back a Buffer view, and the
	// verbatim payload fields below must not alias the caller's bytes.
	const bytes = new Uint8Array(raw);
	const r = new BinReader(bytes.buffer, littleEndian);

	const entityCount = r.readU32();
	const capacity = r.readU32();
	const dataSize = r.readU32();
	const dataEnd = r.readU32();
	const stringTableSize = r.readU32();
	const stringTableEnd = r.readU32();
	const mask = r.readU32();

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	if (mask !== capacity - 1 || (capacity & mask) !== 0) {
		throw new Error(`Registry: muNameHashMask 0x${mask.toString(16)} != capacity-1 (capacity 0x${capacity.toString(16)})`);
	}
	const dataStart = HEADER_SIZE + capacity * 4;
	if (dataEnd !== dataStart + dataSize) {
		throw new Error(`Registry: mpu8Data 0x${dataEnd.toString(16)} != table end 0x${dataStart.toString(16)} + muDataSize 0x${dataSize.toString(16)}`);
	}
	if (stringTableEnd !== dataEnd + stringTableSize) {
		throw new Error(`Registry: mpcStringTable 0x${stringTableEnd.toString(16)} != data end + muStringTableSize`);
	}
	if (bytes.byteLength !== align16(stringTableEnd)) {
		throw new Error(`Registry: resource is 0x${bytes.byteLength.toString(16)} bytes, expected string-table end 0x${stringTableEnd.toString(16)} padded to 16`);
	}
	for (let i = stringTableEnd; i < bytes.byteLength; i++) {
		if (bytes[i] !== 0) throw new Error(`Registry: non-zero trailing pad byte at 0x${i.toString(16)}`);
	}

	// --- Hash table → entity offsets ---
	const slotByOffset = new Map<number, number>();
	for (let slot = 0; slot < capacity; slot++) {
		r.position = HEADER_SIZE + slot * 4;
		const ptr = r.readU32();
		if (ptr === 0) continue;
		if (ptr < dataStart || ptr >= dataEnd) {
			throw new Error(`Registry: slot ${slot} points at 0x${ptr.toString(16)}, outside entity data [0x${dataStart.toString(16)}, 0x${dataEnd.toString(16)})`);
		}
		slotByOffset.set(ptr, slot);
	}
	if (slotByOffset.size !== entityCount) {
		throw new Error(`Registry: ${slotByOffset.size} occupied slots != mu32EntityCount ${entityCount}`);
	}
	const offsets = [...slotByOffset.keys()].sort((a, b) => a - b);
	if (entityCount > 0 && offsets[0] !== dataStart) {
		throw new Error(`Registry: first entity at 0x${offsets[0].toString(16)}, expected data start 0x${dataStart.toString(16)}`);
	}
	if (entityCount === 0 && dataSize !== 0) {
		throw new Error(`Registry: empty table but muDataSize is 0x${dataSize.toString(16)}`);
	}

	// --- Entities (packed back to back; the next offset bounds each one) ---
	const entities: RegistryEntity[] = [];
	for (let i = 0; i < offsets.length; i++) {
		const start = offsets[i];
		const end = i + 1 < offsets.length ? offsets[i + 1] : dataEnd;
		entities.push(parseEntity(r, bytes, start, end));
	}

	// --- Rebuilt hash table must reproduce the stored slots exactly, or the
	// writer's regeneration would not be byte-exact. ---
	const rebuilt = buildHashTable(entities, capacity, mask, offsets);
	for (const [ptr, slot] of slotByOffset) {
		if (rebuilt.get(ptr) !== slot) {
			throw new Error(`Registry: entity at 0x${ptr.toString(16)} stored in slot ${slot} but (hash>>1)&mask + linear probing derives ${rebuilt.get(ptr)} — insertion order assumption violated`);
		}
	}

	// --- String table: NUL-terminated, latin1 so arbitrary bytes round-trip ---
	const strings: string[] = [];
	let cur = dataEnd;
	while (cur < stringTableEnd) {
		let end = cur;
		while (end < stringTableEnd && bytes[end] !== 0) end++;
		if (end === stringTableEnd) {
			throw new Error(`Registry: unterminated string at 0x${cur.toString(16)}`);
		}
		let s = '';
		for (let j = cur; j < end; j++) s += String.fromCharCode(bytes[j]);
		strings.push(s);
		cur = end + 1;
	}

	return { mu32EntityCapacity: capacity, muNameHashMask: mask, entities, strings };
}

function parseEntity(r: BinReader, bytes: Uint8Array, start: number, end: number): RegistryEntity {
	r.position = start;
	const mName = r.readU32();
	const mTypeName = r.readU32();
	const entity = { ...makeEmptyRegistryEntity(), mName, mTypeName };
	const avail = end - start - 8;
	const sized = (need: number) => {
		if (avail !== need) {
			throw new Error(`Registry: ${REGISTRY_TYPE_LABELS[mTypeName]} entity 0x${mName.toString(16)} has ${avail} payload bytes, expected ${need}`);
		}
	};

	switch (mTypeName) {
		case REGISTRY_TYPE_HASHES.CONTENT_CLASS:
			sized(0);
			break;
		case REGISTRY_TYPE_HASHES.CONTENT_TYPE:
		case REGISTRY_TYPE_HASHES.SLOT_SCHEMA:
			sized(4);
			entity.mpContentClass = r.readU32();
			break;
		case REGISTRY_TYPE_HASHES.PARAMETER_SCHEMA:
			sized(12);
			entity.parameterSchema = {
				mf32Minimum: r.readF32(),
				mf32Maximum: r.readF32(),
				mu32Direction: r.readU32(),
			};
			break;
		case REGISTRY_TYPE_HASHES.FEATURE_SCHEMA: {
			const paramCount = r.readU32();
			const slotCount = r.readU32();
			const mu32OutputParamCount = r.readU32();
			sized(12 + 4 * (paramCount + slotCount));
			const parameterHashes: number[] = [];
			for (let i = 0; i < paramCount; i++) parameterHashes.push(r.readU32());
			const slotHashes: number[] = [];
			for (let i = 0; i < slotCount; i++) slotHashes.push(r.readU32());
			entity.featureSchema = { mu32OutputParamCount, parameterHashes, slotHashes };
			break;
		}
		case REGISTRY_TYPE_HASHES.RWAC_FEATURE: {
			const _uninit08 = r.readU32();
			const blockCount = r.readU32();
			const paramCount = r.readU32();
			const slotCount = r.readU32();
			sized(16 + blockCount * 12 + paramCount * 8 + slotCount * 12);
			const blocks: RwacDspBlock[] = [];
			for (let i = 0; i < blockCount; i++) {
				const code = readBlockCode(bytes, r.position);
				r.position += 4;
				blocks.push({ code, mUnknown04: r.readU32(), mUnknown08: r.readU32() });
			}
			const params: RwacParamBinding[] = [];
			for (let i = 0; i < paramCount; i++) {
				params.push({ mParamName: r.readU32(), mu16BlockIndex: r.readU16(), mu16ParamIndex: r.readU16() });
			}
			const slots: RwacSlotBinding[] = [];
			for (let i = 0; i < slotCount; i++) {
				slots.push({ mSlotName: r.readU32(), mSlotClass: r.readU32(), mu16Index: r.readU16(), _pad0A: r.readU16() });
			}
			entity.rwacFeature = { _uninit08, blocks, params, slots };
			break;
		}
		default:
			entity._unknownPayload = bytes.slice(start + 8, end);
			break;
	}
	return entity;
}

// The block code is a u32 multi-char constant — byte-reversing gives the
// human-readable tag ('Pn21', 'Gns0', …). Non-printable bytes would make the
// reversal ambiguous to re-encode, so they fail loudly.
function readBlockCode(bytes: Uint8Array, at: number): string {
	let code = '';
	for (let i = 3; i >= 0; i--) {
		const b = bytes[at + i];
		if (b < 0x20 || b > 0x7e) {
			throw new Error(`Registry: non-printable DSP block code byte 0x${b.toString(16)} at 0x${(at + i).toString(16)}`);
		}
		code += String.fromCharCode(b);
	}
	return code;
}

// =============================================================================
// Writer
// =============================================================================

function buildHashTable(
	entities: RegistryEntity[],
	capacity: number,
	mask: number,
	offsets: number[],
): Map<number, number> {
	const used = new Set<number>();
	const slotByOffset = new Map<number, number>();
	for (let i = 0; i < entities.length; i++) {
		let slot = registrySlotOf(entities[i].mName, mask);
		let hops = 0;
		while (used.has(slot)) {
			slot = (slot + 1) & mask;
			if (++hops > capacity) throw new Error('Registry: hash table full');
		}
		used.add(slot);
		slotByOffset.set(offsets[i], slot);
	}
	return slotByOffset;
}

export function writeRegistry(model: ParsedRegistry, littleEndian = true): Uint8Array {
	const capacity = model.mu32EntityCapacity;
	const mask = model.muNameHashMask;
	if (mask !== capacity - 1 || (capacity & mask) !== 0) {
		throw new Error(`Registry writer: muNameHashMask 0x${mask.toString(16)} != capacity-1 (capacity 0x${capacity.toString(16)})`);
	}
	if (model.entities.length > capacity) {
		throw new Error(`Registry writer: ${model.entities.length} entities exceed table capacity ${capacity}`);
	}

	// File-relative offsets recomputed from the entity shapes, never stored.
	const dataStart = HEADER_SIZE + capacity * 4;
	const offsets: number[] = [];
	let cursor = dataStart;
	for (const e of model.entities) {
		offsets.push(cursor);
		cursor += 8 + entityPayloadSize(e);
	}
	const dataEnd = cursor;
	let stringTableSize = 0;
	for (const s of model.strings) stringTableSize += s.length + 1;
	const stringTableEnd = dataEnd + stringTableSize;
	const totalSize = align16(stringTableEnd);

	const w = new BinWriter(totalSize, littleEndian);
	w.writeU32(model.entities.length);
	w.writeU32(capacity);
	w.writeU32(dataEnd - dataStart);
	w.writeU32(dataEnd);
	w.writeU32(stringTableSize);
	w.writeU32(stringTableEnd);
	w.writeU32(mask);

	// --- Hash table (insertion order = entity order) ---
	w.writeZeroes(capacity * 4);
	for (const [offset, slot] of buildHashTable(model.entities, capacity, mask, offsets)) {
		w.setU32(HEADER_SIZE + slot * 4, offset);
	}

	// --- Entity data ---
	for (let i = 0; i < model.entities.length; i++) {
		if (w.offset !== offsets[i]) {
			throw new Error(`Registry writer: entity ${i} at 0x${w.offset.toString(16)}, expected 0x${offsets[i].toString(16)}`);
		}
		writeEntity(w, model.entities[i]);
	}
	if (w.offset !== dataEnd) {
		throw new Error(`Registry writer: entity data ends at 0x${w.offset.toString(16)}, expected 0x${dataEnd.toString(16)}`);
	}

	// --- String table (latin1) + zero pad to 16 ---
	for (const s of model.strings) {
		for (let i = 0; i < s.length; i++) {
			const c = s.charCodeAt(i);
			if (c === 0 || c > 0xff) {
				throw new Error(`Registry writer: string "${s}" has a byte-unrepresentable character`);
			}
			w.writeU8(c);
		}
		w.writeU8(0);
	}
	if (w.offset !== stringTableEnd) {
		throw new Error(`Registry writer: string table ends at 0x${w.offset.toString(16)}, expected 0x${stringTableEnd.toString(16)}`);
	}
	w.writeZeroes(totalSize - stringTableEnd);
	return w.bytes;
}

function writeEntity(w: BinWriter, e: RegistryEntity) {
	w.writeU32(e.mName);
	w.writeU32(e.mTypeName);
	if (e.mpContentClass != null) {
		w.writeU32(e.mpContentClass);
	} else if (e.parameterSchema != null) {
		w.writeF32(e.parameterSchema.mf32Minimum);
		w.writeF32(e.parameterSchema.mf32Maximum);
		w.writeU32(e.parameterSchema.mu32Direction);
	} else if (e.featureSchema != null) {
		w.writeU32(e.featureSchema.parameterHashes.length);
		w.writeU32(e.featureSchema.slotHashes.length);
		w.writeU32(e.featureSchema.mu32OutputParamCount);
		for (const h of e.featureSchema.parameterHashes) w.writeU32(h);
		for (const h of e.featureSchema.slotHashes) w.writeU32(h);
	} else if (e.rwacFeature != null) {
		const f = e.rwacFeature;
		w.writeU32(f._uninit08);
		w.writeU32(f.blocks.length);
		w.writeU32(f.params.length);
		w.writeU32(f.slots.length);
		for (const b of f.blocks) {
			if (b.code.length !== 4) {
				throw new Error(`Registry writer: DSP block code "${b.code}" must be exactly 4 characters`);
			}
			for (let i = 3; i >= 0; i--) w.writeU8(b.code.charCodeAt(i));
			w.writeU32(b.mUnknown04);
			w.writeU32(b.mUnknown08);
		}
		for (const p of f.params) {
			w.writeU32(p.mParamName);
			w.writeU16(p.mu16BlockIndex);
			w.writeU16(p.mu16ParamIndex);
		}
		for (const s of f.slots) {
			w.writeU32(s.mSlotName);
			w.writeU32(s.mSlotClass);
			w.writeU16(s.mu16Index);
			w.writeU16(s._pad0A);
		}
	} else if (e._unknownPayload != null) {
		w.writeBytes(e._unknownPayload);
	}
}
