import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBundle } from '@/context/BundleContext';
import { ChallengeListEditor } from '@/components/challangelist';
import type { ParsedChallengeList } from '@/lib/core/challengeList';

const ChallengeListPage = () => {
  const { getResource, setResource } = useBundle();
  const challengeList = getResource<ParsedChallengeList>('challengeList');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Challenge List</CardTitle>
        </CardHeader>
        <CardContent>
          {challengeList ? (
            <ChallengeListEditor data={challengeList} onChange={(next) => setResource('challengeList', next)} />
          ) : (
            <div className="text-sm text-muted-foreground">
              No Challenge List found in this bundle.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChallengeListPage;


