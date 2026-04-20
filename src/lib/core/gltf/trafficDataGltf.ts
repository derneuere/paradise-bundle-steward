// TrafficData ↔ glTF 2.0 round-trip.
//
// TrafficData is significantly larger and more deeply nested than StreetData
// (hulls × sections × rungs, plus PVS, vehicle traits, traffic lights, etc).
// Unlike StreetData its writer is byte-exact on first pass, so the glTF
// round-trip must preserve every field exactly — including numeric padding
// byte arrays, bigint IDs, Vec4 quadruples, and 4×4 transform matrices.
//
// Design (Phase 4 MVP):
//   - scene.extras.paradiseBundle.trafficData holds the ENTIRE parsed model
//     as the authoritative source of truth. Bigints are stringified; other
//     fields stay JSON-native.
//   - A visualization subtree exists but is read-only on import; the
//     importer ignores all node transforms and only consults scene.extras.
//     Phase 5 will upgrade the importer to reconcile node edits.
//   - Visualization nodes carry Blender-friendly translations derived from
//     the model (junction logic box positions, static vehicle transforms,
//     light trigger positions, section midpoints from their first rung).
//     No mesh geometry yet — Phase 5 adds LINE_STRIP ribbons for lane rungs.
//
// This keeps the feature shippable now with full round-trip guarantees while
// leaving the door open for visible/editable geometry later.

import { Document, NodeIO, type Scene, type Mesh, type Buffer } from '@gltf-transform/core';
import {
	type ParsedTrafficData,
	type TrafficHull,
	type TrafficJunctionLogicBox,
	type TrafficLaneRung,
	type TrafficLightTrigger,
	type TrafficSection,
	type TrafficStaticVehicle,
	type Vec4,
} from '../trafficData';
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

export const GROUP_TRAFFIC_DATA = 'TrafficData';
const SCENE_EXTRAS_TRAFFIC_DATA = 'trafficData';

// ---------------------------------------------------------------------------
// Visualization nodes
// ---------------------------------------------------------------------------

function vec4Mid(a: Vec4, b: Vec4): { x: number; y: number; z: number } {
	return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 };
}

function firstRungMidpoint(section: TrafficSection, rungs: TrafficLaneRung[]):
	| { x: number; y: number; z: number }
	| null {
	if (section.muNumRungs <= 0) return null;
	const r = rungs[section.muRungOffset];
	if (!r) return null;
	const p = r.maPoints;
	return vec4Mid(p[0], p[1]);
}

/**
 * Append a TrafficStaticVehicle node using the 4×4 affine transform's
 * translation column directly — we skip rotation/scale on Phase 4 since
 * Blender will just show the node position as a gizmo anyway.
 */
function staticVehicleTranslation(v: TrafficStaticVehicle): {
	x: number;
	y: number;
	z: number;
} {
	// Matrix44Affine is stored as 16 f32s in row-major or column-major order
	// depending on the engine convention. Criterion's Matrix44Affine stores
	// the translation in elements [12], [13], [14] (column-major 4th col).
	return {
		x: v.mTransform[12] ?? 0,
		y: v.mTransform[13] ?? 0,
		z: v.mTransform[14] ?? 0,
	};
}

/**
 * Build a LINE_STRIP mesh for a section: two primitives (left edge + right
 * edge), each a polyline of f32 positions in glTF axes. Returns null if the
 * section has no rungs (nothing to draw).
 */
