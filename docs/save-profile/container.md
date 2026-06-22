# Profile/Burnout Paradise

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise (mirrored 2026-06-22)

The profile for *Burnout Paradise* contains all saved progression, including event completion, collectible discovery, records, and unlocked vehicles, among other things. It also contains user-selected data such as vehicle colors, options, and custom online race routes.

The only major content not saved in the profile is mugshot data, which is stored independently. Its location is platform-specific.

## Overview

The primary purpose of the Profile is to store progression. To achieve this goal, it is broken up into several different structures and substructures, with the highest levels being demarcated by update (in the instances where updates introduced content relevant to progression). There may also be separate online-related or options-related chunks. Progression chunks are generally split into sections for vehicles, rivals, events, collectibles, discovery, Road Rules, challenges, records, and statistics, among other things. Not all sections are used in each chunk, but all are guaranteed to be present in the stored data in some form.

### Vehicles

Being the main form of progression in Paradise, a significant amount of attention is devoted to vehicles. Each progression-related chunk has a set amount of storage allocated to store IDs, colors, mileage, and other related data. Which vehicles are unlocked is determined by whether or not one has an entry in the profile, while finishes being unlocked depends on whether the damage value is set to 0.

Vehicle chunks have also been split into two parts such that the chosen finish and mileage for a vehicle is separate from the rest of the data. It is not clear why this is the case. Additionally, PDLC and cop cars use a different structure to the rest which lacks certain fields, such as damage, but it is also unclear why this was done; space savings is one theory, but it is more likely a simple lack of foresight.

### Events

Events take up a relatively small portion of the profile, with only an ID and flags to indicate their discovery and completion state. Only completion-related flags are reset when any new license is earned, allowing them to remain on the map if they have been discovered. Event difficulty is not stored explicitly, instead being derived from license progression and/or the number of wins in that event type.

### Collectibles

Collectibles are stored in three sets, one for each type (Burnout Billboards, Smash Gates, and Super Jumps). Each ID within these is referred to as a stunt element. An ID being present means that specific collectible has been collected. Discoverables (drivethrus) are stored in the same way collectibles are.

Notably, the per-county collectible counts displayed in the discovery tab are not tied to the IDs saved in the sets, instead being stored separately in the profile.

### Road Rules

Road Rules have their own specific chunks in progression profiles. These use one of two formats, one for cars (which is also used in the Street Data resource) and one for bikes. Both store essentially the same data: whether or not the offline and online scores have been beaten, the scores set by the player, and the vehicles used to set the player's high scores.

The highest scores of anyone on a player's friends list are also stored along with the winning player's name. This name is displayed at the top of the screen in-game until it is refreshed by either a leaderboard download or the player beating the score.

Road Rules are also split between mainland Road Rules, with 64 roads, and Big Surf Island Road Rules, with 12 roads. The exact order of these roads is known and appears to be either ID-based or based on the time they were added to the game.

### Challenges

Challenges are split in the profile similarly to how they are split in-game, with separate sets for Freeburn, timed, bike, and Island challenges. Like with collectibles, IDs are used to mark specific challenges as complete. The only type of challenge to differ from this is timed, which has additional fields for the saved time and player count.

Timed bike challenges, despite having a personal best field in-game, do not have saved times in the profile and are instead stored exactly like Freeburn bike challenges.

### Records and statistics

A number of values are stored in the profile so the player can keep track of high scores, total play time, total mileage, etc. Many of these are specific to mainland, bike, and Big Surf Island progression, though none are directly contributory to any licenses. No values are notable from a technical perspective, either, although some suffer from certain limitations and others become deprecated by higher-precision values in later versions, as is the case with the Stunt Run high score.

## Known issues and exploits

### Buffer overread via color indices

