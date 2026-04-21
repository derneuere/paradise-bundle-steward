// AttribSys Vault editor — form-per-attribute-class.
//
// The AttribSys model stores a heterogeneous list of attribute instances, one
// per recognized class (physicsvehiclebaseattribs, physicsvehicleboostattribs,
// camerabumperbehaviour, …). Each class has its own field schema defined in
// src/lib/core/vehicleAttribs.ts. The schema-editor framework expects a fixed
// record tree rather than a discriminated union of records, so this page
// drives its layout directly from AttribSchema via getSchemaByClassHash.
//
// Only numeric-ish fields are editable here: f32 / int / bool / vec4. Bigint
// / bytes / refspecs are displayed read-only; padding is hidden. The writer
// preserves every field regardless of whether the UI exposed it.

import { useCallback, useMemo, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useBundle } from '@/context/BundleContext';
import type { ParsedAttribSys } from '@/lib/core/attribSys';
import {
	getSchemaByClassHash,
	type AttribSchema,
	type ParsedAttribute,
	type RefSpecValue,
} from '@/lib/core/vehicleAttribs';

// Accordion sections opened on first render. These carry the tuning values
// most modders reach for (mass, grip, MaxSpeed, MaxBoostSpeed, BoostKick).
const DEFAULT_OPEN_CLASSES = ['physicsvehiclebaseattribs', 'physicsvehicleboostattribs'];

type UpdateField = (attrIndex: number, fieldName: string, value: unknown) => void;

// Class-name → human label. Falls back to the raw className when missing.
const CLASS_LABELS: Record<string, string> = {
	physicsvehiclebaseattribs: 'Base handling (mass, grip, brakes)',
	physicsvehicleboostattribs: 'Boost',
	physicsvehicleengineattribs: 'Engine (torque, RPM, gears)',
	physicsvehicledriftattribs: 'Drift',
	physicsvehiclesuspensionattribs: 'Suspension',
	physicsvehiclesteeringattribs: 'Steering',
	physicsvehiclecollisionattribs: 'Collision body box',
	physicsvehiclebodyrollattribs: 'Body roll',
	physicsvehiclehandling: 'Handling refs',
	camerabumperbehaviour: 'Bumper camera',
	cameraexternalbehaviour: 'External camera',
	burnoutcargraphicsasset: 'Car graphics asset',
	burnoutcarasset: 'Car asset',
};

function classLabel(className: string): string {
	return CLASS_LABELS[className] ?? className;
}

// Per-field metadata derived from a sweep over every VEH_*_AT.BIN in
// example/ (see scripts/analyze-attribsys-ranges.ts). Three shapes:
//
//   values:   field is categorical → render a dropdown of retail values
//             (plus the current raw value if it isn't in that set)
//   min/max:  free-form numeric but clamped to a 2× retail spread, so a
//             typo can't produce values the game engine has never seen
//   constant: field took the same value on all 48 retail cars → hidden
//             by default behind the "Show advanced" toggle
//
// All entries are advisory: editing still produces a valid write, these
// just guide the UI away from nonsense inputs.
type FieldMeta = {
	values?: number[];
	min?: number;
	max?: number;
	constant?: boolean;
};

