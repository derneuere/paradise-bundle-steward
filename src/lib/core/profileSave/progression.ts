// BrnProgression::Profile layout — the largest and most interesting save chunk
// (license, vehicles, rivals, events, collectibles, Road Rules, records).
//
// This models the PC (Remastered) variant (miVersionNumber 31), which is the
// one we can validate against a real fixture. Other platforms share the early
// layout but diverge later (DateAndTime / PlayerName / texture sizes), so they
// are decoded opaquely until a fixture is available. The decode engine patches
// in place, so any field NOT modelled here (padding, the genuinely ambiguous
// mugshot region) is preserved byte-exact on save.
//
// Source: docs/save-profile/progression-profile.md.

import type { Field, StructSpec, StructRegistry } from './struct';

// --- enumerations ----------------------------------------------------------

export const PROGRESSION_RANK: Record<number, string> = {
	0: "Learner's Permit", 1: 'D License', 2: 'C License', 3: 'B License',
	4: 'A License', 5: 'Burnout License', 6: 'Elite License',
};

export const CAR_TYPE: Record<number, string> = {
	0: 'Danger', 1: 'Aggression', 2: 'Stunts', 3: 'Invalid',
};

export const UNLOCK_TYPE: Record<number, string> = {
	0: 'Unlocked at start', 1: 'Gift (finish / Burning Route)', 2: 'Trophy (carbon)',
	3: 'Shutdown rival', 4: 'Gold / platinum', 5: 'Sponsor', 6: 'Online only',
	7: 'Beat The Team', 8: 'PDLC', 9: 'Cop car', 10: 'Island gift', 11: 'Island unlock',
};

export const RIVAL_STATE: Record<number, string> = {
	0: 'Locked', 1: 'Unlocked (roaming)', 2: 'Fleeing', 3: 'Beaten (shut down)',
};

export const EVENT_FLAGS: Record<number, string> = {
	0x1: 'Discovered', 0x2: 'Finished', 0x4: 'Rank win', 0x8: 'Non-rank win',
	0x10: 'Won special event before', 0x20: 'Won event before',
};

// --- substructures ---------------------------------------------------------

const CarData: StructSpec = {
	name: 'CarData', size: 0x18,
	fields: [
		{ name: 'mId', offset: 0x0, kind: 'cgsid', label: 'Vehicle ID' },
		{ name: 'mu8ColourIndex', offset: 0x8, kind: 'u8', label: 'Colour index' },
		{ name: 'mu8PaletteIndex', offset: 0x9, kind: 'u8', label: 'Palette index' },
		{ name: 'mbUnlockSequenceAlreadyShown', offset: 0xa, kind: 'bool', label: 'Unlock shown' },
		{ name: 'mfUnlockDeformedAmount', offset: 0xc, kind: 'f32', label: 'Damage', note: 'Finish unlocked when 0' },
		{ name: 'meUnlockType', offset: 0x10, kind: 'enum', storage: 'u32', values: UNLOCK_TYPE, label: 'Unlock type' },
	],
};

const LiveryData: StructSpec = {
	name: 'LiveryData', size: 0x18,
	fields: [
		{ name: 'mBaseCarId', offset: 0x0, kind: 'cgsid', label: 'Base car ID' },
		{ name: 'mChosenLiveryCarId', offset: 0x8, kind: 'cgsid', label: 'Chosen livery car ID' },
		{ name: 'mfDistanceDriven', offset: 0x10, kind: 'f32', label: 'Distance driven' },
	],
};

const RivalData: StructSpec = {
	name: 'RivalData', size: 0x38,
	fields: [
		{ name: 'mRivalId', offset: 0x0, kind: 'cgsid', label: 'Rival ID (GameDB)' },
		{ name: 'mCarId', offset: 0x8, kind: 'cgsid', label: 'Car ID' },
		{ name: 'meState', offset: 0x10, kind: 'enum', storage: 'u32', values: RIVAL_STATE, label: 'State' },
		{ name: 'miEventCount', offset: 0x14, kind: 'i32', label: 'Event count' },
		{ name: 'miTakedownFromCount', offset: 0x18, kind: 'i32' },
		{ name: 'miVerticalTakedownFromCount', offset: 0x1c, kind: 'i32' },
		{ name: 'miTakedownToCount', offset: 0x20, kind: 'i32' },
		{ name: 'miVerticalTakedownToCount', offset: 0x24, kind: 'i32' },
		{ name: 'miTakedownToInEventCount', offset: 0x28, kind: 'i32' },
		{ name: 'miTakedownToInLastEventCount', offset: 0x2c, kind: 'i32' },
		{ name: 'miEventMissingCount', offset: 0x30, kind: 'i32' },
		{ name: 'mbHasBeenHit', offset: 0x34, kind: 'bool' },
	],
};

