// AISections ↔ glTF 2.0 round-trip.
//
// AISections has a byte-exact writer, so the glTF round-trip contract is
// strict: parseAISectionsData(writeAISectionsData(importGltf(exportGltf(m))))
// must produce bytes identical to writeAISectionsData(m).
//
// Design mirrors TrafficData: the full model is stashed in
// scene.extras.paradiseBundle.aiSections as the authoritative source of
// truth; visible nodes exist for Blender inspection (sections with their
// 4-corner polygons as points, portals as children with their anchor
// positions) but are ignored on import until Phase 5 adds reconciliation.

import { Document, NodeIO, type Scene } from '@gltf-transform/core';
import type { ParsedAISections } from '../aiSections';
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

export const GROUP_AI_SECTIONS = 'AISections';
const SCENE_EXTRAS_AI_SECTIONS = 'aiSections';

/**
 * Centroid of a section's 4 corners (in Paradise XY, with Z = 0). Used as
 * the visible node's translation — the section polygons are in world-XY so
 * Blender shows them floating above the ground plane which matches how the
 * Paradise engine sees them.
 */
function sectionCentroid(corners: Array<{ x: number; y: number }>): {
	x: number;
	y: number;
	z: number;
} {
	if (corners.length === 0) return { x: 0, y: 0, z: 0 };
	let sx = 0, sy = 0;
	for (const c of corners) {
		sx += c.x;
		sy += c.y;
	}
	// AISections store world X/Z in corners (height is implicit); we map
	// (sx, sy) → Paradise (x, 0, y) so the 2D polygon sits on the ground.
	return { x: sx / corners.length, y: 0, z: sy / corners.length };
}

function addVisualizationNodes(
	doc: Document,
	root: ReturnType<Document['createNode']>,
	model: ParsedAISections,
): void {
	const sectionsGroup = doc.createNode('Sections');
	root.addChild(sectionsGroup);

	for (let i = 0; i < model.sections.length; i++) {
		const section = model.sections[i];
		const node = doc.createNode(`Section ${i} (id=${section.id})`);
		const centroid = sectionCentroid(section.corners);
		node.setTranslation(paradiseToGltf(centroid));
		sectionsGroup.addChild(node);

		// Portals as children of the section — each is a point at the portal's
		// 3D anchor. BoundaryLines are not visualized yet (Phase 5).
		for (let pi = 0; pi < section.portals.length; pi++) {
			const p = section.portals[pi];
			const portalNode = doc.createNode(`Portal ${pi} (link=${p.linkSection})`);
			portalNode.setTranslation(paradiseToGltf(p.position));
			node.addChild(portalNode);
		}
	}

	const resetPairsGroup = doc.createNode('SectionResetPairs');
	root.addChild(resetPairsGroup);
	for (let i = 0; i < model.sectionResetPairs.length; i++) {
		const rp = model.sectionResetPairs[i];
		const node = doc.createNode(
			`ResetPair ${i} (start=${rp.startSectionIndex} reset=${rp.resetSectionIndex})`,
		);
		resetPairsGroup.addChild(node);
	}
}

export function addAISectionsSubtree(
	doc: Document,
	scene: Scene,
	model: ParsedAISections,
): void {
	const encoded = encodeModelDeep(model);
	extendSceneExtras(scene, SCENE_EXTRAS_AI_SECTIONS, encoded);

	const root = doc.createNode(GROUP_AI_SECTIONS);
	scene.addChild(root);
	addVisualizationNodes(doc, root, model);
}

export function readAISectionsFromDocument(doc: Document): ParsedAISections {
	const scene = doc.getRoot().listScenes()[0];
	if (!scene) throw new Error('glTF has no scene');
	const encoded = readSceneExtrasSection(scene, SCENE_EXTRAS_AI_SECTIONS);
	const model = decodeModelDeep(encoded) as ParsedAISections;
	return reconcileAISectionsFromNodes(model, scene);
}

/**
 * Overlay Blender-edited portal positions back onto the model. Each
 * AISections Section node's children are its portals in array order; each
 * portal node's translation is the portal anchor position. Section
 * corners aren't overlaid (they're 2D and derived from the section's node
 * translation is the centroid, not the corner set — Phase 6 could layer
 * a rectangle-editing extension on top).
 */
function reconcileAISectionsFromNodes(
	model: ParsedAISections,
	scene: import('@gltf-transform/core').Scene,
): ParsedAISections {
	const root = findSceneRoot(scene, GROUP_AI_SECTIONS);
	if (!root) return model;
	const sectionsGroup = root.listChildren().find((n) => n.getName() === 'Sections');
	if (!sectionsGroup) return model;
	const sectionNodes = sectionsGroup.listChildren();

	// Length overlay first — allows user to duplicate/delete section nodes
	// in Blender. Then walk portals per section.
	const lengthAdjusted = overlayArrayLength(model.sections, sectionNodes.length);
	const sections = lengthAdjusted.map((section, si) => {
		const node = sectionNodes[si];
		if (!node) return section;
		const portalNodes = node.listChildren();
		const lengthAdjustedPortals = overlayArrayLength(section.portals, portalNodes.length);
		const portals = lengthAdjustedPortals.map((portal, pi) => {
			const pn = portalNodes[pi];
			if (!pn) return portal;
			const t = pn.getTranslation();
			const p = gltfToParadise([t[0], t[1], t[2]]);
			if (portal.position.x === p.x && portal.position.y === p.y && portal.position.z === p.z) {
				return portal;
			}
			return { ...portal, position: { x: p.x, y: p.y, z: p.z } };
		});
		if (portals === section.portals) return section;
		return { ...section, portals };
	});

	if (sections === model.sections) return model;
	return { ...model, sections };
}

// ---------------------------------------------------------------------------
// Single-resource convenience wrappers
// ---------------------------------------------------------------------------

export function buildAISectionsDocument(model: ParsedAISections): Document {
	const doc = new Document();
	doc.getRoot().getAsset().generator = GENERATOR;
	const scene = doc.createScene('Scene');
	addAISectionsSubtree(doc, scene, model);
	return doc;
}

export async function exportAISectionsToGltf(
	model: ParsedAISections,
): Promise<Uint8Array> {
	const doc = buildAISectionsDocument(model);
	const io = new NodeIO();
	return io.writeBinary(doc);
}

export async function exportAISectionsToGltfJson(
	model: ParsedAISections,
): Promise<Uint8Array> {
	return writeDocumentAsGltfJson(buildAISectionsDocument(model));
}

export async function importAISectionsFromGltf(
	bytes: Uint8Array,
): Promise<ParsedAISections> {
	const io = new NodeIO();
	const magic = new TextDecoder().decode(bytes.subarray(0, 4));
	if (magic === 'glTF') {
		const doc = await io.readBinary(bytes);
		return readAISectionsFromDocument(doc);
	}
	const doc = await readDocumentFromGltfJson(bytes);
	return readAISectionsFromDocument(doc);
}
