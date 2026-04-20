// Public surface of the worldlogic glTF module.
// See docs/worldlogic-gltf-roundtrip.md for the overall design.

export {
	addStreetDataSubtree,
	buildStreetDataDocument,
	exportStreetDataToGltf,
	exportStreetDataToGltfJson,
	importStreetDataFromDocument,
	importStreetDataFromGltf,
	readStreetDataFromDocument,
} from './streetDataGltf';

export {
	addTrafficDataSubtree,
	buildTrafficDataDocument,
	exportTrafficDataToGltf,
	exportTrafficDataToGltfJson,
	importTrafficDataFromGltf,
	readTrafficDataFromDocument,
} from './trafficDataGltf';

export {
	addAISectionsSubtree,
	buildAISectionsDocument,
	exportAISectionsToGltf,
	exportAISectionsToGltfJson,
	importAISectionsFromGltf,
	readAISectionsFromDocument,
} from './aiSectionsGltf';

export {
	addTriggerDataSubtree,
	buildTriggerDataDocument,
	exportTriggerDataToGltf,
	exportTriggerDataToGltfJson,
	importTriggerDataFromGltf,
	readTriggerDataFromDocument,
} from './triggerDataGltf';

export {
	buildWorldLogicDocument,
	exportWorldLogicToGltf,
	exportWorldLogicToGltfJson,
	importWorldLogicFromDocument,
	importWorldLogicFromGltf,
	type WorldLogicPayload,
} from './worldLogicGltf';

export { paradiseToGltf, gltfToParadise } from './coords';
