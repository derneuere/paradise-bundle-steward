import * as pako from 'pako';
import { BinReader, BinWriter } from './binTools';
import { object, u32, arrayOf, u8, f32 } from 'typed-binary';
import { u64 } from './u64';
import { ParsedBundle, ProgressCallback, ResourceContext, ResourceEntry } from './types';
import { getResourceData, isNestedBundle } from './resourceManager';
import { BundleError, ResourceNotFoundError } from './errors';
import { parseBundle } from './bundle';
import { writeTriggerDataData } from './triggerData';


// Length	Type	Name	Description	Comments
// 0x4	EDistrict	meDistrict		
// 0x4	ECounty	?		
// 0x8	CgsID	mTriggerID		
// 0x8	CgsID	mRoadID	

export type LocationData = {
    district: number;
    county: number;
    triggerID: bigint;
    roadID: bigint;
}

export const LocationDataSchema = object({
    district: u8,
    county: u8,
    triggerID: u64,
    roadID: u64,
})


// Offset	Length	Type	Name	Description	Comments
// 0x0	0x4	uint32_t	muNumChallenges		
// 0x4	0x4	ChallengeListEntry*	mpEntries		
// 0x8	0x8	uint64_t	mu16BytePad		

export type ChallengeList = {
    numChallenges: number;
    challenges: ChallengeListEntry[];
    bytePad: bigint;
}

export const ChallengeListSchema = object({
    numChallenges: u32,
    challengesOffset: u32,
    bytePad: u64,
})

// Offset	Length	Type	Name	Description	Comments
// 0x0	0xA0	ChallengeListEntryAction[2]	maAction	Challenge parts	
// 0xA0	0x10	char[16]	macDescriptionStringID	Freeburn challenge description string ID	FBCD_<GameDB ID>
// 0xB0	0x10	char[16]	macTitleStringID	Freeburn challenge title string ID	FBCT_<GameDB ID>
// 0xC0	0x8	CgsID	mChallengeID	Challenge GameDB ID	
// 0xC8	0x8	CgsID	mCarID	Car ID to restrict to for challenge participation	Unused
// 0xD0	0x1	uint8_t	muCarType	Car type to restrict to for challenge participation	Unused. See ECarRestrictionType
// 0xD1	0x1	int8_t	miCarColourIndex		Unused
// 0xD2	0x1	int8_t	miCarColourPaletteIndex		Unused
//0xD3	0x1	uint8_t	muNumPlayers	Number of players required to run the challenge	22 = 2-player, 33 = 3-player, etc.
// 0xD4	0x1	uint8_t	muNumActions	Number of parts in the challenge	1 or 2
// 0xD5	0x1	uint8_t	muDifficulty		See EChallengeDifficulty
// 0xD6	0x1	uint8_t	?	Entitlement group	See EEntitlementGroup
//0xD7	0x1			Padding	

export type ChallengeListEntry = {
    actions: ChallengeListEntryAction[];
    descriptionStringID: string;
    titleStringID: string;
    challengeID: bigint;
    carID: bigint;
    carType: number;
    carColourIndex: number;
    carColourPaletteIndex: number;
    numPlayers: number;
    numActions: number;
    difficulty: number;
    entitlementGroup: number;
    padding: number;
}

// Offset	Length	Type	Name	Description	Comments
// 0x0	0x1	uint8_t	muActionType	Goal	See EChallengeActionType
// 0x1	0x1	uint8_t	muCoopType	Co-op type used	See EChallengeCoopType
// 0x2	0x1	uint8_t	mxModifier	Modifications to the goal	See challenge modifier
// 0x3	0x1	uint8_t	muCombineActionType	Score counting type	See ECombineActionType
// 0x4	0x1	uint8_t	muNumLocations	Number of locations	
// 0x5	0x4	uint8_t[4]	mauLocationType	Location types	See ELocationType
// 0x9	0x7			Padding	
// 0x10	0x20	LocationData[4]	maLocationData	Locations	
// 0x30	0x1	uint8_t	muNumTargets	Number of targets	Up to 2
// 0x31	0x3			Padding	
// 0x34	0x8	int32_t[2]	maiTargetValue	Targets	
// 0x3C	0x2	uint8_t[2]	mau8TargetDataType	Target data types	See EChallengeDataType
// 0x3E	0x2			Padding	
// 0x40	0x4	float32_t	mfTimeLimit	Time limit on achieving the goal	Setting this makes any challenge timed
// 0x44	0x4	float32_t	mfConvoyTime	Counts down instead of up	Unused
// 0x48	0x4	uint32_t	muPropType		
// 0x4C	0x4			Padding

