# Profile/Burnout Paradise/Cagney Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Cagney_Profile (mirrored 2026-06-22)

> Subpage: Development — Information on the development of the Cagney profile.

The Cagney profile stores data for timed car challenges, community and online vehicles, and higher precision values for the time played and stunt run high score.

## Structures

### BrnGuiSaveLoad::ProfileDLC_1_3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 29 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x698 | Array<ChallengeScore, 70u> | ? | Timed challenge scores |  |
| 0x6A0 | 0x28 | Array<int32_t, 8u> | ? | Calendar event data | EVENT_GRAD_ID from Comms Database |
| 0x6C8 | 0x1E0 | CarData[20] | ? | Vehicles |  |
| 0x8A8 | 0x1E0 | LiveryData[20] | ? | Liveries |  |
| 0xA88 | 0x8 | int64_t | ? | Best stunt run score |  |
| 0xA90 | 0x8 | CgsID | ? | Spawn vehicle ID |  |
| 0xA98 | 0x4 | uint32_t | ? | Spawn vehicle update version |  |
| 0xA9C | 0x8 | Time | ? | In-car time played |  |
| 0xAA4 | 0x8 | Time | ? | Real time played |  |
| 0xAAC | 0x4 | int32_t | ? | Vehicle count |  |
| 0xAB0 | 0x4 | int32_t | ? | Livery count |  |
| 0xAB4 | 0x1 | uint8_t | ? | Active car road rules | See EActiveRoadRule |
| 0xAB5 | 0x3 |  |  | Padding |  |
| 0xAB8 | 0x8 | BitArray<20u> | ? | Atomika freeburn chats played | AFB_CHAT streams |

### BrnNetwork::NetworkChallengeManager::ChallengeScore

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x8 | CgsID | ? | Challenge GameDB ID |  |
| 0x8 | 0x4 | float32_t | ? | Time (seconds) |  |
| 0xC | 0x4 | uint32_t | ? | Number of players | High nibble is unused |
| 0x10 | 0x1 | uint8_t | ? |  |  |
| 0x11 | 0x7 |  |  | Padding |  |

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
