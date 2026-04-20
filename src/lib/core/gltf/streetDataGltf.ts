// StreetData ↔ glTF 2.0 round-trip.
//
// Design points locked in docs/worldlogic-gltf-roundtrip.md:
//   - One file per bundle; StreetData lives under a top-level `StreetData` group.
//   - Byte-exact writer-idempotent round-trip: writeStreetDataData before and
//     after the glTF round-trip must produce the same bytes.
//   - No custom extensions; everything non-geometric is stored in node/scene
//     extras using human-readable keys.
//   - Bigints stringified as decimal (JSON numbers lose precision above 2^53).
//   - Junctions / Streets / ChallengeParScores have no intrinsic position —
//     translation is derived from the linked road for Blender visibility and
//     is ignored on re-import.
//
// The exporter's output is deterministic: for the same model it produces the
// same bytes, so golden-hash tests are stable.

import { Document, NodeIO, type Scene } from '@gltf-transform/core';
import {
	ESpanType,
	type AIInfo,
	type ChallengeParScores,
	type Junction,
	type ParsedStreetData,
	type Road,
	type SpanBase,
	type Street,
} from '../streetData';
import { paradiseToGltf, gltfToParadise } from './coords';
import {
	extendSceneExtras,
	readSceneExtrasSection,
	asRecord,
	requireNumber,
	requireString,
	decodeBigInt,
	decodeByteArray,
	encodeBigInt,
	writeDocumentAsGltfJson,
	readDocumentFromGltfJson,
} from './sharedGltf';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERATOR = 'steward-worldlogic-gltf/1';

// Node-name prefixes. `<Group>/<Type> <index> (<id>)` mirrors the
// TriggersToGLTF convention — the `(<id>)` suffix is the canonical identity
// token for round-trip.
export const GROUP_STREET_DATA = 'StreetData';
const GROUP_JUNCTIONS = 'Junctions';
const GROUP_ROADS = 'Roads';
const GROUP_STREETS = 'Streets';
const GROUP_CHALLENGES = 'ChallengeParScores';

// Scene-level extras subkey.
const SCENE_EXTRAS_STREET_DATA = 'streetData';

// ---------------------------------------------------------------------------
// Extras key names — human-readable, mirrored verbatim on import. One map per
// struct so the exporter and importer share exactly one definition.
// ---------------------------------------------------------------------------

const K_SPANBASE_ROAD_INDEX = 'Road index';
const K_SPANBASE_SPAN_INDEX = 'Span index';
const K_SPANBASE_PADDING = 'Span base padding';
const K_SPANBASE_SPAN_TYPE = 'Span type';

const K_STREET_MAX_SPEED = 'Max speed MPS';
const K_STREET_MIN_SPEED = 'Min speed MPS';
const K_STREET_PADDING = 'Street padding';

const K_JUNCTION_EXITS_POINTER = 'Exits pointer';
const K_JUNCTION_EXIT_COUNT = 'Exit count';
const K_JUNCTION_NAME = 'Name';

const K_ROAD_SPANS_POINTER = 'Spans pointer';
const K_ROAD_ID = 'ID';
const K_ROAD_LIMIT_ID_0 = 'Road limit ID 0';
const K_ROAD_LIMIT_ID_1 = 'Road limit ID 1';
const K_ROAD_DEBUG_NAME = 'Debug name';
const K_ROAD_CHALLENGE = 'Challenge';
const K_ROAD_SPAN_COUNT = 'Span count';
const K_ROAD_UNKNOWN = 'Unknown';
const K_ROAD_PADDING = 'Road padding';

const K_CHALLENGE_DIRTY = 'Dirty';
const K_CHALLENGE_VALID_SCORE = 'Valid score';
const K_CHALLENGE_SCORES = 'Scores';
const K_CHALLENGE_RIVALS = 'Rivals';

// ---------------------------------------------------------------------------
// Per-struct extras encoders
// ---------------------------------------------------------------------------

function spanBaseExtras(s: SpanBase): Record<string, unknown> {
	return {
		[K_SPANBASE_ROAD_INDEX]: s.miRoadIndex,
		[K_SPANBASE_SPAN_INDEX]: s.miSpanIndex,
		[K_SPANBASE_PADDING]: [...s.padding],
		[K_SPANBASE_SPAN_TYPE]: s.meSpanType,
	};
}