export type ChallengeListEntryAction = {
    actionType: number;
    coopType: number;
    modifier: number;
    combineActionType: number;
    numLocations: number;
    locationType: number[];
    locationData: LocationData[];
    padding1: number[];
    numTargets: number;
    padding2: number[];
    targetValue: number[];
    targetDataType: number[];
    padding3: number[];
    timeLimit: number;
    convoyTime: number;
    propType: number;
    padding4: number[];
}

export const ChallengeListEntryActionSchema = object({
    actionType: u8,
    coopType: u8,
    modifier: u8,
    combineActionType: u8,
    numLocations: u8,
    locationType: arrayOf(u8, 4),
    padding1: arrayOf(u8, 7),
    locationData: arrayOf(LocationDataSchema, 4),
    numTargets: u8,
    padding2: arrayOf(u8, 3),
    targetValue: arrayOf(u32, 2),
    targetDataType: arrayOf(u8, 2),
    padding3: arrayOf(u8, 2),
    timeLimit: f32,
    convoyTime: f32,
    propType: u32,
    padding4: arrayOf(u8, 4),
})


export enum CarRestrictionType {
    NONE = 0,
    DANGER = 1,
    AGGRESSION = 2,
    STUNT = 3,
    COUNT = 4,
}

export enum ChallengeDifficulty {
    EASY = 0,
    MEDIUM = 1,
    HARD = 2,
    VERY_HARD = 3,
    COUNT = 4,
}

export enum EntitlementGroup {
    RELEASE = 0,
    UNKNOWN_DLC = 1,
    UNKNOWN_DLC_2 = 2,
    CAGNEY = 3,
    DAVIS = 4,
    ISLAND = 5,
}

export enum ChallengeActionType {
    MINIMUM_SPEED = 0,
    IN_AIR = 1,
    AIR_DISTANCE = 2,
    LEAP_CARS = 3,
    DRIFT = 4,
    NEAR_MISS = 5,
    BARREL_ROLLS = 6,
    ONCOMING = 7,
    FLATSPIN = 8,
    LAND_SUCCESSFUL = 9,
    ROAD_RULE_TIME = 10,
    ROAD_RULE_CRASH = 11,
    PLAYER_POWER_PARKING = 12,
    TRAFFIC_POWER_PARKING = 13,
    CRASH_INTO_PLAYER = 14,
    BURNOUTS = 15,
    MEET_UP = 16,
    BILLBOARD = 17,
    BOOST_TIME = 18,
    BARREL_ROLLS_REVERSE = 19,
    FLATSPIN_REVERSE = 20,
    LAND_SUCCESSFUL_REVERSE = 21,
    CONVOY_RELATED = 22,
    UNKNOWN_23 = 23,
    AIR_CHAINED_MULTIPLIER = 24,
    FLAT_SPIN_CHAINED_MULTIPLIER = 25,
    BARREL_ROLL_CHAINED_MULTIPLIER = 26,
    SUPER_JUMP_CHAINED_MULTIPLIER = 27,
    BILLBOARD_CHAINED_MULTIPLIER = 28,
    UNKNOWN_CHAINED_MULTIPLIER = 29,
    CHAINED_MULTIPLIER = 30,
    AIR_MULTIPLIER = 31,
    FLAT_SPIN_MULTIPLIER = 32,
    BARREL_ROLL_MULTIPLIER = 33,
    SUPER_JUMP_MULTIPLIER = 34,
    BILLBOARD_MULTIPLIER = 35,
    CARS_LEAPT_MULTIPLIER = 36,
    TAKEDOWN_MULTIPLIER = 37,
    MULTIPLIER = 38,
    STUNT_SCORE = 39,
    CORKSCREW = 40,
    LAND_SUPER_JUMPS = 41,
    LAND_SPECIFIC_SUPER_JUMP = 42,
    SMASH_SPECIFIC_BILLBOARD = 43,
    INTERSTATE_LAP = 44,
    INTERSTATE_LAP_NO_STOP = 45,
    INTERSTATE_LAP_NO_CRASH = 46,
    AERIAL_NEAR_MISS = 47,
    REV_DRIVING = 48,
    REV_ONCOMING = 49,
    TAKEDOWNS = 50,
    VERT_TAKEDOWN = 51,
    TARGET = 52,
    WHEELIE_DISTANCE = 53,
    WHEELIE_TIMES = 54,
    WHEELIE_NEAR_MISS = 55,
    WHEELIE_ONCOMING = 56,
    ONCOMING_NEAR_MISS = 57,
    NO_LONGER_EXISTS_58 = 58,
    NO_LONGER_EXISTS_59 = 59,
    DISTANCE_TRAVELED = 60,
    NO_LONGER_EXISTS_61 = 61,
    JUMP_OVER_BIKES = 62,
    COUNT = 63,
}

export enum ChallengeCoopType {
    ONCE = 0,
    INDIVIDUAL = 1,
    INDIVIDUAL_ACCUMULATION = 2,
    SIMULTANEOUS = 3,
    CUMULATIVE = 4,
    AVERAGE = 5,
    INDIVIDUAL_SEQUENCE = 6,
    COUNT = 7,
}

