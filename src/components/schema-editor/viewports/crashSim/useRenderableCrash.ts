// Crash test inside the Renderable view: when the viewed bundle is a vehicle
// body (a GraphicsSpec whose meshes carry deformation blend weights) and a
// DeformationSpec is loaded in the workspace (its _AT twin, or any other the
// user picks), the textured car can be crashed with the same simulator and
// controls as the Deformation Spec's Crash Preview.

import { useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRenderableDecoded } from '../renderableDecodedContext';
import { decodeShatteredGlass } from '@/lib/core/shatteredGlassDecode';
import { useCrackedGlass, type CrackedGlass } from './useCrackedGlass';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import type { ParsedDeformationSpec } from '@/lib/core/deformationSpec';
import type { DecodedRenderable, DecodeMode } from '@/lib/core/renderableDecode';
import { crashBodyFromDecoded, type CrashBody } from './crashBody';
import { crashSpecFor, crashTestAvailable } from './crashSetup';
import { crashHitHandler, makePartPoser, type PartPoser } from './crashStepper';
import type { HeatUniform, RowsUniform } from './deformMaterial';
import { useCrashSession, type CrashSession } from './useCrashSession';

// What the Renderable view's meshes need while a crash test is on.
export type CrashDeform = {
	// The car's 128 x vec4 deformation rows, refreshed every frame before the
	// draw. Standard materials read it through patchDeformMaterial; the
	// translated game shaders expect the same array as g_verletOffsets.
	rows: RowsUniform;
	heat: HeatUniform;
	flat: boolean;
	// Register each drawn mesh under its GraphicsSpec part so hinged and
	// knocked-off parts take their pose.
	poser: PartPoser;
	onClick: ReturnType<typeof crashHitHandler>;
	// Cracked panes: which drawn renderables are shattered-glass models and
	// the per-pane materials they draw with.
	glass: CrackedGlass;
};

export type RenderableCrash = {
	// A body plus at least one loaded DeformationSpec: offer the crash test.
	available: boolean;
	enabled: boolean;
	setEnabled: (on: boolean) => void;
	specBundles: EditableBundle[];
	specBundle: EditableBundle | undefined;
	chooseSpec: (id: string) => void;
	spec: ParsedDeformationSpec | null;
	body: CrashBody | null;
	session: CrashSession;
	// Non-null while the crash test is on and the meshes can be posed.
	deform: CrashDeform | null;
	// What the view draws while the crash test is on: the car plus its panes'
	// shattered-glass models (shown only while a pane is cracked).
	drawn: DecodedRenderable[] | null;
};

export function useRenderableCrash(bundle: EditableBundle | null, renderables: readonly DecodedRenderable[] | null, decodeMode: DecodeMode): RenderableCrash {
	const { bundles } = useWorkspace();
	// The user's pick holds for the body it was made on.
	const [choice, setChoice] = useState<{ body: string | undefined; spec: string }>({ body: undefined, spec: '' });
	const { candidates: specBundles, picked: specBundle, spec } = useMemo(
		() => crashSpecFor(bundle, bundles, choice.body === bundle?.id ? choice.spec : undefined),
		[bundle, bundles, choice],
	);
	const session = useCrashSession(spec, specBundle?.parsedResources.get('attribSysVault'), { flat: false });
	const decodedCtx = useRenderableDecoded();
	const textureBundles = decodedCtx?.textureBundles, shaderNames = decodedCtx?.shaderNameMap ?? null;
	const shattered = useMemo(
		() => (bundle && renderables && decodeMode === 'graphics'
			? decodeShatteredGlass(bundle.originalArrayBuffer, bundle.parsed, textureBundles ?? [], shaderNames)
			: []),
		[bundle, renderables, decodeMode, textureBundles, shaderNames],
	);
	const body = useMemo(
		() => (renderables && decodeMode === 'graphics' ? crashBodyFromDecoded(renderables, shattered) : null),
		[renderables, decodeMode, shattered],
	);
	const poser = useMemo(() => makePartPoser(), []);
	const [enabled, setEnabled] = useState(false);
	const available = crashTestAvailable(spec, body);
	const on = enabled && available && !!body;
	const { rows, heat, flat } = session;
	// Stable click handler that always hits with the current speed / obstacle.
	const hitRef = useRef(session.hitAt);
	hitRef.current = session.hitAt;
	const onClick = useMemo(() => crashHitHandler((p, n) => hitRef.current(p, n)), []);
	const glass = useCrackedGlass(bundles);
	const deform = useMemo<CrashDeform | null>(
		() => (on ? { rows, heat, flat, poser, onClick, glass } : null),
		[on, rows, heat, flat, poser, onClick, glass],
	);
	const drawn = useMemo(
		() => (on && renderables && body?.glass.length ? [...renderables, ...body.glass] : null),
		[on, renderables, body],
	);
	return { available, enabled: enabled && available, setEnabled, specBundles, specBundle, chooseSpec: (spec: string) => setChoice({ body: bundle?.id, spec }), spec, body, session, deform, drawn };
}
