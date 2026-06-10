// Hand-written schema for ParsedGuiPopup (resource type 0x1F).
//
// Mirrors the types in `src/lib/core/guiPopup.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker reports it as drift.
//
// Domain: the game-wide popup catalogue (one resource, GUI/POPUPS.PUP). Game
// code summons a popup by its CgsID (mNameId); the style picks the frame and
// button bar; all visible text comes from the Language resource via char[32]
// string KEYS, so editing macMessageId retargets the popup at a different
// localised string rather than changing text directly.
//
// Two derived fields are kept in sync by the record's derive hook rather
// than being hand-edited: mNameId (always encodeCgsId(macName.toUpperCase())
// in retail — all 111 popups verified) and miMessageParamsUsed (the count of
// leading non-Unused entries in maeMessageParams). Both are readOnly in the
// inspector; edit macName / maeMessageParams instead.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
	ValidationResult,
} from '../types';
import {
	POPUP_STYLES,
	POPUP_ICONS,
	POPUP_PARAM_TYPES,
	popupStyleLabel,
	countMessageParamsUsed,
	type GuiPopup as GuiPopupModel,
} from '@/lib/core/guiPopup';
import { encodeCgsId } from '@/lib/core/cgsid';

// ---------------------------------------------------------------------------
// Local helpers (mirroring propPhysics.ts)
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const str = (): FieldSchema => ({ kind: 'string' });
const boolField = (): FieldSchema => ({ kind: 'bool' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const bigintId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

const styleEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u32',
	values: POPUP_STYLES.map((s) => ({ value: s.value, label: s.label, description: s.description })),
});
const iconEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u32',
	values: POPUP_ICONS.map((s) => ({ value: s.value, label: s.label, description: s.description })),
});
const paramTypeEnum = (): FieldSchema => ({
	kind: 'enum',
	storage: 'u32',
	values: POPUP_PARAM_TYPES.map((s) => ({ value: s.value, label: s.label, description: s.description })),
});

// ---------------------------------------------------------------------------
// Tree-label helper
// ---------------------------------------------------------------------------