function readSpanBaseExtras(e: Record<string, unknown>, ctx: string): SpanBase {
	return {
		miRoadIndex: requireNumber(e[K_SPANBASE_ROAD_INDEX], `${ctx}.${K_SPANBASE_ROAD_INDEX}`),
		miSpanIndex: requireNumber(e[K_SPANBASE_SPAN_INDEX], `${ctx}.${K_SPANBASE_SPAN_INDEX}`),
		padding: decodeByteArray(e[K_SPANBASE_PADDING], 2),
		meSpanType: requireNumber(e[K_SPANBASE_SPAN_TYPE], `${ctx}.${K_SPANBASE_SPAN_TYPE}`) as ESpanType,
	};
}

function streetExtras(s: Street): Record<string, unknown> {
	return {
		...spanBaseExtras(s.superSpanBase),
		[K_STREET_MAX_SPEED]: s.mAiInfo.muMaxSpeedMPS,
		[K_STREET_MIN_SPEED]: s.mAiInfo.muMinSpeedMPS,
		[K_STREET_PADDING]: [...s.padding],
	};
}

function readStreetExtras(e: Record<string, unknown>, ctx: string): Street {
	const superSpanBase = readSpanBaseExtras(e, ctx);
	const mAiInfo: AIInfo = {
		muMaxSpeedMPS: requireNumber(e[K_STREET_MAX_SPEED], `${ctx}.${K_STREET_MAX_SPEED}`),
		muMinSpeedMPS: requireNumber(e[K_STREET_MIN_SPEED], `${ctx}.${K_STREET_MIN_SPEED}`),
	};
	const padding = decodeByteArray(e[K_STREET_PADDING], 2);
	return { superSpanBase, mAiInfo, padding };
}

function junctionExtras(j: Junction): Record<string, unknown> {
	return {
		...spanBaseExtras(j.superSpanBase),
		[K_JUNCTION_EXITS_POINTER]: j.mpaExits,
		[K_JUNCTION_EXIT_COUNT]: j.miExitCount,
		[K_JUNCTION_NAME]: j.macName,
	};
}

function readJunctionExtras(e: Record<string, unknown>, ctx: string): Junction {
	return {
		superSpanBase: readSpanBaseExtras(e, ctx),
		mpaExits: requireNumber(e[K_JUNCTION_EXITS_POINTER], `${ctx}.${K_JUNCTION_EXITS_POINTER}`),
		miExitCount: requireNumber(e[K_JUNCTION_EXIT_COUNT], `${ctx}.${K_JUNCTION_EXIT_COUNT}`),
		macName: requireString(e[K_JUNCTION_NAME], `${ctx}.${K_JUNCTION_NAME}`),
	};
}

function roadExtras(r: Road): Record<string, unknown> {
	// mReferencePosition is carried on the node's translation (see
	// addStreetDataSubtree), not in extras. This is the one field where a
	// Blender user dragging the node produces a real edit on re-import.
	return {
		[K_ROAD_SPANS_POINTER]: r.mpaSpans,
		[K_ROAD_ID]: encodeBigInt(r.mId),
		[K_ROAD_LIMIT_ID_0]: encodeBigInt(r.miRoadLimitId0),
		[K_ROAD_LIMIT_ID_1]: encodeBigInt(r.miRoadLimitId1),
		[K_ROAD_DEBUG_NAME]: r.macDebugName,
		[K_ROAD_CHALLENGE]: r.mChallenge,
		[K_ROAD_SPAN_COUNT]: r.miSpanCount,
		[K_ROAD_UNKNOWN]: r.unknown,
		[K_ROAD_PADDING]: [...r.padding],
	};
}

function readRoadExtras(
	e: Record<string, unknown>,
	translation: [number, number, number],
	ctx: string,
): Road {
	const mReferencePosition = gltfToParadise(translation);
	return {
		mReferencePosition,
		mpaSpans: requireNumber(e[K_ROAD_SPANS_POINTER], `${ctx}.${K_ROAD_SPANS_POINTER}`),
		mId: decodeBigInt(e[K_ROAD_ID]),
		miRoadLimitId0: decodeBigInt(e[K_ROAD_LIMIT_ID_0]),
		miRoadLimitId1: decodeBigInt(e[K_ROAD_LIMIT_ID_1]),
		macDebugName: requireString(e[K_ROAD_DEBUG_NAME], `${ctx}.${K_ROAD_DEBUG_NAME}`),
		mChallenge: requireNumber(e[K_ROAD_CHALLENGE], `${ctx}.${K_ROAD_CHALLENGE}`),
		miSpanCount: requireNumber(e[K_ROAD_SPAN_COUNT], `${ctx}.${K_ROAD_SPAN_COUNT}`),
		unknown: requireNumber(e[K_ROAD_UNKNOWN], `${ctx}.${K_ROAD_UNKNOWN}`),
		padding: decodeByteArray(e[K_ROAD_PADDING], 4),
	};
}

