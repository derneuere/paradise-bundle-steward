// Shared utilities used by every per-resource gltf subtree builder/reader.
//
// The design convention is fixed:
//   scene.extras = {
//     paradiseBundle: {
//       streetData?:  { ... },
//       trafficData?: { ... },
//       aiSections?:  { ... },
//       triggerData?: { ... },
//     },
//   }
// Each resource writes exactly one key under `paradiseBundle`. Importers
// read only their own key.

import type { Scene } from '@gltf-transform/core';

export const PARADISE_BUNDLE = 'paradiseBundle';

/**
 * Extend scene.extras.paradiseBundle[subkey] with the given data. Other
 * paradise-bundle entries are preserved, so multiple resources can share
 * one scene.
 */
export function extendSceneExtras(
	scene: Scene,
	subkey: string,
	data: unknown,
): void {
	const current = (scene.getExtras() ?? {}) as Record<string, unknown>;
	const pb = (current[PARADISE_BUNDLE] ?? {}) as Record<string, unknown>;
	const next = {
		...current,
		[PARADISE_BUNDLE]: { ...pb, [subkey]: data },
	};
	scene.setExtras(next);
}

/**
 * Read scene.extras.paradiseBundle[subkey]. Throws a descriptive error if
 * the scene isn't a worldlogic glTF or the resource isn't present.
 */
export function readSceneExtrasSection(
	scene: Scene,
	subkey: string,
): Record<string, unknown> {
	const rawExtras = (scene.getExtras() ?? {}) as Record<string, unknown>;
	const pb = rawExtras[PARADISE_BUNDLE];
	if (pb === undefined) {
		throw new Error(
			`scene.extras.${PARADISE_BUNDLE} missing — not a Paradise worldlogic glTF`,
		);
	}
	const pbRec = asRecord(pb, `scene.extras.${PARADISE_BUNDLE}`);
	const section = pbRec[subkey];
	if (section === undefined) {
		throw new Error(`scene.extras.${PARADISE_BUNDLE}.${subkey} missing`);
	}
	return asRecord(section, `scene.extras.${PARADISE_BUNDLE}.${subkey}`);
}

/**
 * Check whether scene.extras.paradiseBundle[subkey] is present without
 * throwing. Used by the worldLogic importer to ignore absent resources.
 */
