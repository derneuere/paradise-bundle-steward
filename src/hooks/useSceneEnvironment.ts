// Set up a PMREM-baked sky-ground gradient as the scene's environment
// map. Lights every meshStandardMaterial in the scene with image-based
// lighting that matches the renderable preview's clay-render aesthetic
// (light sky above the horizon, warm ground below).
//
// Mounts as a child of <Canvas>; the hook reads the WebGL context and
// the scene from useThree() and writes `scene.environment` on commit.
// Cleans up the PMREMGenerator and the bake's input geometry/material
// on unmount so re-mounting the viewport doesn't leak GPU memory.

import { useEffect } from 'react';
import * as THREE from 'three';

const SKY_VERTEX = `
varying vec3 vWorldPosition;
void main() {
	vec4 worldPos = modelMatrix * vec4(position, 1.0);
	vWorldPosition = worldPos.xyz;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = `
varying vec3 vWorldPosition;
void main() {
	float h = normalize(vWorldPosition).y;
	vec3 sky = mix(vec3(0.8, 0.85, 0.9), vec3(0.5, 0.7, 1.0), max(h, 0.0));
	vec3 ground = mix(vec3(0.4, 0.35, 0.3), vec3(0.1, 0.08, 0.06), max(-h, 0.0));
	vec3 color = h > 0.0 ? sky : ground;
	gl_FragColor = vec4(color, 1.0);
}
`;

export function useSceneEnvironment(
	gl: THREE.WebGLRenderer,
	scene: THREE.Scene,
): void {
	useEffect(() => {
		const pmrem = new THREE.PMREMGenerator(gl);
		pmrem.compileCubemapShader();
		const envScene = new THREE.Scene();
		const skyGeo = new THREE.SphereGeometry(50, 32, 16);
		const skyMat = new THREE.ShaderMaterial({
			side: THREE.BackSide,
			uniforms: {},
			vertexShader: SKY_VERTEX,
			fragmentShader: SKY_FRAGMENT,
		});
		envScene.add(new THREE.Mesh(skyGeo, skyMat));
		const envMap = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
		scene.environment = envMap;
		return () => {
			envMap.dispose();
			pmrem.dispose();
			skyGeo.dispose();
			skyMat.dispose();
			scene.environment = null;
		};
	}, [gl, scene]);
}
