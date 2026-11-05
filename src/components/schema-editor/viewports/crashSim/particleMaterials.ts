// GPU side of the crash particles: camera-facing quads built in view space,
// filled from the CPU every frame. Sparks are ribbons from where the spark
// was a blur-time ago to where it is now (the game draws them motion-blurred
// the same way) and add light; dust and smoke are spinning soft sprites.
// The game's own spark / smoke textures are used when PARTICLES.BUNDLE is
// loaded, a soft procedural falloff otherwise.

import * as THREE from 'three';

const RIBBON_VS = /* glsl */ `
attribute vec3 b;
attribute vec2 corner;
attribute vec4 rgba;
attribute float width;
varying vec4 vColor;
varying vec2 vUv;
void main() {
	vec4 va = modelViewMatrix * vec4(position, 1.0);
	vec4 vb = modelViewMatrix * vec4(b, 1.0);
	vec2 d = vb.xy - va.xy;
	float l = length(d);
	vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0);
	vec2 perp = vec2(-dir.y, dir.x);
	vec4 p = mix(va, vb, corner.x);
	p.xy += perp * corner.y * width + dir * (corner.x * 2.0 - 1.0) * width;
	gl_Position = projectionMatrix * p;
	vColor = rgba;
	vUv = vec2(corner.x, corner.y * 0.5 + 0.5);
}`;

const RIBBON_FS = /* glsl */ `
uniform sampler2D map;
uniform float useMap;
varying vec4 vColor;
varying vec2 vUv;
void main() {
	float across = abs(vUv.y * 2.0 - 1.0);
	float soft = 1.0 - across * across;
	vec4 t = texture2D(map, vUv);
	vec3 k = useMap > 0.5 ? t.rgb * t.a : vec3(soft);
	gl_FragColor = vec4(vColor.rgb * k * vColor.a, 1.0);
}`;

const PUFF_VS = /* glsl */ `
attribute vec2 corner;
attribute vec4 rgba;
attribute float size;
attribute float angle;
varying vec4 vColor;
varying vec2 vUv;
void main() {
	vec4 c = modelViewMatrix * vec4(position, 1.0);
	float s = sin(angle), co = cos(angle);
	c.xy += mat2(co, s, -s, co) * corner * size * 0.5;
	gl_Position = projectionMatrix * c;
	vColor = rgba;
	vUv = corner * 0.5 + 0.5;
}`;

const PUFF_FS = /* glsl */ `
uniform sampler2D map;
uniform float useMap;
varying vec4 vColor;
varying vec2 vUv;
void main() {
	float r = length(vUv * 2.0 - 1.0);
	float soft = clamp(1.0 - r, 0.0, 1.0);
	vec4 t = useMap > 0.5 ? texture2D(map, vUv) : vec4(1.0, 1.0, 1.0, soft * soft);
	gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
}`;

// Quads with a static corner attribute and index; the per-particle
// attributes are written each frame. `position` is the ribbon's start / the
// sprite's centre (three.js won't draw a geometry without one).
function quadBatch(capacity: number, corners: number[], perVertex: Record<string, number>): THREE.BufferGeometry {
	const g = new THREE.BufferGeometry();
	const corner = new Float32Array(capacity * 8);
	const index = new Uint32Array(capacity * 6);
	for (let i = 0; i < capacity; i++) {
		corner.set(corners, i * 8);
		index.set([0, 1, 2, 2, 1, 3].map((k) => i * 4 + k), i * 6);
	}
	g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
	for (const [name, size] of Object.entries(perVertex)) {
		const attr = new THREE.BufferAttribute(new Float32Array(capacity * 4 * size), size);
		attr.setUsage(THREE.DynamicDrawUsage);
		g.setAttribute(name, attr);
	}
	g.setIndex(new THREE.BufferAttribute(index, 1));
	g.setDrawRange(0, 0);
	// Positions come from attributes the culler can't see.
	g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
	return g;
}

export const ribbonGeometry = (capacity: number) =>
	quadBatch(capacity, [0, -1, 0, 1, 1, -1, 1, 1], { position: 3, b: 3, rgba: 4, width: 1 });
export const puffGeometry = (capacity: number) =>
	quadBatch(capacity, [-1, -1, -1, 1, 1, -1, 1, 1], { position: 3, rgba: 4, size: 1, angle: 1 });

function material(vs: string, fs: string, map: THREE.Texture | null, blending: THREE.Blending): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		vertexShader: vs, fragmentShader: fs,
		uniforms: { map: { value: map }, useMap: { value: map ? 1 : 0 } },
		// The quads' winding depends on which way a ribbon points on screen.
		transparent: true, depthWrite: false, blending, side: THREE.DoubleSide,
	});
}

export const sparkMaterial = (map: THREE.Texture | null) => material(RIBBON_VS, RIBBON_FS, map, THREE.AdditiveBlending);
export const puffMaterial = (map: THREE.Texture | null) => material(PUFF_VS, PUFF_FS, map, THREE.NormalBlending);

// Writes one particle's value into all four vertices of its quad.
export function setQuad(attr: THREE.BufferAttribute, i: number, ...v: number[]): void {
	const arr = attr.array as Float32Array, n = v.length;
	for (let k = 0; k < 4; k++) arr.set(v, (i * 4 + k) * n);
}

// Debris chunk shapes: a flattened chip for body debris, a thin shard for glass.
export function chipGeometry(): THREE.BufferGeometry {
	const g = new THREE.IcosahedronGeometry(0.5, 0);
	g.scale(1, 0.35, 0.8);
	return g;
}
export function shardGeometry(): THREE.BufferGeometry {
	const g = new THREE.TetrahedronGeometry(0.5, 0);
	g.scale(1, 0.12, 0.7);
	return g;
}
