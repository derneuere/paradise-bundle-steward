# Profile/Burnout Paradise/Davis Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Davis_Profile (mirrored 2026-06-22)

The Davis profile includes all bike-related fields, excluding those found on the Island Profile. This includes vehicles, events, Road Rules, challenges, awards, and statistics. It also has fields for the time of day feature.

## Structures

### BrnGuiSaveLoad::ProfileDLC_1_4

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 21 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x1E0 | CarData[20] | ? | Vehicles |  |
| 0x1E8 | 0x1E0 | LiveryData[20] | ? | Liveries |  |
| 0x3C8 | 0x140 | ProfileEvent[40] | ? | Events |  |
| 0x508 | 0x4 | int32_t | ? | Number of events |  |
| 0x50C | 0x4 |  |  | Padding |  |
| 0x510 | 0x1210 | ? | ? | Bike Road Rules | See bike Road Rules |
| 0x1720 | 0x238 | Array<CgsID, 70u> | ? | Bike challenges |  |
| 0x1958 | 0x8 | BitArray<20u> | ? | Bike awards |  |
| 0x1960 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x1978 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x1984 | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x1988 | 0x4 | int32_t | ? | Number of vehicles |  |
| 0x198C | 0x4 | int32_t | ? | Number of liveries |  |
| 0x1990 | 0x8 | Time | ? | Time of day |  |
| 0x1998 | 0x10 | DateAndTime | ? | Date bikes 100% completed |  |
| 0x19A8 | 0x8 | Time | ? | Total time played |  |
| 0x19B0 | 0x4 | float32_t | ? | Distance ridden offline |  |
| 0x19B4 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x19B8 | 0x4 | float32_t | ? | Longest wheelie |  |
| 0x19BC | 0x4 | float32_t | ? | Longest jump |  |
| 0x19C0 | 0x1 | uint8_t | ? | Active bike road rules | See EActiveRoadRule |
| 0x19C1 | 0x1 | uint8_t | ? | Time of day intro state | See time of day intro state |
| 0x19C2 | 0x1 | uint8_t | ? | Time setting | See time setting |
| 0x19C3 | 0x1 | uint8_t | ? | Constant time setting | See constant time setting |
| 0x19C4 | 0x1 | bool | ? | Is 101% complete |  |
| 0x19C5 | 0x3 |  |  | Padding |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 21 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x1E0 | CarData[20] | ? | Vehicles |  |
| 0x1E8 | 0x1E0 | LiveryData[20] | ? | Liveries |  |
| 0x3C8 | 0x140 | ProfileEvent[40] | ? | Events |  |
| 0x508 | 0x4 | int32_t | ? | Number of events |  |
| 0x50C | 0x4 |  |  | Padding |  |
| 0x510 | 0x1010 | ? | ? | Bike Road Rules | See bike Road Rules |
| 0x1520 | 0x238 | Array<CgsID, 70u> | ? | Bike challenges |  |
| 0x1758 | 0x8 | BitArray<20u> | ? | Bike awards |  |
| 0x1760 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x1778 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x1784 | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x1788 | 0x4 | int32_t | ? | Number of vehicles |  |
| 0x178C | 0x4 | int32_t | ? | Number of liveries |  |
| 0x1790 | 0x8 | Time | ? | Time of day |  |
| 0x1798 | 0xC | DateAndTime | ? | Date bikes 100% completed |  |
| 0x17A4 | 0x8 | Time | ? | Total time played |  |
| 0x17AC | 0x4 | float32_t | ? | Distance ridden offline |  |
| 0x17B0 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x17B4 | 0x4 | float32_t | ? | Longest wheelie |  |
| 0x17B8 | 0x4 | float32_t | ? | Longest jump |  |
| 0x17BC | 0x1 | uint8_t | ? | Active bike road rules | See EActiveRoadRule |
| 0x17BD | 0x1 | uint8_t | ? | Time of day intro state | See time of day intro state |
| 0x17BE | 0x1 | uint8_t | ? | Time setting | See time setting |
| 0x17BF | 0x1 | uint8_t | ? | Constant time setting | See constant time setting |
| 0x17C0 | 0x1 | bool | ? | Is 101% complete |  |
| 0x17C1 | 0x7 |  |  | Padding |  |

#### PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 22 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x1E0 | CarData[20] | ? | Vehicles |  |
| 0x1E8 | 0x1E0 | LiveryData[20] | ? | Liveries |  |
| 0x3C8 | 0x140 | ProfileEvent[40] | ? | Events |  |
| 0x508 | 0x4 | int32_t | ? | Number of events |  |
| 0x50C | 0x4 |  |  | Padding |  |
| 0x510 | 0x1210 | ? | ? | Bike Road Rules | See bike Road Rules |
| 0x1720 | 0x238 | Array<CgsID, 70u> | ? | Bike challenges |  |
| 0x1958 | 0x8 | BitArray<20u> | ? | Bike awards |  |
| 0x1960 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x1978 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x1984 | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x1988 | 0x4 | int32_t | ? | Number of vehicles |  |
| 0x198C | 0x4 | int32_t | ? | Number of liveries |  |
| 0x1990 | 0x8 | Time | ? | Time of day |  |
| 0x1998 | 0xC | DateAndTime | ? | Date bikes 100% completed |  |
| 0x19A4 | 0x8 | Time | ? | Total time played |  |
| 0x19AC | 0x4 | float32_t | ? | Distance ridden offline |  |
| 0x19B0 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x19B4 | 0x4 | float32_t | ? | Longest wheelie |  |
| 0x19B8 | 0x4 | float32_t | ? | Longest jump |  |
| 0x19BC | 0x1 | uint8_t | ? | Active bike road rules | See EActiveRoadRule |
| 0x19BD | 0x1 | uint8_t | ? | Time of day intro state | See time of day intro state |
| 0x19BE | 0x1 | uint8_t | ? | Time setting | See time setting |
| 0x19BF | 0x1 | uint8_t | ? | Constant time setting | See constant time setting |
| 0x19C0 | 0x1 | bool | ? | Is 101% complete |  |
| 0x19C1 | 0x7 |  |  | Padding |  |

#### PlayStation 4

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 21 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x1E0 | CarData[20] | ? | Vehicles |  |
| 0x1E8 | 0x1E0 | LiveryData[20] | ? | Liveries |  |
| 0x3C8 | 0x140 | ProfileEvent[40] | ? | Events |  |
| 0x508 | 0x4 | int32_t | ? | Number of events |  |
| 0x50C | 0x4 |  |  | Padding |  |
| 0x510 | 0x1490 | ? | ? | Bike Road Rules | See bike Road Rules |
| 0x19A0 | 0x238 | Array<CgsID, 70u> | ? | Bike challenges |  |
| 0x1BD8 | 0x8 | BitArray<20u> | ? | Bike awards |  |
| 0x1BE0 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x1BF8 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x1C04 | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x1C08 | 0x4 | int32_t | ? | Number of vehicles |  |
| 0x1C0C | 0x4 | int32_t | ? | Number of liveries |  |
| 0x1C10 | 0x8 | Time | ? | Time of day |  |
| 0x1C18 | 0x10 | DateAndTime | ? | Date bikes 100% completed |  |
| 0x1C28 | 0x8 | Time | ? | Total time played |  |
| 0x1C30 | 0x4 | float32_t | ? | Distance ridden offline |  |
| 0x1C34 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x1C38 | 0x4 | float32_t | ? | Longest wheelie |  |
| 0x1C3C | 0x4 | float32_t | ? | Longest jump |  |
| 0x1C40 | 0x1 | uint8_t | ? | Active bike road rules | See EActiveRoadRule |
| 0x1C41 | 0x1 | uint8_t | ? | Time of day intro state | See time of day intro state |
| 0x1C42 | 0x1 | uint8_t | ? | Time setting | See time setting |
| 0x1C43 | 0x1 | uint8_t | ? | Constant time setting | See constant time setting |
| 0x1C44 | 0x1 | bool | ? | Is 101% complete |  |
| 0x1C45 | 0x3 |  |  | Padding |  |

#### PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 22 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x1E0 | CarData[20] | ? | Vehicles |  |
| 0x1E8 | 0x1E0 | LiveryData[20] | ? | Liveries |  |
| 0x3C8 | 0x140 | ProfileEvent[40] | ? | Events |  |
| 0x508 | 0x4 | int32_t | ? | Number of events |  |
| 0x50C | 0x4 |  |  | Padding |  |
| 0x510 | 0x1490 | ? | ? | Bike Road Rules | See bike Road Rules |
| 0x19A0 | 0x238 | Array<CgsID, 70u> | ? | Bike challenges |  |
| 0x1BD8 | 0x8 | BitArray<20u> | ? | Bike awards |  |
| 0x1BE0 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x1BF8 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x1C04 | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x1C08 | 0x4 | int32_t | ? | Number of vehicles |  |
| 0x1C0C | 0x4 | int32_t | ? | Number of liveries |  |
| 0x1C10 | 0x8 | Time | ? | Time of day |  |
| 0x1C18 | 0xC | DateAndTime | ? | Date bikes 100% completed |  |
| 0x1C24 | 0x8 | Time | ? | Total time played |  |
| 0x1C2C | 0x4 | float32_t | ? | Distance ridden offline |  |
| 0x1C30 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x1C34 | 0x4 | float32_t | ? | Longest wheelie |  |
| 0x1C38 | 0x4 | float32_t | ? | Longest jump |  |
| 0x1C3C | 0x1 | uint8_t | ? | Active bike road rules | See EActiveRoadRule |
| 0x1C3D | 0x1 | uint8_t | ? | Time of day intro state | See time of day intro state |
| 0x1C3E | 0x1 | uint8_t | ? | Time setting | See time setting |
| 0x1C3F | 0x1 | uint8_t | ? | Constant time setting | See constant time setting |
| 0x1C40 | 0x1 | bool | ? | Is 101% complete |  |
| 0x1C41 | 0x7 |  |  | Padding |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 21 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x1E0 | CarData[20] | ? | Vehicles |  |
| 0x1E8 | 0x1E0 | LiveryData[20] | ? | Liveries |  |
| 0x3C8 | 0x140 | ProfileEvent[40] | ? | Events |  |
| 0x508 | 0x4 | int32_t | ? | Number of events |  |
| 0x50C | 0x4 |  |  | Padding |  |
| 0x510 | 0x1890 | ? | ? | Bike Road Rules | See bike Road Rules |
| 0x1DA0 | 0x238 | Array<CgsID, 70u> | ? | Bike challenges |  |
| 0x1FD8 | 0x8 | BitArray<20u> | ? | Bike awards |  |
| 0x1FE0 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x1FF8 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2004 | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x2008 | 0x4 | int32_t | ? | Number of vehicles |  |
| 0x200C | 0x4 | int32_t | ? | Number of liveries |  |
| 0x2010 | 0x8 | Time | ? | Time of day |  |
| 0x2018 | 0x10 | DateAndTime | ? | Date bikes 100% completed |  |
| 0x2028 | 0x8 | Time | ? | Total time played |  |
| 0x2030 | 0x4 | float32_t | ? | Distance ridden offline |  |
| 0x2034 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x2038 | 0x4 | float32_t | ? | Longest wheelie |  |
| 0x203C | 0x4 | float32_t | ? | Longest jump |  |
| 0x2040 | 0x1 | uint8_t | ? | Active bike road rules | See EActiveRoadRule |
| 0x2041 | 0x1 | uint8_t | ? | Time of day intro state | See time of day intro state |
| 0x2042 | 0x1 | uint8_t | ? | Time setting | See time setting |
| 0x2043 | 0x1 | uint8_t | ? | Constant time setting | See constant time setting |
| 0x2044 | 0x1 | bool | ? | Is 101% complete |  |
| 0x2045 | 0x3 |  |  | Padding |  |

