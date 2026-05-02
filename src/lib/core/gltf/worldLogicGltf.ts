// Multi-resource world-logic glTF orchestrator.
//
// Unified scene convention (docs/worldlogic-gltf-roundtrip.md): one glTF file
// per bundle, containing whichever of StreetData / TrafficData / AISections /
// TriggerData happen to be present. Each resource owns exactly one key under
// `scene.extras.paradiseBundle` and one root-level group node.
//
// This module just composes the per-resource subtree builders and importers.
// It does not parse or write bundle bytes — that's the CLI's job.

import { Document, NodeIO } from '@gltf-transform/core';
import type { ParsedStreetData } from '../streetData';
import type { ParsedTrafficData } from '../trafficData';
import type { ParsedAISectionsV12 } from '../aiSections';
import type { ParsedTriggerData } from '../triggerData';
import {
	hasSceneExtrasSection,
	writeDocumentAsGltfJson,
	readDocumentFromGltfJson,
} from './sharedGltf';
import {
	addStreetDataSubtree,
	readStreetDataFromDocument,
} from './streetDataGltf';
import {
	addTrafficDataSubtree,
	readTrafficDataFromDocument,
} from './trafficDataGltf';
import {
	addAISectionsSubtree,
	readAISectionsFromDocument,
} from './aiSectionsGltf';
import {
	addTriggerDataSubtree,
	readTriggerDataFromDocument,
} from './triggerDataGltf';

const GENERATOR = 'steward-worldlogic-gltf/1';

export type WorldLogicPayload = {
	streetData?: ParsedStreetData;
	trafficData?: ParsedTrafficData;
	aiSections?: ParsedAISectionsV12;
	triggerData?: ParsedTriggerData;
};

export function buildWorldLogicDocument(payload: WorldLogicPayload): Document {
	const doc = new Document();
	doc.getRoot().getAsset().generator = GENERATOR;
	const scene = doc.createScene('Scene');

	// Emit in a stable order so the same input always produces the same
	// output: human-anchoring StreetData first, then the bulk-geometry
	// TrafficData, then AISections (collision-adjacent), then TriggerData
	// (mostly event metadata).
	if (payload.streetData) {
		addStreetDataSubtree(doc, scene, payload.streetData);
	}
	if (payload.trafficData) {
		addTrafficDataSubtree(doc, scene, payload.trafficData);
	}
	if (payload.aiSections) {
		addAISectionsSubtree(doc, scene, payload.aiSections);
	}
	if (payload.triggerData) {
		addTriggerDataSubtree(doc, scene, payload.triggerData);
	}

	return doc;
}

export function importWorldLogicFromDocument(doc: Document): WorldLogicPayload {
	const scene = doc.getRoot().listScenes()[0];
	if (!scene) throw new Error('glTF has no scene');

	const out: WorldLogicPayload = {};
	if (hasSceneExtrasSection(scene, 'streetData')) {
		out.streetData = readStreetDataFromDocument(doc);
	}
	if (hasSceneExtrasSection(scene, 'trafficData')) {
		out.trafficData = readTrafficDataFromDocument(doc);
	}
	if (hasSceneExtrasSection(scene, 'aiSections')) {
		out.aiSections = readAISectionsFromDocument(doc);
	}
	if (hasSceneExtrasSection(scene, 'triggerData')) {
		out.triggerData = readTriggerDataFromDocument(doc);
	}
	return out;
}

export async function exportWorldLogicToGltf(
	payload: WorldLogicPayload,
): Promise<Uint8Array> {
	const doc = buildWorldLogicDocument(payload);
	const io = new NodeIO();
	return io.writeBinary(doc);
}

export async function exportWorldLogicToGltfJson(
	payload: WorldLogicPayload,
): Promise<Uint8Array> {
	return writeDocumentAsGltfJson(buildWorldLogicDocument(payload));
}

export async function importWorldLogicFromGltf(
	bytes: Uint8Array,
): Promise<WorldLogicPayload> {
	const io = new NodeIO();
	const magic = new TextDecoder().decode(bytes.subarray(0, 4));
	if (magic === 'glTF') {
		const doc = await io.readBinary(bytes);
		return importWorldLogicFromDocument(doc);
	}
	const doc = await readDocumentFromGltfJson(bytes);
	return importWorldLogicFromDocument(doc);
}
