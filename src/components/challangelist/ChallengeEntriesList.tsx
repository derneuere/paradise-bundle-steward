import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ChallengeListEntry } from '@/lib/core/challengeList';
import {
  ChallengeDifficulty,
  EntitlementGroup,
  ChallengeActionType,
} from '@/lib/core/challengeList';
import { ChallengeEntryEditor } from './ChallengeEntryEditor';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type ChallengeEntriesListProps = {
  challenges: ChallengeListEntry[];
  onUpdate: (index: number, updated: ChallengeListEntry) => void;
  onDelete: (index: number) => void;
};

const difficultyNames: Record<number, string> = {
  [ChallengeDifficulty.EASY]: 'Easy',
  [ChallengeDifficulty.MEDIUM]: 'Medium',
  [ChallengeDifficulty.HARD]: 'Hard',
  [ChallengeDifficulty.VERY_HARD]: 'Very Hard',
};

const difficultyColors: Record<number, string> = {
  [ChallengeDifficulty.EASY]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  [ChallengeDifficulty.MEDIUM]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  [ChallengeDifficulty.HARD]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  [ChallengeDifficulty.VERY_HARD]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const entitlementNames: Record<number, string> = {
  [EntitlementGroup.RELEASE]: 'Release',
  [EntitlementGroup.UNKNOWN_DLC]: 'DLC 1',
  [EntitlementGroup.UNKNOWN_DLC_2]: 'DLC 2',
  [EntitlementGroup.CAGNEY]: 'Cagney',
  [EntitlementGroup.DAVIS]: 'Davis',
  [EntitlementGroup.ISLAND]: 'Island',
};

const actionTypeNames: Record<number, string> = {
  [ChallengeActionType.MINIMUM_SPEED]: 'Min Speed',
  [ChallengeActionType.IN_AIR]: 'In Air',
  [ChallengeActionType.AIR_DISTANCE]: 'Air Distance',
  [ChallengeActionType.LEAP_CARS]: 'Leap Cars',
  [ChallengeActionType.DRIFT]: 'Drift',
  [ChallengeActionType.NEAR_MISS]: 'Near Miss',
  [ChallengeActionType.BARREL_ROLLS]: 'Barrel Rolls',
  [ChallengeActionType.ONCOMING]: 'Oncoming',
  [ChallengeActionType.FLATSPIN]: 'Flat Spin',
  [ChallengeActionType.LAND_SUCCESSFUL]: 'Land',
  [ChallengeActionType.ROAD_RULE_TIME]: 'Road Rule Time',
  [ChallengeActionType.ROAD_RULE_CRASH]: 'Road Rule Crash',
  [ChallengeActionType.BURNOUTS]: 'Burnouts',
  [ChallengeActionType.MEET_UP]: 'Meet Up',
  [ChallengeActionType.BILLBOARD]: 'Billboard',
  [ChallengeActionType.BOOST_TIME]: 'Boost Time',
  [ChallengeActionType.STUNT_SCORE]: 'Stunt Score',
  [ChallengeActionType.TAKEDOWNS]: 'Takedowns',
  [ChallengeActionType.DISTANCE_TRAVELED]: 'Distance',
};

export const ChallengeEntriesList: React.FC<ChallengeEntriesListProps> = ({
  challenges,
  onUpdate,
  onDelete,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [expandedIndices, setExpandedIndices] = React.useState<Set<number>>(new Set());

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedIndices);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedIndices(newExpanded);
  };

  if (challenges.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4 text-center">
        No challenges defined. Click "Add Challenge" to create one.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="space-y-2 max-h-[70vh] overflow-auto pr-2">
      {challenges.map((challenge, index) => {
        const isExpanded = expandedIndices.has(index);
        const primaryAction = challenge.actions[0];
        // numPlayers is hex encoded: 0x22 = 2 players, 0x33 = 3 players, etc.
        const playerCount = challenge.numPlayers === 0x22 ? '2P' : 
                            challenge.numPlayers === 0x33 ? '3P' : 
                            challenge.numPlayers === 0x44 ? '4P' : 
                            challenge.numPlayers === 0x55 ? '5P' : 
                            challenge.numPlayers === 0x66 ? '6P' : 
                            challenge.numPlayers === 0x77 ? '7P' : 
                            challenge.numPlayers === 0x88 ? '8P' : 
                            challenge.numPlayers === 0x99 ? '9P' : 
                            `0x${challenge.numPlayers.toString(16).toUpperCase()}`;

        return (
          <Collapsible key={index} open={isExpanded} onOpenChange={() => toggleExpanded(index)}>
            <div className="border rounded-lg bg-card">
              <CollapsibleTrigger asChild>
                <div className="p-4 cursor-pointer hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-mono text-muted-foreground">#{index}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {challenge.titleStringID || 'Untitled Challenge'}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {challenge.descriptionStringID || 'No description'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {playerCount}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {actionTypeNames[primaryAction.actionType] || `Type ${primaryAction.actionType}`}
                      </Badge>
                      <Badge className={`text-xs ${difficultyColors[challenge.difficulty] || ''}`}>
                        {difficultyNames[challenge.difficulty] || challenge.difficulty}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {entitlementNames[challenge.entitlementGroup] || `E${challenge.entitlementGroup}`}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete challenge #${index}?`)) {
                            onDelete(index);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t p-4">
                  <ChallengeEntryEditor
                    challenge={challenge}
                    onChange={(updated) => onUpdate(index, updated)}
                  />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
};

