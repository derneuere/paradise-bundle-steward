// TriggerData ↔ glTF 2.0 round-trip.
//
// Design mirrors TrafficData / AISections: the authoritative model lives in
// scene.extras.paradiseBundle.triggerData. Visible nodes follow the
// TriggersToGLTF naming convention (`Landmark N (id)`, `GenericRegion N
// (id)`, `Blackspot N (id)`, `VFXBoxRegion N`, `SignatureStunt N`,
// `Killzone N`, `RoamingLocation N`, `SpawnLocation N`) so a Blender user
// familiar with burninrubber0's tool sees a similar outliner.
//
// TriggersToGLTF is lossy — our writer preserves everything in scene.extras
// (via the shared deep transcoder), producing a superset of its output.
//
// TriggerData's writer is writer-idempotent (not byte-exact first pass) like
// StreetData. The glTF round-trip must match writeTriggerDataData's output,
// not the original raw bundle bytes.

import { Document, NodeIO, type Scene } from '@gltf-transform/core';
import type { ParsedTriggerData } from '../triggerData';
import { paradiseToGltf, gltfToParadise } from './coords';
import {
	extendSceneExtras,
	readSceneExtrasSection,
	encodeModelDeep,
	decodeModelDeep,
	findSceneRoot,
	writeDocumentAsGltfJson,
	readDocumentFromGltfJson,
	overlayArrayLength,
} from './sharedGltf';

const GENERATOR = 'steward-worldlogic-gltf/1';

export const GROUP_TRIGGER_DATA = 'TriggerData';
const SCENE_EXTRAS_TRIGGER_DATA = 'triggerData';

function addVisualizationNodes(
	doc: Document,
	root: ReturnType<Document['createNode']>,
	model: ParsedTriggerData,
): void {
	// Landmarks
	const landmarksGroup = doc.createNode('Landmarks');
	root.addChild(landmarksGroup);
	for (let i = 0; i < model.landmarks.length; i++) {
		const l = model.landmarks[i];
		const node = doc.createNode(`Landmark ${i} (${l.id})`);
		node.setTranslation(paradiseToGltf(l.box.position));
		landmarksGroup.addChild(node);
	}

	// Generic regions
	const genericGroup = doc.createNode('GenericRegions');
	root.addChild(genericGroup);
	for (let i = 0; i < model.genericRegions.length; i++) {
		const g = model.genericRegions[i];
		const node = doc.createNode(`GenericRegion ${i} (${g.id})`);
		node.setTranslation(paradiseToGltf(g.box.position));
		genericGroup.addChild(node);
	}

	// Blackspots
	const blackspotsGroup = doc.createNode('Blackspots');
	root.addChild(blackspotsGroup);
	for (let i = 0; i < model.blackspots.length; i++) {
		const b = model.blackspots[i];
		const node = doc.createNode(`Blackspot ${i} (${b.id})`);
		node.setTranslation(paradiseToGltf(b.box.position));
		blackspotsGroup.addChild(node);
	}

	// VFX box regions
	const vfxGroup = doc.createNode('VFXBoxRegions');
	root.addChild(vfxGroup);
	for (let i = 0; i < model.vfxBoxRegions.length; i++) {
		const v = model.vfxBoxRegions[i];
		const node = doc.createNode(`VFXBoxRegion ${i} (${v.id})`);
		node.setTranslation(paradiseToGltf(v.box.position));
		vfxGroup.addChild(node);
	}

	// Killzones (no intrinsic position; empty parent per killzone)
	const killzonesGroup = doc.createNode('Killzones');
	root.addChild(killzonesGroup);
	for (let i = 0; i < model.killzones.length; i++) {
		const node = doc.createNode(`Killzone ${i}`);
		killzonesGroup.addChild(node);
	}

	// Signature stunts (no intrinsic position; empty parent per stunt)
	const stuntsGroup = doc.createNode('SignatureStunts');
	root.addChild(stuntsGroup);
	for (let i = 0; i < model.signatureStunts.length; i++) {
		const s = model.signatureStunts[i];
		const node = doc.createNode(`SignatureStunt ${i} (${s.id.toString(10)})`);
		stuntsGroup.addChild(node);
	}

	// Roaming locations (point triggers)
	const roamingGroup = doc.createNode('RoamingLocations');
	root.addChild(roamingGroup);
	for (let i = 0; i < model.roamingLocations.length; i++) {
		const r = model.roamingLocations[i];
		const node = doc.createNode(`RoamingLocation ${i}`);
		node.setTranslation(paradiseToGltf(r.position));
		roamingGroup.addChild(node);
	}

	// Spawn locations (point triggers with a direction)
	const spawnsGroup = doc.createNode('SpawnLocations');
	root.addChild(spawnsGroup);
	for (let i = 0; i < model.spawnLocations.length; i++) {
		const s = model.spawnLocations[i];
		const node = doc.createNode(`SpawnLocation ${i}`);
		node.setTranslation(paradiseToGltf(s.position));
		spawnsGroup.addChild(node);
	}
}

