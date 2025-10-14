import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ParsedChallengeList, ChallengeListEntry } from '@/lib/core/challengeList';
import { ChallengeEntriesList } from './ChallengeEntriesList';
import { ChallengeOverview } from './ChallengeOverview';

type ChallengeListEditorProps = {
  data: ParsedChallengeList;
  onChange: (next: ParsedChallengeList) => void;
};

export const ChallengeListEditor: React.FC<ChallengeListEditorProps> = ({ data, onChange }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'challenges'>('overview');

  const stats = useMemo(() => {
    const difficultyCount = { easy: 0, medium: 0, hard: 0, veryHard: 0 };
    const playerCount = { two: 0, three: 0, four: 0, five: 0, six: 0, seven: 0, eight: 0, nine: 0, ten: 0, other: 0 };
    const entitlementCount = new Map<number, number>();

    data.challenges.forEach(challenge => {
      // Count difficulty
      switch (challenge.difficulty) {
        case 0: difficultyCount.easy++; break;
        case 1: difficultyCount.medium++; break;
        case 2: difficultyCount.hard++; break;
        case 3: difficultyCount.veryHard++; break;
      }

      // Count player requirements (hex encoded: 0x22 = 2 players, 0x33 = 3 players, etc.)
      const numPlayers = challenge.numPlayers;
      if (numPlayers === 0x22) playerCount.two++;
      else if (numPlayers === 0x33) playerCount.three++;
      else if (numPlayers === 0x44) playerCount.four++;
      else if (numPlayers === 0x55) playerCount.five++;
      else if (numPlayers === 0x66) playerCount.six++;
      else if (numPlayers === 0x77) playerCount.seven++;
      else if (numPlayers === 0x88) playerCount.eight++;
      else if (numPlayers === 0x99) playerCount.nine++;
      else playerCount.other++;

      // Count entitlements
      const count = entitlementCount.get(challenge.entitlementGroup) || 0;
      entitlementCount.set(challenge.entitlementGroup, count + 1);
    });

    return { difficultyCount, playerCount, entitlementCount };
  }, [data.challenges]);

  const addChallenge = () => {
    const newChallenge: ChallengeListEntry = {
      actions: [
        {
          actionType: 0,
          coopType: 0,
          modifier: 0,
          combineActionType: 0,
          numLocations: 0,
          locationType: [0, 0, 0, 0],
          padding1: [0, 0, 0, 0, 0, 0, 0],
          locationData: [
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
          ],
          numTargets: 0,
          padding2: [0, 0, 0],
          targetValue: [0, 0],
          targetDataType: [0, 0],
          padding3: [0, 0],
          timeLimit: 0,
          convoyTime: 0,
          propType: 0,
          padding4: [0, 0, 0, 0],
        },
        {
          actionType: 0,
          coopType: 0,
          modifier: 0,
          combineActionType: 0,
          numLocations: 0,
          locationType: [0, 0, 0, 0],
          padding1: [0, 0, 0, 0, 0, 0, 0],
          locationData: [
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
            { district: 0, county: 0, triggerID: 0n, roadID: 0n },
          ],
          numTargets: 0,
          padding2: [0, 0, 0],
          targetValue: [0, 0],
          targetDataType: [0, 0],
          padding3: [0, 0],
          timeLimit: 0,
          convoyTime: 0,
          propType: 0,
          padding4: [0, 0, 0, 0],
        },
      ],
      descriptionStringID: '',
      titleStringID: '',
      challengeID: 0n,
      carID: 0n,
      carType: 0,
      carColourIndex: 0,
      carColourPaletteIndex: 0,
      numPlayers: 0x22, // Hex encoded: 0x22 = 2 players
      numActions: 1,
      difficulty: 0,
      entitlementGroup: 0,
      padding: 0,
    };

    onChange({
      ...data,
      challenges: [...data.challenges, newChallenge],
      numChallenges: data.challenges.length + 1,
    });
  };

  const deleteChallenge = (index: number) => {
    const newChallenges = data.challenges.filter((_, i) => i !== index);
    onChange({
      ...data,
      challenges: newChallenges,
      numChallenges: newChallenges.length,
    });
  };

  const updateChallenge = (index: number, updated: ChallengeListEntry) => {
    const newChallenges = data.challenges.map((c, i) => (i === index ? updated : c));
    onChange({
      ...data,
      challenges: newChallenges,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Challenge List Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4 text-sm">
          <div>
            Total Challenges: <b>{data.numChallenges}</b>
          </div>
          <div>
            Easy: <b>{stats.difficultyCount.easy}</b>
          </div>
          <div>
            Medium: <b>{stats.difficultyCount.medium}</b>
          </div>
          <div>
            Hard: <b>{stats.difficultyCount.hard}</b>
          </div>
          <div>
            Very Hard: <b>{stats.difficultyCount.veryHard}</b>
          </div>
          <div>
            2-Player: <b>{stats.playerCount.two}</b>
          </div>
          <div>
            3-Player: <b>{stats.playerCount.three}</b>
          </div>
          <div>
            4-Player: <b>{stats.playerCount.four}</b>
          </div>
          <div>
            5-Player: <b>{stats.playerCount.five}</b>
          </div>
          <div>
            6-Player: <b>{stats.playerCount.six}</b>
          </div>
          <div>
            7-Player: <b>{stats.playerCount.seven}</b>
          </div>
          <div>
            8-Player: <b>{stats.playerCount.eight}</b>
          </div>
          <div>
            9-Player: <b>{stats.playerCount.nine}</b>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
        <TabsList className="grid grid-cols-2 w-full gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="challenges">Challenges</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Challenge Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <ChallengeOverview data={data} stats={stats} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="challenges">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Challenges ({data.challenges.length})</CardTitle>
              <Button size="sm" onClick={addChallenge}>
                Add Challenge
              </Button>
            </CardHeader>
            <CardContent>
              <ChallengeEntriesList
                challenges={data.challenges}
                onUpdate={updateChallenge}
                onDelete={deleteChallenge}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ChallengeListEditor;

