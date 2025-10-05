import React, { useMemo, useEffect } from 'react';
import { MapContainer, Polygon, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { ParsedTriggerData, Landmark, GenericRegion, BoxRegion } from '@/lib/core/triggerData';

type PolyData = {
  kind: 'landmark' | 'generic';
  id: number;
  regionIndex: number;
  box: BoxRegion;
  world: Array<[number, number]>;
  data: Landmark | GenericRegion;
};

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
  const boxes = useMemo(() => {
    const fromLm = data.landmarks.map(lm => ({
      kind: 'landmark' as const,
      id: lm.id,
      regionIndex: lm.regionIndex,
      box: lm.box,
      data: lm,
    }));
    const fromGen = data.genericRegions.map(gr => ({
      kind: 'generic' as const,
      id: gr.id,
      regionIndex: gr.regionIndex,
      box: gr.box,
      data: gr,
    }));
    return [...fromLm, ...fromGen];
  }, [data.landmarks, data.genericRegions]);

  if (boxes.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">Nothing to display</div>;
  }

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
      const yaw = toYawRadians((b.box as any).rotationY ?? 0);
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

  return (
    <div className="h-[60vh]">
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
          const color = b.kind === 'landmark' ? '#3b82f6' : '#22c55e';
          const box = b.box;
          
          return (
            <Polygon 
              key={`${b.kind}-${i}`} 
              positions={b.world} 
              pathOptions={{ color, weight: 1, fillOpacity: 0.2 }}
            >
              <Tooltip>
                <div className="text-xs space-y-1">
                  <div className="font-bold text-sm border-b pb-1 mb-1">
                    {b.kind === 'landmark' ? '📍 Landmark' : '🟢 Generic Region'}
                  </div>
                  
                  <div><b>ID:</b> {b.id}</div>
                  <div><b>Region Index:</b> {b.regionIndex}</div>
                  
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
                  
                  {b.kind === 'landmark' && (() => {
                    const lm = b.data as Landmark;
                    return (
                      <div className="border-t pt-1 mt-1">
                        <div><b>Design Index:</b> {lm.designIndex}</div>
                        <div><b>District:</b> {lm.district}</div>
                        <div><b>Flags:</b> {lm.flags}</div>
                        <div><b>Starting Grids:</b> {lm.startingGrids.length}</div>
                      </div>
                    );
                  })()}
                  
                  {b.kind === 'generic' && (() => {
                    const gr = b.data as GenericRegion;
                    return (
                      <div className="border-t pt-1 mt-1">
                        <div><b>Group ID:</b> {gr.groupId}</div>
                        <div><b>Generic Type:</b> {gr.genericType}</div>
                        <div><b>Camera Cut 1:</b> {gr.cameraCut1}</div>
                        <div><b>Camera Cut 2:</b> {gr.cameraCut2}</div>
                        <div><b>Camera Type 1:</b> {gr.cameraType1}</div>
                        <div><b>Camera Type 2:</b> {gr.cameraType2}</div>
                        <div><b>One Way:</b> {gr.isOneWay ? 'Yes' : 'No'}</div>
                      </div>
                    );
                  })()}
                </div>
              </Tooltip>
            </Polygon>
          );
        })}
      </MapContainer>
    </div>
  );
};


