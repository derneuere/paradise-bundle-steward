# Profile/Burnout Paradise/Island Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Island_Profile (mirrored 2026-06-22)

The island profile contains all saved data associated with Big Surf Island, including vehicles, events, collectibles, Road Rules, challenges, and statistics, as well as all bike-related data.

## Structures

### Island Profile

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | ? | Version number | 25 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x108 | CarData[11] | ? | Island vehicles |  |
| 0x138 | 0x108 | LiveryData[11] | ? | Liveries |  |
| 0x240 | 0x4 | uint32_t | ? | Number of island events |  |
| 0x244 | 0x78 | ProfileEvent[15] | ? | Island events |  |
| 0x2BC | 0x28 | int32_t[10] | ? | Number of island events present, per type |  |
| 0x2E4 | 0x28 | int32_t[10] | ? | Number of island events won, per type |  |
| 0x30C | 0x4 | int32_t | ? | Number of island tours present |  |
| 0x310 | 0x4 | int32_t | ? | Number of island tours won |  |
| 0x314 | 0x4 | int32_t | ? | Island vehicle count |  |
| 0x318 | 0x4 | int32_t | ? | Livery count |  |
| 0x31C | 0x16C | Array<?, 45u> | ? | Island billboards | Not padded after length. See island collectible |
| 0x488 | 0x25C | Array<?, 75u> | ? | Island smash gates | Not padded after length. See island collectible |
| 0x6E4 | 0x7C | Array<?, 15u> | ? | Mega jumps | Not padded after length. See island collectible |
| 0x760 | 0x8 | Array<uint32_t, 1u> | ? | Junkyards found | Not padded after length |
| 0x768 | 0x8 | Array<uint32_t, 1u> | ? | Auto repairs found | Not padded after length |
| 0x770 | 0xC | Array<uint32_t, 2u> | ? | Gas stations found | Not padded after length |
| 0x77C | 0x8 | Array<uint32_t, 1u> | ? | Paint shops found | Not padded after length |
| 0x784 | 0x4 |  |  | Padding |  |
| 0x788 | 0x58 | Array<CgsID, 10u> | ? | Island challenges |  |
| 0x7E0 | 0x300 | ChallengeHighScoreEntry[12] | ? | Best island road rules |  |
| 0xAE0 | 0x1E0 | ChallengePlayerScoreEntry[12] | ? | Player island road rules |  |
| 0xCC0 | 0x370 | ? | ? | Island bike Road Rules | See island bike Road Rules |
| 0x1030 | 0x4 | int32_t | ? | Barrel roll record |  |
| 0x1034 | 0x4 | float32_t | ? | Flat spin record |  |
| 0x1038 | 0x4 | float32_t | ? | Drift distance record |  |
| 0x103C | 0x8 | Time | ? | In-car time played |  |
| 0x1044 | 0x8 | Time | ? | Real time played |  |
| 0x104C | 0x4 | float32_t | ? | Distance driven offline |  |
| 0x1050 | 0x4 | float32_t | ? | Distance driven online |  |
| 0x1054 | 0x4 | float32_t | ? | Best air time |  |
| 0x1058 | 0x4 | float32_t | ? | Best oncoming |  |
| 0x105C | 0x4 | int32_t | ? | Highest showtime score |  |
| 0x1060 | 0x4 | int32_t | ? | Best power parking |  |
| 0x1064 | 0x4 | int32_t | ? | Best Burnout chain |  |
| 0x1068 | 0x4 | int32_t | ? | Total number of takedowns |  |
| 0x106C | 0x4 | int32_t | ? | Best Road Rage score |  |
| 0x1070 | 0x8 | int64_t | ? | Best Stunt Run score |  |
| 0x1078 | 0x1 | uint8_t | ? |  |  |
| 0x1079 | 0x1 | bool | ? | Island welcome shown |  |
| 0x107A | 0x1 | bool | ? | 100% completed |  |
| 0x107B | 0x5 |  |  | Padding |  |
| 0x1080 | 0x10 | DateAndTime | ? | Island license issue date |  |
| 0x1090 | 0x4 | float32_t | ? | Best wheelie |  |
| 0x1094 | 0x4 | float32_t | ? | Best bike jump distance |  |
| 0x1098 | 0x8 | Time | ? | Bike time played |  |
| 0x10A0 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x10A4 | 0x4 | float32_t | ? | Distance ridden offline |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | ? | Version number | 25 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x108 | CarData[11] | ? | Island vehicles |  |
| 0x138 | 0x108 | LiveryData[11] | ? | Liveries |  |
| 0x240 | 0x4 | uint32_t | ? | Number of island events |  |
| 0x244 | 0x78 | ProfileEvent[15] | ? | Island events |  |
| 0x2BC | 0x28 | int32_t[10] | ? | Number of island events present, per type |  |
| 0x2E4 | 0x28 | int32_t[10] | ? | Number of island events won, per type |  |
| 0x30C | 0x4 | int32_t | ? | Number of island tours present |  |
| 0x310 | 0x4 | int32_t | ? | Number of island tours won |  |
| 0x314 | 0x4 | int32_t | ? | Island vehicle count |  |
| 0x318 | 0x4 | int32_t | ? | Livery count |  |
| 0x31C | 0x16C | Array<?, 45u> | ? | Island billboards | Not padded after length. See island collectible |
| 0x488 | 0x25C | Array<?, 75u> | ? | Island smash gates | Not padded after length. See island collectible |
| 0x6E4 | 0x7C | Array<?, 15u> | ? | Mega jumps | Not padded after length. See island collectible |
| 0x760 | 0x8 | Array<uint32_t, 1u> | ? | Junkyards found | Not padded after length |
| 0x768 | 0x8 | Array<uint32_t, 1u> | ? | Auto repairs found | Not padded after length |
| 0x770 | 0xC | Array<uint32_t, 2u> | ? | Gas stations found | Not padded after length |
| 0x77C | 0x8 | Array<uint32_t, 1u> | ? | Paint shops found | Not padded after length |
| 0x784 | 0x4 |  |  | Padding |  |
| 0x788 | 0x58 | Array<CgsID, 10u> | ? | Island challenges |  |
| 0x7E0 | 0x2A0 | ChallengeHighScoreEntry[12] | ? | Best island road rules |  |
| 0xA80 | 0x1E0 | ChallengePlayerScoreEntry[12] | ? | Player island road rules |  |
| 0xC60 | 0x310 | ? | ? | Island bike Road Rules | See island bike Road Rules |
| 0xF70 | 0x4 | int32_t | ? | Barrel roll record |  |
| 0xF74 | 0x4 | float32_t | ? | Flat spin record |  |
| 0xF78 | 0x4 | float32_t | ? | Drift distance record |  |
| 0xF7C | 0x8 | Time | ? | In-car time played |  |
| 0xF84 | 0x8 | Time | ? | Real time played |  |
| 0xF8C | 0x4 | float32_t | ? | Distance driven offline |  |
| 0xF90 | 0x4 | float32_t | ? | Distance driven online |  |
| 0xF94 | 0x4 | float32_t | ? | Best air time |  |
| 0xF98 | 0x4 | float32_t | ? | Best oncoming |  |
| 0xF9C | 0x4 | int32_t | ? | Highest showtime score |  |
| 0xFA0 | 0x4 | int32_t | ? | Best power parking |  |
| 0xFA4 | 0x4 | int32_t | ? | Best Burnout chain |  |
| 0xFA8 | 0x4 | int32_t | ? | Total number of takedowns |  |
| 0xFAC | 0x4 | int32_t | ? | Best Road Rage score |  |
| 0xFB0 | 0x8 | int64_t | ? | Best Stunt Run score |  |
| 0xFB8 | 0x1 | uint8_t | ? |  |  |
| 0xFB9 | 0x1 | bool | ? | Island welcome shown |  |
| 0xFBA | 0x1 | bool | ? | 100% completed |  |
| 0xFBB | 0x1 |  |  | Padding |  |
| 0xFBC | 0xC | DateAndTime | ? | Island license issue date |  |
| 0xFC8 | 0x4 | float32_t | ? | Best wheelie |  |
| 0xFCC | 0x4 | float32_t | ? | Best bike jump distance |  |
| 0xFD0 | 0x8 | Time | ? | Bike time played |  |
| 0xFD8 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0xFDC | 0x4 | float32_t | ? | Distance ridden offline |  |