function challengeExtras(c: ChallengeParScores): Record<string, unknown> {
	return {
		[K_CHALLENGE_DIRTY]: [...c.challengeData.mDirty],
		[K_CHALLENGE_VALID_SCORE]: [...c.challengeData.mValidScore],
		[K_CHALLENGE_SCORES]: [...c.challengeData.mScoreList.maScores],
		[K_CHALLENGE_RIVALS]: c.mRivals.map(encodeBigInt),
	};
}

function readChallengeExtras(e: Record<string, unknown>, ctx: string): ChallengeParScores {
	const scoresRaw = e[K_CHALLENGE_SCORES];
	if (!Array.isArray(scoresRaw) || scoresRaw.length !== 2) {
		throw new Error(`${ctx}.${K_CHALLENGE_SCORES}: expected 2-element array`);
	}
	const rivalsRaw = e[K_CHALLENGE_RIVALS];
	if (!Array.isArray(rivalsRaw) || rivalsRaw.length !== 2) {
		throw new Error(`${ctx}.${K_CHALLENGE_RIVALS}: expected 2-element array`);
	}
	return {
		challengeData: {
			mDirty: decodeByteArray(e[K_CHALLENGE_DIRTY], 8),
			mValidScore: decodeByteArray(e[K_CHALLENGE_VALID_SCORE], 8),
			mScoreList: {
				maScores: [
					requireNumber(scoresRaw[0], `${ctx}.${K_CHALLENGE_SCORES}[0]`),
					requireNumber(scoresRaw[1], `${ctx}.${K_CHALLENGE_SCORES}[1]`),
				],
			},
		},
		mRivals: [decodeBigInt(rivalsRaw[0]), decodeBigInt(rivalsRaw[1])],
	};
}

// ---------------------------------------------------------------------------
// Subtree API — the worldLogic orchestrator uses this to embed StreetData
// into a multi-resource scene. The single-resource convenience wrappers at
// the bottom of the file just construct a Document + Scene and delegate here.
// ---------------------------------------------------------------------------

/**
 * Mutate `doc` and `scene` to add the StreetData subtree: scene.extras gets a
 * `paradiseBundle.streetData` entry holding miVersion; a new group node tree
 * `StreetData / { Junctions, Roads, Streets, ChallengeParScores }` is
 * appended as a scene root.
 */
export function addStreetDataSubtree(
	doc: Document,
	scene: Scene,
	model: ParsedStreetData,
): void {
	extendSceneExtras(scene, SCENE_EXTRAS_STREET_DATA, {
		version: model.miVersion,
	});

	const root = doc.createNode(GROUP_STREET_DATA);
	scene.addChild(root);

	const junctionsGroup = doc.createNode(GROUP_JUNCTIONS);
	const roadsGroup = doc.createNode(GROUP_ROADS);
	const streetsGroup = doc.createNode(GROUP_STREETS);
	const challengesGroup = doc.createNode(GROUP_CHALLENGES);
	root.addChild(junctionsGroup);
	root.addChild(roadsGroup);
	root.addChild(streetsGroup);
	root.addChild(challengesGroup);

	for (let i = 0; i < model.roads.length; i++) {
		const r = model.roads[i];
		const node = doc.createNode(`Road ${i} (${encodeBigInt(r.mId)})`);
		node.setTranslation(paradiseToGltf(r.mReferencePosition));
		node.setExtras(roadExtras(r));
		roadsGroup.addChild(node);
	}

	for (let i = 0; i < model.junctions.length; i++) {
		const j = model.junctions[i];
		const node = doc.createNode(`Junction ${i} (${j.macName})`);
		const linkedRoad = model.roads[j.superSpanBase.miRoadIndex];
		if (linkedRoad) {
			node.setTranslation(paradiseToGltf(linkedRoad.mReferencePosition));
		}
		node.setExtras(junctionExtras(j));
		junctionsGroup.addChild(node);
	}

	for (let i = 0; i < model.streets.length; i++) {
		const s = model.streets[i];
		const node = doc.createNode(`Street ${i}`);
		const linkedRoad = model.roads[s.superSpanBase.miRoadIndex];
		if (linkedRoad) {
			node.setTranslation(paradiseToGltf(linkedRoad.mReferencePosition));
		}
		node.setExtras(streetExtras(s));
		streetsGroup.addChild(node);
	}

	for (let i = 0; i < model.challenges.length; i++) {
		const c = model.challenges[i];
		const node = doc.createNode(`ChallengeParScores ${i}`);
		const linkedRoad = model.roads[i];
		if (linkedRoad) {
			node.setTranslation(paradiseToGltf(linkedRoad.mReferencePosition));
		}
		node.setExtras(challengeExtras(c));
		challengesGroup.addChild(node);
	}
}