function buildSectionRibbonMesh(
	doc: Document,
	buffer: Buffer,
	section: TrafficSection,
	rungs: TrafficLaneRung[],
): Mesh | null {
	if (section.muNumRungs <= 0) return null;
	const start = section.muRungOffset;
	const end = start + section.muNumRungs;
	const slice = rungs.slice(start, end);
	if (slice.length === 0) return null;

	// Two buffers: left edge, right edge. f32 Vec3s with axis swap.
	const left = new Float32Array(slice.length * 3);
	const right = new Float32Array(slice.length * 3);
	for (let i = 0; i < slice.length; i++) {
		const [l, r] = slice[i].maPoints;
		const lg = paradiseToGltf({ x: l.x, y: l.y, z: l.z });
		const rg = paradiseToGltf({ x: r.x, y: r.y, z: r.z });
		left[i * 3 + 0] = lg[0];
		left[i * 3 + 1] = lg[1];
		left[i * 3 + 2] = lg[2];
		right[i * 3 + 0] = rg[0];
		right[i * 3 + 1] = rg[1];
		right[i * 3 + 2] = rg[2];
	}

	const leftAccessor = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(left)
		.setBuffer(buffer);
	const rightAccessor = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(right)
		.setBuffer(buffer);

	// LINE_STRIP = 3 per glTF 2.0 spec.
	const leftPrim = doc
		.createPrimitive()
		.setMode(3)
		.setAttribute('POSITION', leftAccessor);
	const rightPrim = doc
		.createPrimitive()
		.setMode(3)
		.setAttribute('POSITION', rightAccessor);

	const mesh = doc.createMesh().addPrimitive(leftPrim).addPrimitive(rightPrim);
	return mesh;
}

function addVisualizationNodes(
	doc: Document,
	root: ReturnType<Document['createNode']>,
	model: ParsedTrafficData,
): void {
	// One shared buffer for every section ribbon across every hull — keeps
	// the glTF compact rather than spraying one buffer per mesh.
	const ribbonBuffer = doc.createBuffer('trafficSectionRibbons');

	for (let hi = 0; hi < model.hulls.length; hi++) {
		const hull: TrafficHull = model.hulls[hi];
		const hullNode = doc.createNode(`Hull ${hi}`);
		root.addChild(hullNode);

		// Sections under this hull — each gets a LINE_STRIP ribbon built from
		// its rungs' left/right edges. This is the geometry that makes the
		// road network actually visible in Blender. When a section has a
		// ribbon mesh we leave the node at the origin so the mesh's world-
		// coord positions aren't double-offset. When there's no mesh (empty
		// section), we still emit a node at the rung midpoint so the user
		// sees the gap.
		const sectionsGroup = doc.createNode('Sections');
		hullNode.addChild(sectionsGroup);
		for (let si = 0; si < hull.sections.length; si++) {
			const s = hull.sections[si];
			const node = doc.createNode(`Section ${si} (span=${s.muSpanIndex})`);

			const mesh = buildSectionRibbonMesh(doc, ribbonBuffer, s, hull.rungs);
			if (mesh) {
				node.setMesh(mesh);
			} else {
				const mid = firstRungMidpoint(s, hull.rungs);
				if (mid) node.setTranslation(paradiseToGltf(mid));
			}
			sectionsGroup.addChild(node);
		}

		// Junction logic boxes.
		const junctionsGroup = doc.createNode('JunctionLogicBoxes');
		hullNode.addChild(junctionsGroup);
		for (let ji = 0; ji < hull.junctions.length; ji++) {
			const j: TrafficJunctionLogicBox = hull.junctions[ji];
			const node = doc.createNode(`JunctionLogicBox ${ji} (muID=${j.muID})`);
			node.setTranslation(paradiseToGltf(j.mPosition));
			junctionsGroup.addChild(node);
		}

		// Static vehicles.
		const staticGroup = doc.createNode('StaticVehicles');
		hullNode.addChild(staticGroup);
		for (let vi = 0; vi < hull.staticTrafficVehicles.length; vi++) {
			const v = hull.staticTrafficVehicles[vi];
			const node = doc.createNode(`StaticVehicle ${vi}`);
			const t = staticVehicleTranslation(v);
			node.setTranslation(paradiseToGltf(t));
			staticGroup.addChild(node);
		}

		// Light triggers.
		const lightGroup = doc.createNode('LightTriggers');
		hullNode.addChild(lightGroup);
		for (let li = 0; li < hull.lightTriggers.length; li++) {
			const t: TrafficLightTrigger = hull.lightTriggers[li];
			const node = doc.createNode(`LightTrigger ${li}`);
			node.setTranslation(paradiseToGltf(t.mPosPlusYRot));
			lightGroup.addChild(node);
		}
	}
}