export enum ChallengeModifier {
    NONE = 0x0,
    WITHOUT_CRASHING = 0x1,
    PRISTINE = 0x2,
    HEAD_ON = 0x4,
    IN_AIR = 0x8,
    BANK_FOR_SUCCESS = 0x10,
    STANDS_BY_BEFORE_PART_2 = 0x20,
    TIMER_STARTS_ON_CHALLENGE_ACTIVATION = 0x40,
    COUNT = 0x80,
}

export enum CombineActionType {
    CHAIN = 0,
    FAILURE_RESETS_CHAIN = 1,
    FAILURE_RESETS_EVERYONE = 2,
    UNKNOWN_3 = 3,
    SIMULTANEOUS = 4,
    INDEPENDENT = 5,
    UNKNOWN_6 = 6,
    COUNT = 7,
}

export enum LocationType {
    ANYWHERE = 0,
    DISTRICT = 1,
    COUNTY = 2,
    TRIGGER = 3,
    ROAD = 4,
    ROAD_NO_MARKER = 5,
    GAS_STATION = 6,
    AUTO_REPAIR = 7,
    PAINT_SHOP = 8,
    COUNT = 6,
}

export enum ChallengeDataType {
    CRASHES = 0,
    NEAR_MISS = 1,
    ONCOMING = 2,
    DRIFT = 3,
    AIR = 4,
    AIR_DISTANCE = 5,
    BARREL_ROLLS = 6,
    FLAT_SPINS = 7,
    CARS_LEAPT = 8,
    SPEED_ROAD_RULE = 9,
    CRASH_ROAD_RULE = 10,
    SUCCESSFUL_LANDINGS = 11,
    BURNOUTS = 12,
    POWER_PARKS = 13,
    PERCENTAGE = 14,
    MEET_UP = 15,
    BILLBOARDS = 16,
    BOOST_TIME = 17,
    CONVOY_POSITION = 18,
    DISTANCE = 19,
    CHAIN = 20,
    MULTIPLIER = 21,
    STUNT_SCORE = 22,
    CORKSCREW = 23,
    SUPER_JUMP = 24,
    INTERSTATE_LAP = 25,
    TAKEDOWNS = 26,
    VERT_TAKEDOWN = 27,
    AERIAL_NEAR_MISS = 28,
    REV_DRIVING = 29,
    REV_ONCOMING = 30,
    TARGET = 31,
    BIKES_LEAPT = 32,
    WHEELIE = 33,
    WHEELIE_NEAR_MISS = 34,
    WHEELIE_ONCOMING = 35,
    ONCOMING_NEAR_MISS = 36,
    DISTANCE_TRAVELED = 37,
    COUNT = 38,
}

// =============================================================================
// UI option registry for enums
// =============================================================================

export type EnumOption<T extends number> = { value: T; label: string };

export type ChallengeOptionRegistry = {
    actionType: EnumOption<ChallengeActionType>[];
    coopType: EnumOption<ChallengeCoopType>[];
    modifier: EnumOption<ChallengeModifier>[];
    combineActionType: EnumOption<CombineActionType>[];
    locationType: EnumOption<LocationType>[];
    dataType: EnumOption<ChallengeDataType>[];
}