### BrnProgression::CarData

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x8 | CgsID | mId | Vehicle ID |  |
| 0x8 | 0x1 | uint8_t | mu8ColourIndex | Color index | From the Player Car Colours resource |
| 0x9 | 0x1 | uint8_t | mu8PaletteIndex | Color palette/type index | From the Player Car Colours resource |
| 0xA | 0x1 | bool | mbUnlockSequenceAlreadyShown | Has Junkyard unlock animation been played |  |
| 0xB | 0x1 | uint8_t | ? | Version flags from the Vehicle List resource | Padding prior to game version 1.3 |
| 0xC | 0x4 | float32_t | mfUnlockDeformedAmount | Damage applied to the car |  |
| 0x10 | 0x4 | UnlockType | meUnlockType | Vehicle unlock type |  |
| 0x14 | 0x4 |  |  | Padding |  |

### BrnProgression::LiveryData

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x8 | CgsID | mBaseCarId |  |  |
| 0x8 | 0x8 | CgsID | mChosenLiveryCarId |  |  |
| 0x10 | 0x4 | float32_t | mfDistanceDriven |  |  |
| 0x14 | 0x1 | uint8_t | ? | Version flags from the Vehicle List resource | Padding prior to version 1.3 |
| 0x15 | 0x3 | ? | ? | Padding |  |

### BrnProgression::ProfileEvent

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | uint32_t | muEventID | Event junction ID |  |
| 0x4 | 0x2 | uint16_t | muFlags | Event flags | See Flags |
| 0x6 | 0x2 |  |  | Padding |  |

### Bike Road Rules

2 sets of 64, first is day, second is night.

#### PlayStation 3, PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x400 | CgsID[64][2] | ? | Vehicles used |  |
| 0x400 | 0x200 | int32_t[64][2] | ? | Player scores |  |
| 0x600 | 0x200 | int32_t[64][2] | ? | Friends' best scores |  |
| 0x800 | 0xA00 | PlayerName[64][2] | ? | Friends' names |  |
| 0x1200 | 0x10 | BitArray<64u>[2] | ? | Dirty |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x400 | CgsID[64][2] | ? | Vehicles used |  |
| 0x400 | 0x200 | int32_t[64][2] | ? | Player scores |  |
| 0x600 | 0x200 | int32_t[64][2] | ? | Friends' best scores |  |
| 0x800 | 0x800 | PlayerName[64][2] | ? | Friends' names |  |
| 0x1000 | 0x10 | BitArray<64u>[2] | ? | Dirty |  |

#### PlayStation 4, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x400 | CgsID[64][2] | ? | Vehicles used |  |
| 0x400 | 0x200 | int32_t[64][2] | ? | Player scores |  |
| 0x600 | 0x200 | int32_t[64][2] | ? | Friends' best scores |  |
| 0x800 | 0xC80 | PlayerName[64][2] | ? | Friends' names |  |
| 0x1480 | 0x10 | BitArray<64u>[2] | ? | Dirty |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x400 | CgsID[64][2] | ? | Vehicles used |  |
| 0x400 | 0x200 | int32_t[64][2] | ? | Player scores |  |
| 0x600 | 0x200 | int32_t[64][2] | ? | Friends' best scores |  |
| 0x800 | 0x1080 | PlayerName[64][2] | ? | Friends' names |  |
| 0x1880 | 0x10 | BitArray<64u>[2] | ? | Dirty |  |

### CgsNetwork::PlayerName

#### PlayStation 3, PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | char[20] | macName | Online player's name |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x10 | char[16] | macName | Online player's name |  |

#### PlayStation 4, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x19 | char[25] | macName | Online player's name |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x21 | char[33] | macName | Online player's name |  |

### CgsSystem::DateAndTime

#### PlayStation 3, PlayStation 4, Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1 | bool | mbIsLocal | Defines whether the saved time is in a local time zone or UTC |  |
| 0x1 | 0x7 |  |  | Padding |  |
| 0x8 | 0x8 | time_t | mSystemTime | The time value |  |

#### Xbox 360, PC, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1 | bool | mbIsLocal | Defines whether the saved time is in a local time zone or UTC |  |
| 0x1 | 0x3 |  |  | Padding |  |
| 0x8 | 0x8 | FILETIME | mSystemTime | The time value |  |

