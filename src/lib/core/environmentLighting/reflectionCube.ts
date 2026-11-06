// three.js cube texture for the reflection stand-in (see reflection.ts).

import * as THREE from 'three';
import type { EngineLighting } from './engineLighting';
import { reflectionCubeFaces } from './reflection';
import { DEFAULT_ENGINE_LIGHTING } from './defaults';

const FACE_SIZE = 64;

export function buildReflectionCube(env: EngineLighting): THREE.CubeTexture {
	const faces = reflectionCubeFaces(env, FACE_SIZE).map((px) => {
		const t = new THREE.DataTexture(px, FACE_SIZE, FACE_SIZE, THREE.RGBAFormat);
		t.needsUpdate = true;
		return t;
	});
	const cube = new THREE.CubeTexture(faces as unknown as HTMLImageElement[]); // TODO(types): three accepts DataTexture faces but types the array as images
	cube.format = THREE.RGBAFormat;
	cube.type = THREE.UnsignedByteType;
	cube.minFilter = THREE.LinearFilter;
	cube.magFilter = THREE.LinearFilter;
	cube.generateMipmaps = false;
	cube.needsUpdate = true;
	return cube;
}

let _default: THREE.CubeTexture | null = null;

/** Shared reflection cube for the retail default daylight. Read-only. */
export function defaultReflectionCube(): THREE.CubeTexture {
	return (_default ??= buildReflectionCube(DEFAULT_ENGINE_LIGHTING));
}