export const challengeOptionRegistry: ChallengeOptionRegistry = {
    actionType: [
        { value: ChallengeActionType.MINIMUM_SPEED, label: 'Minimum Speed' },
        { value: ChallengeActionType.IN_AIR, label: 'In Air' },
        { value: ChallengeActionType.AIR_DISTANCE, label: 'Air Distance' },
        { value: ChallengeActionType.LEAP_CARS, label: 'Leap Cars' },
        { value: ChallengeActionType.DRIFT, label: 'Drift' },
        { value: ChallengeActionType.NEAR_MISS, label: 'Near Miss' },
        { value: ChallengeActionType.BARREL_ROLLS, label: 'Barrel Rolls' },
        { value: ChallengeActionType.ONCOMING, label: 'Oncoming' },
        { value: ChallengeActionType.FLATSPIN, label: 'Flat Spin' },
        { value: ChallengeActionType.LAND_SUCCESSFUL, label: 'Land Successful' },
        { value: ChallengeActionType.ROAD_RULE_TIME, label: 'Road Rule Time' },
        { value: ChallengeActionType.ROAD_RULE_CRASH, label: 'Road Rule Crash' },
        { value: ChallengeActionType.PLAYER_POWER_PARKING, label: 'Player Power Parking' },
        { value: ChallengeActionType.TRAFFIC_POWER_PARKING, label: 'Traffic Power Parking' },
        { value: ChallengeActionType.CRASH_INTO_PLAYER, label: 'Crash Into Player' },
        { value: ChallengeActionType.BURNOUTS, label: 'Burnouts' },
        { value: ChallengeActionType.MEET_UP, label: 'Meet Up' },
        { value: ChallengeActionType.BILLBOARD, label: 'Billboard' },
        { value: ChallengeActionType.BOOST_TIME, label: 'Boost Time' },
        { value: ChallengeActionType.BARREL_ROLLS_REVERSE, label: 'Barrel Rolls Reverse' },
        { value: ChallengeActionType.FLATSPIN_REVERSE, label: 'Flat Spin Reverse' },
        { value: ChallengeActionType.LAND_SUCCESSFUL_REVERSE, label: 'Land Successful Reverse' },
        { value: ChallengeActionType.CONVOY_RELATED, label: 'Convoy Related' },
        { value: ChallengeActionType.UNKNOWN_23, label: 'Unknown 23' },
        { value: ChallengeActionType.AIR_CHAINED_MULTIPLIER, label: 'Air Chained Multiplier' },
        { value: ChallengeActionType.FLAT_SPIN_CHAINED_MULTIPLIER, label: 'Flat Spin Chained Multiplier' },
        { value: ChallengeActionType.BARREL_ROLL_CHAINED_MULTIPLIER, label: 'Barrel Roll Chained Multiplier' },
        { value: ChallengeActionType.SUPER_JUMP_CHAINED_MULTIPLIER, label: 'Super Jump Chained Multiplier' },
        { value: ChallengeActionType.BILLBOARD_CHAINED_MULTIPLIER, label: 'Billboard Chained Multiplier' },
        { value: ChallengeActionType.UNKNOWN_CHAINED_MULTIPLIER, label: 'Unknown Chained Multiplier' },
        { value: ChallengeActionType.CHAINED_MULTIPLIER, label: 'Chained Multiplier' },
        { value: ChallengeActionType.AIR_MULTIPLIER, label: 'Air Multiplier' },
        { value: ChallengeActionType.FLAT_SPIN_MULTIPLIER, label: 'Flat Spin Multiplier' },
        { value: ChallengeActionType.STUNT_SCORE, label: 'Stunt Score' },
        { value: ChallengeActionType.CORKSCREW, label: 'Corkscrew' },
        { value: ChallengeActionType.LAND_SUPER_JUMPS, label: 'Land Super Jumps' },
        { value: ChallengeActionType.LAND_SPECIFIC_SUPER_JUMP, label: 'Land Specific Super Jump' },
        { value: ChallengeActionType.SMASH_SPECIFIC_BILLBOARD, label: 'Smash Specific Billboard' },
        { value: ChallengeActionType.INTERSTATE_LAP, label: 'Interstate Lap' },
        { value: ChallengeActionType.INTERSTATE_LAP_NO_STOP, label: 'Interstate Lap No Stop' },
        { value: ChallengeActionType.INTERSTATE_LAP_NO_CRASH, label: 'Interstate Lap No Crash' },
        { value: ChallengeActionType.AERIAL_NEAR_MISS, label: 'Aerial Near Miss' },
        { value: ChallengeActionType.REV_DRIVING, label: 'Rev Driving' },
        { value: ChallengeActionType.REV_ONCOMING, label: 'Rev Oncoming' },
        { value: ChallengeActionType.TAKEDOWNS, label: 'Takedowns' },
        { value: ChallengeActionType.VERT_TAKEDOWN, label: 'Vert Takedown' },
        { value: ChallengeActionType.TARGET, label: 'Target' },
        { value: ChallengeActionType.WHEELIE_DISTANCE, label: 'Wheelie Distance' },
        { value: ChallengeActionType.WHEELIE_TIMES, label: 'Wheelie Times' },
        { value: ChallengeActionType.WHEELIE_NEAR_MISS, label: 'Wheelie Near Miss' },
        { value: ChallengeActionType.WHEELIE_ONCOMING, label: 'Wheelie Oncoming' },
        { value: ChallengeActionType.ONCOMING_NEAR_MISS, label: 'Oncoming Near Miss' },
        { value: ChallengeActionType.NO_LONGER_EXISTS_58, label: 'No Longer Exists 58' },
        { value: ChallengeActionType.NO_LONGER_EXISTS_59, label: 'No Longer Exists 59' },
        { value: ChallengeActionType.DISTANCE_TRAVELED, label: 'Distance Traveled' },
        { value: ChallengeActionType.NO_LONGER_EXISTS_61, label: 'No Longer Exists 61' },
        { value: ChallengeActionType.JUMP_OVER_BIKES, label: 'Jump Over Bikes' },
        { value: ChallengeActionType.COUNT, label: 'Count' },
    ],
    coopType: [
        { value: ChallengeCoopType.ONCE, label: 'Once' },
        { value: ChallengeCoopType.INDIVIDUAL, label: 'Individual' },
        { value: ChallengeCoopType.INDIVIDUAL_ACCUMULATION, label: 'Individual Accumulation' },
        { value: ChallengeCoopType.SIMULTANEOUS, label: 'Simultaneous' },
        { value: ChallengeCoopType.CUMULATIVE, label: 'Cumulative' },
        { value: ChallengeCoopType.AVERAGE, label: 'Average' },
        { value: ChallengeCoopType.INDIVIDUAL_SEQUENCE, label: 'Individual Sequence' },
    ],
    modifier: [
        { value: ChallengeModifier.NONE, label: 'None' },
        { value: ChallengeModifier.WITHOUT_CRASHING, label: 'Without Crashing' },
        { value: ChallengeModifier.PRISTINE, label: 'Pristine' },
        { value: ChallengeModifier.HEAD_ON, label: 'Head On' },
        { value: ChallengeModifier.IN_AIR, label: 'In Air' },
        { value: ChallengeModifier.BANK_FOR_SUCCESS, label: 'Bank For Success' },
        { value: ChallengeModifier.STANDS_BY_BEFORE_PART_2, label: 'Stands By Before Part 2' },
        { value: ChallengeModifier.TIMER_STARTS_ON_CHALLENGE_ACTIVATION, label: 'Timer Starts On Challenge Activation' },
    ],
    combineActionType: [
        { value: CombineActionType.CHAIN, label: 'Chain' },
        { value: CombineActionType.FAILURE_RESETS_CHAIN, label: 'Failure Resets Chain' },
        { value: CombineActionType.FAILURE_RESETS_EVERYONE, label: 'Failure Resets Everyone' },
        { value: CombineActionType.UNKNOWN_3, label: 'Unknown 3' },
        { value: CombineActionType.SIMULTANEOUS, label: 'Simultaneous' },
        { value: CombineActionType.INDEPENDENT, label: 'Independent' },
        { value: CombineActionType.UNKNOWN_6, label: 'Unknown 6' },
    ],
    locationType: [
        { value: LocationType.ANYWHERE, label: 'Anywhere' },
        { value: LocationType.DISTRICT, label: 'District' },
        { value: LocationType.COUNTY, label: 'County' },
        { value: LocationType.TRIGGER, label: 'Trigger' },
        { value: LocationType.ROAD, label: 'Road' },
        { value: LocationType.ROAD_NO_MARKER, label: 'Road (No Marker)' },
        { value: LocationType.GAS_STATION, label: 'Gas Station' },
        { value: LocationType.AUTO_REPAIR, label: 'Auto Repair' },
        { value: LocationType.PAINT_SHOP, label: 'Paint Shop' },
    ],
    dataType: [
        { value: ChallengeDataType.CRASHES, label: 'Crashes' },
        { value: ChallengeDataType.NEAR_MISS, label: 'Near Miss' },
        { value: ChallengeDataType.ONCOMING, label: 'Oncoming' },
        { value: ChallengeDataType.DRIFT, label: 'Drift' },
        { value: ChallengeDataType.AIR, label: 'Air' },
        { value: ChallengeDataType.AIR_DISTANCE, label: 'Air Distance' },
        { value: ChallengeDataType.BARREL_ROLLS, label: 'Barrel Rolls' },
        { value: ChallengeDataType.FLAT_SPINS, label: 'Flat Spins' },
        { value: ChallengeDataType.CARS_LEAPT, label: 'Cars Leapt' },
        { value: ChallengeDataType.SPEED_ROAD_RULE, label: 'Speed Road Rule' },
        { value: ChallengeDataType.CRASH_ROAD_RULE, label: 'Crash Road Rule' },
        { value: ChallengeDataType.SUCCESSFUL_LANDINGS, label: 'Successful Landings' },
        { value: ChallengeDataType.BURNOUTS, label: 'Burnouts' },
        { value: ChallengeDataType.POWER_PARKS, label: 'Power Parks' },
        { value: ChallengeDataType.PERCENTAGE, label: 'Percentage' },
        { value: ChallengeDataType.MEET_UP, label: 'Meet Up' },
        { value: ChallengeDataType.BILLBOARDS, label: 'Billboards' },
        { value: ChallengeDataType.BOOST_TIME, label: 'Boost Time' },
        { value: ChallengeDataType.CONVOY_POSITION, label: 'Convoy Position' },
        { value: ChallengeDataType.DISTANCE, label: 'Distance' },
        { value: ChallengeDataType.CHAIN, label: 'Chain' },
        { value: ChallengeDataType.MULTIPLIER, label: 'Multiplier' },
        { value: ChallengeDataType.STUNT_SCORE, label: 'Stunt Score' },
        { value: ChallengeDataType.CORKSCREW, label: 'Corkscrew' },
        { value: ChallengeDataType.SUPER_JUMP, label: 'Super Jump' },
        { value: ChallengeDataType.INTERSTATE_LAP, label: 'Interstate Lap' },
        { value: ChallengeDataType.TAKEDOWNS, label: 'Takedowns' },
        { value: ChallengeDataType.VERT_TAKEDOWN, label: 'Vert Takedown' },
        { value: ChallengeDataType.AERIAL_NEAR_MISS, label: 'Aerial Near Miss' },
        { value: ChallengeDataType.REV_DRIVING, label: 'Rev Driving' },
        { value: ChallengeDataType.REV_ONCOMING, label: 'Rev Oncoming' },
        { value: ChallengeDataType.TARGET, label: 'Target' },
        { value: ChallengeDataType.BIKES_LEAPT, label: 'Bikes Leapt' },
        { value: ChallengeDataType.WHEELIE, label: 'Wheelie' },
        { value: ChallengeDataType.WHEELIE_NEAR_MISS, label: 'Wheelie Near Miss' },
        { value: ChallengeDataType.WHEELIE_ONCOMING, label: 'Wheelie Oncoming' },
        { value: ChallengeDataType.ONCOMING_NEAR_MISS, label: 'Oncoming Near Miss' },
        { value: ChallengeDataType.DISTANCE_TRAVELED, label: 'Distance Traveled' },
        { value: ChallengeDataType.COUNT, label: 'Count' },
    ],
};