Colors and color types may be modified by changing the selected index on a given vehicle. As there is no bounds checking in place, it is possible to read data beyond the selected color type and the Player Car Colours resource altogether. What's read in is interpreted as floating-point data representing percentages of 255, leading to values less than 0% and greater than 100%. The resulting colors often glow and have been dubbed "neon" colors. The exact process by which these colors are formed is currently unknown and likely requires shader research to understand.

### Replacement of selected liveries with other vehicles

The selected livery of a given vehicle is stored as a vehicle ID. As there are no checks in place to ensure the selected vehicle is a child of the given vehicle, this can be replaced with any other vehicle, including undrivable vehicles such as traffic. Liveries set this way cannot be selected normally in the junkyard but can be used by other means, such as waiting for the countdown to end in an online race or having the host of an online room start a Marked Man game.

### Time and distance limitations

Time played, measured in seconds, was originally stored as a float. Due to the imprecision inherent to the float datatype, the smallest increments at which a value can increase get larger with bigger values. In this case, time stopped increasing when it could no longer increment by the frametime (16.6 ms), which limited the value to just 262144 seconds (72.8 hours).

Distance travelled suffers the same imprecision woes but at a later point. While it is still added to every frame, the increase changes based on speed, so the limit changes based on speed as well: 10425 mi at 67-134 mph, 20850 mi at 134-268 mph, and 41700 mi at 268-537 mph, to name some common ones. These limits apply to both total and per-car mileage.

In version 1.3, time played was fixed by using a structure created specifically to address the issue:

**CgsSystem::Time**

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miSeconds | Seconds |  |
| 0x4 | 0x4 | float32_t | mfFraction | Milliseconds |  |

Unfortunately, this fix was only applied to time, meaning distance remains limited even in the latest versions of the game.

### Missing smash gate after updating

The profile upgrade performed by the 1.9 update alters the hit props bit array to accommodate prop changes made when the bridge was opened. A single smash gate on top of the Angus car park can become impossible to collect if the profile is upgraded. This can only be circumvented by downgrading the game, smashing the gate, and updating again.

## Headers and protection

#### Xbox 360

Xbox 360 profiles use EA's proprietary MC02 header to protect the data. Following any edits, the profile must be rehashed using a program such as MC02 Package Tool.

The following information is from symbols in Dead Space 2 (2010-11-19 build).

**RealmcCore::FileHeader**

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | uint32_t | mFileHeaderVersion | Magic | Must be 'MC02'<br>MC = Memory Card<br>02 = version 2 |
| 0x4 | 0x4 | uint32_t | mFileSize | Length of the save in bytes | Includes the MC02 header |
| 0x8 | 0x4 | uint32_t | mUserHeaderSize | Save header length in bytes | Unused in Burnout Paradise |
| 0xC | 0x4 | uint32_t | mUserBodySize | Save data length in bytes |  |
| 0x10 | 0x4 | uint32_t | mUserHeaderSignature | Save header CRC32 | Unused in Burnout Paradise |
| 0x14 | 0x4 | uint32_t | mUserBodySignature | Save data CRC32 |  |
| 0x18 | 0x4 | uint32_t | mFileHeaderSignature | MC02 header CRC32 | Hashes everything prior to this field |

The CRC32 algorithm used is nonstandard. See this gist for an example implementation.

#### PC

The PC profile uses the Rich Game Header (RGMH), which provides no protection from modding. The profile is located at `%LOCALAPPDATA%/Criterion Games/Burnout Paradise/Save/Profile.BurnoutParadiseSave`.

Further information on this header can be found at its Microsoft Learn page.