/**
 * Read a StreetData model back out of `doc`. Looks for a StreetData root
 * group node under the first scene and the paradiseBundle.streetData scene
 * extras blob. Pointer fields in the resulting header are zero — the writer
 * recomputes them.
 */
export function readStreetDataFromDocument(doc: Document): ParsedStreetData {
	const scene = doc.getRoot().listScenes()[0];
	if (!scene) throw new Error('glTF has no scene');

	const section = readSceneExtrasSection(scene, SCENE_EXTRAS_STREET_DATA);
	const version = requireNumber(section.version, 'streetData.version');

	// Locate the StreetData root group. It's a direct child of the scene.
	const roots = scene.listChildren();
	const root = roots.find((n) => n.getName() === GROUP_STREET_DATA);
	if (!root) throw new Error(`scene root "${GROUP_STREET_DATA}" not found`);

	const groups = new Map<string, Array<{ name: string; extras: Record<string, unknown>; translation: [number, number, number] }>>();
	for (const group of root.listChildren()) {
		const entries = group.listChildren().map((n) => ({
			name: n.getName(),
			extras: (n.getExtras() ?? {}) as Record<string, unknown>,
			translation: n.getTranslation() as [number, number, number],
		}));
		groups.set(group.getName(), entries);
	}

	const roadsRaw = groups.get(GROUP_ROADS) ?? [];
	const junctionsRaw = groups.get(GROUP_JUNCTIONS) ?? [];
	const streetsRaw = groups.get(GROUP_STREETS) ?? [];
	const challengesRaw = groups.get(GROUP_CHALLENGES) ?? [];

	const roads: Road[] = roadsRaw.map((n, i) =>
		readRoadExtras(n.extras, n.translation, `${GROUP_ROADS}[${i}]`),
	);
	const junctions: Junction[] = junctionsRaw.map((n, i) =>
		readJunctionExtras(n.extras, `${GROUP_JUNCTIONS}[${i}]`),
	);
	const streets: Street[] = streetsRaw.map((n, i) =>
		readStreetExtras(n.extras, `${GROUP_STREETS}[${i}]`),
	);
	const challenges: ChallengeParScores[] = challengesRaw.map((n, i) =>
		readChallengeExtras(n.extras, `${GROUP_CHALLENGES}[${i}]`),
	);

	return {
		miVersion: version,
		mpaStreets: 0,
		mpaJunctions: 0,
		mpaRoads: 0,
		mpaChallengeParScores: 0,
		streets,
		junctions,
		roads,
		challenges,
	};
}

// ---------------------------------------------------------------------------
// Single-resource convenience wrappers.
// ---------------------------------------------------------------------------

export function buildStreetDataDocument(model: ParsedStreetData): Document {
	const doc = new Document();
	doc.getRoot().getAsset().generator = GENERATOR;
	const scene = doc.createScene('Scene');
	addStreetDataSubtree(doc, scene, model);
	return doc;
}

export function importStreetDataFromDocument(doc: Document): ParsedStreetData {
	return readStreetDataFromDocument(doc);
}

export async function exportStreetDataToGltf(model: ParsedStreetData): Promise<Uint8Array> {
	const doc = buildStreetDataDocument(model);
	const io = new NodeIO();
	return io.writeBinary(doc);
}

export async function exportStreetDataToGltfJson(model: ParsedStreetData): Promise<Uint8Array> {
	return writeDocumentAsGltfJson(buildStreetDataDocument(model));
}

export async function importStreetDataFromGltf(bytes: Uint8Array): Promise<ParsedStreetData> {
	const io = new NodeIO();
	const magic = new TextDecoder().decode(bytes.subarray(0, 4));
	if (magic === 'glTF') {
		const doc = await io.readBinary(bytes);
		return importStreetDataFromDocument(doc);
	}
	const doc = await readDocumentFromGltfJson(bytes);
	return importStreetDataFromDocument(doc);
}