export function getOptions<K extends keyof ChallengeOptionRegistry>(key: K): Readonly<ChallengeOptionRegistry[K]> {
    return challengeOptionRegistry[key];
}

export function getLabel<K extends keyof ChallengeOptionRegistry>(key: K, value: number): string | undefined {
    const arr = challengeOptionRegistry[key] as ReadonlyArray<{ value: number; label: string }>;
    return arr.find(o => o.value === value)?.label;
}

export type ParsedChallengeList = {
    numChallenges: number;
    challenges: ChallengeListEntry[];
    bytePad: bigint;
}

export function readChallengeListEntryAction(reader: BinReader): ChallengeListEntryAction {
    const actionType = reader.readU8();
    const coopType = reader.readU8();
    const modifier = reader.readU8();
    const combineActionType = reader.readU8();
    const numLocations = reader.readU8();
    
    // Read location types (4 elements)
    const locationType: number[] = [];
    for (let i = 0; i < 4; i++) {
        locationType.push(reader.readU8());
    }

    const padding1: number[] = [];

    // Padding (7 bytes)
    for (let i = 0; i < 7; i++) {
        padding1.push(reader.readU8());
    } 
    
    // Read location data (4 elements) - each is 8 bytes (2 x u32 based on 0x20 total for 4 entries)
    const locationData: LocationData[] = [];
    for (let i = 0; i < 4; i++) {
        // Based on the structure being 32 bytes (0x20) for 4 entries = 8 bytes each
        // It appears district and county are packed or the structure is 2xu32
        const districtCounty = reader.readU32(); // Combined district/county or first ID
        const triggerID = reader.readU32(); // Second half or trigger ID low
        locationData.push({
            district: districtCounty & 0xFF,
            county: (districtCounty >> 8) & 0xFF,
            triggerID: BigInt(triggerID), // Store as bigint for consistency
            roadID: 0n, // Not present in this packed format
        });
    }
    
    const numTargets = reader.readU8();

    const padding2: number[] = [];

    // Padding (3 bytes)
    for (let i = 0; i < 3; i++) {
        padding2.push(reader.readU8());
    }
    
    // Read target values (2 elements)
    const targetValue: number[] = [];
    for (let i = 0; i < 2; i++) {
        targetValue.push(reader.readU32());
    }
    
    // Read target data types (2 elements)
    const targetDataType: number[] = [];
    for (let i = 0; i < 2; i++) {
        targetDataType.push(reader.readU8());
    }

    const padding3: number[] = [];

    // Padding (2 bytes)
    for (let i = 0; i < 2; i++) {
        padding3.push(reader.readU8());
    }

    const timeLimit = reader.readF32();
    const convoyTime = reader.readF32();
    const propType = reader.readU32();

    const padding4: number[] = [];

    // Padding (4 bytes)
    for (let i = 0; i < 4; i++) {
        padding4.push(reader.readU8());
    }
    
    return {
        actionType,
        coopType,
        modifier,
        combineActionType,
        numLocations,
        locationType,
        padding1,
        locationData,
        numTargets,
        padding2,
        targetValue,
        targetDataType,
        padding3,
        timeLimit,
        convoyTime,
        propType,
        padding4,
    }
}