**RGMH header**

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | DWORD | dwMagicNumber | Used to recognize the header. | Must be 'HMGR' |
| 0x4 | 0x4 | DWORD | dwHeaderVersion | Version of this header. | Must be 1 |
| 0x8 | 0x4 | DWORD | dwHeaderSize | Size of this header in bytes. |  |
| 0xC | 0x8 | LARGE_INTEGER | liThumbnailOffset | Offset to where the thumbnail starts. | Relative to header end |
| 0x14 | 0x4 | DWORD | dwThumbnailSize | Size of the thumbnail in bytes. |  |
| 0x18 | 0x10 | GUID | guidGameId | GUID of the game. | {6D5AE2FB-F7AC-45EA-982C-8422649DB55E}<br>See GUID on MS Learn |
| 0x28 | 0x800 | WCHAR[1024] | szGameName | Name of the game. |  |
| 0x828 | 0x800 | WCHAR[1024] | szSaveName | Description of the saved game. |  |
| 0x1028 | 0x800 | WCHAR[1024] | szLevelName | Description of the level. |  |
| 0x1828 | 0x800 | WCHAR[1024] | szComments | Comments about the saved game. |  |

In practice, this is immediately followed by the thumbnail data.

#### PC (Remastered)

Like with the PC version of the original game, the *Remastered* profile uses the Rich Game Header and has no protection from modding. It is located at `%LOCALAPPDATA%/Criterion Games/Burnout Paradise Remastered/Save/Profile.BurnoutParadiseSave`.

#### Other platforms

No game-specific protection or header is in place on other platforms. See per-platform protections.

## Previous versions

Unlike many of the assets used by the game, the profile is completely backwards compatible with older versions of Burnout Paradise. Data introduced in newer versions is stored in separate chunks, leaving prior chunks untouched; even new vehicles are stored in new arrays instead of the one in the original chunk. Deprecated fields are still written to, such as how the time played statistics are updated despite being replaced with higher-precision fields in 1.3, so progress from updated fields can carry over.

As a result of this system, the ProfileStoredData structure sees no changes between retail versions, only additions. If it is necessary to read profiles from earlier game versions, later chunks can simply be ignored.

## Structures

### BrnGui::ProfileManager::ProfileStoredData

Primary profile structure which holds all data.

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1DA30 | FixedSizeOpaqueBuffer<Profile_1_0> | mProgressionProfile | Base progression profile | In 1.0 |
| 0x1DA30 | 0x7540 | FixedSizeOpaqueBuffer<LiveRevengeProfile> | mLiveRevengeProfile | Live Revenge profile | In 1.0 |
| 0x24F70 | 0x7370 | FixedSizeOpaqueBuffer<OptionsDataProfile_1_0> | mOptionsDataProfile | Options data profile | In 1.0 |
| 0x2C2E0 | 0xAC0 | FixedSizeOpaqueBuffer<ProfileDLC_1_3> | ? | Cagney profile | Added in 1.3 |
| 0x2CDA0 | 0x18 | FixedSizeOpaqueBuffer<OptionsDataProfileDLC_1_3> | ? | Cagney options data profile | Added in 1.3 |
| 0x2CDB8 | 0x19C8 | FixedSizeOpaqueBuffer<ProfileDLC_1_4> | ? | Davis profile | Added in 1.4 |
| 0x2E780 | 0x1C60 | FixedSizeOpaqueBuffer<?> | ? | PDLC profile | Added in 1.7. See PDLC Profile |
| 0x303E0 | 0x268 | FixedSizeOpaqueBuffer<?> | ? | Cop profile | Added in 1.8. See Cop Profile |
| 0x30648 | 0x10A8 | FixedSizeOpaqueBuffer<?> | ? | Island profile | Added in 1.9. See Island Profile |
| 0x316F0 | 0xE910 | char[59664] | macPadData | Padding |  |

#### Xbox 360

