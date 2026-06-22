# Profile/Burnout Paradise/Progression Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Progression_Profile (mirrored 2026-06-22)

> Subpage: Development — Information on the development of the progression profile.

The Progression Profile stores license progression, vehicle unlocks, collectibles, Road Rule scores, and records, among other things.

## Structures

### BrnProgression::Profile

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number of the Profile structure | 28 |
| 0x4 | 0x20 | char[32] | macName | Player-chosen profile name | Unused in the final game |
| 0x24 | 0xC |  |  | Padding |  |
| 0x30 | 0x10 | Vector3 | mCarPosition | Spawn position of the player vehicle | Unused in the final game |
| 0x40 | 0x10 | Vector3 | mCarDirection | Spawn direction of the player vehicle | Unused in the final game |
| 0x50 | 0x8 | CgsID | mSpawnCarId | The vehicle the player spawns in | Deprecated in V1.3 |
| 0x58 | 0x8 | CgsID | mSpawnWheelId | The wheel the player vehicle spawns with | Unused in the final game |
| 0x60 | 0x4 | uint32_t | muTimeStampOfLastRoadRulesDownload |  |  |
| 0x64 | 0x4 | float32_t | mfDistanceDrivenOnline | Distance driven online in cars (meters) | Subject to distance limitations |
| 0x68 | 0x4 | float32_t | mfDistanceDrivenOffline | Distance driven offline in cars (meters) | Subject to distance limitations |
| 0x6C | 0x4 | float32_t | mfInCarTimePlayed | Total time spent driving | Subject to time limitations |
| 0x70 | 0x1 | int8_t | mi8CurrentProgressionRank | Current license of the player | See ranks |
| 0x71 | 0x1 | int8_t | mi8PowerParkingBestRating | Power Parking record |  |
| 0x72 | 0x1 | int8_t | mi8PowerParkingBetweenOtherPlayersBestRating | Power Parking between players record | Not displayed in the final game |
| 0x73 | 0x1 |  |  | Padding |  |
| 0x74 | 0x4 | uint32_t | muBestNewBurnoutChainScore | Burnout chain record |  |
| 0x78 | 0x44 | int32_t[17] | maGameModeTypeAmount | Number of events present, per type | See EGameModeType |
| 0xBC | 0x44 | int32_t[17] | maGameModeTypeAmountDiscovered | Number of events discovered, per type | See EGameModeType |
| 0x100 | 0x44 | int32_t[17] | maGameModeTypeAmountCompleted | Number of events completed for the current license, per type | See EGameModeType |
| 0x144 | 0x44 | int32_t[17] | maGameModeTypeAmountCompletedSinceTheStart | Total number of events completed, per type | See EGameModeType |
| 0x188 | 0x4 | int32_t | miTotalTakedownCount | Number of takedowns performed |  |
| 0x18C | 0x4 | int32_t | miTotalOnlineVerticleTakedownCount | Number of vertical takedowns performed |  |
| 0x190 | 0x34 | int32_t[13] | maiTakedownTypeCounts | Number of takedowns performed, per type | See ETakedownType |
| 0x1C4 | 0x28 | int32_t[10] | maiWinsPerOfflineGameMode | Number of events won, per type | See EGameModeType |
| 0x1EC | 0x28 | int32_t[10] | maiRankWinsPerOfflineGameMode | Number of events won causing a license upgrade, per type | See EGameModeType |
| 0x214 | 0x28 | int32_t[10] | maiLossesPerOfflineGameMode | Number of events lost, per type |  |
| 0x23C | 0x4 | int32_t | miCompletedBarrelRolls | Barrel roll record |  |
| 0x240 | 0x4 | float32_t | mfCompletedAirSpinAngle | Flat spin record |  |
| 0x244 | 0x4 | float32_t | mfCompletedHandbreakTurnAngle | Handbrake turn record | Not displayed in the final game |
| 0x248 | 0x4 | float32_t | mfCompletedDriftDistance | Drift record |  |
| 0x24C | 0x4 | float32_t | mfOncomingDistance | Oncoming record |  |
| 0x250 | 0x4 | float32_t | mfAirMaximum | Air time record |  |
| 0x254 | 0x4 | int32_t | miHighestShowTimeScore | Showtime record |  |
| 0x258 | 0x4 | int32_t | miBestStuntRunScore | Stunt run record | Deprecated in game version 1.3 |
| 0x25C | 0x4 | int32_t | miCarCount | Number of vehicle entries |  |
| 0x260 | 0x4 | int32_t | miLiveryDataCount | Number of livery entries |  |
| 0x264 | 0x4 | int32_t | miRivalCount | Number of rival entries |  |
| 0x268 | 0x4 | int32_t | miEventCount | Number of event entries |  |
| 0x26C | 0x4 |  |  | Padding |  |
| 0x270 | 0x3000 | CarData[512] | maCars | Vehicle unlocks, colors, and damage |  |
| 0x3270 | 0x3000 | LiveryData[512] | maLiveryChoices | Selected finishes and mileage |  |
| 0x6270 | 0xE00 | RivalData[64] | maRivals | Roaming rival/shutdown car info |  |
| 0x7070 | 0x578 | ProfileEvent[175] | maEvents | Event completion states |  |
| 0x75E8 | 0x3018 | Set<CgsID, 512u>[3] | maStuntElements | Collectible completion states | See EStuntType |
| 0xA600 | 0x4 | uint32_t | muMedalCountFromTheStart | Total number of events won |  |
| 0xA604 | 0x1 | bool | mbGoldCarsUnlocked | Tracks whether gold finishes are unlocked |  |
| 0xA605 | 0x1 | bool | mbSilverCarsUnlocked | Tracks whether platinum finishes are unlocked |  |
| 0xA606 | 0x2 |  |  | Padding |  |
| 0xA608 | 0x30 | Set<CgsID, 5u> | mJunkYardsDriveThruSet | Discovered Junkyards |  |
| 0xA638 | 0x60 | Set<CgsID, 11u> | mBodyShopsDriveThruSet | Discovered Auto Repairs |  |
| 0xA698 | 0x30 | Set<CgsID, 5u> | mPaintShopsDriveThruSet | Discovered Paint Shops |  |
| 0xA6C8 | 0x78 | Set<CgsID, 14u> | mGasStationsDriveThruSet | Discovered Gas Stations |  |
| 0xA740 | 0x60 | Set<CgsID, 11u> | mCarParksDriveThruSet | Discovered Car Parks |  |
| 0xA7A0 | 0x3E88 | Array<CgsID, 2000u> | maFreeBurnChallengeData | Completed Freeburn and Timed Challenges |  |
| 0xE628 | 0x9280 | HitPropsBitArray | mabHitPropBitArray | Smashed billboards and individual gate sections | 500 TRK units, 600 prop hit indicators (bits) each. Not all TRKs are used |
| 0x178A8 | 0x1E | int16_t[3][5] | maaiStuntCountsByCounty | Collectible progression, per-county | See EStuntType and counties |
| 0x178C6 | 0x2 |  |  | Padding |  |
| 0x178C8 | 0x1000 | ChallengeHighScoreEntry[64] | maNetworkChallengeData | Online mainland car Time/Showtime Road Rule scores and player names |  |
| 0x188C8 | 0xA00 | ChallengePlayerScoreEntry[64] | maChallengeData | Player mainland car Time/Showtime Road Rule scores and vehicles |  |
| 0x192C8 | 0x4 | uint32_t | muLastRoadRulesResetTime |  |  |
| 0x192CC | 0x1C | NetworkTexture | mPlayerLicencePicture | License picture header |  |
| 0x192E8 | 0x2580 | char[9600] | macPlayerLicenceTextureData | License picture data |  |
| 0x1B868 | 0x1 | bool | mbPlayerLicencePictureIsValid | Tracks whether the license picture is present |  |
| 0x1B869 | 0x7 |  |  | Padding |  |
| 0x1B870 | 0x20F8 | Array<MugshotInfo, 30u>[5] | maaMugshotInfo | Information on saved mugshots |  |
| 0x1D968 | 0x28 | BitArray<30u>[5] | maAvailableMugshotFileIDs | Tracks what mugshot slots are used |  |
| 0x1D990 | 0xC | float32_t[3] | mafCarTypes |  | Unused in the final game |
| 0x1D99C | 0x4 | ECarType | meCurrentCarType | Boost type of the current vehicle | See ECarType |
| 0x1D9A0 | 0x20 | BitArray<256u> | maHasPlayerSeenTraining | Tracks the tips DJ Atomika has used |  |
| 0x1D9C0 | 0x4 | int32_t | miNumOnlineRacesDone | Number of online races completed |  |
| 0x1D9C4 | 0x4 | int32_t | miNumOnlineRacesWon | Number of online races won |  |
| 0x1D9C8 | 0x4 | int32_t | miNumMugshotsSent | Number of mugshots sent by the player |  |
| 0x1D9CC | 0x4 |  |  | Padding |  |
| 0x1D9D0 | 0x10 | DateAndTime | mDateLicenceIssued | Date the player's license was created |  |
| 0x1D9E0 | 0x10 | DateAndTime | mDate100PercentCompleted | Date the player achieved 100% completion |  |
| 0x1D9F0 | 0x4 | int32_t | miHighestNumberOfTakeDownsInRoadRage | Road Rage record |  |
| 0x1D9F4 | 0x4 |  |  | Padding |  |
| 0x1D9F8 | 0x8 | BitArray<35u> | mSeenTrophyAwardBitArray | Tracks which of the primary 35 vehicles unlocks have been shown |  |
| 0x1DA00 | 0x8 | BitArray<60u> | mAchievementsEarnt | Tracks which Paradise Awards have been earned |  |
| 0x1DA08 | 0x1 | bool | mb100PercentCompletionSequenceShown | Tracks whether the 100% completion animation has been shown |  |
| 0x1DA09 | 0x1 | bool | mbIsNewProfile | Tracks whether the profile is new | Intro will be shown if true |
| 0x1DA0A | 0x1 | bool | mbCreditsSequenceViewed | Tracks whether the credits have been shown |  |
| 0x1DA0B | 0x1 | bool | mbOneHundredHudMessageViewed | Tracks whether the 100% completion message has been shown |  |
| 0x1DA0C | 0x1 | bool | mbHasUnlockedCredits | Tracks whether credits are available for viewing |  |
| 0x1DA0D | 0x1 | bool | mbHaveSet100PercentCompletedDate | Tracks whether the 100% completion date is present |  |
| 0x1DA0E | 0x1 | bool | mbHaveSeenEliteCompletionSequence | Tracks whether the Elite license animation has been shown |  |
| 0x1DA0F | 0x1 | bool | mbRedundantBool4 |  | Unused in the final game |
| 0x1DA10 | 0x1 | int8_t | miPad1 |  | Unused in the final game |
| 0x1DA11 | 0x1 |  |  | Padding |  |
| 0x1DA12 | 0x2 | int16_t | miPad2 |  | Unused in the final game |
| 0x1DA14 | 0x4 | uint32_t | muRoadRulesIDLowBits |  |  |
| 0x1DA18 | 0x8 | BitArray<6u> | mSeenCompleteAllEventTypeArray | Tracks which event types have had all events completed |  |
| 0x1DA20 | 0x4 | float32_t | mfRealTimePlayed | Total time played | As opposed to mfInCarTimePlayed |
| 0x1DA24 | 0x4 | float32_t | mfRedundantFloat4 |  | Unused in the final game |
| 0x1DA28 | 0x4 | uint32_t | muRoadRulesIDHighBits |  |  |
| 0x1DA2C | 0x2 | int16_t | miPad3 |  | Unused in the final game |
| 0x1DA2E | 0x1 | int8_t | miPad4 |  | Unused in the final game |
| 0x1DA2F | 0x1 |  |  | Padding |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number of the Profile structure | 28 |
| 0x4 | 0x20 | char[32] | macName | Player-chosen profile name | Unused in the final game |
| 0x24 | 0xC |  |  | Padding |  |
| 0x30 | 0x10 | Vector3 | mCarPosition | Spawn position of the player vehicle | Unused in the final game |
| 0x40 | 0x10 | Vector3 | mCarDirection | Spawn direction of the player vehicle | Unused in the final game |
| 0x50 | 0x8 | CgsID | mSpawnCarId | The vehicle the player spawns in | Deprecated in V1.3 |
| 0x58 | 0x8 | CgsID | mSpawnWheelId | The wheel the player vehicle spawns with | Unused in the final game |
| 0x60 | 0x4 | uint32_t | muTimeStampOfLastRoadRulesDownload |  |  |
| 0x64 | 0x4 | float32_t | mfDistanceDrivenOnline | Distance driven online in cars (meters) | Subject to distance limitations |
| 0x68 | 0x4 | float32_t | mfDistanceDrivenOffline | Distance driven offline in cars (meters) | Subject to distance limitations |
| 0x6C | 0x4 | float32_t | mfInCarTimePlayed | Total time spent driving | Subject to time limitations |
| 0x70 | 0x1 | int8_t | mi8CurrentProgressionRank | Current license of the player | See ranks |
| 0x71 | 0x1 | int8_t | mi8PowerParkingBestRating | Power Parking record |  |
| 0x72 | 0x1 | int8_t | mi8PowerParkingBetweenOtherPlayersBestRating | Power Parking between players record | Not displayed in the final game |
| 0x73 | 0x1 |  |  | Padding |  |
| 0x74 | 0x4 | uint32_t | muBestNewBurnoutChainScore | Burnout chain record |  |
| 0x78 | 0x44 | int32_t[17] | maGameModeTypeAmount | Number of events present, per type | See EGameModeType |
| 0xBC | 0x44 | int32_t[17] | maGameModeTypeAmountDiscovered | Number of events discovered, per type | See EGameModeType |
| 0x100 | 0x44 | int32_t[17] | maGameModeTypeAmountCompleted | Number of events completed for the current license, per type | See EGameModeType |
| 0x144 | 0x44 | int32_t[17] | maGameModeTypeAmountCompletedSinceTheStart | Total number of events completed, per type | See EGameModeType |
| 0x188 | 0x4 | int32_t | miTotalTakedownCount | Number of takedowns performed |  |
| 0x18C | 0x4 | int32_t | miTotalOnlineVerticleTakedownCount | Number of vertical takedowns performed |  |
| 0x190 | 0x34 | int32_t[13] | maiTakedownTypeCounts | Number of takedowns performed, per type | See ETakedownType |
| 0x1C4 | 0x28 | int32_t[10] | maiWinsPerOfflineGameMode | Number of events won, per type | See EGameModeType |
| 0x1EC | 0x28 | int32_t[10] | maiRankWinsPerOfflineGameMode | Number of events won causing a license upgrade, per type | See EGameModeType |
| 0x214 | 0x28 | int32_t[10] | maiLossesPerOfflineGameMode | Number of events lost, per type |  |
| 0x23C | 0x4 | int32_t | miCompletedBarrelRolls | Barrel roll record |  |
| 0x240 | 0x4 | float32_t | mfCompletedAirSpinAngle | Flat spin record |  |
| 0x244 | 0x4 | float32_t | mfCompletedHandbreakTurnAngle | Handbrake turn record | Not displayed in the final game |
| 0x248 | 0x4 | float32_t | mfCompletedDriftDistance | Drift record |  |
| 0x24C | 0x4 | float32_t | mfOncomingDistance | Oncoming record |  |
| 0x250 | 0x4 | float32_t | mfAirMaximum | Air time record |  |
| 0x254 | 0x4 | int32_t | miHighestShowTimeScore | Showtime record |  |
| 0x258 | 0x4 | int32_t | miBestStuntRunScore | Stunt run record | Deprecated in game version 1.3 |
| 0x25C | 0x4 | int32_t | miCarCount | Number of vehicle entries |  |
| 0x260 | 0x4 | int32_t | miLiveryDataCount | Number of livery entries |  |
| 0x264 | 0x4 | int32_t | miRivalCount | Number of rival entries |  |
| 0x268 | 0x4 | int32_t | miEventCount | Number of event entries |  |
| 0x26C | 0x4 |  |  | Padding |  |
| 0x270 | 0x3000 | CarData[512] | maCars | Vehicle unlocks, colors, and damage |  |
| 0x3270 | 0x3000 | LiveryData[512] | maLiveryChoices | Selected finishes and mileage |  |
| 0x6270 | 0xE00 | RivalData[64] | maRivals | Roaming rival/shutdown car info |  |
| 0x7070 | 0x578 | ProfileEvent[175] | maEvents | Event completion states |  |
| 0x75E8 | 0x3018 | Set<CgsID, 512u>[3] | maStuntElements | Collectible completion states | See EStuntType |
| 0xA600 | 0x4 | uint32_t | muMedalCountFromTheStart | Total number of events won |  |
| 0xA604 | 0x1 | bool | mbGoldCarsUnlocked | Tracks whether gold finishes are unlocked |  |
| 0xA605 | 0x1 | bool | mbSilverCarsUnlocked | Tracks whether platinum finishes are unlocked |  |
| 0xA606 | 0x2 |  |  | Padding |  |
| 0xA608 | 0x30 | Set<CgsID, 5u> | mJunkYardsDriveThruSet | Discovered Junkyards |  |
| 0xA638 | 0x60 | Set<CgsID, 11u> | mBodyShopsDriveThruSet | Discovered Auto Repairs |  |
| 0xA698 | 0x30 | Set<CgsID, 5u> | mPaintShopsDriveThruSet | Discovered Paint Shops |  |
| 0xA6C8 | 0x78 | Set<CgsID, 14u> | mGasStationsDriveThruSet | Discovered Gas Stations |  |
| 0xA740 | 0x60 | Set<CgsID, 11u> | mCarParksDriveThruSet | Discovered Car Parks |  |
| 0xA7A0 | 0x3E88 | Array<CgsID, 2000u> | maFreeBurnChallengeData | Completed Freeburn and Timed Challenges |  |
| 0xE628 | 0x9280 | HitPropsBitArray | mabHitPropBitArray | Smashed billboards and individual gate sections | 500 TRK units, 600 prop hit indicators (bits) each. Not all TRKs are used |
| 0x178A8 | 0x1E | int16_t[3][5] | maaiStuntCountsByCounty | Collectible progression, per-county | See EStuntType and counties |
| 0x178C6 | 0x2 |  |  | Padding |  |
| 0x178C8 | 0xE00 | ChallengeHighScoreEntry[64] | maNetworkChallengeData | Online mainland car Time/Showtime Road Rule scores and player names |  |
| 0x186C8 | 0xA00 | ChallengePlayerScoreEntry[64] | maChallengeData | Player mainland car Time/Showtime Road Rule scores and vehicles |  |
| 0x190C8 | 0x4 | uint32_t | muLastRoadRulesResetTime |  |  |
| 0x190CC | 0x1C | NetworkTexture | mPlayerLicencePicture | License picture header |  |
| 0x190E8 | 0x2580 | char[9600] | macPlayerLicenceTextureData | License picture data |  |
| 0x1B668 | 0x1 | bool | mbPlayerLicencePictureIsValid | Tracks whether the license picture is present |  |
| 0x1B669 | 0x7 |  |  | Padding |  |
| 0x1B670 | 0x1608 | Array<MugshotInfo, 20u>[5] | maaMugshotInfo | Information on saved mugshots |  |
| 0x1CC78 | 0x28 | BitArray<20u>[5] | maAvailableMugshotFileIDs | Tracks what mugshot slots are used |  |
| 0x1CCA0 | 0xC | float32_t[3] | mafCarTypes |  | Unused in the final game |
| 0x1CCAC | 0x4 | ECarType | meCurrentCarType | Boost type of the current vehicle | See ECarType |
| 0x1CCB0 | 0x20 | BitArray<256u> | maHasPlayerSeenTraining | Tracks the tips DJ Atomika has used |  |
| 0x1CCD0 | 0x4 | int32_t | miNumOnlineRacesDone | Number of online races completed |  |
| 0x1CCD4 | 0x4 | int32_t | miNumOnlineRacesWon | Number of online races won |  |
| 0x1CCD8 | 0x4 | int32_t | miNumMugshotsSent | Number of mugshots sent by the player |  |
| 0x1CCDC | 0x10 | DateAndTime | mDateLicenceIssued | Date the player's license was created |  |
| 0x1CCE8 | 0x10 | DateAndTime | mDate100PercentCompleted | Date the player achieved 100% completion |  |
| 0x1CCF4 | 0x4 | int32_t | miHighestNumberOfTakeDownsInRoadRage | Road Rage record |  |
| 0x1CCF8 | 0x8 | BitArray<35u> | mSeenTrophyAwardBitArray | Tracks which of the primary 35 vehicles unlocks have been shown |  |
| 0x1CD00 | 0x1 | bool | mb100PercentCompletionSequenceShown | Tracks whether the 100% completion animation has been shown |  |
| 0x1CD01 | 0x1 | bool | mbIsNewProfile | Tracks whether the profile is new | Intro will be shown if true |
| 0x1CD02 | 0x1 | bool | mbCreditsSequenceViewed | Tracks whether the credits have been shown |  |
| 0x1CD03 | 0x1 | bool | mbOneHundredHudMessageViewed | Tracks whether the 100% completion message has been shown |  |
| 0x1CD04 | 0x1 | bool | mbHasUnlockedCredits | Tracks whether credits are available for viewing |  |
| 0x1CD05 | 0x1 | bool | mbHaveSet100PercentCompletedDate | Tracks whether the 100% completion date is present |  |
| 0x1CD06 | 0x1 | bool | mbHaveSeenEliteCompletionSequence | Tracks whether the Elite license animation has been shown |  |
| 0x1CD07 | 0x1 | bool | mbRedundantBool4 |  | Unused in the final game |
| 0x1CD08 | 0x1 | int8_t | miPad1 |  | Unused in the final game |
| 0x1CD09 | 0x1 |  |  | Padding |  |
| 0x1CD0A | 0x2 | int16_t | miPad2 |  | Unused in the final game |
| 0x1CD0C | 0x4 | uint32_t | muRoadRulesIDLowBits |  |  |
| 0x1CD10 | 0x8 | BitArray<6u> | mSeenCompleteAllEventTypeArray | Tracks which event types have had all events completed |  |
| 0x1CD18 | 0x4 | float32_t | mfRealTimePlayed | Total time played | As opposed to mfInCarTimePlayed |
| 0x1CD1C | 0x4 | float32_t | mfRedundantFloat4 |  | Unused in the final game |
| 0x1CD20 | 0x4 | uint32_t | muRoadRulesIDHighBits |  |  |
| 0x1CD24 | 0x2 | int16_t | miPad3 |  | Unused in the final game |
| 0x1CD26 | 0x1 | int8_t | miPad4 |  | Unused in the final game |
| 0x1CD27 | 0x9 |  |  | Padding |  |

#### PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number of the Profile structure | 30 |
| 0x4 | 0x20 | char[32] | macName | Player-chosen profile name | Unused in the final game |
| 0x24 | 0xC |  |  | Padding |  |
| 0x30 | 0x10 | Vector3 | mCarPosition | Spawn position of the player vehicle | Unused in the final game |
| 0x40 | 0x10 | Vector3 | mCarDirection | Spawn direction of the player vehicle | Unused in the final game |
| 0x50 | 0x8 | CgsID | mSpawnCarId | The vehicle the player spawns in | Deprecated in V1.3 |
| 0x58 | 0x8 | CgsID | mSpawnWheelId | The wheel the player vehicle spawns with | Unused in the final game |
| 0x60 | 0x4 | uint32_t | muTimeStampOfLastRoadRulesDownload |  |  |
| 0x64 | 0x4 | float32_t | mfDistanceDrivenOnline | Distance driven online in cars (meters) | Subject to distance limitations |
| 0x68 | 0x4 | float32_t | mfDistanceDrivenOffline | Distance driven offline in cars (meters) | Subject to distance limitations |
| 0x6C | 0x4 | float32_t | mfInCarTimePlayed | Total time spent driving | Subject to time limitations |
| 0x70 | 0x1 | int8_t | mi8CurrentProgressionRank | Current license of the player | See ranks |
| 0x71 | 0x1 | int8_t | mi8PowerParkingBestRating | Power Parking record |  |
| 0x72 | 0x1 | int8_t | mi8PowerParkingBetweenOtherPlayersBestRating | Power Parking between players record | Not displayed in the final game |
| 0x73 | 0x1 |  |  | Padding |  |
| 0x74 | 0x4 | uint32_t | muBestNewBurnoutChainScore | Burnout chain record |  |
| 0x78 | 0x44 | int32_t[17] | maGameModeTypeAmount | Number of events present, per type | See EGameModeType |
| 0xBC | 0x44 | int32_t[17] | maGameModeTypeAmountDiscovered | Number of events discovered, per type | See EGameModeType |
| 0x100 | 0x44 | int32_t[17] | maGameModeTypeAmountCompleted | Number of events completed for the current license, per type | See EGameModeType |
| 0x144 | 0x44 | int32_t[17] | maGameModeTypeAmountCompletedSinceTheStart | Total number of events completed, per type | See EGameModeType |
| 0x188 | 0x4 | int32_t | miTotalTakedownCount | Number of takedowns performed |  |
| 0x18C | 0x4 | int32_t | miTotalOnlineVerticleTakedownCount | Number of vertical takedowns performed |  |
| 0x190 | 0x34 | int32_t[13] | maiTakedownTypeCounts | Number of takedowns performed, per type | See ETakedownType |
| 0x1C4 | 0x28 | int32_t[10] | maiWinsPerOfflineGameMode | Number of events won, per type | See EGameModeType |
| 0x1EC | 0x28 | int32_t[10] | maiRankWinsPerOfflineGameMode | Number of events won causing a license upgrade, per type | See EGameModeType |
| 0x214 | 0x28 | int32_t[10] | maiLossesPerOfflineGameMode | Number of events lost, per type |  |
| 0x23C | 0x4 | int32_t | miCompletedBarrelRolls | Barrel roll record |  |
| 0x240 | 0x4 | float32_t | mfCompletedAirSpinAngle | Flat spin record |  |
| 0x244 | 0x4 | float32_t | mfCompletedHandbreakTurnAngle | Handbrake turn record | Not displayed in the final game |
| 0x248 | 0x4 | float32_t | mfCompletedDriftDistance | Drift record |  |
| 0x24C | 0x4 | float32_t | mfOncomingDistance | Oncoming record |  |
| 0x250 | 0x4 | float32_t | mfAirMaximum | Air time record |  |
| 0x254 | 0x4 | int32_t | miHighestShowTimeScore | Showtime record |  |
| 0x258 | 0x4 | int32_t | miBestStuntRunScore | Stunt run record | Deprecated in game version 1.3 |
| 0x25C | 0x4 | int32_t | miCarCount | Number of vehicle entries |  |
| 0x260 | 0x4 | int32_t | miLiveryDataCount | Number of livery entries |  |
| 0x264 | 0x4 | int32_t | miRivalCount | Number of rival entries |  |
| 0x268 | 0x4 | int32_t | miEventCount | Number of event entries |  |
| 0x26C | 0x4 |  |  | Padding |  |
| 0x270 | 0x3000 | CarData[512] | maCars | Vehicle unlocks, colors, and damage |  |
| 0x3270 | 0x3000 | LiveryData[512] | maLiveryChoices | Selected finishes and mileage |  |
| 0x6270 | 0xE00 | RivalData[64] | maRivals | Roaming rival/shutdown car info |  |
| 0x7070 | 0x578 | ProfileEvent[175] | maEvents | Event completion states |  |
| 0x75E8 | 0x3018 | Set<CgsID, 512u>[3] | maStuntElements | Collectible completion states | See EStuntType |
| 0xA600 | 0x4 | uint32_t | muMedalCountFromTheStart | Total number of events won |  |
| 0xA604 | 0x1 | bool | mbGoldCarsUnlocked | Tracks whether gold finishes are unlocked |  |
| 0xA605 | 0x1 | bool | mbSilverCarsUnlocked | Tracks whether platinum finishes are unlocked |  |
| 0xA606 | 0x2 |  |  | Padding |  |
| 0xA608 | 0x30 | Set<CgsID, 5u> | mJunkYardsDriveThruSet | Discovered Junkyards |  |
| 0xA638 | 0x60 | Set<CgsID, 11u> | mBodyShopsDriveThruSet | Discovered Auto Repairs |  |
| 0xA698 | 0x30 | Set<CgsID, 5u> | mPaintShopsDriveThruSet | Discovered Paint Shops |  |
| 0xA6C8 | 0x78 | Set<CgsID, 14u> | mGasStationsDriveThruSet | Discovered Gas Stations |  |
| 0xA740 | 0x60 | Set<CgsID, 11u> | mCarParksDriveThruSet | Discovered Car Parks |  |
| 0xA7A0 | 0x3E88 | Array<CgsID, 2000u> | maFreeBurnChallengeData | Completed Freeburn and Timed Challenges |  |
| 0xE628 | 0x9280 | HitPropsBitArray | mabHitPropBitArray | Smashed billboards and individual gate sections | 500 TRK units, 600 prop hit indicators (bits) each. Not all TRKs are used |
| 0x178A8 | 0x1E | int16_t[3][5] | maaiStuntCountsByCounty | Collectible progression, per-county | See EStuntType and counties |
| 0x178C6 | 0x2 |  |  | Padding |  |
| 0x178C8 | 0x1000 | ChallengeHighScoreEntry[64] | maNetworkChallengeData | Online mainland car Time/Showtime Road Rule scores and player names |  |
| 0x188C8 | 0xA00 | ChallengePlayerScoreEntry[64] | maChallengeData | Player mainland car Time/Showtime Road Rule scores and vehicles |  |
| 0x192C8 | 0x4 | uint32_t | muLastRoadRulesResetTime |  |  |
| 0x192CC | 0x1C | NetworkTexture | mPlayerLicencePicture | License picture header |  |
| 0x192E8 | 0x2580 | char[9600] | macPlayerLicenceTextureData | License picture data |  |
| 0x1B868 | 0x1 | bool | mbPlayerLicencePictureIsValid | Tracks whether the license picture is present |  |
| 0x1B869 | 0x3 |  |  | Padding |  |
| 0x1B86C | 0x12D4 | Array<MugshotInfo, 20u>[5] | maaMugshotInfo | Information on saved mugshots | Not padded after length |
| 0x1CB40 | 0x28 | BitArray<20u>[5] | maAvailableMugshotFileIDs | Tracks what mugshot slots are used |  |
| 0x1CB68 | 0xC | float32_t[3] | mafCarTypes |  | Unused in the final game |
| 0x1CB74 | 0x4 | ECarType | meCurrentCarType | Boost type of the current vehicle | See ECarType |
| 0x1CB78 | 0x20 | BitArray<256u> | maHasPlayerSeenTraining | Tracks the tips DJ Atomika has used |  |
| 0x1CB98 | 0x4 | int32_t | miNumOnlineRacesDone | Number of online races completed |  |
| 0x1CB9C | 0x4 | int32_t | miNumOnlineRacesWon | Number of online races won |  |
| 0x1CBA0 | 0x4 | int32_t | miNumMugshotsSent | Number of mugshots sent by the player |  |
| 0x1CBA4 | 0xC | DateAndTime | mDateLicenceIssued | Date the player's license was created |  |
| 0x1CBB0 | 0xC | DateAndTime | mDate100PercentCompleted | Date the player achieved 100% completion |  |
| 0x1CBBC | 0x4 | int32_t | miHighestNumberOfTakeDownsInRoadRage | Road Rage record |  |
| 0x1CBC0 | 0x8 | BitArray<35u> | mSeenTrophyAwardBitArray | Tracks which of the primary 35 vehicles unlocks have been shown |  |
| 0x1CBC8 | 0x8 | BitArray<60u> | mAchievementsEarnt | Tracks which Paradise Awards have been earned |  |
| 0x1CBD0 | 0x1 | bool | mb100PercentCompletionSequenceShown | Tracks whether the 100% completion animation has been shown |  |
| 0x1CBD1 | 0x1 | bool | mbIsNewProfile | Tracks whether the profile is new | Intro will be shown if true |
| 0x1CBD2 | 0x1 | bool | mbCreditsSequenceViewed | Tracks whether the credits have been shown |  |
| 0x1CBD3 | 0x1 | bool | mbOneHundredHudMessageViewed | Tracks whether the 100% completion message has been shown |  |
| 0x1CBD4 | 0x1 | bool | mbHasUnlockedCredits | Tracks whether credits are available for viewing |  |
| 0x1CBD5 | 0x1 | bool | mbHaveSet100PercentCompletedDate | Tracks whether the 100% completion date is present |  |
| 0x1CBD6 | 0x1 | bool | mbHaveSeenEliteCompletionSequence | Tracks whether the Elite license animation has been shown |  |
| 0x1CBD7 | 0x1 | bool | mbRedundantBool4 |  | Unused in the final game |
| 0x1CBD8 | 0x1 | int8_t | miPad1 |  | Unused in the final game |
| 0x1CBD9 | 0x1 |  |  | Padding |  |
| 0x1CBDA | 0x2 | int16_t | miPad2 |  | Unused in the final game |
| 0x1CBDC | 0x4 |  |  | Padding |  |
| 0x1CBE0 | 0x4 | uint32_t | muRoadRulesIDLowBits |  |  |
| 0x1CBE4 | 0x4 |  |  | Padding |  |
| 0x1CBE8 | 0x8 | BitArray<6u> | mSeenCompleteAllEventTypeArray | Tracks which event types have had all events completed |  |
| 0x1CBF0 | 0x4 | float32_t | mfRealTimePlayed | Total time played | As opposed to mfInCarTimePlayed |
| 0x1CBF4 | 0x4 | float32_t | mfRedundantFloat4 |  | Unused in the final game |
| 0x1CBF8 | 0x4 | uint32_t | muRoadRulesIDHighBits |  |  |
| 0x1CBFC | 0x2 | int16_t | miPad3 |  | Unused in the final game |
| 0x1CBFE | 0x1 | int8_t | miPad4 |  | Unused in the final game |
| 0x1CBFF | 0x1 |  |  | Padding |  |

