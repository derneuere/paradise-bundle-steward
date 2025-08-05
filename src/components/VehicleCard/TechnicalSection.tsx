import { Settings } from "lucide-react";
import { ComponentStyles } from '@/lib/burnoutTheme';
import type { VehicleListEntry } from '@/lib/vehicleListParser';

interface TechnicalSectionProps {
  vehicle: VehicleListEntry;
}

export const TechnicalSection = ({ vehicle }: TechnicalSectionProps) => {
  return (
    <details className="group border rounded-lg">
      <summary className={`cursor-pointer p-3 hover:bg-muted/50 transition-colors rounded-lg ${ComponentStyles.sectionTitle} hover:text-foreground`}>
        <Settings className="h-3 w-3 text-gray-500" />
        Technical Details
      </summary>
      <div className={`px-3 pb-3 ${ComponentStyles.details}`}>
        <div className="grid grid-cols-1 gap-1.5 text-xs">
          <div>
            <span className={ComponentStyles.statLabel}>Category:</span>
            <span className="ml-1 font-mono">
              0x{vehicle.category.toString(16).toUpperCase()}
            </span>
          </div>
          <div>
            <span className={ComponentStyles.statLabel}>Flags:</span>
            <span className="ml-1 font-mono">
              0x{vehicle.gamePlayData.flags.toString(16).toUpperCase()}
            </span>
          </div>
          <div>
            <span className={ComponentStyles.statLabel}>Attrib Key:</span>
            <span className="ml-1 font-mono break-all">
              {vehicle.attribCollectionKey.toString(16).toUpperCase()}
            </span>
          </div>
          {vehicle.audioData.rivalUnlockName && vehicle.audioData.rivalUnlockName !== '0x0' && (
            <div>
              <span className={ComponentStyles.statLabel}>Rival Unlock:</span>
              <span className="ml-1 font-mono break-all">
                {vehicle.audioData.rivalUnlockName}
              </span>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}; 