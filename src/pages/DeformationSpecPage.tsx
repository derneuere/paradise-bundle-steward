// Deformation Spec editor — tabbed form for vehicle crash data.
//
// Every tab exposes one region of the resource: handling body / offsets,
// wheels (4), sensors (20), car→handling body transform, the variable-length
// tag-point / driven-point / IK / glass-pane tables, and the three parallel
// transform-tag tables (generic / camera / light). Edits are propagated
// immutably into `setResource('deformationSpec', ...)`; array lengths are
// preserved since the writer's layout normalizer depends on them.
//
// Byte-exact round-trip is validated by the handler's `byteRoundTrip` fixture,
// plus every stress scenario (scale-handling-body, raise-all-wheels,
// sensor-radii-x2, etc.) exercises exactly the same field paths this UI edits.

import { useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useBundle } from '@/context/BundleContext';
import type {
	ParsedDeformationSpec,
	Vec3,
	Vec4,
	Mat4,
	WheelSpec,
	DeformationSensorSpec,
	TagPointSpec,
	DrivenPoint,
	TransformTag,
	IKPart,
	GlassPane,
} from '@/lib/core/deformationSpec';

// ── Primitive editors ─────────────────────────────────────────────────────

function F32Input({ value, onChange, readOnly }: { value: number; onChange?: (v: number) => void; readOnly?: boolean }) {
	return (
		<Input
			type="number"
			step="any"
			readOnly={readOnly}
			className="h-7 text-xs"
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				if (!onChange) return;
				const n = parseFloat(e.target.value);
				if (Number.isFinite(n)) onChange(n);
			}}
		/>
	);
}

function IntInput({ value, onChange, readOnly }: { value: number; onChange?: (v: number) => void; readOnly?: boolean }) {
	return (
		<Input
			type="number"
			step="1"
			readOnly={readOnly}
			className="h-7 text-xs"
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				if (!onChange) return;
				const n = parseInt(e.target.value, 10);
				if (Number.isFinite(n)) onChange(n);
			}}
		/>
	);
}

function Vec3Editor({ value, onChange }: { value: Vec3; onChange: (v: Vec3) => void }) {
	return (
		<div className="grid grid-cols-3 gap-2">
			{[0, 1, 2].map((i) => (
				<F32Input
					key={i}
					value={value[i]}
					onChange={(n) => {
						const next = value.slice() as Vec3;
						next[i] = n;
						onChange(next);
					}}
				/>
			))}
		</div>
	);
}

function Vec4Editor({ value, onChange }: { value: Vec4; onChange: (v: Vec4) => void }) {
	return (
		<div className="grid grid-cols-4 gap-2">
			{[0, 1, 2, 3].map((i) => (
				<F32Input
					key={i}
					value={value[i]}
					onChange={(n) => {
						const next = value.slice() as Vec4;
						next[i] = n;
						onChange(next);
					}}
				/>
			))}
		</div>
	);
}

function Mat4Editor({ value, onChange }: { value: Mat4; onChange: (v: Mat4) => void }) {
	return (
		<div className="grid grid-cols-4 gap-2">
			{value.map((row, r) =>
				row.map((cell, c) => (
					<F32Input
						key={`${r}-${c}`}
						value={cell}
						onChange={(n) => {
							const nextRow = row.slice() as Vec4;
							nextRow[c] = n;
							const nextMat = value.slice() as Mat4;
							nextMat[r] = nextRow;
							onChange(nextMat);
						}}
					/>
				)),
			)}
		</div>
	);
}

// Fixed-length numeric tuple editor (for nextSensor[6], cornerTagIndices[4], etc.)
function TupleEditor({
	value,
	onChange,
	readOnly,
}: {
	value: number[];
	onChange?: (v: number[]) => void;
	readOnly?: boolean;
}) {
	return (
		<div className="flex flex-wrap gap-1">
			{value.map((n, i) => (
				<Input
					key={i}
					type="number"
					step="1"
					readOnly={readOnly}
					className="h-7 w-16 text-xs"
					value={n}
					onChange={(e) => {
						if (!onChange) return;
						const parsed = parseInt(e.target.value, 10);
						if (!Number.isFinite(parsed)) return;
						const next = value.slice();
						next[i] = parsed;
						onChange(next);
					}}
				/>
			))}
		</div>
	);
}

// ── Field row wrapper ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1">
			<Label className="text-xs">{label}</Label>
			{children}
		</div>
	);
}

