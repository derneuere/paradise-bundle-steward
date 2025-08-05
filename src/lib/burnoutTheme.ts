import type { CarType, VehicleType, LiveryType, Rank } from './vehicleListParser';

// Official Burnout Paradise color scheme based on the game's UI
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

// Type-safe color getter functions
export const getBoostTypeColors = (type: CarType) => {
  switch (type) {
    case 0: return BurnoutColors.speed; // Speed
    case 1: return BurnoutColors.aggression; // Aggression  
    case 2: return BurnoutColors.stunt; // Stunt
    case 3: return BurnoutColors.neutral; // None
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

// Label mapping functions  
export const getVehicleTypeLabel = (type: VehicleType): string => {
  switch (type) {
    case 0: return "Car";
    case 1: return "Bike"; 
    case 2: return "Plane";
    default: return "Unknown";
  }
};

export const getBoostTypeLabel = (type: CarType): string => {
  switch (type) {
    case 0: return "Speed";
    case 1: return "Aggression";
    case 2: return "Stunt"; 
    case 3: return "None";
    case 4: return "Locked";
    case 5: return "Invalid";
    default: return "Unknown";
  }
};

export const getRankLabel = (rank: Rank): string => {
  switch (rank) {
    case 0: return "Learners";
    case 1: return "D-Class";
    case 2: return "C-Class"; 
    case 3: return "B-Class";
    case 4: return "A-Class";
    case 5: return "Burnout";
    default: return "Unknown";
  }
};

export const getLiveryTypeLabel = (type: LiveryType): string => {
  switch (type) {
    case 0: return "Default";
    case 1: return "Color";
    case 2: return "Pattern";
    case 3: return "Silver";
    case 4: return "Gold";
    case 5: return "Community";
    default: return "Unknown";
  }
};

// Component styling constants
export const ComponentStyles = {
  card: "bg-card border rounded-lg hover:shadow-lg transition-all duration-200",
  section: "space-y-2",
  sectionTitle: "text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2",
  statGrid: "grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs",
  statLabel: "text-muted-foreground text-xs",
  badge: "font-mono text-xs px-2 py-1 rounded border",
  details: "text-xs space-y-1.5"
} as const; 