function popupLabel(p: unknown, index: number): string {
	try {
		if (!p || typeof p !== 'object') return `#${index}`;
		const e = p as { macName?: string; meStyle?: number; meIcon?: number };
		const bits = [`#${index} · ${e.macName || '(unnamed)'}`];
		if (e.meStyle != null) bits.push(popupStyleLabel(e.meStyle));
		if (e.meIcon === 1) bits.push('⚠');
		return bits.join(' · ');
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

// Charset CgsID encoding can represent — anything else round-trips through
// encode/decode as a different character, so the name field warns on it.
const CGS_SAFE = /^[A-Za-z0-9 /_-]*$/;

function validatePopup(value: Record<string, unknown>): ValidationResult[] {
	const out: ValidationResult[] = [];
	const p = value as Partial<GuiPopupModel>;
	if (typeof p.macName === 'string') {
		if (p.macName.length > 12) {
			out.push({ severity: 'error', field: 'macName', message: `Name is ${p.macName.length} chars; char[13] fits at most 12.` });
		}
		if (!CGS_SAFE.test(p.macName)) {
			out.push({ severity: 'warning', field: 'macName', message: 'Name has characters outside the CgsID charset (A–Z, 0–9, space, -, /, _); the derived name ID will not round-trip them.' });
		}
	}
	for (const field of ['macTitleId', 'macMessageId', 'macButton1Id', 'macButton2Id'] as const) {
		const v = p[field];
		if (typeof v === 'string' && v.length > 31) {
			out.push({ severity: 'error', field, message: `Key is ${v.length} chars; char[32] fits at most 31.` });
		}
	}
	return out;
}

const GuiPopup: RecordSchema = {
	name: 'GuiPopup',
	description: 'One popup card. Game code summons it by name ID; the style picks the frame and button bar ("wait" styles have no buttons and are dismissed by code). All text fields are KEYS into the Language resource — empty key = no title / no button.',
	fields: {
		macName: str(),
		mNameId: bigintId(),
		meStyle: styleEnum(),
		meIcon: iconEnum(),
		macTitleId: str(),
		macMessageId: str(),
		maeMessageParams: fixedList(paramTypeEnum(), 2),
		miMessageParamsUsed: i32(),
		macButton1Id: str(),
		meButton1Param: paramTypeEnum(),
		mbButton1ParamUsed: boolField(),
		macButton2Id: str(),
		meButton2Param: paramTypeEnum(),
		mbButton2ParamUsed: boolField(),
		_pad15: fixedList(u8(), 3),
		_padB1: fixedList(u8(), 3),
		_padB9: fixedList(u8(), 7),
	},
	fieldMetadata: {
		macName: {
			label: 'Name',
			description: 'Debug name, max 12 chars. Renaming re-derives the name ID, which is what game code uses to summon the popup — a renamed popup stops appearing unless the calling code knows the new name.',
		},
		mNameId: {
			label: 'Name ID (CgsID)',
			description: 'Base-40 packed macName.toUpperCase() — every retail popup follows that derivation, and the editor keeps it in sync when the name changes.',
			readOnly: true,
			derivedFrom: 'macName',
		},
		meStyle: {
			label: 'Style',
			description: 'Popup frame, placement, and button bar. CrashNav styles render in the front-end nav, In-game styles over gameplay; splash is the full-screen online mode card. Styles 14/15 are the v1.9+ Big Surf Island variants.',
		},
		meIcon: { label: 'Icon', description: 'Warning shows the hazard icon next to the message; Invisible shows none.' },
		macTitleId: { label: 'Title key', description: 'Language string key for the heading. Empty = untitled card.' },
		macMessageId: {
			label: 'Message key',
			description: 'Language string key for the body text. Some retail keys carry a \'~\' prefix (meaning unconfirmed) — keep it when retargeting.',
		},
		maeMessageParams: {
			label: 'Message params',
			description: 'How runtime fills the message string\'s two substitution slots: a raw string (e.g. a player name) or another Language string. Used slots must be leading — slot 2 can\'t be set while slot 1 is Unused.',
		},
		miMessageParamsUsed: {
			label: 'Params used',
			description: 'Count of leading non-Unused message params; re-derived automatically when the params change.',
			readOnly: true,
			derivedFrom: 'maeMessageParams',
		},
		macButton1Id: { label: 'Button 1 key', description: 'Language string key for the first button caption. Empty = no buttons ("wait" styles).' },
		meButton1Param: { label: 'Button 1 param', description: 'Substitution slot for the button caption — Unused on every retail popup.' },
		mbButton1ParamUsed: { label: 'Button 1 param used', description: 'False on every retail popup.' },
		macButton2Id: { label: 'Button 2 key', description: 'Language string key for the second button caption (the Cancel/No slot). Empty = single-button popup.' },
		meButton2Param: { label: 'Button 2 param', description: 'Substitution slot for the button caption — Unused on every retail popup.' },
		mbButton2ParamUsed: { label: 'Button 2 param used', description: 'False on every retail popup.' },
		_pad15: { label: 'pad +0x15', description: 'Record pad (zero in retail); preserved verbatim.', hidden: true },
		_padB1: { label: 'pad +0xB1', description: 'Record pad — uninitialised build-machine garbage, identical in every retail record; preserved verbatim.', hidden: true },
		_padB9: { label: 'pad +0xB9', description: 'Record pad — uninitialised build-machine garbage, identical in every retail record; preserved verbatim.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['macName', 'mNameId', 'meStyle', 'meIcon'] },
		{ title: 'Text', properties: ['macTitleId', 'macMessageId', 'maeMessageParams', 'miMessageParamsUsed'] },
		{ title: 'Buttons', properties: ['macButton1Id', 'meButton1Param', 'mbButton1ParamUsed', 'macButton2Id', 'meButton2Param', 'mbButton2ParamUsed'] },
	],
	label: (value, index) => popupLabel(value, index ?? 0),
	validate: (value) => validatePopup(value),
	derive: (prev, next) => {
		const patch: Record<string, unknown> = {};
		const name = next.macName;
		// Length-guard: encodeCgsId throws past 12 chars; validation already
		// flags that as an error, so derive just skips until the name fits.
		if (name !== prev.macName && typeof name === 'string' && name.length <= 12) {
			patch.mNameId = encodeCgsId(name.toUpperCase());
		}
		const params = next.maeMessageParams;
		if (Array.isArray(params) && params.length === 2) {
			const used = countMessageParamsUsed(params as [number, number]);
			if (used !== next.miMessageParamsUsed) patch.miMessageParamsUsed = used;
		}
		return patch;
	},
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

function makeEmptyPopup(): GuiPopupModel {
	return {
		mNameId: encodeCgsId('NEWPOPUP'),
		macName: 'NewPopup',
		meStyle: 7, // In-game — OK: the most common retail style
		meIcon: 0,
		macTitleId: '',
		macMessageId: 'PLACEHOLDER_TEMP_STRING',
		maeMessageParams: [0, 0],
		miMessageParamsUsed: 0,
		macButton1Id: 'GENERAL_OPTION_OK',
		meButton1Param: 0,
		mbButton1ParamUsed: false,
		macButton2Id: '',
		meButton2Param: 0,
		mbButton2ParamUsed: false,
		_pad15: [0, 0, 0],
		_padB1: [0, 0, 0],
		_padB9: [0, 0, 0, 0, 0, 0, 0],
	};
}

const ParsedGuiPopup: RecordSchema = {
	name: 'ParsedGuiPopup',
	description: 'Root record for the GuiPopup resource (0x1F) — the game-wide popup catalogue (111 popups in retail POPUPS.PUP). The writer recomputes the whole layout from the list, so popups can be added or removed freely; the i16 size field caps the resource at ~165 popups.',
	fields: {
		popups: {
			kind: 'list',
			item: record('GuiPopup'),
			addable: true,
			removable: true,
			makeEmpty: () => makeEmptyPopup(),
			itemLabel: (item, index) => popupLabel(item, index),
		},
	},
	fieldMetadata: {
		popups: {
			label: 'Popups',
			description: 'Every popup card, in disk order. Code looks them up by name ID, not index, so order is cosmetic.',
		},
	},
	propertyGroups: [
		{ title: 'Catalogue', properties: ['popups'] },
	],
};

const registry: SchemaRegistry = {
	ParsedGuiPopup,
	GuiPopup,
};

export const guiPopupResourceSchema: ResourceSchema = {
	key: 'guiPopup',
	name: 'GUI Popup',
	rootType: 'ParsedGuiPopup',
	registry,
};