// ── Per-section editors ───────────────────────────────────────────────────

function OverviewTab({
	data,
	set,
}: {
	data: ParsedDeformationSpec;
	set: (patch: Partial<ParsedDeformationSpec>) => void;
}) {
	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="py-3">
					<CardTitle className="text-sm">Header</CardTitle>
				</CardHeader>
				<CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
					<Field label="version">
						<IntInput value={data.version} onChange={(n) => set({ version: n })} />
					</Field>
					<Field label="specID (u8)">
						<IntInput value={data.specID} onChange={(n) => set({ specID: n })} />
					</Field>
					<Field label="numVehicleBodies (u8)">
						<IntInput value={data.numVehicleBodies} onChange={(n) => set({ numVehicleBodies: n })} />
					</Field>
					<Field label="numDeformationSensors (u8)">
						<IntInput value={data.numDeformationSensors} onChange={(n) => set({ numDeformationSensors: n })} />
					</Field>
					<Field label="numGraphicsParts (u8)">
						<IntInput value={data.numGraphicsParts} onChange={(n) => set({ numGraphicsParts: n })} />
					</Field>
					<Field label="totalSize (bytes, recomputed)">
						<IntInput value={data.totalSize} readOnly />
					</Field>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="py-3">
					<CardTitle className="text-sm">Handling body + inertia</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<Field label="handlingBodyDimensions (vec4)">
						<Vec4Editor value={data.handlingBodyDimensions} onChange={(v) => set({ handlingBodyDimensions: v })} />
					</Field>
					<Field label="currentCOMOffset (vec4)">
						<Vec4Editor value={data.currentCOMOffset} onChange={(v) => set({ currentCOMOffset: v })} />
					</Field>
					<Field label="meshOffset (vec4)">
						<Vec4Editor value={data.meshOffset} onChange={(v) => set({ meshOffset: v })} />
					</Field>
					<Field label="rigidBodyOffset (vec4)">
						<Vec4Editor value={data.rigidBodyOffset} onChange={(v) => set({ rigidBodyOffset: v })} />
					</Field>
					<Field label="collisionOffset (vec4)">
						<Vec4Editor value={data.collisionOffset} onChange={(v) => set({ collisionOffset: v })} />
					</Field>
					<Field label="inertiaTensor (vec4)">
						<Vec4Editor value={data.inertiaTensor} onChange={(v) => set({ inertiaTensor: v })} />
					</Field>
				</CardContent>
			</Card>
		</div>
	);
}

