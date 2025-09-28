import type { ResourceCategory } from '@/lib/resourceTypes';

export const formatHex = (byte: number): string => {
  return byte.toString(16).toUpperCase().padStart(2, '0');
};

export const formatAscii = (byte: number): string => {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
};

export const shadesForCategory = (category: ResourceCategory): [string, string, string] => {
  switch (category) {
    case 'Graphics': return ['bg-blue-500', 'bg-blue-600', 'bg-blue-700'];
    case 'Audio': return ['bg-green-500', 'bg-green-600', 'bg-green-700'];
    case 'Data': return ['bg-purple-500', 'bg-purple-600', 'bg-purple-700'];
    case 'Script': return ['bg-orange-500', 'bg-orange-600', 'bg-orange-700'];
    case 'Camera': return ['bg-cyan-500', 'bg-cyan-600', 'bg-cyan-700'];
    default: return ['bg-gray-500', 'bg-gray-600', 'bg-gray-700'];
  }
};