export function hasSceneExtrasSection(scene: Scene, subkey: string): boolean {
	const rawExtras = (scene.getExtras() ?? {}) as Record<string, unknown>;
	const pb = rawExtras[PARADISE_BUNDLE];
	if (pb === undefined || pb === null || typeof pb !== 'object' || Array.isArray(pb)) return false;
	return subkey in (pb as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Type-guard decoders — preserve useful error messages when extras are
// malformed. Every read path uses them so a corrupted glTF fails loud.
// ---------------------------------------------------------------------------

export function asRecord(v: unknown, ctx: string): Record<string, unknown> {
	if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) {
		throw new Error(
			`${ctx}: expected object, got ${Array.isArray(v) ? 'array' : typeof v}`,
		);
	}
	return v as Record<string, unknown>;
}

export function requireNumber(v: unknown, ctx: string): number {
	if (typeof v !== 'number') throw new Error(`${ctx}: expected number, got ${typeof v}`);
	return v;
}

export function requireString(v: unknown, ctx: string): string {
	if (typeof v !== 'string') throw new Error(`${ctx}: expected string, got ${typeof v}`);
	return v;
}

export function encodeBigInt(v: bigint): string {
	return v.toString(10);
}

export function decodeBigInt(v: unknown): bigint {
	if (typeof v === 'string') return BigInt(v);
	if (typeof v === 'number') return BigInt(v);
	if (typeof v === 'bigint') return v;
	throw new Error(`expected bigint-encodable, got ${typeof v}: ${String(v)}`);
}

export function decodeByteArray(v: unknown, len: number): number[] {
	if (!Array.isArray(v)) throw new Error(`expected byte array of length ${len}, got ${typeof v}`);
	if (v.length !== len) throw new Error(`expected byte array of length ${len}, got length ${v.length}`);
	const out = new Array<number>(len);
	for (let i = 0; i < len; i++) {
		const n = v[i];
		if (typeof n !== 'number' || !Number.isInteger(n)) {
			throw new Error(`byte-array element ${i} is not an integer: ${String(n)}`);
		}
		out[i] = n & 0xff;
	}
	return out;
}

// ---------------------------------------------------------------------------
// JSON-safe deep transcoder.
//
// Three JSON hazards in Paradise models:
//   1. bigint — thrown on by JSON.stringify.
//   2. non-finite floats (NaN, ±Infinity) — JSON turns them into `null`,
//      destroying the f32 bit pattern.
//   3. negative zero — JSON.stringify(-0) produces "0", losing the sign bit.
//
// encodeModelDeep wraps hazardous values in tagged objects:
//   { __bigint: "<decimal>" }
//   { __float: "NaN" | "Infinity" | "-Infinity" | "-0" }
// Everything else passes through structurally.
//
// decodeModelDeep reverses the encoding. The pair is the canonical way
// every per-resource gltf subtree stashes its model in scene.extras.
// ---------------------------------------------------------------------------

type BigIntSlot = { __bigint: string };
type FloatSlot = { __float: string };

function isBigIntSlot(v: unknown): v is BigIntSlot {
	return (
		typeof v === 'object' &&
		v !== null &&
		!Array.isArray(v) &&
		'__bigint' in (v as Record<string, unknown>) &&
		typeof (v as Record<string, unknown>).__bigint === 'string'
	);
}

function isFloatSlot(v: unknown): v is FloatSlot {
	return (
		typeof v === 'object' &&
		v !== null &&
		!Array.isArray(v) &&
		'__float' in (v as Record<string, unknown>) &&
		typeof (v as Record<string, unknown>).__float === 'string'
	);
}

function encodeFloat(n: number): FloatSlot | number {
	if (Number.isNaN(n)) return { __float: 'NaN' };
	if (n === Infinity) return { __float: 'Infinity' };
	if (n === -Infinity) return { __float: '-Infinity' };
	if (n === 0 && Object.is(n, -0)) return { __float: '-0' };
	return n;
}

function decodeFloatSlot(slot: FloatSlot): number {
	switch (slot.__float) {
		case 'NaN':       return NaN;
		case 'Infinity':  return Infinity;
		case '-Infinity': return -Infinity;
		case '-0':        return -0;
		default:
			throw new Error(`unknown __float tag: ${slot.__float}`);
	}
}

export function encodeModelDeep(v: unknown): unknown {
	if (typeof v === 'bigint') return { __bigint: v.toString(10) };
	if (typeof v === 'number') return encodeFloat(v);
	if (Array.isArray(v)) return v.map(encodeModelDeep);
	if (v !== null && typeof v === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, sub] of Object.entries(v as Record<string, unknown>)) {
			out[k] = encodeModelDeep(sub);
		}
		return out;
	}
	return v;
}

export function decodeModelDeep(v: unknown): unknown {
	if (isBigIntSlot(v)) return BigInt(v.__bigint);
	if (isFloatSlot(v)) return decodeFloatSlot(v);
	if (Array.isArray(v)) return v.map(decodeModelDeep);
	if (v !== null && typeof v === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, sub] of Object.entries(v as Record<string, unknown>)) {
			out[k] = decodeModelDeep(sub);
		}
		return out;
	}
	return v;
}

// ---------------------------------------------------------------------------
// Visualization-node reconciliation — supports Phase 5 "edit in Blender"
// round-trip. Each per-resource gltf module walks its known group/index
// tree and overlays node translations back onto the decoded model.
// ---------------------------------------------------------------------------

/**
 * Locate a named group beneath a named root. Returns null if either the
 * root or the group is absent, so resources emit different group shapes
 * (flat vs nested) can still reuse the helper.
 */
export function findNamedGroup(
	scene: import('@gltf-transform/core').Scene,
	rootName: string,
	groupName: string,
): import('@gltf-transform/core').Node | null {
	const root = scene.listChildren().find((n) => n.getName() === rootName);
	if (!root) return null;
	return root.listChildren().find((n) => n.getName() === groupName) ?? null;
}