#### PlayStation 4

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number of the Profile structure | 31 |
| 0x4 | 0x20 | char[32] | macName | Player-chosen profile name | Unused in the final game |
| 0x24 | 0xC |  |  | Padding |  |
| 0x30 | 0x10 | Vector3 | mCarPosition | Spawn position of the player vehicle | Unused in the final game |
| 0x40 | 0x10 | Vector3 | mCarDirection | Spawn direction of the player vehicle | Unused in the final game |
| 0x50 | 0x8 | CgsID | mSpawnCarId | The vehicle the player spawns in | Deprecated in V1.3 |
| 0x58 | 0x8 | CgsID | mSpawnWheelId | The wheel the player vehicle spawns with | Unused in the final game |
| 0x60 | 0x4 | uint32_t | muTimeStampOfLastRoadRulesDownload |  |  |
| 0x64 | 0x4 | float32_t | mfDistanceDrivenOnline | Distance driven online in cars (meters) | Subject to distance limitations |
| 0x68 | 0x4 | float32_t | mfDistanceDrivenOffline | Distance driven offline in cars (meters) | Subject to distance limitations |
| 0x6C | 0x4 | float32_t | mfInCarTimePlayed | Total time spent driving | Subject to time limitations |
| 0x70 | 0x1 | int8_t | mi8CurrentProgressionRank | Current license of the player | See ranks |
| 0x71 | 0x1 | int8_t | mi8PowerParkingBestRating | Power Parking record |  |
| 0x72 | 0x1 | int8_t | mi8PowerParkingBetweenOtherPlayersBestRating | Power Parking between players record | Not displayed in the final game |
| 0x73 | 0x1 |  |  | Padding |  |
| 0x74 | 0x4 | uint32_t | muBestNewBurnoutChainScore | Burnout chain record |  |
| 0x78 | 0x44 | int32_t[17] | maGameModeTypeAmount | Number of events present, per type | See EGameModeType |
| 0xBC | 0x44 | int32_t[17] | maGameModeTypeAmountDiscovered | Number of events discovered, per type | See EGameModeType |
| 0x100 | 0x44 | int32_t[17] | maGameModeTypeAmountCompleted | Number of events completed for the current license, per type | See EGameModeType |
| 0x144 | 0x44 | int32_t[17] | maGameModeTypeAmountCompletedSinceTheStart | Total number of events completed, per type | See EGameModeType |
| 0x188 | 0x4 | int32_t | miTotalTakedownCount | Number of takedowns performed |  |
| 0x18C | 0x4 | int32_t | miTotalOnlineVerticleTakedownCount | Number of vertical takedowns performed |  |
| 0x190 | 0x34 | int32_t[13] | maiTakedownTypeCounts | Number of takedowns performed, per type | See ETakedownType |
| 0x1C4 | 0x28 | int32_t[10] | maiWinsPerOfflineGameMode | Number of events won, per type | See EGameModeType |
| 0x1EC | 0x28 | int32_t[10] | maiRankWinsPerOfflineGameMode | Number of events won causing a license upgrade, per type | See EGameModeType |
| 0x214 | 0x28 | int32_t[10] | maiLossesPerOfflineGameMode | Number of events lost, per type |  |
| 0x23C | 0x4 | int32_t | miCompletedBarrelRolls | Barrel roll record |  |
| 0x240 | 0x4 | float32_t | mfCompletedAirSpinAngle | Flat spin record |  |
| 0x244 | 0x4 | float32_t | mfCompletedHandbreakTurnAngle | Handbrake turn record | Not displayed in the final game |
| 0x248 | 0x4 | float32_t | mfCompletedDriftDistance | Drift record |  |
| 0x24C | 0x4 | float32_t | mfOncomingDistance | Oncoming record |  |
| 0x250 | 0x4 | float32_t | mfAirMaximum | Air time record |  |
| 0x254 | 0x4 | int32_t | miHighestShowTimeScore | Showtime record |  |
| 0x258 | 0x4 | int32_t | miBestStuntRunScore | Stunt run record | Deprecated in game version 1.3 |
| 0x25C | 0x4 | int32_t | miCarCount | Number of vehicle entries |  |
| 0x260 | 0x4 | int32_t | miLiveryDataCount | Number of livery entries |  |
| 0x264 | 0x4 | int32_t | miRivalCount | Number of rival entries |  |
| 0x268 | 0x4 | int32_t | miEventCount | Number of event entries |  |
| 0x26C | 0x4 |  |  | Padding |  |
| 0x270 | 0x3000 | CarData[512] | maCars | Vehicle unlocks, colors, and damage |  |
| 0x3270 | 0x3000 | LiveryData[512] | maLiveryChoices | Selected finishes and mileage |  |
| 0x6270 | 0xE00 | RivalData[64] | maRivals | Roaming rival/shutdown car info |  |
| 0x7070 | 0x578 | ProfileEvent[175] | maEvents | Event completion states |  |
| 0x75E8 | 0x3018 | Set<CgsID, 512u>[3] | maStuntElements | Collectible completion states | See EStuntType |
| 0xA600 | 0x4 | uint32_t | muMedalCountFromTheStart | Total number of events won |  |
| 0xA604 | 0x1 | bool | mbGoldCarsUnlocked | Tracks whether gold finishes are unlocked |  |
| 0xA605 | 0x1 | bool | mbSilverCarsUnlocked | Tracks whether platinum finishes are unlocked |  |
| 0xA606 | 0x2 |  |  | Padding |  |
| 0xA608 | 0x30 | Set<CgsID, 5u> | mJunkYardsDriveThruSet | Discovered Junkyards |  |
| 0xA638 | 0x60 | Set<CgsID, 11u> | mBodyShopsDriveThruSet | Discovered Auto Repairs |  |
| 0xA698 | 0x30 | Set<CgsID, 5u> | mPaintShopsDriveThruSet | Discovered Paint Shops |  |
| 0xA6C8 | 0x78 | Set<CgsID, 14u> | mGasStationsDriveThruSet | Discovered Gas Stations |  |
| 0xA740 | 0x60 | Set<CgsID, 11u> | mCarParksDriveThruSet | Discovered Car Parks |  |
| 0xA7A0 | 0x3E88 | Array<CgsID, 2000u> | maFreeBurnChallengeData | Completed Freeburn and Timed Challenges |  |
| 0xE628 | 0x9280 | HitPropsBitArray | mabHitPropBitArray | Smashed billboards and individual gate sections | 500 TRK units, 600 prop hit indicators (bits) each. Not all TRKs are used |
| 0x178A8 | 0x1E | int16_t[3][5] | maaiStuntCountsByCounty | Collectible progression, per-county | See EStuntType and counties |
| 0x178C6 | 0x2 |  |  | Padding |  |
| 0x178C8 | 0x1400 | ChallengeHighScoreEntry[64] | maNetworkChallengeData | Online mainland car Time/Showtime Road Rule scores and player names |  |
| 0x18CC8 | 0xA00 | ChallengePlayerScoreEntry[64] | maChallengeData | Player mainland car Time/Showtime Road Rule scores and vehicles |  |
| 0x196C8 | 0x4 | uint32_t | muLastRoadRulesResetTime |  |  |
| 0x196CC | 0x4 |  |  | Padding |  |
| 0x196D0 | 0x28 | NetworkTexture | mPlayerLicencePicture | License picture header |  |
| 0x196F8 | 0x4B000 | char[38400][8] | macPlayerLicenceTextureData | License picture data | Only first is used |
| 0x646F8 | 0x1 | bool | mbPlayerLicencePictureIsValid | Tracks whether the license picture is present |  |
| 0x646F9 | 0x7 |  |  | Padding |  |
| 0x64700 | 0x1928 | Array<MugshotInfo, 20u>[5] | maaMugshotInfo | Information on saved mugshots |  |
| 0x66028 | 0x28 | BitArray<20u>[5] | maAvailableMugshotFileIDs | Tracks what mugshot slots are used |  |
| 0x66050 | 0xC | float32_t[3] | mafCarTypes |  | Unused in the final game |
| 0x6605C | 0x4 | ECarType | meCurrentCarType | Boost type of the current vehicle | See ECarType |
| 0x66060 | 0x20 | BitArray<256u> | maHasPlayerSeenTraining | Tracks the tips DJ Atomika has used |  |
| 0x66080 | 0x4 | int32_t | miNumOnlineRacesDone | Number of online races completed |  |
| 0x66084 | 0x4 | int32_t | miNumOnlineRacesWon | Number of online races won |  |
| 0x66088 | 0x4 | int32_t | miNumMugshotsSent | Number of mugshots sent by the player |  |
| 0x6608C | 0x4 |  |  | Padding |  |
| 0x66090 | 0x10 | DateAndTime | mDateLicenceIssued | Date the player's license was created |  |
| 0x660A0 | 0x10 | DateAndTime | mDate100PercentCompleted | Date the player achieved 100% completion |  |
| 0x660B0 | 0x4 | int32_t | miHighestNumberOfTakeDownsInRoadRage | Road Rage record |  |
| 0x660B4 | 0x4 |  |  | Padding |  |
| 0x660B8 | 0x8 | BitArray<35u> | mSeenTrophyAwardBitArray | Tracks which of the primary 35 vehicles unlocks have been shown |  |
| 0x660C0 | 0x8 | BitArray<60u> | mAchievementsEarnt | Tracks which Paradise Awards have been earned |  |
| 0x660C8 | 0x1 | bool | mb100PercentCompletionSequenceShown | Tracks whether the 100% completion animation has been shown |  |
| 0x660C9 | 0x1 | bool | mbIsNewProfile | Tracks whether the profile is new | Intro will be shown if true |
| 0x660CA | 0x1 | bool | mbCreditsSequenceViewed | Tracks whether the credits have been shown |  |
| 0x660CB | 0x1 | bool | mbOneHundredHudMessageViewed | Tracks whether the 100% completion message has been shown |  |
| 0x660CC | 0x1 | bool | mbHasUnlockedCredits | Tracks whether credits are available for viewing |  |
| 0x660CD | 0x1 | bool | mbHaveSet100PercentCompletedDate | Tracks whether the 100% completion date is present |  |
| 0x660CE | 0x1 | bool | mbHaveSeenEliteCompletionSequence | Tracks whether the Elite license animation has been shown |  |
| 0x660CF | 0x1 | bool | mbRedundantBool4 |  | Unused in the final game |
| 0x660D0 | 0x1 | int8_t | miPad1 |  | Unused in the final game |
| 0x660D1 | 0x1 |  |  | Padding |  |
| 0x660D2 | 0x2 | int16_t | miPad2 |  | Unused in the final game |
| 0x660D4 | 0x4 |  |  | Padding |  |
| 0x660D8 | 0x4 | uint32_t | muRoadRulesIDLowBits |  |  |
| 0x660DC | 0x4 |  |  | Padding |  |
| 0x660E0 | 0x8 | BitArray<6u> | mSeenCompleteAllEventTypeArray | Tracks which event types have had all events completed |  |
| 0x660E8 | 0x4 | float32_t | mfRealTimePlayed | Total time played | As opposed to mfInCarTimePlayed |
| 0x660EC | 0x4 | float32_t | mfRedundantFloat4 |  | Unused in the final game |
| 0x660F0 | 0x4 | uint32_t | muRoadRulesIDHighBits |  |  |
| 0x660F4 | 0x1 | bool | ? | License agreement 1 |  |
| 0x660F5 | 0x1 | bool | ? | License agreement 2 |  |
| 0x660F6 | 0x1 | int8_t | miPad4 |  | Unused in the final game |
| 0x660F7 | 0x9 |  |  | Padding |  |

#### PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number of the Profile structure | 31 |
| 0x4 | 0x20 | char[32] | macName | Player-chosen profile name | Unused in the final game |
| 0x24 | 0xC |  |  | Padding |  |
| 0x30 | 0x10 | Vector3 | mCarPosition | Spawn position of the player vehicle | Unused in the final game |
| 0x40 | 0x10 | Vector3 | mCarDirection | Spawn direction of the player vehicle | Unused in the final game |
| 0x50 | 0x8 | CgsID | mSpawnCarId | The vehicle the player spawns in | Deprecated in V1.3 |
| 0x58 | 0x8 | CgsID | mSpawnWheelId | The wheel the player vehicle spawns with | Unused in the final game |
| 0x60 | 0x4 | uint32_t | muTimeStampOfLastRoadRulesDownload |  |  |
| 0x64 | 0x4 | float32_t | mfDistanceDrivenOnline | Distance driven online in cars (meters) | Subject to distance limitations |
| 0x68 | 0x4 | float32_t | mfDistanceDrivenOffline | Distance driven offline in cars (meters) | Subject to distance limitations |
| 0x6C | 0x4 | float32_t | mfInCarTimePlayed | Total time spent driving | Subject to time limitations |
| 0x70 | 0x1 | int8_t | mi8CurrentProgressionRank | Current license of the player | See ranks |
| 0x71 | 0x1 | int8_t | mi8PowerParkingBestRating | Power Parking record |  |
| 0x72 | 0x1 | int8_t | mi8PowerParkingBetweenOtherPlayersBestRating | Power Parking between players record | Not displayed in the final game |
| 0x73 | 0x1 |  |  | Padding |  |
| 0x74 | 0x4 | uint32_t | muBestNewBurnoutChainScore | Burnout chain record |  |
| 0x78 | 0x44 | int32_t[17] | maGameModeTypeAmount | Number of events present, per type | See EGameModeType |
| 0xBC | 0x44 | int32_t[17] | maGameModeTypeAmountDiscovered | Number of events discovered, per type | See EGameModeType |
| 0x100 | 0x44 | int32_t[17] | maGameModeTypeAmountCompleted | Number of events completed for the current license, per type | See EGameModeType |
| 0x144 | 0x44 | int32_t[17] | maGameModeTypeAmountCompletedSinceTheStart | Total number of events completed, per type | See EGameModeType |
| 0x188 | 0x4 | int32_t | miTotalTakedownCount | Number of takedowns performed |  |
| 0x18C | 0x4 | int32_t | miTotalOnlineVerticleTakedownCount | Number of vertical takedowns performed |  |
| 0x190 | 0x34 | int32_t[13] | maiTakedownTypeCounts | Number of takedowns performed, per type | See ETakedownType |
| 0x1C4 | 0x28 | int32_t[10] | maiWinsPerOfflineGameMode | Number of events won, per type | See EGameModeType |
| 0x1EC | 0x28 | int32_t[10] | maiRankWinsPerOfflineGameMode | Number of events won causing a license upgrade, per type | See EGameModeType |
| 0x214 | 0x28 | int32_t[10] | maiLossesPerOfflineGameMode | Number of events lost, per type |  |
| 0x23C | 0x4 | int32_t | miCompletedBarrelRolls | Barrel roll record |  |
| 0x240 | 0x4 | float32_t | mfCompletedAirSpinAngle | Flat spin record |  |
| 0x244 | 0x4 | float32_t | mfCompletedHandbreakTurnAngle | Handbrake turn record | Not displayed in the final game |
| 0x248 | 0x4 | float32_t | mfCompletedDriftDistance | Drift record |  |
| 0x24C | 0x4 | float32_t | mfOncomingDistance | Oncoming record |  |
| 0x250 | 0x4 | float32_t | mfAirMaximum | Air time record |  |
| 0x254 | 0x4 | int32_t | miHighestShowTimeScore | Showtime record |  |
| 0x258 | 0x4 | int32_t | miBestStuntRunScore | Stunt run record | Deprecated in game version 1.3 |
| 0x25C | 0x4 | int32_t | miCarCount | Number of vehicle entries |  |
| 0x260 | 0x4 | int32_t | miLiveryDataCount | Number of livery entries |  |
| 0x264 | 0x4 | int32_t | miRivalCount | Number of rival entries |  |
| 0x268 | 0x4 | int32_t | miEventCount | Number of event entries |  |
| 0x26C | 0x4 |  |  | Padding |  |
| 0x270 | 0x3000 | CarData[512] | maCars | Vehicle unlocks, colors, and damage |  |
| 0x3270 | 0x3000 | LiveryData[512] | maLiveryChoices | Selected finishes and mileage |  |
| 0x6270 | 0xE00 | RivalData[64] | maRivals | Roaming rival/shutdown car info |  |
| 0x7070 | 0x578 | ProfileEvent[175] | maEvents | Event completion states |  |
| 0x75E8 | 0x3018 | Set<CgsID, 512u>[3] | maStuntElements | Collectible completion states | See EStuntType |
| 0xA600 | 0x4 | uint32_t | muMedalCountFromTheStart | Total number of events won |  |
| 0xA604 | 0x1 | bool | mbGoldCarsUnlocked | Tracks whether gold finishes are unlocked |  |
| 0xA605 | 0x1 | bool | mbSilverCarsUnlocked | Tracks whether platinum finishes are unlocked |  |
| 0xA606 | 0x2 |  |  | Padding |  |
| 0xA608 | 0x30 | Set<CgsID, 5u> | mJunkYardsDriveThruSet | Discovered Junkyards |  |
| 0xA638 | 0x60 | Set<CgsID, 11u> | mBodyShopsDriveThruSet | Discovered Auto Repairs |  |
| 0xA698 | 0x30 | Set<CgsID, 5u> | mPaintShopsDriveThruSet | Discovered Paint Shops |  |
| 0xA6C8 | 0x78 | Set<CgsID, 14u> | mGasStationsDriveThruSet | Discovered Gas Stations |  |
| 0xA740 | 0x60 | Set<CgsID, 11u> | mCarParksDriveThruSet | Discovered Car Parks |  |
| 0xA7A0 | 0x3E88 | Array<CgsID, 2000u> | maFreeBurnChallengeData | Completed Freeburn and Timed Challenges |  |
| 0xE628 | 0x9280 | HitPropsBitArray | mabHitPropBitArray | Smashed billboards and individual gate sections | 500 TRK units, 600 prop hit indicators (bits) each. Not all TRKs are used |
| 0x178A8 | 0x1E | int16_t[3][5] | maaiStuntCountsByCounty | Collectible progression, per-county | See EStuntType and counties |
| 0x178C6 | 0x2 |  |  | Padding |  |
| 0x178C8 | 0x1400 | ChallengeHighScoreEntry[64] | maNetworkChallengeData | Online mainland car Time/Showtime Road Rule scores and player names |  |
| 0x18CC8 | 0xA00 | ChallengePlayerScoreEntry[64] | maChallengeData | Player mainland car Time/Showtime Road Rule scores and vehicles |  |
| 0x196C8 | 0x4 | uint32_t | muLastRoadRulesResetTime |  |  |
| 0x196CC | 0x1C | NetworkTexture | mPlayerLicencePicture | License picture header |  |
| 0x196E8 | 0x4B000 | char[38400][8] | macPlayerLicenceTextureData | License picture data | Only first is used |
| 0x646E8 | 0x1 | bool | mbPlayerLicencePictureIsValid | Tracks whether the license picture is present |  |
| 0x646E9 | 0x3 |  |  | Padding |  |
| 0x646EC | 0x15F4 | Array<MugshotInfo, 20u>[5] | maaMugshotInfo | Information on saved mugshots | Not padded after length |
| 0x65CE0 | 0x28 | BitArray<20u>[5] | maAvailableMugshotFileIDs | Tracks what mugshot slots are used |  |
| 0x65D08 | 0xC | float32_t[3] | mafCarTypes |  | Unused in the final game |
| 0x65D14 | 0x4 | ECarType | meCurrentCarType | Boost type of the current vehicle | See ECarType |
| 0x65D18 | 0x20 | BitArray<256u> | maHasPlayerSeenTraining | Tracks the tips DJ Atomika has used |  |
| 0x65D38 | 0x4 | int32_t | miNumOnlineRacesDone | Number of online races completed |  |
| 0x65D3C | 0x4 | int32_t | miNumOnlineRacesWon | Number of online races won |  |
| 0x65D40 | 0x4 | int32_t | miNumMugshotsSent | Number of mugshots sent by the player |  |
| 0x65D44 | 0xC | DateAndTime | mDateLicenceIssued | Date the player's license was created |  |
| 0x65D50 | 0xC | DateAndTime | mDate100PercentCompleted | Date the player achieved 100% completion |  |
| 0x65D5C | 0x4 | int32_t | miHighestNumberOfTakeDownsInRoadRage | Road Rage record |  |
| 0x65D60 | 0x8 | BitArray<35u> | mSeenTrophyAwardBitArray | Tracks which of the primary 35 vehicles unlocks have been shown |  |
| 0x65D68 | 0x8 | BitArray<60u> | mAchievementsEarnt | Tracks which Paradise Awards have been earned |  |
| 0x65D70 | 0x1 | bool | mb100PercentCompletionSequenceShown | Tracks whether the 100% completion animation has been shown |  |
| 0x65D71 | 0x1 | bool | mbIsNewProfile | Tracks whether the profile is new | Intro will be shown if true |
| 0x65D72 | 0x1 | bool | mbCreditsSequenceViewed | Tracks whether the credits have been shown |  |
| 0x65D73 | 0x1 | bool | mbOneHundredHudMessageViewed | Tracks whether the 100% completion message has been shown |  |
| 0x65D74 | 0x1 | bool | mbHasUnlockedCredits | Tracks whether credits are available for viewing |  |
| 0x65D75 | 0x1 | bool | mbHaveSet100PercentCompletedDate | Tracks whether the 100% completion date is present |  |
| 0x65D76 | 0x1 | bool | mbHaveSeenEliteCompletionSequence | Tracks whether the Elite license animation has been shown |  |
| 0x65D77 | 0x1 | bool | mbRedundantBool4 |  | Unused in the final game |
| 0x65D78 | 0x1 | int8_t | miPad1 |  | Unused in the final game |
| 0x65D79 | 0x1 |  |  | Padding |  |
| 0x65D7A | 0x2 | int16_t | miPad2 |  | Unused in the final game |
| 0x65D7C | 0x4 |  |  | Padding |  |
| 0x65D80 | 0x4 | uint32_t | muRoadRulesIDLowBits |  |  |
| 0x65D84 | 0x4 |  |  | Padding |  |
| 0x65D88 | 0x8 | BitArray<6u> | mSeenCompleteAllEventTypeArray | Tracks which event types have had all events completed |  |
| 0x65D90 | 0x4 | float32_t | mfRealTimePlayed | Total time played | As opposed to mfInCarTimePlayed |
| 0x65D94 | 0x4 | float32_t | mfRedundantFloat4 |  | Unused in the final game |
| 0x65D98 | 0x4 | uint32_t | muRoadRulesIDHighBits |  |  |
| 0x65D9C | 0x2 | int16_t | miPad3 |  | Unused in the final game |
| 0x65D9E | 0x1 | int8_t | miPad4 |  | Unused in the final game |
| 0x65D9F | 0x1 |  |  | Padding |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number of the Profile structure | 31 |
| 0x4 | 0x20 | char[32] | macName | Player-chosen profile name | Unused in the final game |
| 0x24 | 0xC |  |  | Padding |  |
| 0x30 | 0x10 | Vector3 | mCarPosition | Spawn position of the player vehicle | Unused in the final game |
| 0x40 | 0x10 | Vector3 | mCarDirection | Spawn direction of the player vehicle | Unused in the final game |
| 0x50 | 0x8 | CgsID | mSpawnCarId | The vehicle the player spawns in | Deprecated in V1.3 |
| 0x58 | 0x8 | CgsID | mSpawnWheelId | The wheel the player vehicle spawns with | Unused in the final game |
| 0x60 | 0x4 | uint32_t | muTimeStampOfLastRoadRulesDownload |  |  |
| 0x64 | 0x4 | float32_t | mfDistanceDrivenOnline | Distance driven online in cars (meters) | Subject to distance limitations |
| 0x68 | 0x4 | float32_t | mfDistanceDrivenOffline | Distance driven offline in cars (meters) | Subject to distance limitations |
| 0x6C | 0x4 | float32_t | mfInCarTimePlayed | Total time spent driving | Subject to time limitations |
| 0x70 | 0x1 | int8_t | mi8CurrentProgressionRank | Current license of the player | See ranks |
| 0x71 | 0x1 | int8_t | mi8PowerParkingBestRating | Power Parking record |  |
| 0x72 | 0x1 | int8_t | mi8PowerParkingBetweenOtherPlayersBestRating | Power Parking between players record | Not displayed in the final game |
| 0x73 | 0x1 |  |  | Padding |  |
| 0x74 | 0x4 | uint32_t | muBestNewBurnoutChainScore | Burnout chain record |  |
| 0x78 | 0x44 | int32_t[17] | maGameModeTypeAmount | Number of events present, per type | See EGameModeType |
| 0xBC | 0x44 | int32_t[17] | maGameModeTypeAmountDiscovered | Number of events discovered, per type | See EGameModeType |
| 0x100 | 0x44 | int32_t[17] | maGameModeTypeAmountCompleted | Number of events completed for the current license, per type | See EGameModeType |
| 0x144 | 0x44 | int32_t[17] | maGameModeTypeAmountCompletedSinceTheStart | Total number of events completed, per type | See EGameModeType |
| 0x188 | 0x4 | int32_t | miTotalTakedownCount | Number of takedowns performed |  |
| 0x18C | 0x4 | int32_t | miTotalOnlineVerticleTakedownCount | Number of vertical takedowns performed |  |
| 0x190 | 0x34 | int32_t[13] | maiTakedownTypeCounts | Number of takedowns performed, per type | See ETakedownType |
| 0x1C4 | 0x28 | int32_t[10] | maiWinsPerOfflineGameMode | Number of events won, per type | See EGameModeType |
| 0x1EC | 0x28 | int32_t[10] | maiRankWinsPerOfflineGameMode | Number of events won causing a license upgrade, per type | See EGameModeType |
| 0x214 | 0x28 | int32_t[10] | maiLossesPerOfflineGameMode | Number of events lost, per type |  |
| 0x23C | 0x4 | int32_t | miCompletedBarrelRolls | Barrel roll record |  |
| 0x240 | 0x4 | float32_t | mfCompletedAirSpinAngle | Flat spin record |  |
| 0x244 | 0x4 | float32_t | mfCompletedHandbreakTurnAngle | Handbrake turn record | Not displayed in the final game |
| 0x248 | 0x4 | float32_t | mfCompletedDriftDistance | Drift record |  |
| 0x24C | 0x4 | float32_t | mfOncomingDistance | Oncoming record |  |
| 0x250 | 0x4 | float32_t | mfAirMaximum | Air time record |  |
| 0x254 | 0x4 | int32_t | miHighestShowTimeScore | Showtime record |  |
| 0x258 | 0x4 | int32_t | miBestStuntRunScore | Stunt run record | Deprecated in game version 1.3 |
| 0x25C | 0x4 | int32_t | miCarCount | Number of vehicle entries |  |
| 0x260 | 0x4 | int32_t | miLiveryDataCount | Number of livery entries |  |
| 0x264 | 0x4 | int32_t | miRivalCount | Number of rival entries |  |
| 0x268 | 0x4 | int32_t | miEventCount | Number of event entries |  |
| 0x26C | 0x4 |  |  | Padding |  |
| 0x270 | 0x3000 | CarData[512] | maCars | Vehicle unlocks, colors, and damage |  |
| 0x3270 | 0x3000 | LiveryData[512] | maLiveryChoices | Selected finishes and mileage |  |
| 0x6270 | 0xE00 | RivalData[64] | maRivals | Roaming rival/shutdown car info |  |
| 0x7070 | 0x578 | ProfileEvent[175] | maEvents | Event completion states |  |
| 0x75E8 | 0x3018 | Set<CgsID, 512u>[3] | maStuntElements | Collectible completion states | See EStuntType |
| 0xA600 | 0x4 | uint32_t | muMedalCountFromTheStart | Total number of events won |  |
| 0xA604 | 0x1 | bool | mbGoldCarsUnlocked | Tracks whether gold finishes are unlocked |  |
| 0xA605 | 0x1 | bool | mbSilverCarsUnlocked | Tracks whether platinum finishes are unlocked |  |
| 0xA606 | 0x2 |  |  | Padding |  |
| 0xA608 | 0x30 | Set<CgsID, 5u> | mJunkYardsDriveThruSet | Discovered Junkyards |  |
| 0xA638 | 0x60 | Set<CgsID, 11u> | mBodyShopsDriveThruSet | Discovered Auto Repairs |  |
| 0xA698 | 0x30 | Set<CgsID, 5u> | mPaintShopsDriveThruSet | Discovered Paint Shops |  |
| 0xA6C8 | 0x78 | Set<CgsID, 14u> | mGasStationsDriveThruSet | Discovered Gas Stations |  |
| 0xA740 | 0x60 | Set<CgsID, 11u> | mCarParksDriveThruSet | Discovered Car Parks |  |
| 0xA7A0 | 0x3E88 | Array<CgsID, 2000u> | maFreeBurnChallengeData | Completed Freeburn and Timed Challenges |  |
| 0xE628 | 0x9280 | HitPropsBitArray | mabHitPropBitArray | Smashed billboards and individual gate sections | 500 TRK units, 600 prop hit indicators (bits) each. Not all TRKs are used |
| 0x178A8 | 0x1E | int16_t[3][5] | maaiStuntCountsByCounty | Collectible progression, per-county | See EStuntType and counties |
| 0x178C6 | 0x2 |  |  | Padding |  |
| 0x178C8 | 0x1800 | ChallengeHighScoreEntry[64] | maNetworkChallengeData | Online mainland car Time/Showtime Road Rule scores and player names |  |
| 0x190C8 | 0xA00 | ChallengePlayerScoreEntry[64] | maChallengeData | Player mainland car Time/Showtime Road Rule scores and vehicles |  |
| 0x19AC8 | 0x4 | uint32_t | muLastRoadRulesResetTime |  |  |
| 0x19ACC | 0x4 |  |  | Padding |  |
| 0x19AD0 | 0x28 | NetworkTexture | mPlayerLicencePicture | License picture header |  |
| 0x19AF8 | 0x4B000 | char[38400][8] | macPlayerLicenceTextureData | License picture data | Only first is used |
| 0x64AF8 | 0x1 | bool | mbPlayerLicencePictureIsValid | Tracks whether the license picture is present |  |
| 0x64AF9 | 0x7 |  |  | Padding |  |
| 0x64B00 | 0x1C48 | Array<MugshotInfo, 20u>[5] | maaMugshotInfo | Information on saved mugshots |  |
| 0x66748 | 0x28 | BitArray<20u>[5] | maAvailableMugshotFileIDs | Tracks what mugshot slots are used |  |
| 0x66770 | 0xC | float32_t[3] | mafCarTypes |  | Unused in the final game |
| 0x6677C | 0x4 | ECarType | meCurrentCarType | Boost type of the current vehicle | See ECarType |
| 0x66780 | 0x20 | BitArray<256u> | maHasPlayerSeenTraining | Tracks the tips DJ Atomika has used |  |
| 0x667A0 | 0x4 | int32_t | miNumOnlineRacesDone | Number of online races completed |  |
| 0x667A4 | 0x4 | int32_t | miNumOnlineRacesWon | Number of online races won |  |
| 0x667A8 | 0x4 | int32_t | miNumMugshotsSent | Number of mugshots sent by the player |  |
| 0x667AC | 0x4 |  |  | Padding |  |
| 0x667B0 | 0x10 | DateAndTime | mDateLicenceIssued | Date the player's license was created |  |
| 0x667C0 | 0x10 | DateAndTime | mDate100PercentCompleted | Date the player achieved 100% completion |  |
| 0x667D0 | 0x4 | int32_t | miHighestNumberOfTakeDownsInRoadRage | Road Rage record |  |
| 0x667D4 | 0x4 |  |  | Padding |  |
| 0x667D8 | 0x8 | BitArray<35u> | mSeenTrophyAwardBitArray | Tracks which of the primary 35 vehicles unlocks have been shown |  |
| 0x667E0 | 0x8 | BitArray<60u> | mAchievementsEarnt | Tracks which Paradise Awards have been earned |  |
| 0x667E8 | 0x1 | bool | mb100PercentCompletionSequenceShown | Tracks whether the 100% completion animation has been shown |  |
| 0x667E9 | 0x1 | bool | mbIsNewProfile | Tracks whether the profile is new | Intro will be shown if true |
| 0x667EA | 0x1 | bool | mbCreditsSequenceViewed | Tracks whether the credits have been shown |  |
| 0x667EB | 0x1 | bool | mbOneHundredHudMessageViewed | Tracks whether the 100% completion message has been shown |  |
| 0x667EC | 0x1 | bool | mbHasUnlockedCredits | Tracks whether credits are available for viewing |  |
| 0x667ED | 0x1 | bool | mbHaveSet100PercentCompletedDate | Tracks whether the 100% completion date is present |  |
| 0x667EE | 0x1 | bool | mbHaveSeenEliteCompletionSequence | Tracks whether the Elite license animation has been shown |  |
| 0x667EF | 0x1 | bool | mbRedundantBool4 |  | Unused in the final game |
| 0x667F0 | 0x1 | int8_t | miPad1 |  | Unused in the final game |
| 0x667F1 | 0x1 |  |  | Padding |  |
| 0x667F2 | 0x2 | int16_t | miPad2 |  | Unused in the final game |
| 0x667F4 | 0x4 |  |  | Padding |  |
| 0x667F8 | 0x4 | uint32_t | muRoadRulesIDLowBits |  |  |
| 0x667FC | 0x4 |  |  | Padding |  |
| 0x66800 | 0x8 | BitArray<6u> | mSeenCompleteAllEventTypeArray | Tracks which event types have had all events completed |  |
| 0x66808 | 0x4 | float32_t | mfRealTimePlayed | Total time played | As opposed to mfInCarTimePlayed |
| 0x6680C | 0x4 | float32_t | mfRedundantFloat4 |  | Unused in the final game |
| 0x66810 | 0x4 | uint32_t | muRoadRulesIDHighBits |  |  |
| 0x66814 | 0x2 | int16_t | miPad3 |  | Unused in the final game |
| 0x66816 | 0x1 | int8_t | miPad4 |  | Unused in the final game |
| 0x66817 | 0x9 |  |  | Padding |  |

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
| 0x15 | 0x3 |  |  | Padding |  |