const FIELD_META: Record<string, Record<string, FieldMeta>> = {
	physicsvehiclebaseattribs: {
		MaxSpeed: { min: 60, max: 300 },
		DrivingMass: { min: 200, max: 10000 },
		DownForce: { min: 0, max: 60 },
		RearTireAdhesiveLimit: { min: 5000, max: 100000 },
		FrontTireAdhesiveLimit: { min: 5000, max: 100000 },
		RearTireStaticFrictionCoefficient: { min: 0.5, max: 6 },
		RearTireDynamicFrictionCoefficient: { min: 0.5, max: 6 },
		FrontTireStaticFrictionCoefficient: { min: 0.5, max: 6 },
		FrontTireDynamicFrictionCoefficient: { min: 0.5, max: 6 },
		PowerToRear: { min: 0, max: 1 },
		PowerToFront: { min: 0, max: 1 },
		SurfaceRearGripFactor: { min: 0, max: 2 },
		SurfaceFrontGripFactor: { min: 0, max: 2 },
		SurfaceRoughnessFactor: { min: 0, max: 2 },
		SurfaceDragFactor: { min: 0, max: 2 },
		LinearDrag: { min: 0, max: 2 },
		MagicBrakeFactorTurning: { min: 0, max: 5 },
		MagicBrakeFactorStraightLine: { min: 0, max: 15 },
		LowSpeedTyreFrictionTractionControl: { min: 0, max: 50 },
		TimeForFullBrake: { values: [3, 4, 5] },
		RearWheelMass: { values: [20, 30, 45, 50, 120] },
		FrontWheelMass: { values: [20, 30, 45, 120] },
		LowSpeedDrivingSpeed: { values: [50, 70] },
		TractionLineLength: { constant: true },
		CrashExtraYawVelocityFactor: { constant: true },
		CrashExtraRollVelocityFactor: { constant: true },
		CrashExtraPitchVelocityFactor: { constant: true },
		CrashExtraLinearVelocityFactor: { constant: true },
	},
	physicsvehicleengineattribs: {
		MaxRPM: { min: 1000, max: 15000 },
		MaxTorque: { min: 50, max: 2000 },
		TorqueFallOffRPM: { min: 0, max: 10000 },
		Differential: { min: 1, max: 10 },
		TransmissionEfficiency: { min: 0, max: 1 },
		EngineLowEndTorqueFactor: { min: 0, max: 5 },
		LSDMGearUpSpeed: { values: [20, 30] },
		EngineBraking: { values: [125, 500] },
		GearChangeTime: { constant: true },
		FlyWheelInertia: { constant: true },
		FlyWheelFriction: { constant: true },
		EngineResistance: { constant: true },
	},
	physicsvehicleboostattribs: {
		MaxBoostSpeed: { min: 80, max: 350 },
		BlueMaxBoostSpeed: { values: [170, 175, 180] },
		BoostBase: { min: 0, max: 3 },
		BoostAcceleration: { min: 0, max: 30 },
		BoostKick: { values: [0, 5] },
		BoostKickMaxStartSpeed: { values: [100, 180] },
		BoostKickAcceleration: { min: 0, max: 60 },
		BlueBoostKick: { min: 0, max: 15 },
		BoostRule: { constant: true },
		BoostKickTime: { constant: true },
		BoostKickMaxTime: { constant: true },
		BoostHeightOffset: { constant: true },
		BlueBoostKickTime: { constant: true },
		BlueBoostBase: { constant: true },
	},
	physicsvehicledriftattribs: {
		DriftMaxAngle: { values: [45, 50, 60, 65, 75, 80, 85, 90] },
		MinSpeedForDrift: { values: [40, 45, 60] },
		SideForceDriftSpeedCutOff: { values: [1, 100] },
		SideForceDriftAngleCutOff: { values: [30, 35, 40, 45, 50, 55, 60] },
		SideForcePeakDriftAngle: { min: 0, max: 80 },
		SideForceMagnitude: { min: 0, max: 70 },
		NaturalYawTorque: { min: 0, max: 30000 },
		NaturalYawTorqueCutOffAngle: { min: 0, max: 45 },
		TimeForNaturalDrift: { constant: true },
		NeutralTimeToReduceDrift: { constant: true },
		NaturalDriftTimeToReachBaseSlip: { constant: true },
		NaturalDriftStartSlip: { constant: true },
		InitialDriftPushBaseInc: { constant: true },
		GripFromSteering: { constant: true },
		GripFromGasLetOff: { constant: true },
		GripFromBrake: { constant: true },
		ForcedDriftTimeToReachBaseSlip: { constant: true },
		DriftSidewaysDamping: { constant: true },
	},
	physicsvehiclesteeringattribs: {
		MaxAngle: { values: [10, 11, 12, 15, 17] },
		SpeedForMinAngle: { values: [90, 120, 150, 180] },
		AiPidCoefficientDriftD: { values: [1, 3] },
		AiMinLookAheadDistanceForDrift: { values: [0, 20] },
		SpeedForMaxAngle: { constant: true },
		AiPidCoefficientP: { constant: true },
		AiLookAheadTimeForDrift: { constant: true },
	},
	physicsvehiclesuspensionattribs: {
		UpwardMovement: { min: 0, max: 0.5 },
		DownwardMovement: { min: 0, max: 0.5 },
		SpringLength: { min: 0, max: 0.5 },
		Strength: { constant: true },
		InAirDamping: { constant: true },
	},
	physicsvehiclebodyrollattribs: {
		RollSpringStiffness: { constant: true },
		RollSpringDampening: { constant: true },
		PitchSpringStiffness: { constant: true },
		PitchSpringDampening: { constant: true },
	},
	camerabumperbehaviour: {
		YawSpring: { constant: true },
		RollSpring: { constant: true },
		PitchSpring: { constant: true },
		FieldOfView: { constant: true },
		BoostFieldOfView: { constant: true },
		BodyRollScale: { constant: true },
		BodyPitchScale: { constant: true },
		AccelerationResponse: { constant: true },
		AccelerationDampening: { constant: true },
	},
	cameraexternalbehaviour: {
		FieldOfView: { values: [60, 70, 80] },
		DownAngle: { values: [0, 5] },
		BoostFieldOfView: { values: [80, 90, 95] },
		ZDistanceScale: { constant: true },
		ZAndTiltCutoffSpeedMPH: { constant: true },
		TiltCameraScale: { constant: true },
		TiltAroundCar: { constant: true },
		SlideZOffsetMax: { constant: true },
		SlideYScale: { constant: true },
		SlideXScale: { constant: true },
		BoostFieldOfViewZoom: { constant: true },
	},
	burnoutcargraphicsasset: {
		PlayerPalletteIndex: { values: [0, 1, 2, 3] },
		Alloc: { constant: true },
		Num_RandomTrafficColours: { constant: true },
		Size: { constant: true },
		EncodedTypePad: { constant: true },
		Alloc_Offences: { constant: true },
		Num_Offences: { constant: true },
		Size_Offences: { constant: true },
		EncodedTypePad_Offences: { constant: true },
	},
};

