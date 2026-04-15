// ICE Take Dictionary editor — schema-driven hierarchy + inspector.
//
// The old tab-based editor was replaced by the generic schema editor. The
// handler is read-only, so the CapabilityWarning is still rendered above
// the editor to remind users that edits won't round-trip to disk.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { CapabilityWarning } from '@/components/capabilities';
import { iceTakeDictionaryResourceSchema } from '@/lib/schema/resources/iceTakeDictionary';
import type { ParsedIceTakeDictionary } from '@/lib/core/iceTakeDictionary';

const IcePage = () => {
  const { getResource, setResource } = useBundle();
  const data = getResource<ParsedIceTakeDictionary>('iceTakeDictionary');

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ICE Take Dictionary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Load a bundle containing an ICE Take Dictionary to begin.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <CapabilityWarning featureId="icetake-dictionary" />
      <div className="flex-1 min-h-0">
        <SchemaEditorProvider
          resource={iceTakeDictionaryResourceSchema}
          data={data}
          onChange={(next) => setResource('iceTakeDictionary', next as ParsedIceTakeDictionary)}
        >
          <SchemaEditor />
        </SchemaEditorProvider>
      </div>
    </div>
  );
};

export default IcePage;