export function parseChallengeListData(data: Uint8Array, littleEndian: boolean = true): ParsedChallengeList {
    const reader = new BinReader(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), littleEndian);
    const numChallenges = reader.readU32();
    const challengesOffset = reader.readU32();
    const bytePad = reader.readU64();

    // ChallengeListEntry
    const challenges: ChallengeListEntry[] = [];
    reader.position = challengesOffset;
    for (let i = 0; i < numChallenges; i++) {
        // parse ChallengeListEntryAction First element
        const challengeListEntryActionOne = readChallengeListEntryAction(reader);
        // parse ChallengeListEntryAction Second element
        const challengeListEntryActionTwo = readChallengeListEntryAction(reader);
        // parse remaining data for ChallengeListEntry
        const descriptionStringID = reader.readFixedString(16);
        const titleStringID = reader.readFixedString(16);
        const challengeID = reader.readU64();
        const carID = reader.readU64();
        const carType = reader.readU8();
        const carColourIndex = reader.readU8();
        const carColourPaletteIndex = reader.readU8();
        const numPlayers = reader.readU8();
        const numActions = reader.readU8();
        const difficulty = reader.readU8();
        const entitlementGroup = reader.readU8();
        const padding = reader.readU8();
        const challengeListEntry: ChallengeListEntry = {
            actions: [challengeListEntryActionOne, challengeListEntryActionTwo],
            descriptionStringID,
            titleStringID,
            challengeID,
            carID,
            carType,
            carColourIndex,
            carColourPaletteIndex,
            numPlayers,
            numActions,
            difficulty,
            entitlementGroup,
            padding,
        }
        challenges.push(challengeListEntry);
    }
    const challengeList: ParsedChallengeList = {
        numChallenges,
        challenges,
        bytePad,
    }
    return challengeList;
}