Offsets are relative to 0x1C, the end of the MC02 header (start of the Profile structure).

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1CD30 | FixedSizeOpaqueBuffer<Profile_1_0> | mProgressionProfile | Base progression profile | In 1.0 |
| 0x1CD30 | 0x7540 | FixedSizeOpaqueBuffer<LiveRevengeProfile> | mLiveRevengeProfile | Live Revenge profile | In 1.0 |
| 0x24270 | 0x7370 | FixedSizeOpaqueBuffer<OptionsDataProfile_1_0> | mOptionsDataProfile | Options data profile | In 1.0 |
| 0x2B5E0 | 0xAC0 | FixedSizeOpaqueBuffer<ProfileDLC_1_3> | ? | Cagney profile | Added in 1.3 |
| 0x2C0A0 | 0x18 | FixedSizeOpaqueBuffer<OptionsDataProfileDLC_1_3> | ? | Cagney options data profile | Added in 1.3 |
| 0x2C0B8 | 0x17C8 | FixedSizeOpaqueBuffer<ProfileDLC_1_4> | ? | Davis profile | Added in 1.4 |
| 0x2D880 | 0x1C60 | FixedSizeOpaqueBuffer<?> | ? | PDLC profile | Added in 1.7. See PDLC Profile |
| 0x2F4E0 | 0x268 | FixedSizeOpaqueBuffer<?> | ? | Cop profile | Added in 1.8. See Cop Profile |
| 0x2F748 | 0xFE0 | FixedSizeOpaqueBuffer<?> | ? | Island profile | Added in 1.9. See Island Profile |
| 0x30728 | 0xF8D8 | char[63704] | macPadData | Padding |  |

#### PC

Offsets are relative to 0x1D246, the end of the RGMH header (start of the Profile structure).

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1CC00 | FixedSizeOpaqueBuffer<Profile_1_0> | mProgressionProfile | Base progression profile | In 1.0 |
| 0x1CC00 | 0x6D68 | FixedSizeOpaqueBuffer<LiveRevengeProfile> | mLiveRevengeProfile | Live Revenge profile | In 1.0 |
| 0x23968 | 0x7780 | FixedSizeOpaqueBuffer<OptionsDataProfile_1_0> | mOptionsDataProfile | Options data profile | In 1.0 |
| 0x2B0E8 | 0xAC0 | FixedSizeOpaqueBuffer<ProfileDLC_1_3> | ? | Cagney profile | Added in 1.3 |
| 0x2BBA8 | 0x18 | FixedSizeOpaqueBuffer<OptionsDataProfileDLC_1_3> | ? | Cagney options data profile | Added in 1.3 |
| 0x2BBC0 | 0x19C8 | FixedSizeOpaqueBuffer<ProfileDLC_1_4> | ? | Davis profile | Added in 1.4 |
| 0x2D588 | 0xC88 | FixedSizeOpaqueBuffer<?> | ? | Recent players profile | See Recent Players Profile |
| 0x2E210 | 0x1C68 | FixedSizeOpaqueBuffer<?> | ? | PDLC profile | Added in 1.7. See PDLC Profile |
| 0x2FE78 | 0x10188 | char[65928] | macPadData | Padding |  |

#### PlayStation 4

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x66100 | FixedSizeOpaqueBuffer<Profile_1_0> | mProgressionProfile | Base progression profile | In 1.0 |
| 0x66100 | 0x7D10 | FixedSizeOpaqueBuffer<LiveRevengeProfile> | mLiveRevengeProfile | Live Revenge profile | In 1.0 |
| 0x6DE10 | 0x7778 | FixedSizeOpaqueBuffer<OptionsDataProfile_1_0> | mOptionsDataProfile | Options data profile | In 1.0 |
| 0x75588 | 0xAC0 | FixedSizeOpaqueBuffer<ProfileDLC_1_3> | ? | Cagney profile | Added in 1.3 |
| 0x76048 | 0x18 | FixedSizeOpaqueBuffer<OptionsDataProfileDLC_1_3> | ? | Cagney options data profile | Added in 1.3 |
| 0x76060 | 0x1C48 | FixedSizeOpaqueBuffer<ProfileDLC_1_4> | ? | Davis profile | Added in 1.4 |
| 0x77CA8 | 0x1C68 | FixedSizeOpaqueBuffer<?> | ? | PDLC profile | Added in 1.7. See PDLC Profile |
| 0x79910 | 0x268 | FixedSizeOpaqueBuffer<?> | ? | Cop profile | Added in 1.8. See Cop Profile |
| 0x79B78 | 0x11E0 | FixedSizeOpaqueBuffer<?> | ? | Island profile | Added in 1.9. See Island Profile |
| 0x7AD58 | 0x52A9 | char[21161] | macPadData | Padding |  |