/**
 * Locate a subroot (direct child of the scene) by name. Returns null if
 * absent. Used by resources whose visualization is nested (e.g. TrafficData
 * groups per-hull).
 */
export function findSceneRoot(
	scene: import('@gltf-transform/core').Scene,
	rootName: string,
): import('@gltf-transform/core').Node | null {
	return scene.listChildren().find((n) => n.getName() === rootName) ?? null;
}

/**
 * Serialize a Document as a self-contained .gltf JSON file. Any resource
 * buffers (meshes, accessors, etc.) are inlined as base64 data URIs so the
 * resulting file stands alone — no sibling .bin needed.
 *
 * The output is deterministic: gltf-transform writes stable JSON, and
 * `JSON.stringify(json, null, 2)` pretty-prints in stable key order.
 */
export async function writeDocumentAsGltfJson(
	doc: import('@gltf-transform/core').Document,
): Promise<Uint8Array> {
	const { NodeIO } = await import('@gltf-transform/core');
	const io = new NodeIO();
	const { json, resources } = await io.writeJSON(doc);
	if (Object.keys(resources).length > 0) {
		for (const [name, bytes] of Object.entries(resources)) {
			const b64 = Buffer.from(bytes).toString('base64');
			const uri = `data:application/octet-stream;base64,${b64}`;
			const buf = json.buffers?.find((b) => b.uri === name);
			if (buf) buf.uri = uri;
		}
	}
	return new TextEncoder().encode(JSON.stringify(json, null, 2));
}

/**
 * Overlay the node count of a visualization group onto the model array:
 *   - If fewer nodes than entries: user deleted nodes → truncate the model.
 *   - If more nodes than entries: user duplicated nodes → clone-last to
 *     extend. When the model array is empty and a template is provided,
 *     use the template instead.
 *   - If equal: return the input array unchanged (structural sharing).
 *
 * Uses structuredClone so bigint and typed-array fields survive the copy.
 * Callers should chain a per-field overlay afterward (translation, etc.)
 * to reflect any edits on the duplicated nodes.
 */
export function overlayArrayLength<T>(
	entries: T[],
	targetLength: number,
	template?: T,
): T[] {
	if (entries.length === targetLength) return entries;
	if (targetLength < entries.length) return entries.slice(0, targetLength);
	const extended = entries.slice();
	const source = entries.length > 0 ? entries[entries.length - 1] : template;
	if (source === undefined) {
		throw new Error(
			`overlayArrayLength: cannot extend from length ${entries.length} to ${targetLength} without a template`,
		);
	}
	for (let i = entries.length; i < targetLength; i++) {
		extended.push(structuredClone(source));
	}
	return extended;
}

/**
 * Parse a self-contained .gltf JSON file (as produced by
 * `writeDocumentAsGltfJson`) back into a Document. Extracts any embedded
 * `data:application/octet-stream;base64,...` buffers into the resources
 * dict that NodeIO.readJSON expects, then rewrites the buffer URIs to
 * placeholder names so gltf-transform can wire them up.
 */
export async function readDocumentFromGltfJson(
	bytes: Uint8Array,
): Promise<import('@gltf-transform/core').Document> {
	const { NodeIO } = await import('@gltf-transform/core');
	const io = new NodeIO();
	const json = JSON.parse(new TextDecoder().decode(bytes));
	const resources: Record<string, Uint8Array> = {};
	if (Array.isArray(json.buffers)) {
		for (let i = 0; i < json.buffers.length; i++) {
			const buf = json.buffers[i];
			if (typeof buf.uri !== 'string') continue;
			const m = /^data:[^;]*;base64,(.*)$/.exec(buf.uri);
			if (!m) continue;
			const name = `buffer${i}.bin`;
			resources[name] = new Uint8Array(Buffer.from(m[1], 'base64'));
			buf.uri = name;
		}
	}
	return io.readJSON({ json, resources });
}
