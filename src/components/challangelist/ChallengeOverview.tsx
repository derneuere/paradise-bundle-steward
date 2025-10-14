import React from 'react';
import type { ParsedChallengeList } from '@/lib/core/challengeList';
import {
  EntitlementGroup,
  ChallengeDifficulty,
} from '@/lib/core/challengeList';

type ChallengeOverviewProps = {
  data: ParsedChallengeList;
  stats: {
    difficultyCount: { easy: number; medium: number; hard: number; veryHard: number };
    playerCount: { two: number; three: number; four: number; five: number; six: number; seven: number; eight: number; nine: number; other: number };
    entitlementCount: Map<number, number>;
  };
};

const entitlementNames: Record<number, string> = {
  [EntitlementGroup.RELEASE]: 'Release',
  [EntitlementGroup.UNKNOWN_DLC]: 'Unknown DLC',
  [EntitlementGroup.UNKNOWN_DLC_2]: 'Unknown DLC 2',
  [EntitlementGroup.CAGNEY]: 'Cagney',
  [EntitlementGroup.DAVIS]: 'Davis',
  [EntitlementGroup.ISLAND]: 'Island',
};

const difficultyNames: Record<number, string> = {
  [ChallengeDifficulty.EASY]: 'Easy',
  [ChallengeDifficulty.MEDIUM]: 'Medium',
  [ChallengeDifficulty.HARD]: 'Hard',
  [ChallengeDifficulty.VERY_HARD]: 'Very Hard',
};

export const ChallengeOverview: React.FC<ChallengeOverviewProps> = ({ data, stats }) => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3">Difficulty Distribution</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">Easy</div>
            <div className="text-2xl font-bold">{stats.difficultyCount.easy}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">Medium</div>
            <div className="text-2xl font-bold">{stats.difficultyCount.medium}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">Hard</div>
            <div className="text-2xl font-bold">{stats.difficultyCount.hard}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">Very Hard</div>
            <div className="text-2xl font-bold">{stats.difficultyCount.veryHard}</div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Player Requirements</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">2-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.two}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">3-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.three}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">4-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.four}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">5-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.five}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">6-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.six}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">7-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.seven}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">8-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.eight}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">9-Player</div>
            <div className="text-2xl font-bold">{stats.playerCount.nine}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">Other</div>
            <div className="text-2xl font-bold">{stats.playerCount.other}</div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Entitlement Groups</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from(stats.entitlementCount.entries()).map(([group, count]) => (
            <div key={group} className="border rounded p-3">
              <div className="text-sm text-muted-foreground">
                {entitlementNames[group] || `Group ${group}`}
              </div>
              <div className="text-2xl font-bold">{count}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Summary</h3>
        <div className="text-sm space-y-2 text-muted-foreground">
          <p>Total Challenges: <span className="font-semibold text-foreground">{data.numChallenges}</span></p>
          <p>Byte Padding: <span className="font-mono text-foreground">{data.bytePad.toString()}</span></p>
        </div>
      </div>
    </div>
  );
};
