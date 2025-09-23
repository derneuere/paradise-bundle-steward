import { Volume2 } from "lucide-react";
import { ComponentStyles } from '@/lib/burnoutTheme';
import type { VehicleListEntry } from '@/lib/parsers/vehicleListParser';
import { getDecryptedId } from '@/lib/parsers/vehicleListParser';

type AudioSectionProps = {
  vehicle: VehicleListEntry;
}

export const AudioSection = ({ vehicle }: AudioSectionProps) => {
  const hasAudioData = vehicle.audioData.engineName !== 0n || vehicle.audioData.exhaustName !== 0n || vehicle.audioData.aiMusicLoopContentSpec;

  if (!hasAudioData) return null;

  return (
    <div className="border rounded-lg p-3">
      <h4 className={ComponentStyles.sectionTitle}>
        <Volume2 className="h-3 w-3 text-green-500" />
        Audio
      </h4>
      <div className={ComponentStyles.details}>
        {vehicle.audioData.engineName !== 0n && (
          <div>
            <span className={ComponentStyles.statLabel}>Engine:</span>
            <span className="ml-1 font-mono text-xs break-all">
              {getDecryptedId(vehicle.audioData.engineName)}
            </span>
          </div>
        )}
        {vehicle.audioData.exhaustName !== 0n && (
          <div>
            <span className={ComponentStyles.statLabel}>Exhaust:</span>
            <span className="ml-1 font-mono text-xs break-all">
              {getDecryptedId(vehicle.audioData.exhaustName)}
            </span>
          </div>
        )}
        {vehicle.audioData.aiMusicLoopContentSpec && (
          <div>
            <span className={ComponentStyles.statLabel}>Music:</span>
            <span className="ml-1 font-mono text-xs break-all">
              {vehicle.audioData.aiMusicLoopContentSpec}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}; 