### BrnProgression::RivalData

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x8 | CgsID | mRivalId |  | GameDB ID |
| 0x8 | 0x8 | CgsID | mCarId |  |  |
| 0x10 | 0x4 | EState | meState |  |  |
| 0x14 | 0x4 | int32_t | miEventCount |  |  |
| 0x18 | 0x4 | int32_t | miTakedownFromCount |  |  |
| 0x1C | 0x4 | int32_t | miVerticalTakedownFromCount |  |  |
| 0x20 | 0x4 | int32_t | miTakedownToCount |  |  |
| 0x24 | 0x4 | int32_t | miVerticalTakedownToCount |  |  |
| 0x28 | 0x4 | int32_t | miTakedownToInEventCount |  |  |
| 0x2C | 0x4 | int32_t | miTakedownToInLastEventCount |  |  |
| 0x30 | 0x4 | int32_t | miEventMissingCount |  |  |
| 0x34 | 0x1 | bool | mbHasBeenHit |  |  |
| 0x35 | 0x3 |  |  | Padding |  |

### BrnProgression::ProfileEvent

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | uint32_t | muEventID | Event junction ID |  |
| 0x4 | 0x2 | uint16_t | muFlags | Event flags | See Flags |
| 0x6 | 0x2 |  |  | Padding |  |

