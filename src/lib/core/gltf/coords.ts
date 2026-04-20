// Paradise uses Z-up (Criterion engine convention). glTF is Y-up. The whole
// gltf module keeps Paradise world-space in extras (as literal x/y/z copies
// of the source) and applies the swap only when writing/reading node
// translations — so the viewer shows a correctly oriented scene in Blender
// while the importer round-trips bytes exactly.
//
// `paradiseToGltf` and `gltfToParadise` are inverses: applying them in
// sequence yields the identity. They are the only place in the gltf module
// that knows about the axis convention.

export type Vec3 = { x: number; y: number; z: number };

export function paradiseToGltf(p: Vec3): [number, number, number] {
	// Paradise (x=east, y=up, z=north) → glTF (x=east, y=up, z=south).
	// Flipping z keeps handedness correct.
	return [p.x, p.y, -p.z];
}

export function gltfToParadise(t: [number, number, number]): Vec3 {
	return { x: t[0], y: t[1], z: -t[2] };
}
