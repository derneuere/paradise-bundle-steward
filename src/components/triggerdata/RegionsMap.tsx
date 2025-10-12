import React, { useMemo, useEffect, useState } from 'react';
import { MapContainer, Polygon, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { ParsedTriggerData, Landmark, GenericRegion, BoxRegion } from '@/lib/core/triggerData';
import { GenericRegionType, StuntCameraType } from '@/lib/core/triggerData';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Filter } from 'lucide-react';

type PolyData = {
  kind: 'landmark';
  id: number;
  regionIndex: number;
  box: BoxRegion;
  world: Array<[number, number]>;
  enabled: number;
  data: Landmark;
} | {
  kind: 'generic';
  id: number;
  regionIndex: number;
  box: BoxRegion;
  world: Array<[number, number]>;
  enabled: number;
  data: GenericRegion;
};

const getGenericRegionTypeName = (type: GenericRegionType): string => {
  const names: Record<GenericRegionType, string> = {
    [GenericRegionType.E_TYPE_JUNK_YARD]: 'Junk Yard',
    [GenericRegionType.E_TYPE_BIKE_SHOP]: 'Bike Shop',
    [GenericRegionType.E_TYPE_GAS_STATION]: 'Gas Station',
    [GenericRegionType.E_TYPE_BODY_SHOP]: 'Body Shop',
    [GenericRegionType.E_TYPE_PAINT_SHOP]: 'Paint Shop',
    [GenericRegionType.E_TYPE_CAR_PARK]: 'Car Park',
    [GenericRegionType.E_TYPE_SIGNATURE_TAKEDOWN]: 'Signature Takedown',
    [GenericRegionType.E_TYPE_KILLZONE]: 'Killzone',
    [GenericRegionType.E_TYPE_JUMP]: 'Jump',
    [GenericRegionType.E_TYPE_SMASH]: 'Smash',
    [GenericRegionType.E_TYPE_SIGNATURE_CRASH]: 'Signature Crash',
    [GenericRegionType.E_TYPE_SIGNATURE_CRASH_CAMERA]: 'Signature Crash Camera',
    [GenericRegionType.E_TYPE_ROAD_LIMIT]: 'Road Limit',
    [GenericRegionType.E_TYPE_OVERDRIVE_BOOST]: 'Overdrive Boost',
    [GenericRegionType.E_TYPE_OVERDRIVE_STRENGTH]: 'Overdrive Strength',
    [GenericRegionType.E_TYPE_OVERDRIVE_SPEED]: 'Overdrive Speed',
    [GenericRegionType.E_TYPE_OVERDRIVE_CONTROL]: 'Overdrive Control',
    [GenericRegionType.E_TYPE_TIRE_SHOP]: 'Tire Shop',
    [GenericRegionType.E_TYPE_TUNING_SHOP]: 'Tuning Shop',
    [GenericRegionType.E_TYPE_PICTURE_PARADISE]: 'Picture Paradise',
    [GenericRegionType.E_TYPE_TUNNEL]: 'Tunnel',
    [GenericRegionType.E_TYPE_OVERPASS]: 'Overpass',
    [GenericRegionType.E_TYPE_BRIDGE]: 'Bridge',
    [GenericRegionType.E_TYPE_WAREHOUSE]: 'Warehouse',
    [GenericRegionType.E_TYPE_LARGE_OVERHEAD_OBJECT]: 'Large Overhead Object',
    [GenericRegionType.E_TYPE_NARROW_ALLEY]: 'Narrow Alley',
    [GenericRegionType.E_TYPE_PASS_TUNNEL]: 'Pass Tunnel',
    [GenericRegionType.E_TYPE_PASS_OVERPASS]: 'Pass Overpass',
    [GenericRegionType.E_TYPE_PASS_BRIDGE]: 'Pass Bridge',
    [GenericRegionType.E_TYPE_PASS_WAREHOUSE]: 'Pass Warehouse',
    [GenericRegionType.E_TYPE_PASS_LARGEOVERHEADOBJECT]: 'Pass Large Overhead Object',
    [GenericRegionType.E_TYPE_PASS_NARROWALLEY]: 'Pass Narrow Alley',
    [GenericRegionType.E_TYPE_RAMP]: 'Ramp',
    [GenericRegionType.E_TYPE_GOLD]: 'Gold',
    [GenericRegionType.E_TYPE_ISLAND_ENTITLEMENT]: 'Island Entitlement',
  };
  return names[type] ?? `Unknown (${type})`;
};