#### PlayStation 4

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | ? | Version number | 25 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x108 | CarData[11] | ? | Island vehicles |  |
| 0x138 | 0x108 | LiveryData[11] | ? | Liveries |  |
| 0x240 | 0x4 | uint32_t | ? | Number of island events |  |
| 0x244 | 0x78 | ProfileEvent[15] | ? | Island events |  |
| 0x2BC | 0x28 | int32_t[10] | ? | Number of island events present, per type |  |
| 0x2E4 | 0x28 | int32_t[10] | ? | Number of island events won, per type |  |
| 0x30C | 0x4 | int32_t | ? | Number of island tours present |  |
| 0x310 | 0x4 | int32_t | ? | Number of island tours won |  |
| 0x314 | 0x4 | int32_t | ? | Island vehicle count |  |
| 0x318 | 0x4 | int32_t | ? | Livery count |  |
| 0x31C | 0x16C | Array<?, 45u> | ? | Island billboards | Not padded after length. See island collectible |
| 0x488 | 0x25C | Array<?, 75u> | ? | Island smash gates | Not padded after length. See island collectible |
| 0x6E4 | 0x7C | Array<?, 15u> | ? | Mega jumps | Not padded after length. See island collectible |
| 0x760 | 0x8 | Array<uint32_t, 1u> | ? | Junkyards found | Not padded after length |
| 0x768 | 0x8 | Array<uint32_t, 1u> | ? | Auto repairs found | Not padded after length |
| 0x770 | 0xC | Array<uint32_t, 2u> | ? | Gas stations found | Not padded after length |
| 0x77C | 0x8 | Array<uint32_t, 1u> | ? | Paint shops found | Not padded after length |
| 0x784 | 0x4 |  |  | Padding |  |
| 0x788 | 0x58 | Array<CgsID, 10u> | ? | Island challenges |  |
| 0x7E0 | 0x3C0 | ChallengeHighScoreEntry[12] | ? | Best island road rules |  |
| 0xBA0 | 0x1E0 | ChallengePlayerScoreEntry[12] | ? | Player island road rules |  |
| 0xD80 | 0x3E8 | ? | ? | Island bike Road Rules | See island bike Road Rules |
| 0x1168 | 0x4 | int32_t | ? | Barrel roll record |  |
| 0x116C | 0x4 | float32_t | ? | Flat spin record |  |
| 0x1170 | 0x4 | float32_t | ? | Drift distance record |  |
| 0x1174 | 0x8 | Time | ? | In-car time played |  |
| 0x117C | 0x8 | Time | ? | Real time played |  |
| 0x1184 | 0x4 | float32_t | ? | Distance driven offline |  |
| 0x1188 | 0x4 | float32_t | ? | Distance driven online |  |
| 0x118C | 0x4 | float32_t | ? | Best air time |  |
| 0x1190 | 0x4 | float32_t | ? | Best oncoming |  |
| 0x1194 | 0x4 | int32_t | ? | Highest showtime score |  |
| 0x1198 | 0x4 | int32_t | ? | Best power parking |  |
| 0x119C | 0x4 | int32_t | ? | Best Burnout chain |  |
| 0x11A0 | 0x4 | int32_t | ? | Total number of takedowns |  |
| 0x11A4 | 0x4 | int32_t | ? | Best Road Rage score |  |
| 0x11A8 | 0x8 | int64_t | ? | Best Stunt Run score |  |
| 0x11B0 | 0x1 | uint8_t | ? |  |  |
| 0x11B1 | 0x1 | bool | ? | Island welcome shown |  |
| 0x11B2 | 0x1 | bool | ? | 100% completed |  |
| 0x11B3 | 0x5 |  |  | Padding |  |
| 0x11B8 | 0x10 | DateAndTime | ? | Island license issue date |  |
| 0x11C8 | 0x4 | float32_t | ? | Best wheelie |  |
| 0x11CC | 0x4 | float32_t | ? | Best bike jump distance |  |
| 0x11D0 | 0x8 | Time | ? | Bike time played |  |
| 0x11D8 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x11DC | 0x4 | float32_t | ? | Distance ridden offline |  |

#### PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | ? | Version number | 25 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x108 | CarData[11] | ? | Island vehicles |  |
| 0x138 | 0x108 | LiveryData[11] | ? | Liveries |  |
| 0x240 | 0x4 | uint32_t | ? | Number of island events |  |
| 0x244 | 0x78 | ProfileEvent[15] | ? | Island events |  |
| 0x2BC | 0x28 | int32_t[10] | ? | Number of island events present, per type |  |
| 0x2E4 | 0x28 | int32_t[10] | ? | Number of island events won, per type |  |
| 0x30C | 0x4 | int32_t | ? | Number of island tours present |  |
| 0x310 | 0x4 | int32_t | ? | Number of island tours won |  |
| 0x314 | 0x4 | int32_t | ? | Island vehicle count |  |
| 0x318 | 0x4 | int32_t | ? | Livery count |  |
| 0x31C | 0x16C | Array<?, 45u> | ? | Island billboards | Not padded after length. See island collectible |
| 0x488 | 0x25C | Array<?, 75u> | ? | Island smash gates | Not padded after length. See island collectible |
| 0x6E4 | 0x7C | Array<?, 15u> | ? | Mega jumps | Not padded after length. See island collectible |
| 0x760 | 0x8 | Array<uint32_t, 1u> | ? | Junkyards found | Not padded after length |
| 0x768 | 0x8 | Array<uint32_t, 1u> | ? | Auto repairs found | Not padded after length |
| 0x770 | 0xC | Array<uint32_t, 2u> | ? | Gas stations found | Not padded after length |
| 0x77C | 0x8 | Array<uint32_t, 1u> | ? | Paint shops found | Not padded after length |
| 0x784 | 0x4 |  |  | Padding |  |
| 0x788 | 0x58 | Array<CgsID, 10u> | ? | Island challenges |  |
| 0x7E0 | 0x3C0 | ChallengeHighScoreEntry[12] | ? | Best island road rules |  |
| 0xBA0 | 0x1E0 | ChallengePlayerScoreEntry[12] | ? | Player island road rules |  |
| 0xD80 | 0x3E8 | ? | ? | Island bike Road Rules | See island bike Road Rules |
| 0x1168 | 0x4 | int32_t | ? | Barrel roll record |  |
| 0x116C | 0x4 | float32_t | ? | Flat spin record |  |
| 0x1170 | 0x4 | float32_t | ? | Drift distance record |  |
| 0x1174 | 0x8 | Time | ? | In-car time played |  |
| 0x117C | 0x8 | Time | ? | Real time played |  |
| 0x1184 | 0x4 | float32_t | ? | Distance driven offline |  |
| 0x1188 | 0x4 | float32_t | ? | Distance driven online |  |
| 0x118C | 0x4 | float32_t | ? | Best air time |  |
| 0x1190 | 0x4 | float32_t | ? | Best oncoming |  |
| 0x1194 | 0x4 | int32_t | ? | Highest showtime score |  |
| 0x1198 | 0x4 | int32_t | ? | Best power parking |  |
| 0x119C | 0x4 | int32_t | ? | Best Burnout chain |  |
| 0x11A0 | 0x4 | int32_t | ? | Total number of takedowns |  |
| 0x11A4 | 0x4 | int32_t | ? | Best Road Rage score |  |
| 0x11A8 | 0x8 | int64_t | ? | Best Stunt Run score |  |
| 0x11B0 | 0x1 | uint8_t | ? |  |  |
| 0x11B1 | 0x1 | bool | ? | Island welcome shown |  |
| 0x11B2 | 0x1 | bool | ? | 100% completed |  |
| 0x11B3 | 0x1 |  |  | Padding |  |
| 0x11B4 | 0xC | DateAndTime | ? | Island license issue date |  |
| 0x11C0 | 0x4 | float32_t | ? | Best wheelie |  |
| 0x11C4 | 0x4 | float32_t | ? | Best bike jump distance |  |
| 0x11C8 | 0x8 | Time | ? | Bike time played |  |
| 0x11D0 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x11D4 | 0x4 | float32_t | ? | Distance ridden offline |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | ? | Version number | 25 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x108 | CarData[11] | ? | Island vehicles |  |
| 0x138 | 0x108 | LiveryData[11] | ? | Liveries |  |
| 0x240 | 0x4 | uint32_t | ? | Number of island events |  |
| 0x244 | 0x78 | ProfileEvent[15] | ? | Island events |  |
| 0x2BC | 0x28 | int32_t[10] | ? | Number of island events present, per type |  |
| 0x2E4 | 0x28 | int32_t[10] | ? | Number of island events won, per type |  |
| 0x30C | 0x4 | int32_t | ? | Number of island tours present |  |
| 0x310 | 0x4 | int32_t | ? | Number of island tours won |  |
| 0x314 | 0x4 | int32_t | ? | Island vehicle count |  |
| 0x318 | 0x4 | int32_t | ? | Livery count |  |
| 0x31C | 0x16C | Array<?, 45u> | ? | Island billboards | Not padded after length. See island collectible |
| 0x488 | 0x25C | Array<?, 75u> | ? | Island smash gates | Not padded after length. See island collectible |
| 0x6E4 | 0x7C | Array<?, 15u> | ? | Mega jumps | Not padded after length. See island collectible |
| 0x760 | 0x8 | Array<uint32_t, 1u> | ? | Junkyards found | Not padded after length |
| 0x768 | 0x8 | Array<uint32_t, 1u> | ? | Auto repairs found | Not padded after length |
| 0x770 | 0xC | Array<uint32_t, 2u> | ? | Gas stations found | Not padded after length |
| 0x77C | 0x8 | Array<uint32_t, 1u> | ? | Paint shops found | Not padded after length |
| 0x784 | 0x4 |  |  | Padding |  |
| 0x788 | 0x58 | Array<CgsID, 10u> | ? | Island challenges |  |
| 0x7E0 | 0x480 | ChallengeHighScoreEntry[12] | ? | Best island road rules |  |
| 0xC60 | 0x1E0 | ChallengePlayerScoreEntry[12] | ? | Player island road rules |  |
| 0xE40 | 0x4A8 | ? | ? | Island bike Road Rules | See island bike Road Rules |
| 0x12E8 | 0x4 | int32_t | ? | Barrel roll record |  |
| 0x12EC | 0x4 | float32_t | ? | Flat spin record |  |
| 0x12F0 | 0x4 | float32_t | ? | Drift distance record |  |
| 0x12F4 | 0x8 | Time | ? | In-car time played |  |
| 0x12FC | 0x8 | Time | ? | Real time played |  |
| 0x1304 | 0x4 | float32_t | ? | Distance driven offline |  |
| 0x1308 | 0x4 | float32_t | ? | Distance driven online |  |
| 0x130C | 0x4 | float32_t | ? | Best air time |  |
| 0x1310 | 0x4 | float32_t | ? | Best oncoming |  |
| 0x1314 | 0x4 | int32_t | ? | Highest showtime score |  |
| 0x1318 | 0x4 | int32_t | ? | Best power parking |  |
| 0x131C | 0x4 | int32_t | ? | Best Burnout chain |  |
| 0x1320 | 0x4 | int32_t | ? | Total number of takedowns |  |
| 0x1324 | 0x4 | int32_t | ? | Best Road Rage score |  |
| 0x1328 | 0x8 | int64_t | ? | Best Stunt Run score |  |
| 0x1330 | 0x1 | uint8_t | ? |  |  |
| 0x1331 | 0x1 | bool | ? | Island welcome shown |  |
| 0x1332 | 0x1 | bool | ? | 100% completed |  |
| 0x1333 | 0x5 |  |  | Padding |  |
| 0x1338 | 0x10 | DateAndTime | ? | Island license issue date |  |
| 0x1348 | 0x4 | float32_t | ? | Best wheelie |  |
| 0x134C | 0x4 | float32_t | ? | Best bike jump distance |  |
| 0x1350 | 0x8 | Time | ? | Bike time played |  |
| 0x1358 | 0x4 | float32_t | ? | Distance ridden online |  |
| 0x135C | 0x4 | float32_t | ? | Distance ridden offline |  |

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

