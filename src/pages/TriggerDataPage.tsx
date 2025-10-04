
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { TriggerDataEditor } from '@/components/TriggerDataEditor';

const TriggerDataPage = () => {
  const { triggerData, setTriggerData } = useBundle();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Trigger Data</CardTitle>
        </CardHeader>
        <CardContent>
          {triggerData ? (
            <TriggerDataEditor data={triggerData} onChange={setTriggerData} />
          ) : (
            <div className="text-sm text-muted-foreground">{triggerData ? 'Loading Trigger Data...' : 'Load a bundle to begin.'}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TriggerDataPage;


