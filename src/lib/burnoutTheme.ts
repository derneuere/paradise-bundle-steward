// Burnout Paradise UI Theme and Labeling Utilities
// Separated from parsing logic to maintain clean architecture

import {
  CarType,
  VehicleType,
  LiveryType,
  Rank
} from './core/vehicleList';

// ============================================================================
// Official Burnout Paradise Color Scheme
// ============================================================================

export const BurnoutColors = {
  // Vehicle boost types (official colors from the game)
  speed: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-700', 
    border: 'border-blue-200',
    accent: 'bg-blue-500'
  },
  aggression: {
    bg: 'bg-red-500/10',
    text: 'text-red-700',
    border: 'border-red-200', 
    accent: 'bg-red-500'
  },
  stunt: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-700',
    border: 'border-yellow-200',
    accent: 'bg-yellow-500'
  },
  // Neutral colors
  neutral: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-700',
    border: 'border-gray-200',
    accent: 'bg-gray-500'
  },
  // System colors
  primary: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    accent: 'bg-primary'
  }
} as const;

// ============================================================================
// Type-Safe Color Getter Functions
// ============================================================================

export const getBoostTypeColors = (type: CarType) => {
  switch (type) {
    case CarType.SPEED: return BurnoutColors.speed;
    case CarType.AGGRESSION: return BurnoutColors.aggression;
    case CarType.STUNT: return BurnoutColors.stunt;
    case CarType.NONE: return BurnoutColors.neutral;
    default: return BurnoutColors.neutral;
  }
};

export const getStatBarColor = (statType: 'speed' | 'strength' | 'default') => {
  switch (statType) {
    case 'speed': return BurnoutColors.speed.accent;
    case 'strength': return BurnoutColors.aggression.accent;
    default: return BurnoutColors.primary.accent;
  }
};

// ============================================================================
// Label Mapping Functions
// ============================================================================

export const getVehicleTypeLabel = (type: VehicleType): string => {
  switch (type) {
    case VehicleType.CAR: return "Car";
    case VehicleType.BIKE: return "Bike"; 
    case VehicleType.PLANE: return "Plane";
    default: return "Unknown";
  }
};

export const getBoostTypeLabel = (type: CarType): string => {
  switch (type) {
    case CarType.SPEED: return "Speed";
    case CarType.AGGRESSION: return "Aggression";
    case CarType.STUNT: return "Stunt"; 
    case CarType.NONE: return "None";
    case CarType.LOCKED: return "Locked";
    case CarType.INVALID: return "Invalid";
    default: return "Unknown";
  }
};

export const getRankLabel = (rank: Rank): string => {
  switch (rank) {
    case Rank.LEARNERS_PERMIT: return "Learners";
    case Rank.D_CLASS: return "D-Class";
    case Rank.C_CLASS: return "C-Class"; 
    case Rank.B_CLASS: return "B-Class";
    case Rank.A_CLASS: return "A-Class";
    case Rank.BURNOUT_LICENSE: return "Burnout";
    default: return "Unknown";
  }
};

export const getLiveryTypeLabel = (type: LiveryType): string => {
  switch (type) {
    case LiveryType.DEFAULT: return "Default";
    case LiveryType.COLOUR: return "Color";
    case LiveryType.PATTERN: return "Pattern";
    case LiveryType.SILVER: return "Silver";
    case LiveryType.GOLD: return "Gold";
    case LiveryType.COMMUNITY: return "Community";
    default: return "Unknown";
  }
};

// ============================================================================
// Component Styling Constants
// ============================================================================

export const ComponentStyles = {
  card: "bg-card border rounded-lg hover:shadow-lg transition-all duration-200",
  section: "space-y-2",
  sectionTitle: "text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2",
  statGrid: "grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs",
  statLabel: "text-muted-foreground text-xs",
  badge: "font-mono text-xs px-2 py-1 rounded border",
  details: "text-xs space-y-1.5"
} as const;

// ============================================================================
// Advanced Theme Utilities
// ============================================================================

/**
 * Gets theme colors based on vehicle characteristics
 */
export function getVehicleTheme(vehicleType: VehicleType, boostType: CarType) {
  const baseColors = getBoostTypeColors(boostType);
  
  // Modify colors based on vehicle type
  switch (vehicleType) {
    case VehicleType.BIKE:
      return {
        ...baseColors,
        bg: baseColors.bg.replace('/10', '/15'), // Slightly more intense
        border: baseColors.border.replace('-200', '-300')
      };
    case VehicleType.PLANE:
      return {
        ...baseColors,
        bg: 'bg-purple-500/10',
        text: 'text-purple-700',
        border: 'border-purple-200',
        accent: 'bg-purple-500'
      };
    default:
      return baseColors;
  }
}

/**
 * Gets performance rating color based on stat value
 */
export function getPerformanceRatingColor(value: number, maxValue: number = 10): string {
  const ratio = value / maxValue;
  
  if (ratio >= 0.8) return 'text-green-600';
  if (ratio >= 0.6) return 'text-yellow-600';
  if (ratio >= 0.4) return 'text-orange-600';
  return 'text-red-600';
}

/**
 * Gets rarity indicator based on vehicle category flags
 */
export function getRarityIndicator(category: number): {
  label: string;
  color: string;
  description: string;
} {
  // Based on VehicleCategory enum from core types
  if (category & 0x10) { // LEGENDARY_CARS
    return {
      label: 'Legendary',
      color: 'text-yellow-500',
      description: 'Rare legendary vehicle'
    };
  }
  
  if (category & 0x20) { // BOOST_SPECIAL_CARS
    return {
      label: 'Special',
      color: 'text-purple-500',
      description: 'Special boost vehicle'
    };
  }
  
  if (category & 0x40) { // COP_CARS
    return {
      label: 'Police',
      color: 'text-blue-500',
      description: 'Law enforcement vehicle'
    };
  }
  
  if (category & 0x80) { // BIG_SURF_ISLAND_CARS
    return {
      label: 'Big Surf Island',
      color: 'text-cyan-500',
      description: 'DLC vehicle from Big Surf Island'
    };
  }
  
  if (category & 0x8) { // TOY_VEHICLES
    return {
      label: 'Toy',
      color: 'text-pink-500',
      description: 'Toy vehicle'
    };
  }
  
  return {
    label: 'Standard',
    color: 'text-gray-500',
    description: 'Standard vehicle'
  };
}

/**
 * Creates a theme-aware CSS class string
 */
export function createThemeClasses(
  vehicleType: VehicleType,
  boostType: CarType,
  additionalClasses: string = ''
): string {
  const theme = getVehicleTheme(vehicleType, boostType);
  return `${theme.bg} ${theme.text} ${theme.border} ${additionalClasses}`.trim();
} 