const getCameraTypeName = (type: StuntCameraType): string => {
  const names: Record<StuntCameraType, string> = {
    [StuntCameraType.E_STUNT_CAMERA_TYPE_NO_CUTS]: 'No Cuts',
    [StuntCameraType.E_STUNT_CAMERA_TYPE_CUSTOM]: 'Custom',
    [StuntCameraType.E_STUNT_CAMERA_TYPE_NORMAL]: 'Normal',
  };
  return names[type] ?? `Unknown (${type})`;
};

// All available generic region types
const ALL_GENERIC_TYPES = [
  GenericRegionType.E_TYPE_JUNK_YARD,
  GenericRegionType.E_TYPE_BIKE_SHOP,
  GenericRegionType.E_TYPE_GAS_STATION,
  GenericRegionType.E_TYPE_BODY_SHOP,
  GenericRegionType.E_TYPE_PAINT_SHOP,
  GenericRegionType.E_TYPE_CAR_PARK,
  GenericRegionType.E_TYPE_SIGNATURE_TAKEDOWN,
  GenericRegionType.E_TYPE_KILLZONE,
  GenericRegionType.E_TYPE_JUMP,
  GenericRegionType.E_TYPE_SMASH,
  GenericRegionType.E_TYPE_SIGNATURE_CRASH,
  GenericRegionType.E_TYPE_SIGNATURE_CRASH_CAMERA,
  GenericRegionType.E_TYPE_ROAD_LIMIT,
  GenericRegionType.E_TYPE_OVERDRIVE_BOOST,
  GenericRegionType.E_TYPE_OVERDRIVE_STRENGTH,
  GenericRegionType.E_TYPE_OVERDRIVE_SPEED,
  GenericRegionType.E_TYPE_OVERDRIVE_CONTROL,
  GenericRegionType.E_TYPE_TIRE_SHOP,
  GenericRegionType.E_TYPE_TUNING_SHOP,
  GenericRegionType.E_TYPE_PICTURE_PARADISE,
  GenericRegionType.E_TYPE_TUNNEL,
  GenericRegionType.E_TYPE_OVERPASS,
  GenericRegionType.E_TYPE_BRIDGE,
  GenericRegionType.E_TYPE_WAREHOUSE,
  GenericRegionType.E_TYPE_LARGE_OVERHEAD_OBJECT,
  GenericRegionType.E_TYPE_NARROW_ALLEY,
  GenericRegionType.E_TYPE_PASS_TUNNEL,
  GenericRegionType.E_TYPE_PASS_OVERPASS,
  GenericRegionType.E_TYPE_PASS_BRIDGE,
  GenericRegionType.E_TYPE_PASS_WAREHOUSE,
  GenericRegionType.E_TYPE_PASS_LARGEOVERHEADOBJECT,
  GenericRegionType.E_TYPE_PASS_NARROWALLEY,
  GenericRegionType.E_TYPE_RAMP,
  GenericRegionType.E_TYPE_GOLD,
  GenericRegionType.E_TYPE_ISLAND_ENTITLEMENT,
];

const FitBounds: React.FC<{ polys: PolyData[] }> = ({ polys }) => {
  const map = useMap();
  
  useEffect(() => {
    if (polys.length === 0) return;
    
    const allPoints: L.LatLngExpression[] = polys.flatMap(p => p.world);
    const bounds = L.latLngBounds(allPoints);
    
    // Fit bounds to show all regions with padding
    map.fitBounds(bounds, { padding: [100, 100] });
  }, [map, polys]);
  
  return null;
};