#### PC (Remastered)

Offsets are relative to 0x1D246, the end of the RGMH header (start of the Profile structure).

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x65DA0 | FixedSizeOpaqueBuffer<Profile_1_0> | mProgressionProfile | Base progression profile | In 1.0 |
| 0x65DA0 | 0x7538 | FixedSizeOpaqueBuffer<LiveRevengeProfile> | mLiveRevengeProfile | Live Revenge profile | In 1.0 |
| 0x6D2D8 | 0x7778 | FixedSizeOpaqueBuffer<OptionsDataProfile_1_0> | mOptionsDataProfile | Options data profile | In 1.0 |
| 0x74A50 | 0xAC0 | FixedSizeOpaqueBuffer<ProfileDLC_1_3> | ? | Cagney profile | Added in 1.3 |
| 0x75510 | 0x18 | FixedSizeOpaqueBuffer<OptionsDataProfileDLC_1_3> | ? | Cagney options data profile | Added in 1.3 |
| 0x75528 | 0x1C48 | FixedSizeOpaqueBuffer<ProfileDLC_1_4> | ? | Davis profile | Added in 1.4 |
| 0x77170 | 0x1C68 | FixedSizeOpaqueBuffer<?> | ? | PDLC profile | Added in 1.7. See PDLC Profile |
| 0x78DD8 | 0x268 | FixedSizeOpaqueBuffer<?> | ? | Cop profile | Added in 1.8. See Cop Profile |
| 0x79040 | 0x11D8 | FixedSizeOpaqueBuffer<?> | ? | Island profile | Added in 1.9. See Island Profile |
| 0x7A218 | 0x5DE8 | char[24040] | macPadData | Padding |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x66820 | FixedSizeOpaqueBuffer<Profile_1_0> | mProgressionProfile | Base progression profile | In 1.0 |
| 0x66820 | 0x84E0 | FixedSizeOpaqueBuffer<LiveRevengeProfile> | mLiveRevengeProfile | Live Revenge profile | In 1.0 |
| 0x6ED00 | 0x7778 | FixedSizeOpaqueBuffer<OptionsDataProfile_1_0> | mOptionsDataProfile | Options data profile | In 1.0 |
| 0x76478 | 0xAC0 | FixedSizeOpaqueBuffer<ProfileDLC_1_3> | ? | Cagney profile | Added in 1.3 |
| 0x76F38 | 0x18 | FixedSizeOpaqueBuffer<OptionsDataProfileDLC_1_3> | ? | Cagney options data profile | Added in 1.3 |
| 0x76F50 | 0x2048 | FixedSizeOpaqueBuffer<ProfileDLC_1_4> | ? | Davis profile | Added in 1.4 |
| 0x78F98 | 0x1C68 | FixedSizeOpaqueBuffer<?> | ? | PDLC profile | Added in 1.7. See PDLC Profile |
| 0x7AC00 | 0x268 | FixedSizeOpaqueBuffer<?> | ? | Cop profile | Added in 1.8. See Cop Profile |
| 0x7AE68 | 0x1360 | FixedSizeOpaqueBuffer<?> | ? | Island profile | Added in 1.9. See Island Profile |
| 0x7C1C8 | 0x3E38 | char[15928] | macPadData | Padding |  |

### BrnGui::ProfileManager::FixedSizeOpaqueBuffer

Buffer type used when loading and saving. It is always the size of the specified type. For example, the Progression Profile on PS3 is stored as:

**FixedSizeOpaqueBuffer<BrnProgression::Profile>**

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1DA30 | uint8_t[121392] | maData | uint8_t buffer of the exact length of the structure |  |