function WheelsTab({
	wheels,
	setWheels,
}: {
	wheels: WheelSpec[];
	setWheels: (next: WheelSpec[]) => void;
}) {
	const labels = ['FR', 'FL', 'RR', 'RL'];
	const updateAt = (i: number, patch: Partial<WheelSpec>) => {
		setWheels(wheels.map((w, j) => (i === j ? { ...w, ...patch } : w)));
	};
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
			{wheels.map((w, i) => (
				<Card key={i}>
					<CardHeader className="py-2">
						<CardTitle className="text-sm">Wheel {i} · {labels[i] ?? '?'}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<Field label="position (vec4)">
							<Vec4Editor value={w.position} onChange={(v) => updateAt(i, { position: v })} />
						</Field>
						<Field label="direction (vec4)">
							<Vec4Editor value={w.direction} onChange={(v) => updateAt(i, { direction: v })} />
						</Field>
						<Field label="iValue (i32)">
							<IntInput value={w.iValue} onChange={(n) => updateAt(i, { iValue: n })} />
						</Field>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function SensorsTab({
	sensors,
	setSensors,
}: {
	sensors: DeformationSensorSpec[];
	setSensors: (next: DeformationSensorSpec[]) => void;
}) {
	const updateAt = (i: number, patch: Partial<DeformationSensorSpec>) => {
		setSensors(sensors.map((s, j) => (i === j ? { ...s, ...patch } : s)));
	};
	return (
		<Accordion type="multiple" className="space-y-1">
			{sensors.map((s, i) => (
				<AccordionItem key={i} value={`sensor-${i}`} className="border rounded-md bg-card">
					<AccordionTrigger className="px-3 py-2 hover:no-underline">
						<div className="flex items-center gap-3 text-left">
							<span className="text-sm font-semibold">Sensor {i}</span>
							<span className="text-xs text-muted-foreground font-mono">
								r={s.radius.toFixed(3)} · scene={s.sceneIndex} · abs={s.absorbtionLevel}
							</span>
						</div>
					</AccordionTrigger>
					<AccordionContent className="px-3 pb-3 space-y-3">
						<Field label="initialOffset (vec3)">
							<Vec3Editor value={s.initialOffset} onChange={(v) => updateAt(i, { initialOffset: v })} />
						</Field>
						<Field label="directionParams (6 × f32)">
							<div className="flex flex-wrap gap-1">
								{s.directionParams.map((n, k) => (
									<Input
										key={k}
										type="number"
										step="any"
										className="h-7 w-24 text-xs"
										value={n}
										onChange={(e) => {
											const parsed = parseFloat(e.target.value);
											if (!Number.isFinite(parsed)) return;
											const next = s.directionParams.slice() as DeformationSensorSpec['directionParams'];
											next[k] = parsed;
											updateAt(i, { directionParams: next });
										}}
									/>
								))}
							</div>
						</Field>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<Field label="radius (f32)">
								<F32Input value={s.radius} onChange={(n) => updateAt(i, { radius: n })} />
							</Field>
							<Field label="sceneIndex (u8)">
								<IntInput value={s.sceneIndex} onChange={(n) => updateAt(i, { sceneIndex: n })} />
							</Field>
							<Field label="absorbtionLevel (u8)">
								<IntInput value={s.absorbtionLevel} onChange={(n) => updateAt(i, { absorbtionLevel: n })} />
							</Field>
							<Field label="nextBoundarySensor (2 × u8)">
								<TupleEditor
									value={s.nextBoundarySensor}
									onChange={(v) =>
										updateAt(i, {
											nextBoundarySensor: [v[0], v[1]] as DeformationSensorSpec['nextBoundarySensor'],
										})
									}
								/>
							</Field>
						</div>
						<Field label="nextSensor (6 × u8)">
							<TupleEditor
								value={s.nextSensor}
								onChange={(v) =>
									updateAt(i, { nextSensor: v as unknown as DeformationSensorSpec['nextSensor'] })
								}
							/>
						</Field>
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}

function TransformTab({
	data,
	set,
}: {
	data: ParsedDeformationSpec;
	set: (patch: Partial<ParsedDeformationSpec>) => void;
}) {
	return (
		<Card>
			<CardHeader className="py-3">
				<CardTitle className="text-sm">carModelSpaceToHandlingBodySpace (4×4, row-major)</CardTitle>
			</CardHeader>
			<CardContent>
				<Mat4Editor
					value={data.carModelSpaceToHandlingBodySpace}
					onChange={(v) => set({ carModelSpaceToHandlingBodySpace: v })}
				/>
			</CardContent>
		</Card>
	);
}

function TagPointsTab({
	tagPoints,
	setTagPoints,
}: {
	tagPoints: TagPointSpec[];
	setTagPoints: (next: TagPointSpec[]) => void;
}) {
	const updateAt = (i: number, patch: Partial<TagPointSpec>) => {
		setTagPoints(tagPoints.map((t, j) => (i === j ? { ...t, ...patch } : t)));
	};
	return (
		<Accordion type="multiple" className="space-y-1">
			{tagPoints.map((t, i) => (
				<AccordionItem key={i} value={`tp-${i}`} className="border rounded-md bg-card">
					<AccordionTrigger className="px-3 py-2 hover:no-underline">
						<div className="flex items-center gap-3 text-left">
							<span className="text-sm font-semibold">TagPoint {i}</span>
							<span className="text-xs text-muted-foreground font-mono">
								pos=[{t.initialPosition.map((v) => v.toFixed(2)).join(', ')}] · sensorA={t.deformationSensorA} · joint={t.jointIndex}
							</span>
						</div>
					</AccordionTrigger>
					<AccordionContent className="px-3 pb-3 space-y-3">
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<Field label="offsetFromA (vec3)">
								<Vec3Editor value={t.offsetFromA} onChange={(v) => updateAt(i, { offsetFromA: v })} />
							</Field>
							<Field label="weightA (f32)">
								<F32Input value={t.weightA} onChange={(n) => updateAt(i, { weightA: n })} />
							</Field>
							<Field label="offsetFromB (vec3)">
								<Vec3Editor value={t.offsetFromB} onChange={(v) => updateAt(i, { offsetFromB: v })} />
							</Field>
							<Field label="weightB (f32)">
								<F32Input value={t.weightB} onChange={(n) => updateAt(i, { weightB: n })} />
							</Field>
							<Field label="initialPosition (vec3)">
								<Vec3Editor value={t.initialPosition} onChange={(v) => updateAt(i, { initialPosition: v })} />
							</Field>
							<Field label="detachThreshold (f32)">
								<F32Input value={t.detachThreshold} onChange={(n) => updateAt(i, { detachThreshold: n })} />
							</Field>
							<Field label="fWeightA (f32)">
								<F32Input value={t.fWeightA} onChange={(n) => updateAt(i, { fWeightA: n })} />
							</Field>
							<Field label="fWeightB (f32)">
								<F32Input value={t.fWeightB} onChange={(n) => updateAt(i, { fWeightB: n })} />
							</Field>
							<Field label="fDetachThresholdSquared (f32)">
								<F32Input
									value={t.fDetachThresholdSquared}
									onChange={(n) => updateAt(i, { fDetachThresholdSquared: n })}
								/>
							</Field>
							<Field label="deformationSensorA (i16)">
								<IntInput value={t.deformationSensorA} onChange={(n) => updateAt(i, { deformationSensorA: n })} />
							</Field>
							<Field label="deformationSensorB (i16)">
								<IntInput value={t.deformationSensorB} onChange={(n) => updateAt(i, { deformationSensorB: n })} />
							</Field>
							<Field label="jointIndex (i8)">
								<IntInput value={t.jointIndex} onChange={(n) => updateAt(i, { jointIndex: n })} />
							</Field>
							<div className="flex items-center gap-2">
								<input
									id={`tp-skin-${i}`}
									type="checkbox"
									checked={!!t.skinnedPoint}
									onChange={(e) => updateAt(i, { skinnedPoint: e.target.checked })}
								/>
								<Label htmlFor={`tp-skin-${i}`} className="text-xs">skinnedPoint</Label>
							</div>
						</div>
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}

function DrivenPointsTab({
	drivenPoints,
	setDrivenPoints,
}: {
	drivenPoints: DrivenPoint[];
	setDrivenPoints: (next: DrivenPoint[]) => void;
}) {
	const updateAt = (i: number, patch: Partial<DrivenPoint>) => {
		setDrivenPoints(drivenPoints.map((d, j) => (i === j ? { ...d, ...patch } : d)));
	};
	return (
		<Accordion type="multiple" className="space-y-1">
			{drivenPoints.map((d, i) => (
				<AccordionItem key={i} value={`dp-${i}`} className="border rounded-md bg-card">
					<AccordionTrigger className="px-3 py-2 hover:no-underline">
						<span className="text-sm font-semibold">DrivenPoint {i}</span>
						<span className="text-xs text-muted-foreground font-mono ml-3">
							A={d.tagPointIndexA} · B={d.tagPointIndexB} · d={d.distanceFromA.toFixed(2)}/{d.distanceFromB.toFixed(2)}
						</span>
					</AccordionTrigger>
					<AccordionContent className="px-3 pb-3">
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<Field label="initialPos (vec3)">
								<Vec3Editor value={d.initialPos} onChange={(v) => updateAt(i, { initialPos: v })} />
							</Field>
							<Field label="distanceFromA (f32)">
								<F32Input value={d.distanceFromA} onChange={(n) => updateAt(i, { distanceFromA: n })} />
							</Field>
							<Field label="distanceFromB (f32)">
								<F32Input value={d.distanceFromB} onChange={(n) => updateAt(i, { distanceFromB: n })} />
							</Field>
							<Field label="tagPointIndexA (i16)">
								<IntInput value={d.tagPointIndexA} onChange={(n) => updateAt(i, { tagPointIndexA: n })} />
							</Field>
							<Field label="tagPointIndexB (i16)">
								<IntInput value={d.tagPointIndexB} onChange={(n) => updateAt(i, { tagPointIndexB: n })} />
							</Field>
						</div>
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}

function TransformTagsList({
	tags,
	setTags,
	title,
}: {
	tags: TransformTag[];
	setTags: (next: TransformTag[]) => void;
	title: string;
}) {
	const updateAt = (i: number, patch: Partial<TransformTag>) => {
		setTags(tags.map((t, j) => (i === j ? { ...t, ...patch } : t)));
	};
	if (tags.length === 0) {
		return <div className="text-xs text-muted-foreground">No {title.toLowerCase()} tags.</div>;
	}
	return (
		<Accordion type="multiple" className="space-y-1">
			{tags.map((t, i) => (
				<AccordionItem key={i} value={`${title}-${i}`} className="border rounded-md bg-card">
					<AccordionTrigger className="px-3 py-2 hover:no-underline">
						<span className="text-sm font-semibold">{title} {i}</span>
						<span className="text-xs text-muted-foreground font-mono ml-3">
							type={t.tagPointType} · ikPart={t.ikPartIndex} · skin={t.skinPoint}
						</span>
					</AccordionTrigger>
					<AccordionContent className="px-3 pb-3 space-y-3">
						<Field label="locator (4×4)">
							<Mat4Editor value={t.locator} onChange={(v) => updateAt(i, { locator: v })} />
						</Field>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
							<Field label="tagPointType (i32)">
								<IntInput value={t.tagPointType} onChange={(n) => updateAt(i, { tagPointType: n })} />
							</Field>
							<Field label="ikPartIndex (i16)">
								<IntInput value={t.ikPartIndex} onChange={(n) => updateAt(i, { ikPartIndex: n })} />
							</Field>
							<Field label="skinPoint (u8)">
								<IntInput value={t.skinPoint} onChange={(n) => updateAt(i, { skinPoint: n })} />
							</Field>
						</div>
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}

function IKPartsTab({
	ikParts,
	setIKParts,
}: {
	ikParts: IKPart[];
	setIKParts: (next: IKPart[]) => void;
}) {
	const updateAt = (i: number, patch: Partial<IKPart>) => {
		setIKParts(ikParts.map((p, j) => (i === j ? { ...p, ...patch } : p)));
	};
	const updateJoint = (partIdx: number, jointIdx: number, patch: Partial<IKPart['jointSpecs'][number]>) => {
		const part = ikParts[partIdx];
		const nextJoints = part.jointSpecs.map((j, k) => (k === jointIdx ? { ...j, ...patch } : j));
		updateAt(partIdx, { jointSpecs: nextJoints });
	};
	return (
		<Accordion type="multiple" className="space-y-1">
			{ikParts.map((p, i) => (
				<AccordionItem key={i} value={`ik-${i}`} className="border rounded-md bg-card">
					<AccordionTrigger className="px-3 py-2 hover:no-underline">
						<span className="text-sm font-semibold">IKPart {i}</span>
						<span className="text-xs text-muted-foreground font-mono ml-3">
							type={p.partType} · graphics={p.partGraphics} · tp={p.numberOfTagPoints}@{p.startIndexOfTagPoints} · dp={p.numberOfDrivenPoints}@{p.startIndexOfDrivenPoints} · joints={p.jointSpecs.length}
						</span>
					</AccordionTrigger>
					<AccordionContent className="px-3 pb-3 space-y-3">
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
							<Field label="partType (i32)">
								<IntInput value={p.partType} onChange={(n) => updateAt(i, { partType: n })} />
							</Field>
							<Field label="partGraphics (i32)">
								<IntInput value={p.partGraphics} onChange={(n) => updateAt(i, { partGraphics: n })} />
							</Field>
							<Field label="startIndexOfTagPoints (i32)">
								<IntInput
									value={p.startIndexOfTagPoints}
									onChange={(n) => updateAt(i, { startIndexOfTagPoints: n })}
								/>
							</Field>
							<Field label="numberOfTagPoints (i32)">
								<IntInput value={p.numberOfTagPoints} onChange={(n) => updateAt(i, { numberOfTagPoints: n })} />
							</Field>
							<Field label="startIndexOfDrivenPoints (i32)">
								<IntInput
									value={p.startIndexOfDrivenPoints}
									onChange={(n) => updateAt(i, { startIndexOfDrivenPoints: n })}
								/>
							</Field>
							<Field label="numberOfDrivenPoints (i32)">
								<IntInput
									value={p.numberOfDrivenPoints}
									onChange={(n) => updateAt(i, { numberOfDrivenPoints: n })}
								/>
							</Field>
						</div>

						<Field label="graphicsTransform (4×4)">
							<Mat4Editor value={p.graphicsTransform} onChange={(v) => updateAt(i, { graphicsTransform: v })} />
						</Field>
						<Field label="orientation (4×4)">
							<Mat4Editor value={p.orientation} onChange={(v) => updateAt(i, { orientation: v })} />
						</Field>

						{p.jointSpecs.length > 0 && (
							<div className="space-y-2">
								<div className="text-xs font-semibold text-muted-foreground">Joints ({p.jointSpecs.length})</div>
								{p.jointSpecs.map((j, ji) => (
									<Card key={ji}>
										<CardContent className="py-3 space-y-3">
											<div className="text-xs font-mono">joint #{ji}</div>
											<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
												<Field label="position (vec4)">
													<Vec4Editor value={j.position} onChange={(v) => updateJoint(i, ji, { position: v })} />
												</Field>
												<Field label="axis (vec4)">
													<Vec4Editor value={j.axis} onChange={(v) => updateJoint(i, ji, { axis: v })} />
												</Field>
												<Field label="defaultDirection (vec4)">
													<Vec4Editor
														value={j.defaultDirection}
														onChange={(v) => updateJoint(i, ji, { defaultDirection: v })}
													/>
												</Field>
												<Field label="maxJointAngle (f32)">
													<F32Input
														value={j.maxJointAngle}
														onChange={(n) => updateJoint(i, ji, { maxJointAngle: n })}
													/>
												</Field>
												<Field label="jointDetachThreshold (f32)">
													<F32Input
														value={j.jointDetachThreshold}
														onChange={(n) => updateJoint(i, ji, { jointDetachThreshold: n })}
													/>
												</Field>
												<Field label="jointType (i32)">
													<IntInput
														value={j.jointType}
														onChange={(n) => updateJoint(i, ji, { jointType: n })}
													/>
												</Field>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}

function GlassPanesTab({
	glassPanes,
	setGlassPanes,
}: {
	glassPanes: GlassPane[];
	setGlassPanes: (next: GlassPane[]) => void;
}) {
	const updateAt = (i: number, patch: Partial<GlassPane>) => {
		setGlassPanes(glassPanes.map((g, j) => (i === j ? { ...g, ...patch } : g)));
	};
	if (glassPanes.length === 0) {
		return <div className="text-xs text-muted-foreground">No glass panes.</div>;
	}
	return (
		<Accordion type="multiple" className="space-y-1">
			{glassPanes.map((g, i) => (
				<AccordionItem key={i} value={`gp-${i}`} className="border rounded-md bg-card">
					<AccordionTrigger className="px-3 py-2 hover:no-underline">
						<span className="text-sm font-semibold">GlassPane {i}</span>
						<span className="text-xs text-muted-foreground font-mono ml-3">
							type={g.partType} · corners=[{g.cornerTagIndices.join(', ')}]
						</span>
					</AccordionTrigger>
					<AccordionContent className="px-3 pb-3 space-y-3">
						<Field label="plane (vec4: normal + distance)">
							<Vec4Editor value={g.plane} onChange={(v) => updateAt(i, { plane: v })} />
						</Field>
						<Field label="matrix (4×4)">
							<Mat4Editor value={g.matrix} onChange={(v) => updateAt(i, { matrix: v })} />
						</Field>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<Field label="cornerTagIndices (4 × i16)">
								<TupleEditor
									value={g.cornerTagIndices}
									onChange={(v) =>
										updateAt(i, {
											cornerTagIndices: [v[0], v[1], v[2], v[3]] as GlassPane['cornerTagIndices'],
										})
									}
								/>
							</Field>
							<Field label="bytes58 (4 × u8)">
								<TupleEditor
									value={g.bytes58}
									onChange={(v) =>
										updateAt(i, { bytes58: [v[0], v[1], v[2], v[3]] as GlassPane['bytes58'] })
									}
								/>
							</Field>
							<Field label="short5C (i16)">
								<IntInput value={g.short5C} onChange={(n) => updateAt(i, { short5C: n })} />
							</Field>
							<Field label="short5E (i16)">
								<IntInput value={g.short5E} onChange={(n) => updateAt(i, { short5E: n })} />
							</Field>
							<Field label="short60 (i16)">
								<IntInput value={g.short60} onChange={(n) => updateAt(i, { short60: n })} />
							</Field>
							<Field label="partType (i32)">
								<IntInput value={g.partType} onChange={(n) => updateAt(i, { partType: n })} />
							</Field>
						</div>
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}

// ── Main page ────────────────────────────────────────────────────────────

const DeformationSpecPage = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedDeformationSpec>('deformationSpec');

	const set = useCallback(
		(patch: Partial<ParsedDeformationSpec>) => {
			if (!data) return;
			setResource('deformationSpec', { ...data, ...patch });
		},
		[data, setResource],
	);

	const summary = useMemo(() => {
		if (!data) return '';
		const [hx, hy, hz] = data.handlingBodyDimensions;
		return `v${data.version} · body[${hx.toFixed(2)}, ${hy.toFixed(2)}, ${hz.toFixed(2)}] · `
			+ `${data.wheels.length}W ${data.sensors.length}S · tp=${data.tagPoints.length} dp=${data.drivenPoints.length} `
			+ `ik=${data.ikParts.length} gp=${data.glassPanes.length} gen=${data.genericTags.length} `
			+ `cam=${data.cameraTags.length} lit=${data.lightTags.length} · ${data.totalSize}B`;
	}, [data]);

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Deformation Spec</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing a DeformationSpec resource (e.g. VEH_*_AT.BIN) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0 flex flex-col gap-3">
			<Card className="shrink-0">
				<CardHeader className="py-3">
					<CardTitle className="text-base">Deformation Spec</CardTitle>
				</CardHeader>
				<CardContent className="py-2 text-xs text-muted-foreground font-mono">
					{summary}
				</CardContent>
			</Card>

			<div className="flex-1 min-h-0 overflow-auto">
				<Tabs defaultValue="overview" className="w-full">
					<TabsList className="flex flex-wrap h-auto">
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="wheels">Wheels (4)</TabsTrigger>
						<TabsTrigger value="sensors">Sensors (20)</TabsTrigger>
						<TabsTrigger value="transform">Transform</TabsTrigger>
						<TabsTrigger value="tagPoints">Tag points ({data.tagPoints.length})</TabsTrigger>
						<TabsTrigger value="drivenPoints">Driven points ({data.drivenPoints.length})</TabsTrigger>
						<TabsTrigger value="ikParts">IK parts ({data.ikParts.length})</TabsTrigger>
						<TabsTrigger value="glassPanes">Glass panes ({data.glassPanes.length})</TabsTrigger>
						<TabsTrigger value="tags">Tags ({data.genericTags.length}/{data.cameraTags.length}/{data.lightTags.length})</TabsTrigger>
					</TabsList>

					<TabsContent value="overview"><OverviewTab data={data} set={set} /></TabsContent>
					<TabsContent value="wheels">
						<WheelsTab wheels={data.wheels} setWheels={(w) => set({ wheels: w })} />
					</TabsContent>
					<TabsContent value="sensors">
						<SensorsTab sensors={data.sensors} setSensors={(s) => set({ sensors: s })} />
					</TabsContent>
					<TabsContent value="transform"><TransformTab data={data} set={set} /></TabsContent>
					<TabsContent value="tagPoints">
						<TagPointsTab tagPoints={data.tagPoints} setTagPoints={(t) => set({ tagPoints: t })} />
					</TabsContent>
					<TabsContent value="drivenPoints">
						<DrivenPointsTab drivenPoints={data.drivenPoints} setDrivenPoints={(d) => set({ drivenPoints: d })} />
					</TabsContent>
					<TabsContent value="ikParts">
						<IKPartsTab ikParts={data.ikParts} setIKParts={(p) => set({ ikParts: p })} />
					</TabsContent>
					<TabsContent value="glassPanes">
						<GlassPanesTab glassPanes={data.glassPanes} setGlassPanes={(g) => set({ glassPanes: g })} />
					</TabsContent>
					<TabsContent value="tags">
						<Tabs defaultValue="generic" className="w-full">
							<TabsList>
								<TabsTrigger value="generic">Generic ({data.genericTags.length})</TabsTrigger>
								<TabsTrigger value="camera">Camera ({data.cameraTags.length})</TabsTrigger>
								<TabsTrigger value="light">Light ({data.lightTags.length})</TabsTrigger>
							</TabsList>
							<TabsContent value="generic">
								<TransformTagsList
									tags={data.genericTags}
									setTags={(t) => set({ genericTags: t })}
									title="Generic"
								/>
							</TabsContent>
							<TabsContent value="camera">
								<TransformTagsList
									tags={data.cameraTags}
									setTags={(t) => set({ cameraTags: t })}
									title="Camera"
								/>
							</TabsContent>
							<TabsContent value="light">
								<TransformTagsList
									tags={data.lightTags}
									setTags={(t) => set({ lightTags: t })}
									title="Light"
								/>
							</TabsContent>
						</Tabs>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
};

export default DeformationSpecPage;