function reportProgress(
    callback: ProgressCallback | undefined,
    stage: string,
    progress: number,
    message?: string
  ) {
    callback?.({ type: 'parse', stage, progress, message });
  }


  function handleNestedChallengeListBundle(
    data: Uint8Array,
    originalBuffer: ArrayBuffer,
    resource: ResourceEntry
  ): Uint8Array {
    if (!isNestedBundle(data)) {
      return data;
    }
  
    try {
      const innerBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const bundle = parseBundle(innerBuffer);
  
      // Find the TriggerData resource in the nested bundle by matching type id
      const innerResource = bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId);
      if (!innerResource) {
        throw new ResourceNotFoundError(resource.resourceTypeId);
      }
  
      // Try to locate section data that contains the resource payload
      const dataOffsets = bundle.header.resourceDataOffsets;
  
      for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
        const sectionOffset = dataOffsets[sectionIndex];
        if (sectionOffset === 0) continue;
  
        const absoluteOffset = data.byteOffset + sectionOffset;
        if (absoluteOffset >= originalBuffer.byteLength) continue;
  
        const maxSize = originalBuffer.byteLength - absoluteOffset;
        const sectionData = new Uint8Array(originalBuffer, absoluteOffset, Math.min(maxSize, 1000000));
  
        // Prefer compressed payloads first
        if (sectionData.length >= 2 && sectionData[0] === 0x78) {
          return sectionData;
        }
  
        // Heuristic: TriggerData header starts with version (i32) and size (u32) where size <= section length
        if (sectionData.length >= 8) {
          const dv = new DataView(sectionData.buffer, sectionData.byteOffset, sectionData.byteLength);
          const size = dv.getUint32(4, true);
          if (size > 0 && size <= sectionData.length) {
            return sectionData;
          }
        }
      }
  
      // Fallback: some nested bundles store payload at offset 0
      const resourceOffset = innerResource.diskOffsets[0];
      if (resourceOffset === 0) {
        const resourceData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return resourceData;
      }
  
      throw new BundleError('Could not find valid TriggerData in nested bundle', 'TRIGGER_DATA_NESTED_NOT_FOUND');
    } catch (error) {
      console.warn('Failed to parse TriggerData as nested bundle, treating as raw data:', error);
      return data;
    }
  }
  

export function parseChallengeList(
    buffer: ArrayBuffer,
    resource: ResourceEntry,
    options: { littleEndian?: boolean } = {},
    progressCallback?: ProgressCallback
  ): ParsedChallengeList {
    try {
      reportProgress(progressCallback, 'parse', 0.0, 'Starting ChallengeList parsing');
  
      const context: ResourceContext = {
        bundle: {} as ParsedBundle,
        resource,
        buffer
      };
  
      // Extract and prepare data
      let { data } = getResourceData(context);
  
      reportProgress(progressCallback, 'parse', 0.2, 'Processing nested bundle if present');
      data = handleNestedChallengeListBundle(data, buffer, resource);
  
      // Decompress if needed (zlib)
      if (data.length >= 2 && data[0] === 0x78) {
        data = pako.inflate(data);
      }
  
      reportProgress(progressCallback, 'parse', 0.5, 'Parsing ChallengeList payload');
      const result = parseChallengeListData(data, options.littleEndian !== false);
  
      console.log('ChallengeList parsed successfully', result);
  
      reportProgress(progressCallback, 'parse', 1.0, 'ChallengeList parsed successfully');
      return result;
  
    } catch (error) {
      if (error instanceof BundleError) {
        throw error;
      }
      throw new BundleError(
        `Failed to parse ChallengeList: ${error instanceof Error ? error.message : String(error)}`,
        'CHALLENGE_LIST_PARSE_ERROR',
        { error }
      );
    }
  }