const ProfileEvent: StructSpec = {
	name: 'ProfileEvent', size: 0x8,
	fields: [
		{ name: 'muEventID', offset: 0x0, kind: 'u32', label: 'Event ID' },
		{ name: 'muFlags', offset: 0x4, kind: 'flags', storage: 'u16', bits: EVENT_FLAGS, label: 'Flags' },
	],
};

const ScoreList: StructSpec = {
	name: 'ScoreList', size: 0x8,
	fields: [
		{ name: 'maScores', offset: 0x0, kind: 'array', count: 2, stride: 4, element: { kind: 'i32' }, label: 'Scores (Time, Showtime)' },
	],
};

const ChallengeData: StructSpec = {
	name: 'ChallengeData', size: 0x18,
	fields: [
		{ name: 'mDirty', offset: 0x0, kind: 'bitset', bits: 2 },
		{ name: 'mValidScores', offset: 0x8, kind: 'bitset', bits: 2 },
		{ name: 'mScoreList', offset: 0x10, kind: 'struct', ref: 'ScoreList' },
	],
};

// PC (Remastered): PlayerName is char[25]; ChallengeHighScoreEntry is 0x50.
const PlayerName: StructSpec = {
	name: 'PlayerName', size: 0x19,
	fields: [{ name: 'macName', offset: 0x0, kind: 'ascii', len: 25, label: 'Player name' }],
};

const ChallengeHighScoreEntry: StructSpec = {
	name: 'ChallengeHighScoreEntry', size: 0x50,
	fields: [
		{ name: 'super_ChallengeData', offset: 0x0, kind: 'struct', ref: 'ChallengeData' },
		{ name: 'maPlayerNames', offset: 0x18, kind: 'array', count: 2, stride: 0x19, element: { kind: 'struct', ref: 'PlayerName' }, label: 'Top friend names' },
	],
};

const ChallengePlayerScoreEntry: StructSpec = {
	name: 'ChallengePlayerScoreEntry', size: 0x28,
	fields: [
		{ name: 'super_ChallengeData', offset: 0x0, kind: 'struct', ref: 'ChallengeData' },
		{ name: 'maCarIDs', offset: 0x18, kind: 'array', count: 2, stride: 8, element: { kind: 'cgsid' }, label: 'Cars used (Time, Showtime)' },
	],
};

// NetworkTexture (PC Remastered) — pointers are runtime-only; kept verbatim.
const NetworkTexture: StructSpec = {
	name: 'NetworkTexture', size: 0x1c,
	fields: [
		{ name: 'miBitsPerPixel', offset: 0x4, kind: 'i32', label: 'Bits/pixel' },
		{ name: 'miWidth', offset: 0x8, kind: 'i32', label: 'Width' },
		{ name: 'miHeight', offset: 0xc, kind: 'i32', label: 'Height' },
		{ name: 'mFormat', offset: 0x10, kind: 'u32', label: 'Format (DXGI)' },
		{ name: 'mbTextureAllocatedFromHeap', offset: 0x18, kind: 'bool' },
		{ name: 'mbIsUncompressedYUV', offset: 0x19, kind: 'bool' },
	],
};

// --- the Profile root (PC Remastered) --------------------------------------

const G = {
	id: 'Identity', rec: 'Records', cnt: 'Counters', veh: 'Vehicles', riv: 'Rivals',
	evt: 'Events', col: 'Collectibles', dis: 'Discovery', chl: 'Challenges',
	rr: 'Road Rules', lic: 'License', mug: 'Mugshots', flg: 'Flags', misc: 'Misc',
};

const intArray = (name: string, offset: number, count: number, group: string, label: string): Field =>
	({ name, offset, kind: 'array', count, stride: 4, element: { kind: 'i32' }, group, label });