function getFieldMeta(className: string, fieldName: string): FieldMeta {
	return FIELD_META[className]?.[fieldName] ?? {};
}

function hex64(v: bigint): string {
	return '0x' + BigInt.asUintN(64, v).toString(16).toUpperCase().padStart(16, '0');
}

function hex8(bytes: number[]): string {
	return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

// bytes8 fields carry short ASCII names in practice (VehicleID="CARBRWDS",
// InGameName packed text, etc.). Decode up to the first null; fall back to
// hex if the payload isn't all printable ASCII.
function decodeBytes8(bytes: number[]): { ascii: string | null; hex: string } {
	const hex = hex8(bytes);
	const out: number[] = [];
	for (const b of bytes) {
		if (b === 0) break;
		out.push(b);
	}
	if (out.length === 0) return { ascii: '', hex };
	const printable = out.every((b) => b >= 0x20 && b < 0x7F);
	return { ascii: printable ? String.fromCharCode(...out) : null, hex };
}

function encodeBytes8(text: string): number[] {
	const out = new Array(8).fill(0);
	for (let i = 0; i < Math.min(text.length, 8); i++) {
		out[i] = text.charCodeAt(i) & 0xFF;
	}
	return out;
}

// Human-readable class name for a refspec's classKey. Falls back to hex when
// the class isn't in our schema registry.
function refspecClassName(classKey: bigint): string {
	const schema = getSchemaByClassHash(classKey);
	return schema?.name ?? hex64(classKey);
}

// ── Leaf editors ──────────────────────────────────────────────────────────

function F32Input({
	value,
	onChange,
	min,
	max,
}: {
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
}) {
	return (
		<Input
			type="number"
			step="any"
			min={min}
			max={max}
			className="h-8"
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const n = parseFloat(e.target.value);
				if (Number.isFinite(n)) onChange(n);
			}}
		/>
	);
}

function IntInput({
	value,
	onChange,
	min,
	max,
}: {
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
}) {
	return (
		<Input
			type="number"
			step="1"
			min={min}
			max={max}
			className="h-8"
			value={Number.isFinite(value) ? value : 0}
			onChange={(e) => {
				const n = parseInt(e.target.value, 10);
				if (Number.isFinite(n)) onChange(n);
			}}
		/>
	);
}

// Categorical dropdown — renders a native <select> styled to match the
// Input component. If the current value isn't one of the whitelisted retail
// values, it's prepended with an "(off-retail)" marker so edits preserve the
// user's existing override rather than silently clamping it.
function CategoricalSelect({
	value,
	values,
	onChange,
}: {
	value: number;
	values: number[];
	onChange: (v: number) => void;
}) {
	const hasCurrent = values.includes(value);
	const options = hasCurrent ? values : [value, ...values];
	return (
		<select
			className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
			value={value}
			onChange={(e) => {
				const n = Number(e.target.value);
				if (Number.isFinite(n)) onChange(n);
			}}
		>
			{options.map((v) => (
				<option key={v} value={v}>
					{!hasCurrent && v === value ? `${v} (off-retail)` : v}
				</option>
			))}
		</select>
	);
}