function writeChallengeListEntryAction(writer: BinWriter, action: ChallengeListEntryAction) {
    writer.writeU8(action.actionType);
    writer.writeU8(action.coopType);
    writer.writeU8(action.modifier);
    writer.writeU8(action.combineActionType);
    writer.writeU8(action.numLocations);
    
    // Write location types (4 elements)
    for (let i = 0; i < 4; i++) {
        writer.writeU8(action.locationType[i] || 0);
    }
    
    // Padding (7 bytes)
    for (let i = 0; i < 7; i++) {
        writer.writeU8(action.padding1?.[i] || 0);
    }
    
    // Write location data (4 elements) - each is 8 bytes (2 x u32 based on 0x20 total for 4 entries)
    for (let i = 0; i < 4; i++) {
        const loc = action.locationData[i] || { district: 0, county: 0, triggerID: 0n, roadID: 0n };
        // Pack district and county into first u32
        const districtCounty = (loc.district & 0xFF) | ((loc.county & 0xFF) << 8);
        writer.writeU32(districtCounty);
        // Write triggerID as u32 (low part)
        writer.writeU32(Number(loc.triggerID & 0xFFFFFFFFn));
    }
    
    writer.writeU8(action.numTargets);
    
    // Padding (3 bytes)
    for (let i = 0; i < 3; i++) {
        writer.writeU8(action.padding2?.[i] || 0);
    }
    
    // Write target values (2 elements)
    for (let i = 0; i < 2; i++) {
        writer.writeU32(action.targetValue[i] || 0);
    }
    
    // Write target data types (2 elements)
    for (let i = 0; i < 2; i++) {
        writer.writeU8(action.targetDataType[i] || 0);
    }
    
    // Padding (2 bytes)
    for (let i = 0; i < 2; i++) {
        writer.writeU8(action.padding3?.[i] || 0);
    }
    
    // Float values - timeLimit, convoyTime, propType (12 bytes)
    writer.writeF32(action.timeLimit || 0);
    writer.writeF32(action.convoyTime || 0);
    writer.writeU32(action.propType || 0);
    
    // Padding (4 bytes)
    for (let i = 0; i < 4; i++) {
        writer.writeU8(action.padding4?.[i] || 0);
    }
}

function writeChallengeListEntry(writer: BinWriter, challenge: ChallengeListEntry) {
    // Write both actions (always 2)
    writeChallengeListEntryAction(writer, challenge.actions[0]);
    writeChallengeListEntryAction(writer, challenge.actions[1]);
    
    // Write challenge metadata
    writer.writeFixedString(challenge.descriptionStringID, 16);
    writer.writeFixedString(challenge.titleStringID, 16);
    writer.writeU64(challenge.challengeID);
    writer.writeU64(challenge.carID);
    writer.writeU8(challenge.carType);
    writer.writeU8(challenge.carColourIndex);
    writer.writeU8(challenge.carColourPaletteIndex);
    writer.writeU8(challenge.numPlayers);
    writer.writeU8(challenge.numActions);
    writer.writeU8(challenge.difficulty);
    writer.writeU8(challenge.entitlementGroup);
    writer.writeU8(challenge.padding);
}

export function writeChallengeListData(challengeList: ParsedChallengeList, littleEndian: boolean = true): Uint8Array {
    const writer = new BinWriter(64 * 1024, littleEndian);
    
    // Write header
    writer.writeU32(challengeList.numChallenges);
    const challengesOffsetPos = writer.offset;
    writer.writeU32(0); // Placeholder for challenges offset
    writer.writeU64(challengeList.bytePad);
    
    // Write challenges
    const challengesOffset = writer.offset;
    for (const challenge of challengeList.challenges) {
        writeChallengeListEntry(writer, challenge);
    }
    
    // Update challenges offset
    writer.setU32(challengesOffsetPos, challengesOffset);
    
    return writer.bytes;
}

// =============================================================================
// High-level wrapper with progress (optional)
// =============================================================================

export function writeChallengeList(td: ParsedChallengeList, options: { littleEndian?: boolean; autoAssignRegionIndexes?: boolean } = {}, progress?: ProgressCallback): Uint8Array {
	progress?.({ type: 'write', stage: 'write', progress: 0.0, message: 'Serializing ChallengeList' });
	const out = writeChallengeListData(td, options.littleEndian !== false);
	progress?.({ type: 'write', stage: 'write', progress: 1.0, message: 'Done' });
	return out;
}
