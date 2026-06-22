# Profile/Burnout Paradise/Live Revenge Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Live_Revenge_Profile (mirrored 2026-06-22)

The Live Revenge profile tracks online relationships with with other players, storing statistics such as takedown counts and event wins. These are displayed during online event intros.

## Structures

### BrnNetwork::LiveRevengeProfile

#### PlayStation 3, Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 6 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x7538 | Array<LiveRevengeRelationship, 250u> | maRelationshipTable |  |  |

#### PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 7 |
| 0x4 | 0x6D64 | Array<LiveRevengeRelationship, 250u> | maRelationshipTable |  | Array not padded after length |

#### PlayStation 4

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 6 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x7D08 | Array<LiveRevengeRelationship, 250u> | maRelationshipTable |  |  |

#### Xbox One, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 7 |
| 0x4 | 0x7534 | Array<LiveRevengeRelationship, 250u> | maRelationshipTable |  | Array not padded after length |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 6 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x84D8 | Array<LiveRevengeRelationship, 250u> | maRelationshipTable |  |  |

### BrnNetwork::LiveRevengeRelationship

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x48 | CommonRelationship | mOverallStats |  |  |
| 0x48 | 0x10 | DateAndTime | mLastTimeChanged |  |  |
| 0x58 | 0x14 | UniquePlayerID | mUniqueID |  |  |
| 0x6C | 0x4 | int32_t | miCurrentScoreForPlayersPointOfView |  |  |
| 0x70 | 0x4 | uint32_t | miTotalEvents |  |  |
| 0x74 | 0x4 |  |  | Padding |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x48 | CommonRelationship | mOverallStats |  |  |
| 0x48 | 0xC | DateAndTime | mLastTimeChanged |  |  |
| 0x54 | 0x4 |  |  | Padding |  |
| 0x58 | 0x18 | UniquePlayerID | mUniqueID |  |  |
| 0x70 | 0x4 | int32_t | miCurrentScoreForPlayersPointOfView |  |  |
| 0x74 | 0x4 | uint32_t | miTotalEvents |  |  |

#### PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x48 | CommonRelationship | mOverallStats |  |  |
| 0x48 | 0xC | DateAndTime | mLastTimeChanged |  |  |
| 0x54 | 0x14 | UniquePlayerID | mUniqueID |  |  |
| 0x68 | 0x4 | int32_t | miCurrentScoreForPlayersPointOfView |  |  |
| 0x6C | 0x4 | uint32_t | miTotalEvents |  |  |

#### PlayStation 4

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x48 | CommonRelationship | mOverallStats |  |  |
| 0x48 | 0x10 | DateAndTime | mLastTimeChanged |  |  |
| 0x58 | 0x19 | UniquePlayerID | mUniqueID |  |  |
| 0x71 | 0x3 |  |  | Padding |  |
| 0x74 | 0x4 | int32_t | miCurrentScoreForPlayersPointOfView |  |  |
| 0x78 | 0x4 | uint32_t | miTotalEvents |  |  |
| 0x7C | 0x4 |  |  | Padding |  |

#### Xbox One, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x48 | CommonRelationship | mOverallStats |  |  |
| 0x48 | 0xC | DateAndTime | mLastTimeChanged |  |  |
| 0x54 | 0x19 | UniquePlayerID | mUniqueID |  |  |
| 0x6D | 0x3 |  |  | Padding |  |
| 0x70 | 0x4 | int32_t | miCurrentScoreForPlayersPointOfView |  |  |
| 0x74 | 0x4 | uint32_t | miTotalEvents |  |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x48 | CommonRelationship | mOverallStats |  |  |
| 0x48 | 0x10 | DateAndTime | mLastTimeChanged |  |  |
| 0x58 | 0x21 | UniquePlayerID | mUniqueID |  |  |
| 0x79 | 0x3 |  |  | Padding |  |
| 0x7C | 0x4 | int32_t | miCurrentScoreForPlayersPointOfView |  |  |
| 0x80 | 0x4 | uint32_t | miTotalEvents |  |  |
| 0x84 | 0x4 |  |  | Padding |  |

### BrnNetwork::CommonRelationship

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x24 | CommonRelationshipStats | mPlayerStats |  |  |
| 0x24 | 0x24 | CommonRelationshipStats | mRivalStats |  |  |

### BrnNetwork::CommonRelationshipStats

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miTakedowns |  |  |
| 0x4 | 0x4 | int32_t | miScalps |  |  |
| 0x8 | 0x4 | int32_t | miLongestStreak |  |  |
| 0xC | 0x4 | int32_t | miWins |  |  |
| 0x10 | 0x4 | int32_t | miMarks |  |  |
| 0x14 | 0x4 | int32_t | miScoresSettled |  |  |
| 0x18 | 0x4 | int32_t | miEventsSinceLastTakedown |  |  |
| 0x1C | 0x4 | int32_t | miPaybacksScored |  |  |
| 0x20 | 0x4 | int32_t | miPaybacksDealt |  |  |

### CgsSystem::DateAndTime

#### PlayStation 3, PlayStation 4, Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1 | bool | mbIsLocal | Defines whether the saved time is in a local time zone or UTC |  |
| 0x1 | 0x7 |  |  | Padding |  |
| 0x8 | 0x8 | time_t | mSystemTime | The time value |  |

#### Xbox 360, PC, Xbox One, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1 | bool | mbIsLocal | Defines whether the saved time is in a local time zone or UTC |  |
| 0x1 | 0x3 |  |  | Padding |  |
| 0x4 | 0x8 | FILETIME | mSystemTime | The time value |  |

### CgsNetwork::UniquePlayerIDPS3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | PlayerName | mPlayerName | Player name |  |

### CgsNetwork::UniquePlayerIDX360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x10 | PlayerName | mPlayerName | Player name |  |
| 0x10 | 0x8 | int64_t | ? | XUID |  |

### CgsNetwork::PlayerName

#### PlayStation 3, PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | char[20] | macName | Online player's name |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x10 | char[16] | macName | Online player's name |  |

#### PlayStation 4, Xbox One, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x19 | char[25] | macName | Online player's name |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x21 | char[33] | macName | Online player's name |  |

## Typedefs

### BrnProgression::MugshotInfo::UniquePlayerID

#### PlayStation 3

| Name | Type | Length | Comments |
| --- | --- | --- | --- |
| UniquePlayerID | UniquePlayerIDPS3 | 0x14 |  |

#### Xbox 360

| Name | Type | Length | Comments |
| --- | --- | --- | --- |
| UniquePlayerID | UniquePlayerIDX360 | 0x18 |  |

#### Other platforms

Similar to UniquePlayerIDPS3 but with an unknown type name. See PlayerName.
