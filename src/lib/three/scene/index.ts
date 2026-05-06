// Barrel for the Scene module — three.js / R3F hooks that the World
// viewport (and its siblings: TrafficData, TriggerData, StreetData,
// AI Sections, PolygonSoup, RotationVisualizer) depend on. Reading
// this folder is the entry point for understanding what wiring a
// scene viewport requires.
//
// Callers import from the specific hook file (e.g.
// `@/lib/three/scene/useUpdateInstancedMesh`) rather than from this
// barrel, so a viewport that doesn't need the leaflet-backed
// `useFitMapBounds` doesn't pay for it transitively (leaflet touches
// `window` at module load and breaks node-side tests).

export { useApplyDisplayMatrix } from './useApplyDisplayMatrix';
export { useApplyMatrixToObject } from './useApplyMatrixToObject';
export { useAutoFitCamera, type AutoFitCameraOptions } from './useAutoFitCamera';
export {
	useCameraBridgeSync,
	type CameraBridgeData,
} from './useCameraBridgeSync';
export { useFitMapBounds } from './useFitMapBounds';
export { useFlyCameraToTarget } from './useFlyCameraToTarget';
export { useLineSegmentsGeometry } from './useLineSegmentsGeometry';
export { useSceneEnvironment } from './useSceneEnvironment';
export { useUpdateInstancedMesh } from './useUpdateInstancedMesh';