### BrnStreetData::ChallengeHighScoreEntry

#### PlayStation 3, PC

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

### BrnStreetData::ChallengePlayerScoreEntry

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x18 | ChallengeData | super_ChallengeData |  |  |
| 0x18 | 0x10 | CgsID[2] | maCarIDs |  | See ScoreType for index names |

### CgsNetwork::NetworkTexture

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | HeapMalloc* | mpHeapMalloc |  |  |
| 0x4 | 0x4 | int32_t | miBitsPerPixel |  |  |
| 0x8 | 0x4 | int32_t | miWidth |  |  |
| 0xC | 0x4 | int32_t | miHeight |  |  |
| 0x10 | 0x4 | PixelFormat | mFormat |  |
| 0x14 | 0x4 | char* | mpcTexture |  |  |
| 0x18 | 0x1 | bool | mbTextureAllocatedFromHeap |  |  |
| 0x19 | 0x1 | bool | mbIsUncompressedYUV |  |  |
| 0x1A | 0x2 |  |  | Padding |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | HeapMalloc* | mpHeapMalloc |  |  |
| 0x4 | 0x4 | int32_t | miBitsPerPixel |  |  |
| 0x8 | 0x4 | int32_t | miWidth |  |  |
| 0xC | 0x4 | int32_t | miHeight |  |  |
| 0x10 | 0x4 | Parameters | mFormat |  |
| 0x14 | 0x4 | char* | mpcTexture |  |  |
| 0x18 | 0x1 | bool | mbTextureAllocatedFromHeap |  |  |
| 0x19 | 0x1 | bool | mbIsUncompressedYUV |  |  |
| 0x1A | 0x2 |  |  | Padding |  |

