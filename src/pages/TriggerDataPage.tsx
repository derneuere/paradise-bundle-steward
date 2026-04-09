
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { TriggerDataEditor } from '@/components/triggerdata/TriggerDataEditor';
import type { ParsedTriggerData } from '@/lib/core/triggerData';

const TriggerDataPage = () => {
  const { getResource, setResource } = useBundle();
  const triggerData = getResource<ParsedTriggerData>('triggerData');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Trigger Data</CardTitle>
        </CardHeader>
        <CardContent>
          {triggerData ? (
            <TriggerDataEditor data={triggerData} onChange={(next) => setResource('triggerData', next)} />
          ) : (
            <div className="text-sm text-muted-foreground">Load a bundle to begin.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TriggerDataPage;