const ProfilePCR: StructSpec = {
	name: 'Profile', size: 0x65da0,
	fields: [
		{ name: 'miVersionNumber', offset: 0x0, kind: 'i32', group: G.id, label: 'Version', note: '31 on PC Remastered' },
		{ name: 'macName', offset: 0x4, kind: 'ascii', len: 32, group: G.id, label: 'Profile name', note: 'Unused in the final game' },
		{ name: 'mSpawnCarId', offset: 0x50, kind: 'cgsid', group: G.misc, label: 'Spawn car ID', note: 'Deprecated in 1.3' },
		{ name: 'muTimeStampOfLastRoadRulesDownload', offset: 0x60, kind: 'u32', group: G.rr, label: 'Last Road Rules download' },
		{ name: 'mfDistanceDrivenOnline', offset: 0x64, kind: 'f32', group: G.cnt, label: 'Distance driven online (m)' },
		{ name: 'mfDistanceDrivenOffline', offset: 0x68, kind: 'f32', group: G.cnt, label: 'Distance driven offline (m)' },
		{ name: 'mfInCarTimePlayed', offset: 0x6c, kind: 'f32', group: G.cnt, label: 'In-car time played (s)' },
		{ name: 'mi8CurrentProgressionRank', offset: 0x70, kind: 'enum', storage: 'i8', values: PROGRESSION_RANK, group: G.id, label: 'License' },
		{ name: 'mi8PowerParkingBestRating', offset: 0x71, kind: 'i8', group: G.rec, label: 'Power Parking best' },
		{ name: 'muBestNewBurnoutChainScore', offset: 0x74, kind: 'u32', group: G.rec, label: 'Burnout chain record' },
		intArray('maGameModeTypeAmount', 0x78, 17, G.cnt, 'Events present per type'),
		intArray('maGameModeTypeAmountDiscovered', 0xbc, 17, G.cnt, 'Events discovered per type'),
		intArray('maGameModeTypeAmountCompleted', 0x100, 17, G.cnt, 'Events completed (this license) per type'),
		intArray('maGameModeTypeAmountCompletedSinceTheStart', 0x144, 17, G.cnt, 'Events completed total per type'),
		{ name: 'miTotalTakedownCount', offset: 0x188, kind: 'i32', group: G.cnt, label: 'Total takedowns' },
		{ name: 'miTotalOnlineVerticleTakedownCount', offset: 0x18c, kind: 'i32', group: G.cnt, label: 'Vertical takedowns' },
		intArray('maiTakedownTypeCounts', 0x190, 13, G.cnt, 'Takedowns per type'),
		intArray('maiWinsPerOfflineGameMode', 0x1c4, 10, G.cnt, 'Wins per offline mode'),
		intArray('maiRankWinsPerOfflineGameMode', 0x1ec, 10, G.cnt, 'Rank wins per offline mode'),
		intArray('maiLossesPerOfflineGameMode', 0x214, 10, G.cnt, 'Losses per offline mode'),
		{ name: 'miCompletedBarrelRolls', offset: 0x23c, kind: 'i32', group: G.rec, label: 'Barrel roll record' },
		{ name: 'mfCompletedAirSpinAngle', offset: 0x240, kind: 'f32', group: G.rec, label: 'Flat spin record' },
		{ name: 'mfCompletedDriftDistance', offset: 0x248, kind: 'f32', group: G.rec, label: 'Drift record' },
		{ name: 'mfOncomingDistance', offset: 0x24c, kind: 'f32', group: G.rec, label: 'Oncoming record' },
		{ name: 'mfAirMaximum', offset: 0x250, kind: 'f32', group: G.rec, label: 'Air time record' },
		{ name: 'miHighestShowTimeScore', offset: 0x254, kind: 'i32', group: G.rec, label: 'Showtime record' },
		{ name: 'miBestStuntRunScore', offset: 0x258, kind: 'i32', group: G.rec, label: 'Stunt Run record', note: 'Deprecated in 1.3' },
		{ name: 'miCarCount', offset: 0x25c, kind: 'i32', group: G.veh, label: 'Vehicle entry count' },
		{ name: 'miLiveryDataCount', offset: 0x260, kind: 'i32', group: G.veh, label: 'Livery entry count' },
		{ name: 'miRivalCount', offset: 0x264, kind: 'i32', group: G.riv, label: 'Rival entry count' },
		{ name: 'miEventCount', offset: 0x268, kind: 'i32', group: G.evt, label: 'Event entry count' },
		{ name: 'maCars', offset: 0x270, kind: 'array', count: 512, stride: 0x18, element: { kind: 'struct', ref: 'CarData' }, group: G.veh, label: 'Vehicles' },
		{ name: 'maLiveryChoices', offset: 0x3270, kind: 'array', count: 512, stride: 0x18, element: { kind: 'struct', ref: 'LiveryData' }, group: G.veh, label: 'Livery choices' },
		{ name: 'maRivals', offset: 0x6270, kind: 'array', count: 64, stride: 0x38, element: { kind: 'struct', ref: 'RivalData' }, group: G.riv, label: 'Rivals' },
		{ name: 'maEvents', offset: 0x7070, kind: 'array', count: 175, stride: 0x8, element: { kind: 'struct', ref: 'ProfileEvent' }, group: G.evt, label: 'Events' },
		{ name: 'maStuntElements', offset: 0x75e8, kind: 'array', count: 3, stride: 0x1008, element: { kind: 'cgsidset', capacity: 512 }, group: G.col, label: 'Collectibles (Jump, Smash, Billboard)' },
		{ name: 'muMedalCountFromTheStart', offset: 0xa600, kind: 'u32', group: G.cnt, label: 'Total events won' },
		{ name: 'mbGoldCarsUnlocked', offset: 0xa604, kind: 'bool', group: G.veh, label: 'Gold finishes unlocked' },
		{ name: 'mbSilverCarsUnlocked', offset: 0xa605, kind: 'bool', group: G.veh, label: 'Platinum finishes unlocked' },
		{ name: 'mJunkYardsDriveThruSet', offset: 0xa608, kind: 'cgsidset', capacity: 5, group: G.dis, label: 'Junkyards discovered' },
		{ name: 'mBodyShopsDriveThruSet', offset: 0xa638, kind: 'cgsidset', capacity: 11, group: G.dis, label: 'Auto Repairs discovered' },
		{ name: 'mPaintShopsDriveThruSet', offset: 0xa698, kind: 'cgsidset', capacity: 5, group: G.dis, label: 'Paint Shops discovered' },
		{ name: 'mGasStationsDriveThruSet', offset: 0xa6c8, kind: 'cgsidset', capacity: 14, group: G.dis, label: 'Gas Stations discovered' },
		{ name: 'mCarParksDriveThruSet', offset: 0xa740, kind: 'cgsidset', capacity: 11, group: G.dis, label: 'Car Parks discovered' },
		{ name: 'maFreeBurnChallengeData', offset: 0xa7a0, kind: 'cgsidarray', capacity: 2000, group: G.chl, label: 'Freeburn/Timed challenges completed' },
		{ name: 'mabHitPropBitArray', offset: 0xe628, kind: 'bytes', len: 0x9280, group: G.col, label: 'Smashed billboards/gates (bit array)' },
		{ name: 'maaiStuntCountsByCounty', offset: 0x178a8, kind: 'array', count: 15, stride: 2, element: { kind: 'i16' }, group: G.col, label: 'Collectible counts per county' },
		{ name: 'maNetworkChallengeData', offset: 0x178c8, kind: 'array', count: 64, stride: 0x50, element: { kind: 'struct', ref: 'ChallengeHighScoreEntry' }, group: G.rr, label: 'Online Road Rule scores' },
		{ name: 'maChallengeData', offset: 0x18cc8, kind: 'array', count: 64, stride: 0x28, element: { kind: 'struct', ref: 'ChallengePlayerScoreEntry' }, group: G.rr, label: 'Player Road Rule scores' },
		{ name: 'muLastRoadRulesResetTime', offset: 0x196c8, kind: 'u32', group: G.rr, label: 'Last Road Rules reset' },
		{ name: 'mPlayerLicencePicture', offset: 0x196cc, kind: 'struct', ref: 'NetworkTexture', group: G.lic, label: 'License picture header' },
		{ name: 'macPlayerLicenceTextureData', offset: 0x196e8, kind: 'bytes', len: 0x4b000, group: G.lic, label: 'License picture data' },
		{ name: 'mbPlayerLicencePictureIsValid', offset: 0x646e8, kind: 'bool', group: G.lic, label: 'License picture present' },
		{ name: 'maaMugshotInfo', offset: 0x646ec, kind: 'bytes', len: 0x15f4, group: G.mug, label: 'Mugshot info (raw)' },
		{ name: 'maAvailableMugshotFileIDs', offset: 0x65ce0, kind: 'bytes', len: 0x28, group: G.mug, label: 'Mugshot slots used (raw)' },
		{ name: 'meCurrentCarType', offset: 0x65d14, kind: 'enum', storage: 'u32', values: CAR_TYPE, group: G.misc, label: 'Current boost type' },
		{ name: 'maHasPlayerSeenTraining', offset: 0x65d18, kind: 'bitset', bits: 256, group: G.flg, label: 'DJ tips seen' },
		{ name: 'miNumOnlineRacesDone', offset: 0x65d38, kind: 'i32', group: G.cnt, label: 'Online races done' },
		{ name: 'miNumOnlineRacesWon', offset: 0x65d3c, kind: 'i32', group: G.cnt, label: 'Online races won' },
		{ name: 'miNumMugshotsSent', offset: 0x65d40, kind: 'i32', group: G.cnt, label: 'Mugshots sent' },
		{ name: 'mDateLicenceIssued', offset: 0x65d44, kind: 'datetime', size: 0xc, group: G.id, label: 'License issued' },
		{ name: 'mDate100PercentCompleted', offset: 0x65d50, kind: 'datetime', size: 0xc, group: G.id, label: '100% completed' },
		{ name: 'miHighestNumberOfTakeDownsInRoadRage', offset: 0x65d5c, kind: 'i32', group: G.rec, label: 'Road Rage record' },
		{ name: 'mSeenTrophyAwardBitArray', offset: 0x65d60, kind: 'bitset', bits: 35, group: G.flg, label: 'Vehicle unlock trophies seen' },
		{ name: 'mAchievementsEarnt', offset: 0x65d68, kind: 'bitset', bits: 60, group: G.flg, label: 'Paradise Awards earned' },
		{ name: 'mb100PercentCompletionSequenceShown', offset: 0x65d70, kind: 'bool', group: G.flg, label: '100% sequence shown' },
		{ name: 'mbIsNewProfile', offset: 0x65d71, kind: 'bool', group: G.flg, label: 'Is new profile', note: 'Intro plays if true' },
		{ name: 'mbCreditsSequenceViewed', offset: 0x65d72, kind: 'bool', group: G.flg, label: 'Credits viewed' },
		{ name: 'mbOneHundredHudMessageViewed', offset: 0x65d73, kind: 'bool', group: G.flg, label: '100% HUD message viewed' },
		{ name: 'mbHasUnlockedCredits', offset: 0x65d74, kind: 'bool', group: G.flg, label: 'Credits unlocked' },
		{ name: 'mbHaveSet100PercentCompletedDate', offset: 0x65d75, kind: 'bool', group: G.flg, label: '100% date set' },
		{ name: 'mbHaveSeenEliteCompletionSequence', offset: 0x65d76, kind: 'bool', group: G.flg, label: 'Elite sequence seen' },
		{ name: 'muRoadRulesIDLowBits', offset: 0x65d80, kind: 'u32', group: G.rr, label: 'Road Rules ID (low)' },
		{ name: 'mSeenCompleteAllEventTypeArray', offset: 0x65d88, kind: 'bitset', bits: 6, group: G.flg, label: 'All-events-of-type seen' },
		{ name: 'mfRealTimePlayed', offset: 0x65d90, kind: 'f32', group: G.cnt, label: 'Real time played (s)' },
		{ name: 'muRoadRulesIDHighBits', offset: 0x65d98, kind: 'u32', group: G.rr, label: 'Road Rules ID (high)' },
	],
};

export const PROGRESSION_REGISTRY: StructRegistry = {
	CarData, LiveryData, RivalData, ProfileEvent, ScoreList, ChallengeData,
	PlayerName, ChallengeHighScoreEntry, ChallengePlayerScoreEntry, NetworkTexture,
	Profile: ProfilePCR,
};

/** Returns the Progression StructSpec for a variant, or null if not modelled. */
export function progressionSpec(variantId: string): StructSpec | null {
	return variantId === 'pc-remastered' ? ProfilePCR : null;
}