### Island collectible

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | uint32_t | ? | Collectible GameDB ID |  |
| 0x4 | 0x4 | uint32_t | ? | District | See districts |

### BrnStreetData::ChallengeHighScoreEntry

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x18 | ChallengeData | super_ChallengeData |  |  |
| 0x18 | 0x28 | PlayerName[2] | maPlayerNames |  | See ScoreType for index names |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x18 | ChallengeData | super_ChallengeData |  |  |
| 0x18 | 0x20 | PlayerName[2] | maPlayerNames |  | See ScoreType for index names |

#### PlayStation 4, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x18 | ChallengeData | super_ChallengeData |  |  |
| 0x18 | 0x32 | PlayerName[2] | maPlayerNames |  | See ScoreType for index names |
| 0x4A | 0x6 |  |  | Padding |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x18 | ChallengeData | super_ChallengeData |  |  |
| 0x18 | 0x42 | PlayerName[2] | maPlayerNames |  | See ScoreType for index names |
| 0x5A | 0x6 |  |  | Padding |  |

### BrnStreetData::ChallengeData

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x8 | BitArray<2u> | mDirty |  | See ScoreType for index names |
| 0x8 | 0x8 | BitArray<2u> | mValidScores |  | See ScoreType for index names |
| 0x10 | 0x8 | ScoreList | mScoreList |  |  |