function Vec4Input({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
	return (
		<div className="grid grid-cols-4 gap-2">
			{[0, 1, 2, 3].map((i) => (
				<F32Input
					key={i}
					value={value[i] ?? 0}
					onChange={(n) => {
						const next = value.slice();
						next[i] = n;
						onChange(next);
					}}
				/>
			))}
		</div>
	);
}

function I32ArrayInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
	return (
		<div className="flex flex-wrap gap-1">
			{value.map((n, i) => (
				<Input
					key={i}
					type="number"
					step="1"
					className="h-7 w-20 text-xs"
					value={n}
					onChange={(e) => {
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

// ── Field renderer ────────────────────────────────────────────────────────

function FieldRow({
	attrIndex,
	fieldName,
	spec,
	value,
	update,
	meta,
}: {
	attrIndex: number;
	fieldName: string;
	spec: AttribSchema['fields'][number];
	value: unknown;
	update: UpdateField;
	meta: FieldMeta;
}) {
	const label = fieldName;
	const set = (v: unknown) => update(attrIndex, fieldName, v);

	switch (spec.type) {
		case 'pad':
		case 'align16':
			return null;

		case 'f32':
			return (
				<div className="space-y-1">
					<Label className="text-xs">
						{label}
						{meta.constant && <span className="ml-2 text-muted-foreground/60">(retail-constant)</span>}
					</Label>
					{meta.values
						? <CategoricalSelect value={value as number} values={meta.values} onChange={set} />
						: <F32Input value={value as number} onChange={set} min={meta.min} max={meta.max} />
					}
				</div>
			);

		case 'i32':
		case 'u16':
		case 'u8':
			return (
				<div className="space-y-1">
					<Label className="text-xs">
						{label}
						{meta.constant && <span className="ml-2 text-muted-foreground/60">(retail-constant)</span>}
					</Label>
					{meta.values
						? <CategoricalSelect value={value as number} values={meta.values} onChange={set} />
						: <IntInput value={value as number} onChange={set} min={meta.min} max={meta.max} />
					}
				</div>
			);

		case 'bool':
			return (
				<div className="flex items-center justify-between pr-2">
					<Label className="text-xs">{label}</Label>
					<Switch checked={!!value} onCheckedChange={set} />
				</div>
			);

		case 'vec4':
			return (
				<div className="space-y-1 col-span-full">
					<Label className="text-xs">{label}</Label>
					<Vec4Input value={value as number[]} onChange={set} />
				</div>
			);

		case 'u64':
		case 'i64':
			return (
				<div className="space-y-1">
					<Label className="text-xs">{label}</Label>
					<Input
						readOnly
						className="h-8 font-mono text-xs"
						value={hex64(value as bigint)}
					/>
				</div>
			);

		case 'bytes8': {
			const bytes = value as number[];
			const { ascii, hex } = decodeBytes8(bytes);
			if (ascii !== null) {
				return (
					<div className="space-y-1">
						<Label className="text-xs">{label} · ASCII</Label>
						<Input
							className="h-8 font-mono text-xs"
							value={ascii}
							maxLength={8}
							onChange={(e) => set(encodeBytes8(e.target.value))}
						/>
					</div>
				);
			}
			return (
				<div className="space-y-1">
					<Label className="text-xs">{label} · bytes</Label>
					<Input readOnly className="h-8 font-mono text-xs" value={hex} />
				</div>
			);
		}

		case 'refspec': {
			const rs = value as RefSpecValue;
			return (
				<div className="space-y-1">
					<Label className="text-xs">{label} · ref to {refspecClassName(rs.classKey)}</Label>
					<Input
						readOnly
						className="h-8 font-mono text-xs"
						value={`key=${hex64(rs.collectionKey)}`}
					/>
				</div>
			);
		}

		case 'refspec_array': {
			const arr = value as RefSpecValue[];
			return (
				<div className="space-y-1 col-span-full">
					<Label className="text-xs">{label} · {arr.length} refs</Label>
					<div className="text-[11px] text-muted-foreground font-mono">
						{arr.map((r, i) => (
							<div key={i}>
								[{i}] {refspecClassName(r.classKey)} · key={hex64(r.collectionKey)}
							</div>
						))}
					</div>
				</div>
			);
		}

		case 'i32_array':
			return (
				<div className="space-y-1 col-span-full">
					<Label className="text-xs">{label}</Label>
					<I32ArrayInput value={value as number[]} onChange={set} />
				</div>
			);
	}
}

// ── Main page ─────────────────────────────────────────────────────────────

const AttribSysVaultPage = () => {
	const { getResource, setResource } = useBundle();
	const data = getResource<ParsedAttribSys>('attribSysVault');
	const [showAdvanced, setShowAdvanced] = useState(false);

	const update = useCallback<UpdateField>(
		(attrIndex, fieldName, newValue) => {
			if (!data) return;
			const nextAttributes: ParsedAttribute[] = data.attributes.map((attr, i) => {
				if (i !== attrIndex) return attr;
				return { ...attr, fields: { ...attr.fields, [fieldName]: newValue } };
			});
			setResource('attribSysVault', { ...data, attributes: nextAttributes });
		},
		[data, setResource],
	);

	const defaultOpen = useMemo(() => {
		if (!data) return [];
		const present = new Set(data.attributes.map((a) => a.className));
		const preferred = DEFAULT_OPEN_CLASSES.filter((c) => present.has(c));
		// Fallback to the first two attributes if none of the preferred classes
		// are present (e.g. a non-vehicle vault).
		return preferred.length > 0
			? preferred
			: data.attributes.slice(0, 2).map((a) => a.className);
	}, [data]);

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>AttribSys Vault</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						Load a bundle containing an AttribSys vault (e.g. VEH_*_AT.BIN) to begin.
					</div>
				</CardContent>
			</Card>
		);
	}

	if (data.binRaw && data.attributes.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>AttribSys Vault</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-muted-foreground">
						This vault contains attribute classes that aren't in the schema registry yet.
						The raw bytes are preserved for round-trip but no typed editor is available.
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="h-full min-h-0 flex flex-col gap-3">
			<Card className="shrink-0">
				<CardHeader className="py-3 flex-row items-center justify-between space-y-0">
					<CardTitle className="text-base">AttribSys Vault</CardTitle>
					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						<Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
						Show advanced (retail-constant fields)
					</label>
				</CardHeader>
				<CardContent className="py-2 text-xs text-muted-foreground space-y-0.5">
					<div>
						<span className="font-mono">version=</span>{hex64(data.versionHash)}
					</div>
					<div>
						{data.collections.length} collections · {data.attributes.length} attributes · {data.strings.length} strings · {data.exports.length} exports
					</div>
					{data.strings.length > 0 && (
						<div className="font-mono text-[11px] truncate">
							strings=[{data.strings.join(', ')}]
						</div>
					)}
				</CardContent>
			</Card>

			<div className="flex-1 min-h-0 overflow-auto">
				<Accordion type="multiple" defaultValue={defaultOpen} className="space-y-2">
					{data.attributes.map((attr, attrIndex) => {
						const schema = getSchemaByClassHash(attr.classHash);
						return (
							<AccordionItem
								key={`${attr.className}-${attrIndex}`}
								value={attr.className}
								className="border rounded-md bg-card"
							>
								<AccordionTrigger className="px-3 py-2 hover:no-underline">
									<div className="flex flex-col items-start text-left">
										<span className="text-sm font-semibold">{classLabel(attr.className)}</span>
										<span className="text-[11px] text-muted-foreground font-mono">
											{attr.className}
										</span>
									</div>
								</AccordionTrigger>
								<AccordionContent className="px-3 pb-3">
									{schema ? (
										<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
											{schema.fields
												.filter((spec) => {
													const meta = getFieldMeta(attr.className, spec.name);
													return showAdvanced || !meta.constant;
												})
												.map((spec) => (
												<FieldRow
													key={spec.name}
													attrIndex={attrIndex}
													fieldName={spec.name}
													spec={spec}
													value={attr.fields[spec.name]}
													update={update}
													meta={getFieldMeta(attr.className, spec.name)}
												/>
											))}
										</div>
									) : (
										<div className="text-xs text-muted-foreground">
											No schema available for classHash {hex64(attr.classHash)} — field editing disabled.
										</div>
									)}
								</AccordionContent>
							</AccordionItem>
						);
					})}
				</Accordion>
			</div>
		</div>
	);
};

export default AttribSysVaultPage;