### CgsSystem::Time

Precise time counter used as a replacement for floats starting in version 1.3.

| Offset | Size | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miSeconds | Seconds |  |
| 0x4 | 0x4 | float32_t | mfFraction | Milliseconds |  |

## Enumerations

### BrnGameState::EActiveRoadRule

| Name | Value | Comment |
| --- | --- | --- |
| E_ACTIVE_ROAD_RULE_NONE | 0 |  |
| E_ACTIVE_ROAD_RULE_OFFLINE_TIME | 1 |  |
| E_ACTIVE_ROAD_RULE_ONLINE_TIME | 2 |  |
| E_ACTIVE_ROAD_RULE_OFFLINE_CRASH | 3 |  |
| E_ACTIVE_ROAD_RULE_ONLINE_CRASH | 4 |  |
| ? | 5 | Bike offline time (day) |
| ? | 6 | Bike online time (day) |
| ? | 7 | Bike offline time (night) |
| ? | 8 | Bike online time (night) |
| E_ACTIVE_ROAD_RULE_COUNT | 9 |  |

### BrnProgression::CarData::UnlockType

| Name | Value | Comment |
| --- | --- | --- |
| E_UNLOCK_TYPE_UNLOCK | 0 | Unlocked at start |
| E_UNLOCK_TYPE_GIFT | 1 | Secondary finishes and Burning Route unlocks |
| E_UNLOCK_TYPE_TROPHY | 2 | Unlocked through achievements (carbon cars) |
| E_UNLOCK_TYPE_SHUTDOWN_RIVAL | 3 |  |
| E_UNLOCK_TYPE_GOLD_SILVER | 4 | Gold and platinum cars |
| E_UNLOCK_TYPE_SPONSOR | 5 | Will not show until a certain rank is reached |
| ? | 6 | Used on online cars. Causes vehicles to only show while online |
| ? | 7 | Used on Beat The Team community cars (Tempesta Dream/Tiger GT) |
| ? | 8 | Used on PDLC vehicles |
| ? | 9 | Used on Cop Cars |
| ? | 10 | Island gift |
| ? | 11 | Island unlock |

### BrnProgression::ProfileEvent::Flags

| Name | Value | Comments |
| --- | --- | --- |
| E_FLAG_UNDISCOVERED | 0x0 |  |
| E_FLAG_DISCOVERED | 0x1 |  |
| E_FLAG_FINISHED | 0x2 |  |
| E_FLAG_RANK_WIN | 0x4 |  |
| E_FLAG_NON_RANK_WIN | 0x8 |  |
| E_FLAG_WON_SPECIAL_EVENT_BEFORE | 0x10 |  |
| E_FLAG_WON_EVENT_BEFORE | 0x20 |  |

### Time of day intro state

| Name | Value | Comments |
| --- | --- | --- |
| ? | 0 | Initial value for a new save file<br>At Junkyard exit this changes to 1, time of day is set to 8:00 am and time setting becomes 24-Hour Day |
| ? | 1 | Weather disabled. Bike traffic density is always 0.05. Time only runs if the vehicle's engine is on<br>At 8:15 am this changes to 2 |
| ? | 2 | Weather disabled. Bike traffic density interpolates from 0.05 to the normal values<br>At 8:20 am this changes to 3 and time setting becomes 48-Minute Day |
| ? | 3 | Normal time of day and weather management. Saving game options will skip to this state |

### Time setting

| Name | Value | Comments |
| --- | --- | --- |
| ? | 0 | 24-Minute Day |
| ? | 1 | 48-Minute Day |
| ? | 2 | 2-Hour Day |
| ? | 3 | 24-Hour Day |
| ? | 4 | Match Local Time |
| ? | 5 | Constant Time of Day |

### Constant time setting

| Name | Value | Comments |
| --- | --- | --- |
| ? | 0 | Midday |
| ? | 1 | Sunset |
| ? | 2 | Midnight |
| ? | 3 | Sunrise |
