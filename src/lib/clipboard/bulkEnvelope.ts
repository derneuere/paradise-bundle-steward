// JSON envelope for cross-bundle bulk transfers.
//
// The envelope is the on-the-wire shape that flows through the OS clipboard
// or a downloaded `.json` file. It carries enough metadata for the import
// side to:
//   - reject foreign payloads (`kind === 'steward.bulk'` discriminator);
//   - refuse incompatible future versions (`version` is a literal `1`);
//   - dispatch to the right resource pipeline (`resourceKey` like
//     'aiSections' / 'pslSoups' / etc.);
//   - migrate when source and destination profiles disagree (`profile` like
//     'v12' / 'v4' / 'v6').
//
// The envelope is intentionally resource-agnostic: the `items` array is a
// generic `TItem[]` and the AI-Sections-specific item shape (with
// `sourceIndex`) lives one level up in `aiSectionsBulkExport.ts`. New
// resources (PSL, traffic data, etc.) reuse this module unchanged.

/** On-the-wire shape — the entire payload that hits the clipboard / file. */
export type BulkEnvelope<TItem = unknown> = {
	kind: 'steward.bulk';
	version: 1;
	resourceKey: string;
	profile: string;
	exportedAt: string;
	sourceBundle?: string;
	items: TItem[];
};

// Discriminated union — both branches carry distinct fields so narrowing
// works under `strict: false` (the project's tsconfig flips it off; see
// CLAUDE.md / type-debt entry). Callers use the `ok` field to switch.
type ParsedBulkEnvelopeOk<TItem = unknown> = {
	ok: true;
	envelope: BulkEnvelope<TItem>;
	reason?: undefined;
};
type ParsedBulkEnvelopeErr = {
	ok: false;
	reason: string;
	envelope?: undefined;
};
export type ParsedBulkEnvelope<TItem = unknown> =
	| ParsedBulkEnvelopeOk<TItem>
	| ParsedBulkEnvelopeErr;

const KIND = 'steward.bulk';
const VERSION = 1;

/**
 * Build an envelope from the export pipeline's outputs and serialize to a
 * pretty-printed JSON string. The pretty-printing matters because the most
 * common debugging path is "paste the clipboard into a scratch buffer and
 * eyeball the items" — minified JSON wrecks that workflow.
 */
export function encodeBulkEnvelope<TItem>(opts: {
	resourceKey: string;
	profile: string;
	items: TItem[];
	sourceBundle?: string;
}): string {
	const envelope: BulkEnvelope<TItem> = {
		kind: KIND,
		version: VERSION,
		resourceKey: opts.resourceKey,
		profile: opts.profile,
		exportedAt: new Date().toISOString(),
		items: opts.items,
		// `sourceBundle` is optional — the dialog still works without it,
		// the user just won't see "from BUNDLE.BNDL" in the preview.
		...(opts.sourceBundle != null ? { sourceBundle: opts.sourceBundle } : {}),
	};
	return JSON.stringify(envelope, null, 2);
}

/**
 * Validate a candidate envelope string. Every failure returns
 * `{ ok: false, reason }` with a message the dialog can surface verbatim
 * to the user. Throwing was rejected because the dialog already needs to
 * branch on success/failure to render its preview state.
 */
export function decodeBulkEnvelope(raw: string): ParsedBulkEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		return {
			ok: false,
			reason: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (!parsed || typeof parsed !== 'object') {
		return { ok: false, reason: 'Envelope must be a JSON object.' };
	}
	const obj = parsed as Record<string, unknown>;
	if (obj.kind !== KIND) {
		return {
			ok: false,
			reason: `Not a Steward bulk payload (kind = ${JSON.stringify(obj.kind)}, expected ${JSON.stringify(KIND)}).`,
		};
	}
	if (obj.version !== VERSION) {
		return {
			ok: false,
			reason: `Unsupported envelope version ${String(obj.version)} (expected ${VERSION}).`,
		};
	}
	if (typeof obj.resourceKey !== 'string' || obj.resourceKey.length === 0) {
		return { ok: false, reason: 'Missing or invalid `resourceKey` (must be non-empty string).' };
	}
	if (typeof obj.profile !== 'string' || obj.profile.length === 0) {
		return { ok: false, reason: 'Missing or invalid `profile` (must be non-empty string).' };
	}
	if (typeof obj.exportedAt !== 'string') {
		return { ok: false, reason: 'Missing or invalid `exportedAt` (must be ISO 8601 string).' };
	}
	if (!Array.isArray(obj.items)) {
		return { ok: false, reason: 'Missing or invalid `items` (must be array).' };
	}
	if (obj.sourceBundle != null && typeof obj.sourceBundle !== 'string') {
		return { ok: false, reason: '`sourceBundle` must be a string when present.' };
	}
	// All validation passed — the items array is opaque at this layer; the
	// caller's resource-specific decoder is responsible for typing it.
	return {
		ok: true,
		envelope: {
			kind: KIND,
			version: VERSION,
			resourceKey: obj.resourceKey,
			profile: obj.profile,
			exportedAt: obj.exportedAt,
			items: obj.items as unknown[],
			...(typeof obj.sourceBundle === 'string' ? { sourceBundle: obj.sourceBundle } : {}),
		},
	};
}