#### Parameters

Parameters for the MAKED3DFMT2 macro. Xbox 360 only.

| Offset (bits) | Length (bits) | Name | Description | Comments |
| --- | --- | --- | --- | --- |
| 0 | 2 |  | Padding |  |
| 2 | 3 | SwizzleW |  | See GPUSWIZZLE on the Xbox 360 texture page. |
| 5 | 3 | SwizzleZ |  | See GPUSWIZZLE on the Xbox 360 texture page. |
| 8 | 3 | SwizzleY |  | See GPUSWIZZLE on the Xbox 360 texture page. |
| 11 | 3 | SwizzleX |  | See GPUSWIZZLE on the Xbox 360 texture page. |
| 14 | 1 | NumFormat |  | See GPUNUMFORMAT on the Xbox 360 texture page. |
| 15 | 2 | TextureSignW |  | See GPUSIGN on the Xbox 360 texture page. |
| 17 | 2 | TextureSignZ |  | See GPUSIGN on the Xbox 360 texture page. |
| 19 | 2 | TextureSignY |  | See GPUSIGN on the Xbox 360 texture page. |
| 21 | 2 | TextureSignX |  | See GPUSIGN on the Xbox 360 texture page. |
| 23 | 1 | Tiled |  |  |
| 24 | 2 | Endian |  | See GPUENDIAN on the Xbox 360 texture page. |
| 26 | 6 | TextureFormat |  | See GPUTEXTUREFORMAT. |

#### PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | HeapMalloc* | mpHeapMalloc |  |  |
| 0x4 | 0x4 | int32_t | miBitsPerPixel |  |  |
| 0x8 | 0x4 | int32_t | miWidth |  |  |
| 0xC | 0x4 | int32_t | miHeight |  |  |
| 0x10 | 0x4 | D3DFORMAT | mFormat |  |
| 0x14 | 0x4 | char* | mpcTexture |  |  |
| 0x18 | 0x1 | bool | mbTextureAllocatedFromHeap |  |  |
| 0x19 | 0x1 | bool | mbIsUncompressedYUV |  |  |
| 0x1A | 0x2 |  |  | Padding |  |

#### PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | HeapMalloc* | mpHeapMalloc |  |  |
| 0x4 | 0x4 | int32_t | miBitsPerPixel |  |  |
| 0x8 | 0x4 | int32_t | miWidth |  |  |
| 0xC | 0x4 | int32_t | miHeight |  |  |
| 0x10 | 0x4 | DXGI_FORMAT | mFormat |  |
| 0x14 | 0x4 | char* | mpcTexture |  |  |
| 0x18 | 0x1 | bool | mbTextureAllocatedFromHeap |  |  |
| 0x19 | 0x1 | bool | mbIsUncompressedYUV |  |  |
| 0x1A | 0x2 |  |  | Padding |  |

#### PlayStation 4, Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x8 | HeapMalloc* | mpHeapMalloc |  |  |
| 0x8 | 0x4 | int32_t | miBitsPerPixel |  |  |
| 0xC | 0x4 | int32_t | miWidth |  |  |
| 0x10 | 0x4 | int32_t | miHeight |  |  |
| 0x14 | 0x4 | DXGI_FORMAT | mFormat |  |
| 0x18 | 0x8 | char* | mpcTexture |  |  |
| 0x20 | 0x1 | bool | mbTextureAllocatedFromHeap |  |  |
| 0x21 | 0x1 | bool | mbIsUncompressedYUV |  |  |
| 0x22 | 0x6 |  |  | Padding |  |

### BrnProgression::MugshotInfo

#### PlayStation 3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | UniquePlayerID | mUniquePlayerID |  |  |
| 0x14 | 0x4 |  |  | Padding |  |
| 0x18 | 0x10 | DateAndTime | mCaptureDate |  |  |
| 0x28 | 0x8 | WorldRegion | mWorldRegion |  |  |
| 0x30 | 0x4 | int32_t | miNumCaptures |  |  |
| 0x34 | 0x2 | uint16_t | mu16FileID |  |  |
| 0x36 | 0x1 | bool | mbLocked |  |  |
| 0x37 | 0x1 |  |  | Padding |  |

#### Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x18 | UniquePlayerID | mUniquePlayerID |  |  |
| 0x18 | 0xC | DateAndTime | mCaptureDate |  |  |
| 0x24 | 0x8 | WorldRegion | mWorldRegion |  |  |
| 0x2C | 0x4 | int32_t | miNumCaptures |  |  |
| 0x30 | 0x2 | uint16_t | mu16FileID |  |  |
| 0x32 | 0x1 | bool | mbLocked |  |  |
| 0x33 | 0x5 |  |  | Padding |  |

#### PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | UniquePlayerID | mUniquePlayerID |  |  |
| 0x14 | 0xC | DateAndTime | mCaptureDate |  |  |
| 0x20 | 0x8 | WorldRegion | mWorldRegion |  |  |
| 0x28 | 0x4 | int32_t | miNumCaptures |  |  |
| 0x2C | 0x2 | uint16_t | mu16FileID |  |  |
| 0x2E | 0x1 | bool | mbLocked |  |  |
| 0x2F | 0x1 |  |  | Padding |  |

#### PlayStation 4

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x19 | UniquePlayerID | mUniquePlayerID |  |  |
| 0x19 | 0x3 |  |  | Padding |  |
| 0x1C | 0x10 | DateAndTime | mCaptureDate |  |  |
| 0x2C | 0x8 | WorldRegion | mWorldRegion |  |  |
| 0x34 | 0x4 | int32_t | miNumCaptures |  |  |
| 0x38 | 0x2 | uint16_t | mu16FileID |  |  |
| 0x3A | 0x1 | bool | mbLocked |  |  |
| 0x3B | 0x5 |  |  | Padding |  |

#### PC (Remastered)

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x19 | UniquePlayerID | mUniquePlayerID |  |  |
| 0x19 | 0x3 |  |  | Padding |  |
| 0x1C | 0xC | DateAndTime | mCaptureDate |  |  |
| 0x28 | 0x8 | WorldRegion | mWorldRegion |  |  |
| 0x30 | 0x4 | int32_t | miNumCaptures |  |  |
| 0x34 | 0x2 | uint16_t | mu16FileID |  |  |
| 0x36 | 0x1 | bool | mbLocked |  |  |
| 0x37 | 0x1 |  |  | Padding |  |

#### Switch

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x21 | UniquePlayerID | mUniquePlayerID |  |  |
| 0x21 | 0x3 |  |  | Padding |  |
| 0x24 | 0x10 | DateAndTime | mCaptureDate |  |  |
| 0x34 | 0x8 | WorldRegion | mWorldRegion |  |  |
| 0x3C | 0x4 | int32_t | miNumCaptures |  |  |
| 0x40 | 0x2 | uint16_t | mu16FileID |  |  |
| 0x42 | 0x1 | bool | mbLocked |  |  |
| 0x43 | 0x5 |  |  | Padding |  |

### CgsNetwork::UniquePlayerIDPS3

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | PlayerName | mPlayerName | Player name |  |

### CgsNetwork::UniquePlayerIDX360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x10 | PlayerName | mPlayerName | Player name |  |
| 0x10 | 0x8 | int64_t | ? | XUID |  |

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

### BrnWorld::WorldRegion

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | ECounty | meCounty |  | See counties |
| 0x4 | 0x4 | EDistrict | meDistrict |  | See districts |

## Typedefs

### BrnProgression::Profile::HitPropsBitArray

| Name | Type | Length | Comments |
| --- | --- | --- | --- |
| HitPropsBitArray | BitArray<300000u> | 0x9280 |  |

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

## Enumerations

### Progression rank

| Name | Value | Comments |
| --- | --- | --- |
| ? | 0 | Learner's Permit |
| ? | 1 | D License |
| ? | 2 | C License |
| ? | 3 | B License |
| ? | 4 | A License |
| ? | 5 | Burnout License |
| ? | 6 | Elite License |

### BrnGameState::GameStateModuleIO::EGameModeType

| Name | Value | Comments |
| --- | --- | --- |
| E_MODE_NONE | -1 |  |
| E_MODE_OFFLINE_RACE | 0 |  |
| E_MODE_FACE_OFF | 1 |  |
| E_MODE_OFFLINE_SHOWTIME | 2 |  |
| E_MODE_ROAD_RAGE | 3 |  |
| E_MODE_PURSUIT | 4 |  |
| E_MODE_BURNING_ROUTE | 5 |  |
| E_MODE_ELIMINATOR | 6 |  |
| E_MODE_STUNT_ATTACK | 7 |  |
| E_MODE_MARKED_MAN | 8 |  |
| E_MODE_TRAFFIC_ATTACK | 9 |  |
| E_MODE_OFFLINE_COUNT | 10 |  |
| E_MODE_ONLINE_MODE_START | 10 |  |
| E_MODE_ONLINE_RACE | 10 |  |
| E_MODE_ONLINE_ROAD_RAGE | 11 |  |
| E_MODE_ONLINE_FUGITIVE | 12 |  |
| E_MODE_ONLINE_BURNING_HOME_RUN | 13 |  |
| E_MODE_ONLINE_FREE_BURN | 14 |  |
| E_MODE_ONLINE_FREE_BURN_LOBBY | 15 |  |
| E_MODE_ONLINE_SHOWTIME | 16 |  |
| E_MODE_ONLINE_MODE_END | 17 |  |
| E_MODE_COUNT | 17 |  |

### BrnGameState::ETakedownType

| Name | Value | Comments |
| --- | --- | --- |
| E_TAKEDOWN_NONE | -1 |  |
| E_TAKEDOWN_STANDARD | 0 |  |
| E_TAKEDOWN_GRINDING | 1 |  |
| E_TAKEDOWN_T_BONE | 2 |  |
| E_TAKEDOWN_VERTICAL | 3 |  |
| E_TAKEDOWN_TRAFFIC_CHECK | 4 |  |
| E_TAKEDOWN_HEAD_ON | 5 |  |
| E_TAKEDOWN_UNKNOWN0 | 6 |  |
| E_TAKEDOWN_UNKNOWN1 | 7 |  |
| E_TAKEDOWN_DOUBLE | 8 |  |
| E_TAKEDOWN_REVENGE | 9 |  |
| E_TAKEDOWN_INTO_CAR | 10 |  |
| E_TAKEDOWN_INTO_VAN | 11 |  |
| E_TAKEDOWN_INTO_BUS | 12 |  |
| E_TAKEDOWN_COUNT | 13 |  |

### BrnProgression::CarData::UnlockType

| Name | Value | Comments |
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

### BrnProgression::RivalData::EState

| Name | Value | Comments |
| --- | --- | --- |
| E_STATE_LOCKED | 0 |  |
| E_STATE_UNLOCKED | 1 | Roaming rival |
| E_STATE_FLEEING | 2 |  |
| E_STATE_BEATEN | 3 | Shut down |

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

### BrnGameState::EStuntType

| Name | Value | Comments |
| --- | --- | --- |
| E_STUNT_ELEMENT_TYPE_JUMP | 0 |  |
| E_STUNT_ELEMENT_TYPE_SMASH | 1 |  |
| E_STUNT_ELEMENT_TYPE_BILLBOARD | 2 |  |
| E_STUNT_ELEMENT_TYPE_COUNT | 3 |  |

### BrnStreetData::ScoreType

| Name | Value | Comments |
| --- | --- | --- |
| E_SCORE_TYPE_START | 0 |  |
| E_SCORE_TYPE_TIME | 0 |  |
| E_SCORE_TYPE_CRASH | 1 |  |
| E_SCORE_TYPE_COUNT | 2 |  |

### BrnResource::ECarType

| Name | Value | Comments |
| --- | --- | --- |
| E_CARTYPE_DANGER | 0 |  |
| E_CARTYPE_AGGRESSION | 1 |  |
| E_CARTYPE_STUNTS | 2 |  |
| E_CARTYPE_COUNT | 3 |  |
| E_CARTYPE_INVALID | 3 |  |