export function addTriggerDataSubtree(
	doc: Document,
	scene: Scene,
	model: ParsedTriggerData,
): void {
	const encoded = encodeModelDeep(model);
	extendSceneExtras(scene, SCENE_EXTRAS_TRIGGER_DATA, encoded);

	const root = doc.createNode(GROUP_TRIGGER_DATA);
	scene.addChild(root);
	addVisualizationNodes(doc, root, model);
}

export function readTriggerDataFromDocument(doc: Document): ParsedTriggerData {
	const scene = doc.getRoot().listScenes()[0];
	if (!scene) throw new Error('glTF has no scene');
	const encoded = readSceneExtrasSection(scene, SCENE_EXTRAS_TRIGGER_DATA);
	const model = decodeModelDeep(encoded) as ParsedTriggerData;
	return reconcileTriggerDataFromNodes(model, scene);
}

/**
 * Overlay Blender-edited positions back onto the model. Positions are the
 * natural Blender edit surface — other fields (type, group ID, dimensions,
 * rotation) round-trip via scene.extras only. Phase 6 can layer in more.
 *
 * Affected model fields on Phase 5:
 *   - Landmark.box.position (Vector3)
 *   - GenericRegion.box.position (Vector3)
 *   - Blackspot.box.position (Vector3)
 *   - VFXBoxRegion.box.position (Vector3)
 *   - RoamingLocation.position (Vector4 — w preserved)
 *   - SpawnLocation.position (Vector4 — w preserved)
 */