export const RegionsMap: React.FC<{ data: ParsedTriggerData; }> = ({ data }) => {
  // Filter state
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [selectedGenericTypes, setSelectedGenericTypes] = useState<Set<GenericRegionType>>(new Set(ALL_GENERIC_TYPES));
  const [showEnabled, setShowEnabled] = useState(true);
  const [showDisabled, setShowDisabled] = useState(true);

  const boxes = useMemo(() => {
    const fromLm = showLandmarks ? data.landmarks
      .filter(lm => {
        const isEnabled = lm.enabled === 1;
        return (isEnabled && showEnabled) || (!isEnabled && showDisabled);
      })
      .map(lm => ({
        kind: 'landmark' as const,
        id: lm.id,
        regionIndex: lm.regionIndex,
        box: lm.box,
        enabled: lm.enabled,
        data: lm,
      })) : [];
    const fromGen = data.genericRegions
      .filter(gr => {
        const isEnabled = gr.enabled === 1;
        const matchesType = selectedGenericTypes.has(gr.genericType);
        const matchesEnabledFilter = (isEnabled && showEnabled) || (!isEnabled && showDisabled);
        return matchesType && matchesEnabledFilter;
      })
      .map(gr => ({
        kind: 'generic' as const,
        id: gr.id,
        regionIndex: gr.regionIndex,
        box: gr.box,
        enabled: gr.enabled,
        data: gr,
      }));
    return [...fromLm, ...fromGen];
  }, [data.landmarks, data.genericRegions, showLandmarks, selectedGenericTypes, showEnabled, showDisabled]);

  // Calculate counts for display
  const landmarkCount = boxes.filter(b => b.kind === 'landmark').length;
  const genericCount = boxes.filter(b => b.kind === 'generic').length;
  const totalDisplayed = boxes.length;

  // Normalize yaw to radians: values > 2π are treated as degrees
  const toYawRadians = (yaw: number) => {
    const abs = Math.abs(yaw);
    if (!Number.isFinite(abs)) return 0;
    return abs > Math.PI * 2 ? (yaw * Math.PI / 180) : yaw;
  };

  // Pre-compute rotated polygon corners for each box in [lat(z), lng(x)] order
  const polys = useMemo(() => {
    return boxes.map(b => {
      const halfX = Math.abs(b.box.dimensionX) / 2;
      const halfZ = Math.abs(b.box.dimensionZ) / 2;
      const cx = b.box.positionX;
      const cz = b.box.positionZ;
      const yaw = toYawRadians(b.box.rotationY ?? 0);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const local: Array<[number, number]> = [
        [-halfX, -halfZ],
        [ halfX, -halfZ],
        [ halfX,  halfZ],
        [-halfX,  halfZ],
      ];
      const world: Array<[number, number]> = local.map(([lx, lz]) => {
        const x = cx + lx * cos + lz * sin;
        const z = cz - lx * sin + lz * cos;
        return [z, x];
      });
      return { ...b, world };
    });
  }, [boxes]);

  const toggleGenericType = (type: GenericRegionType) => {
    setSelectedGenericTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const selectAllGenericTypes = () => {
    setSelectedGenericTypes(new Set(ALL_GENERIC_TYPES));
  };

  const clearAllGenericTypes = () => {
    setSelectedGenericTypes(new Set());
  };

  return (
    <div className="space-y-3">
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          id="show-landmarks"
          checked={showLandmarks}
          onCheckedChange={(checked) => setShowLandmarks(!!checked)}
        />
        <Label htmlFor="show-landmarks" className="cursor-pointer">
          Show Landmarks ({landmarkCount}/{data.landmarks.length})
        </Label>

        <div className="flex items-center gap-2 ml-2">
          <span className="text-sm text-muted-foreground">|</span>
          <span className="text-sm font-medium">
            Generic: {genericCount}/{data.genericRegions.length}
          </span>
        </div>

        <div className="flex items-center gap-4 ml-4 pl-4 border-l">
          <Checkbox
            id="show-enabled"
            checked={showEnabled}
            onCheckedChange={(checked) => setShowEnabled(!!checked)}
          />
          <Label htmlFor="show-enabled" className="cursor-pointer">
            Enabled
          </Label>

          <Checkbox
            id="show-disabled"
            checked={showDisabled}
            onCheckedChange={(checked) => setShowDisabled(!!checked)}
          />
          <Label htmlFor="show-disabled" className="cursor-pointer">
            Disabled
          </Label>
        </div>

        <div className="flex items-center gap-2 ml-4 pl-4 border-l">
          <span className="text-sm font-semibold text-primary">
            Total: {totalDisplayed}
          </span>
        </div>

        <Popover modal={false}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="ml-2">
              <Filter className="h-4 w-4 mr-2" />
              Filter Generic Types ({selectedGenericTypes.size}/{ALL_GENERIC_TYPES.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent 
            className="w-80 max-h-96 overflow-y-auto z-[10000]" 
            style={{ zIndex: 10000 }}
            sideOffset={5}
            align="start"
          >
            <div className="space-y-3">
              <div className="font-semibold text-sm">Filter by Generic Type</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllGenericTypes}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllGenericTypes}>
                  Clear All
                </Button>
              </div>
              <div className="space-y-2">
                {ALL_GENERIC_TYPES.map(type => (
                  <div key={type} className="flex items-center space-x-2">
                    <Checkbox
                      id={`type-${type}`}
                      checked={selectedGenericTypes.has(type)}
                      onCheckedChange={() => toggleGenericType(type)}
                    />
                    <Label
                      htmlFor={`type-${type}`}
                      className="text-sm cursor-pointer flex-1"
                    >
                      {getGenericRegionTypeName(type)}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Map */}
      <div className="h-[60vh]">
      {boxes.length === 0 ? (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          Nothing to display - adjust filters to see regions
        </div>
      ) : (
      <MapContainer 
        {...({ 
          crs: L.CRS.Simple, 
          center: [0, 0], 
          zoom: -2, 
          minZoom: -5,
          maxZoom: 2,
          preferCanvas: true 
        } as any)} 
        scrollWheelZoom 
        className="h-full w-full bg-muted"
      >
        <FitBounds polys={polys} />
        {polys.map((b, i) => {
          const isEnabled = b.enabled === 1;
          const baseColor = b.kind === 'landmark' ? '#3b82f6' : '#22c55e';
          const color = isEnabled ? baseColor : '#94a3b8';
          const fillOpacity = isEnabled ? 0.2 : 0.1;
          const dashArray = isEnabled ? undefined : '5, 5';
          const box = b.box;
          
          return (
            <Polygon 
              key={`${b.kind}-${i}`} 
              positions={b.world} 
              pathOptions={{ color, weight: 1, fillOpacity, dashArray }}
            >
              <Tooltip>
                <div className="text-xs space-y-1">
                  <div className="font-bold text-sm border-b pb-1 mb-1">
                    {b.kind === 'landmark' ? '📍 Landmark' : '🟢 Generic Region'}
                  </div>
                  
                  <div><b>ID:</b> {b.id}</div>
                  <div><b>Region Index:</b> {b.regionIndex}</div>
                  <div><b>Enabled:</b> {b.enabled === 1 ? '✅ Yes' : '❌ No'}</div>
                  
                  <div className="border-t pt-1 mt-1">
                    <div className="font-semibold">Position:</div>
                    <div className="pl-2">
                      X: {box.positionX.toFixed(2)}, 
                      Y: {box.positionY.toFixed(2)}, 
                      Z: {box.positionZ.toFixed(2)}
                    </div>
                  </div>
                  
                  <div>
                    <div className="font-semibold">Rotation:</div>
                    <div className="pl-2">
                      X: {box.rotationX.toFixed(2)}, 
                      Y: {box.rotationY.toFixed(2)}, 
                      Z: {box.rotationZ.toFixed(2)}
                    </div>
                  </div>
                  
                  <div>
                    <div className="font-semibold">Dimensions:</div>
                    <div className="pl-2">
                      X: {box.dimensionX.toFixed(2)}, 
                      Y: {box.dimensionY.toFixed(2)}, 
                      Z: {box.dimensionZ.toFixed(2)}
                    </div>
                  </div>
                  
                  {b.kind === 'landmark' && (
                    <div className="border-t pt-1 mt-1">
                      <div><b>Design Index:</b> {b.data.designIndex}</div>
                      <div><b>District:</b> {b.data.district}</div>
                      <div><b>Flags:</b> {b.data.flags}</div>
                      <div><b>Starting Grids:</b> {b.data.startingGrids.length}</div>
                    </div>
                  )}
                  
                  {b.kind === 'generic' && (
                    <div className="border-t pt-1 mt-1">
                      <div><b>Group ID:</b> {b.data.groupId}</div>
                      <div><b>Type:</b> {getGenericRegionTypeName(b.data.genericType)}</div>
                      <div><b>Camera Cut 1:</b> {b.data.cameraCut1}</div>
                      <div><b>Camera Cut 2:</b> {b.data.cameraCut2}</div>
                      <div><b>Camera Type 1:</b> {getCameraTypeName(b.data.cameraType1)}</div>
                      <div><b>Camera Type 2:</b> {getCameraTypeName(b.data.cameraType2)}</div>
                      <div><b>One Way:</b> {b.data.isOneWay ? 'Yes' : 'No'}</div>
                    </div>
                  )}
                </div>
              </Tooltip>
            </Polygon>
          );
        })}
      </MapContainer>
      )}
      </div>
    </div>
  );
};