// ---------------------------------------------------------------------------
// Subtree API
// ---------------------------------------------------------------------------

/**
 * Mutate `doc` and `scene` to add the TrafficData subtree. The full model is
 * encoded into scene.extras.paradiseBundle.trafficData (bigint-safe); a
 * visualization subtree rooted at a `TrafficData` node is appended to the
 * scene for Blender inspection.
 */
export function addTrafficDataSubtree(
	doc: Document,
	scene: Scene,
	model: ParsedTrafficData,
): void {
	const encoded = encodeModelDeep(model);
	extendSceneExtras(scene, SCENE_EXTRAS_TRAFFIC_DATA, encoded);

	const root = doc.createNode(GROUP_TRAFFIC_DATA);
	scene.addChild(root);
	addVisualizationNodes(doc, root, model);
}

/**
 * Read a TrafficData model back out of `doc`. Only consults
 * scene.extras.paradiseBundle.trafficData; the visualization nodes are
 * ignored. Phase 5 adds a reconciler that incorporates node edits.
 */
export function readTrafficDataFromDocument(doc: Document): ParsedTrafficData {
	const scene = doc.getRoot().listScenes()[0];
	if (!scene) throw new Error('glTF has no scene');
	const encoded = readSceneExtrasSection(scene, SCENE_EXTRAS_TRAFFIC_DATA);
	const model = decodeModelDeep(encoded) as ParsedTrafficData;
	return reconcileTrafficDataFromNodes(model, scene);
}

/**
 * Walk the TrafficData visualization subtree and overlay any translations
 * that differ from the model's encoded positions back onto the model. This
 * is how a Blender user's drag-a-junction edit actually lands in the
 * reconstructed bundle.
 *
 * Only position-only edits are honoured in Phase 5:
 *   - TrafficJunctionLogicBox.mPosition.{x,y,z} (w is preserved)
 *   - TrafficLightTrigger.mPosPlusYRot.{x,y,z} (w holds Y-rotation; preserved)
 *   - TrafficStaticVehicle.mTransform[12..14] (translation column of the 4×4;
 *     rotation/scale in [0..11] are preserved)
 *
 * Section node translations are derived from a rung midpoint and don't map
 * back to a single field — they remain visualisation-only. Phase 5 could
 * extend this to edit rung endpoints but that's a separate contract.
 */
