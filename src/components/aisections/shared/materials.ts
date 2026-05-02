// Shared three.js materials and geometries reused by every AI Sections
// overlay (V4/V6 read-only and V12 editable). Module-level instances are
// safe because every consumer renders them with stateless mesh JSX —
// nothing mutates the material itself across overlays. Lifting them here
// keeps the V4 / V12 visual conventions in lock-step (issue #35).

import * as THREE from 'three';

export const fillMaterial = new THREE.MeshBasicMaterial({
	vertexColors: true,
	transparent: true,
	opacity: 0.25,
	side: THREE.DoubleSide,
	depthWrite: false,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1,
});

export const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x888888 });

export const portalGeo = new THREE.SphereGeometry(3, 12, 8);

export const portalMat = new THREE.MeshStandardMaterial({
	color: 0x33cccc,
	roughness: 0.4,
	metalness: 0.2,
});

export const portalSelMat = new THREE.MeshStandardMaterial({
	color: 0xffaa33,
	roughness: 0.4,
	metalness: 0.2,
	emissive: 0x664400,
	emissiveIntensity: 0.5,
});
