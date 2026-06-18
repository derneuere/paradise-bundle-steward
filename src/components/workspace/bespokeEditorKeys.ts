// Which resource keys are edited by a hand-written (schema-less) editor in
// the Workspace rather than the generic schema-driven inspector.
//
// Pure (no React / component imports) so render sites can ask "does this key
// have a bespoke editor?" without dragging the editor component graph into
// their import chain, and so the predicate is trivially unit-testable. The
// component dispatch (key → editor component) lives in BespokeResourceEditor.

export const BESPOKE_EDITOR_KEYS = ['deformationSpec', 'attribSysVault'] as const;

export type BespokeEditorKey = (typeof BESPOKE_EDITOR_KEYS)[number];

/** True when `resourceKey` is edited by a hand-written editor rather than the
 *  generic schema-driven inspector. */
export function hasBespokeEditor(resourceKey: string | undefined): boolean {
	return resourceKey != null && (BESPOKE_EDITOR_KEYS as readonly string[]).includes(resourceKey);
}