function reconcileTrafficDataFromNodes(
	model: ParsedTrafficData,
	scene: import('@gltf-transform/core').Scene,
): ParsedTrafficData {
	const root = findSceneRoot(scene, GROUP_TRAFFIC_DATA);
	if (!root) return model;

	// Walk per-hull subtrees. Sibling order is the authoritative hull index.
	// (We don't support adding or removing hulls via Blender — hull count is
	// an architectural spatial partition decided by the original data.)
	const hullNodes = root.listChildren();
	const hulls = model.hulls.map((hull, hi) => {
		const hullNode = hullNodes[hi];
		if (!hullNode) return hull;
		const groups = new Map(
			hullNode.listChildren().map((n) => [n.getName(), n]),
		);

		// Sections — length-only overlay. Rung offsets of duplicated sections
		// still point at the original rungs; the user can refine in the
		// schema editor or by editing extras.
		let sections = hull.sections;
		const sectionsGroup = groups.get('Sections');
		if (sectionsGroup) {
			sections = overlayArrayLength(sections, sectionsGroup.listChildren().length);
		}

		// Junction logic boxes — length overlay + translation overlay.
		let junctions = hull.junctions;
		const junctionsGroup = groups.get('JunctionLogicBoxes');
		if (junctionsGroup) {
			const entries = junctionsGroup.listChildren();
			junctions = overlayArrayLength(junctions, entries.length).map((j, ji) => {
				const node = entries[ji];
				if (!node) return j;
				const t = node.getTranslation();
				const p = gltfToParadise([t[0], t[1], t[2]]);
				if (j.mPosition.x === p.x && j.mPosition.y === p.y && j.mPosition.z === p.z) {
					return j;
				}
				return { ...j, mPosition: { ...j.mPosition, x: p.x, y: p.y, z: p.z } };
			});
		}

		// Light triggers — w holds rotation; preserve it.
		let lightTriggers = hull.lightTriggers;
		const lightGroup = groups.get('LightTriggers');
		if (lightGroup) {
			const entries = lightGroup.listChildren();
			lightTriggers = overlayArrayLength(lightTriggers, entries.length).map((t, li) => {
				const node = entries[li];
				if (!node) return t;
				const tr = node.getTranslation();
				const p = gltfToParadise([tr[0], tr[1], tr[2]]);
				if (
					t.mPosPlusYRot.x === p.x &&
					t.mPosPlusYRot.y === p.y &&
					t.mPosPlusYRot.z === p.z
				) {
					return t;
				}
				return { ...t, mPosPlusYRot: { ...t.mPosPlusYRot, x: p.x, y: p.y, z: p.z } };
			});
		}

		// Static vehicles — translation column of the 4×4.
		let staticTrafficVehicles = hull.staticTrafficVehicles;
		const staticGroup = groups.get('StaticVehicles');
		if (staticGroup) {
			const entries = staticGroup.listChildren();
			staticTrafficVehicles = overlayArrayLength(staticTrafficVehicles, entries.length).map((v, vi) => {
				const node = entries[vi];
				if (!node) return v;
				const tr = node.getTranslation();
				const p = gltfToParadise([tr[0], tr[1], tr[2]]);
				if (
					v.mTransform[12] === p.x &&
					v.mTransform[13] === p.y &&
					v.mTransform[14] === p.z
				) {
					return v;
				}
				const nextTransform = v.mTransform.slice();
				nextTransform[12] = p.x;
				nextTransform[13] = p.y;
				nextTransform[14] = p.z;
				return { ...v, mTransform: nextTransform };
			});
		}

		if (
			sections === hull.sections &&
			junctions === hull.junctions &&
			lightTriggers === hull.lightTriggers &&
			staticTrafficVehicles === hull.staticTrafficVehicles
		) {
			return hull;
		}
		return { ...hull, sections, junctions, lightTriggers, staticTrafficVehicles };
	});

	if (hulls.every((h, i) => h === model.hulls[i])) return model;
	return { ...model, hulls };
}

// ---------------------------------------------------------------------------
// Single-resource convenience wrappers
// ---------------------------------------------------------------------------

export function buildTrafficDataDocument(model: ParsedTrafficData): Document {
	const doc = new Document();
	doc.getRoot().getAsset().generator = GENERATOR;
	const scene = doc.createScene('Scene');
	addTrafficDataSubtree(doc, scene, model);
	return doc;
}

export async function exportTrafficDataToGltf(
	model: ParsedTrafficData,
): Promise<Uint8Array> {
	const doc = buildTrafficDataDocument(model);
	const io = new NodeIO();
	return io.writeBinary(doc);
}

export async function exportTrafficDataToGltfJson(
	model: ParsedTrafficData,
): Promise<Uint8Array> {
	return writeDocumentAsGltfJson(buildTrafficDataDocument(model));
}

export async function importTrafficDataFromGltf(
	bytes: Uint8Array,
): Promise<ParsedTrafficData> {
	const io = new NodeIO();
	const magic = new TextDecoder().decode(bytes.subarray(0, 4));
	if (magic === 'glTF') {
		const doc = await io.readBinary(bytes);
		return readTrafficDataFromDocument(doc);
	}
	const doc = await readDocumentFromGltfJson(bytes);
	return readTrafficDataFromDocument(doc);
}