### BrnStreetData::ScoreList

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x8 | int32_t[2] | maScores | Time and showtime score, respectively | See ScoreType for index names |

### CgsNetwork::PlayerName

#### PlayStation 3

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

### BrnStreetData::ChallengePlayerScoreEntry

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x18 | ChallengeData | super_ChallengeData |  |  |
| 0x18 | 0x10 | CgsID[2] | maCarIDs |  | See ScoreType for index names |

### Island bike Road Rules

2 sets of 12, first is day, second is night.

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0xC0 | CgsID[12][2] | ? | Vehicles used |  |
| 0xC0 | 0x60 | int32_t[12][2] | ? | Player scores |  |
| 0x120 | 0x60 | int32_t[12][2] | ? | Friends' best scores |  |
| 0x180 | 0x1E0 | PlayerName[12][2] | ? | Friends' names |  |
| 0x360 | 0x10 | BitArray<12u>[2] | ? | Dirty |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0xC0 | CgsID[12][2] | ? | Vehicles used |  |
| 0xC0 | 0x60 | int32_t[12][2] | ? | Player scores |  |
| 0x120 | 0x60 | int32_t[12][2] | ? | Friends' best scores |  |
| 0x180 | 0x180 | PlayerName[12][2] | ? | Friends' names |  |
| 0x300 | 0x10 | BitArray<12u>[2] | ? | Dirty |  |

