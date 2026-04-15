// Vehicle List editor — schema-driven hierarchy + inspector.
//
// Replaces the old card-grid list + modal editor combo with the shared
// schema editor framework. Per-vehicle editing happens via the
// `VehicleEditorTab` extension registered in vehicleListExtensions, which
// wraps the legacy 5-tab form as a custom renderer.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { SchemaEditor } from '@/components/schema-editor/SchemaEditor';
import { SchemaEditorProvider } from '@/components/schema-editor/context';
import { vehicleListResourceSchema } from '@/lib/schema/resources/vehicleList';
import { vehicleListExtensions } from '@/components/schema-editor/extensions/vehicleListExtensions';
import type { ParsedVehicleList } from '@/lib/core/vehicleList';

const VehiclesPage = () => {
  const { getResource, setResource } = useBundle();
  const data = getResource<ParsedVehicleList>('vehicleList');

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vehicle List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Load a bundle containing a vehicle list (e.g. VEHICLELIST.BUNDLE) to begin.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full min-h-0">
      <SchemaEditorProvider
        resource={vehicleListResourceSchema}
        data={data}
        onChange={(next) => setResource('vehicleList', next as ParsedVehicleList)}
        extensions={vehicleListExtensions}
      >
        <SchemaEditor />
      </SchemaEditorProvider>
    </div>
  );
};

export default VehiclesPage;
