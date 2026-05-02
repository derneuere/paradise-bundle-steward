// Back-compat re-export — the AI Sections schema now lives in a per-version
// subfolder (`./aiSections/`) so V4, V6, and V12 each have their own file.
// Existing imports of `aiSectionsResourceSchema` continue to land on V12
// because that's still the only variant the workspace's main editor surface
// targets; V4 has its own export and is wired in through the editor
// registry's V4 EditorProfile (see `src/lib/editor/profiles/aiSections.ts`).
//
// Adding a new version: drop a new file in `./aiSections/`, register its
// EditorProfile alongside the existing ones, and (if it should become the
// new "default" for legacy callers) update the re-export below. This file
// itself stays trivially small — it only exists to preserve the import
// path that pre-#33 callers expect.

export { aiSectionsV12ResourceSchema as aiSectionsResourceSchema } from './aiSections/v12';
export { aiSectionsV12ResourceSchema } from './aiSections/v12';
export { aiSectionsV4ResourceSchema } from './aiSections/v4';
