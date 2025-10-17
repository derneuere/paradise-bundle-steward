import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { ChallengeListEditor } from '@/components/challangelist';

const ChallengeListPage = () => {
  const { challengeList, setChallengeList } = useBundle();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Challenge List</CardTitle>
        </CardHeader>
        <CardContent>
          {challengeList ? (
            <ChallengeListEditor data={challengeList} onChange={setChallengeList} />
          ) : (
            <div className="text-sm text-muted-foreground">
              {challengeList === undefined ? 'Loading Challenge List...' : 'No Challenge List found in this bundle.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChallengeListPage;


