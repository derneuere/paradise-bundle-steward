// Settings management for user preferences
// Uses localStorage to persist settings across sessions

const SETTINGS_KEY = 'paradise-bundle-steward-settings';

type Settings = {
  autoAssignRegionIndexes: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  autoAssignRegionIndexes: true, // Default to true (current behavior)
};

export function getSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.warn('Failed to load settings from localStorage:', error);
  }
  return DEFAULT_SETTINGS;
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return getSettings()[key];
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  try {
    const current = getSettings();
    const updated = { ...current, [key]: value };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save settings to localStorage:', error);
  }
}

export function updateSettings(partial: Partial<Settings>): void {
  try {
    const current = getSettings();
    const updated = { ...current, ...partial };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save settings to localStorage:', error);
  }
}