function reconcileTriggerDataFromNodes(
	model: ParsedTriggerData,
	scene: import('@gltf-transform/core').Scene,
): ParsedTriggerData {
	const root = findSceneRoot(scene, GROUP_TRIGGER_DATA);
	if (!root) return model;
	const groups = new Map(root.listChildren().map((n) => [n.getName(), n]));

	function reconcileBoxArray<T extends { box: { position: { x: number; y: number; z: number } } }>(
		entries: T[],
		group: import('@gltf-transform/core').Node | undefined,
	): T[] {
		if (!group) return entries;
		const nodes = group.listChildren();
		const lengthAdjusted = overlayArrayLength(entries, nodes.length);
		let changed = lengthAdjusted !== entries;
		const next = lengthAdjusted.map((e, i) => {
			const n = nodes[i];
			if (!n) return e;
			const t = n.getTranslation();
			const p = gltfToParadise([t[0], t[1], t[2]]);
			if (e.box.position.x === p.x && e.box.position.y === p.y && e.box.position.z === p.z) {
				return e;
			}
			changed = true;
			return { ...e, box: { ...e.box, position: { x: p.x, y: p.y, z: p.z } } };
		});
		return changed ? next : entries;
	}

	function reconcilePointArray<T extends { position: { x: number; y: number; z: number; w: number } }>(
		entries: T[],
		group: import('@gltf-transform/core').Node | undefined,
	): T[] {
		if (!group) return entries;
		const nodes = group.listChildren();
		const lengthAdjusted = overlayArrayLength(entries, nodes.length);
		let changed = lengthAdjusted !== entries;
		const next = lengthAdjusted.map((e, i) => {
			const n = nodes[i];
			if (!n) return e;
			const t = n.getTranslation();
			const p = gltfToParadise([t[0], t[1], t[2]]);
			if (e.position.x === p.x && e.position.y === p.y && e.position.z === p.z) {
				return e;
			}
			changed = true;
			return { ...e, position: { ...e.position, x: p.x, y: p.y, z: p.z } };
		});
		return changed ? next : entries;
	}

	function reconcileSimpleLength<T>(
		entries: T[],
		group: import('@gltf-transform/core').Node | undefined,
	): T[] {
		if (!group) return entries;
		return overlayArrayLength(entries, group.listChildren().length);
	}

	const landmarks = reconcileBoxArray(model.landmarks, groups.get('Landmarks'));
	const genericRegions = reconcileBoxArray(model.genericRegions, groups.get('GenericRegions'));
	const blackspots = reconcileBoxArray(model.blackspots, groups.get('Blackspots'));
	const vfxBoxRegions = reconcileBoxArray(model.vfxBoxRegions, groups.get('VFXBoxRegions'));
	const roamingLocations = reconcilePointArray(model.roamingLocations, groups.get('RoamingLocations'));
	const spawnLocations = reconcilePointArray(model.spawnLocations, groups.get('SpawnLocations'));
	// Killzones and SignatureStunts have no intrinsic position, so their
	// visualization is empty placeholder nodes — length-only overlay.
	const killzones = reconcileSimpleLength(model.killzones, groups.get('Killzones'));
	const signatureStunts = reconcileSimpleLength(model.signatureStunts, groups.get('SignatureStunts'));

	if (
		landmarks === model.landmarks &&
		genericRegions === model.genericRegions &&
		blackspots === model.blackspots &&
		vfxBoxRegions === model.vfxBoxRegions &&
		roamingLocations === model.roamingLocations &&
		spawnLocations === model.spawnLocations &&
		killzones === model.killzones &&
		signatureStunts === model.signatureStunts
	) {
		return model;
	}
	return {
		...model,
		landmarks,
		genericRegions,
		blackspots,
		vfxBoxRegions,
		roamingLocations,
		spawnLocations,
		killzones,
		signatureStunts,
	};
}

// ---------------------------------------------------------------------------
// Single-resource convenience wrappers
// ---------------------------------------------------------------------------

export function buildTriggerDataDocument(model: ParsedTriggerData): Document {
	const doc = new Document();
	doc.getRoot().getAsset().generator = GENERATOR;
	const scene = doc.createScene('Scene');
	addTriggerDataSubtree(doc, scene, model);
	return doc;
}

export async function exportTriggerDataToGltf(
	model: ParsedTriggerData,
): Promise<Uint8Array> {
	const doc = buildTriggerDataDocument(model);
	const io = new NodeIO();
	return io.writeBinary(doc);
}

export async function exportTriggerDataToGltfJson(
	model: ParsedTriggerData,
): Promise<Uint8Array> {
	return writeDocumentAsGltfJson(buildTriggerDataDocument(model));
}

export async function importTriggerDataFromGltf(
	bytes: Uint8Array,
): Promise<ParsedTriggerData> {
	const io = new NodeIO();
	const magic = new TextDecoder().decode(bytes.subarray(0, 4));
	if (magic === 'glTF') {
		const doc = await io.readBinary(bytes);
		return readTriggerDataFromDocument(doc);
	}
	const doc = await readDocumentFromGltfJson(bytes);
	return readTriggerDataFromDocument(doc);
}