#### PlayStation 4, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0xC0 | CgsID[12][2] | ? | Vehicles used |  |
| 0xC0 | 0x60 | int32_t[12][2] | ? | Player scores |  |
| 0x120 | 0x60 | int32_t[12][2] | ? | Friends' best scores |  |
| 0x180 | 0x258 | PlayerName[12][2] | ? | Friends' names |  |
| 0x3D8 | 0x10 | BitArray<12u>[2] | ? | Dirty |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0xC0 | CgsID[12][2] | ? | Vehicles used |  |
| 0xC0 | 0x60 | int32_t[12][2] | ? | Player scores |  |
| 0x120 | 0x60 | int32_t[12][2] | ? | Friends' best scores |  |
| 0x180 | 0x318 | PlayerName[12][2] | ? | Friends' names |  |
| 0x498 | 0x10 | BitArray<12u>[2] | ? | Dirty |  |

### CgsSystem::Time

Precise time counter used as a replacement for floats starting in version 1.3.

| Offset | Size | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miSeconds | Seconds |  |
| 0x4 | 0x4 | float32_t | mfFraction | Milliseconds |  |

### CgsSystem::DateAndTime

#### PlayStation 3, PlayStation 4, Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1 | bool | mbIsLocal | Defines whether the saved time is in a local time zone or UTC |  |
| 0x1 | 0x7 |  |  | Padding |  |
| 0x8 | 0x8 | time_t | mSystemTime | The time value |  |

#### Xbox 360, PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1 | bool | mbIsLocal | Defines whether the saved time is in a local time zone or UTC |  |
| 0x1 | 0x3 |  |  | Padding |  |
| 0x8 | 0x8 | FILETIME | mSystemTime | The time value |  |

## Enumerations

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

### BrnStreetData::ScoreType

| Name | Value | Comments |
| --- | --- | --- |
| E_SCORE_TYPE_START | 0 |  |
| E_SCORE_TYPE_TIME | 0 |  |
| E_SCORE_TYPE_CRASH | 1 |  |
| E_SCORE_TYPE_COUNT | 2 |  |
