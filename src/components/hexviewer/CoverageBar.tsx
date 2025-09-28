import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CoverageSegment } from './types';

type CoverageBarProps = {
  coveragePercent: number;
  segments: CoverageSegment[];
  breakdown: Record<string, number>;
  totalBytes: number;
  bytesPerRow: number;
  onClickSegment: (seg: CoverageSegment) => void;
};

export const CoverageBar: React.FC<CoverageBarProps> = ({ coveragePercent, segments, breakdown, totalBytes, bytesPerRow, onClickSegment }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Bundle Coverage: {coveragePercent}% parsed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="w-full h-4 rounded border overflow-hidden flex">
          {segments.map((seg, idx) => {
            const widthPct = totalBytes ? ((seg.end - seg.start) / totalBytes) * 100 : 0;
            return (
              <div
                key={idx}
                className={`h-full ${seg.color} ${seg.kind === 'unparsed' ? 'opacity-60' : ''} cursor-pointer hover:opacity-90`}
                style={{ width: `${widthPct}%` }}
                title={`${seg.name} • ${(seg.end - seg.start).toLocaleString()} bytes • ${Math.round(widthPct * 10) / 10}%`}
                onClick={() => onClickSegment(seg)}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded bg-blue-500" /> Header ({totalBytes ? Math.round((breakdown['Header'] / totalBytes) * 1000) / 10 : 0}%)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded bg-green-500" /> Resource Entries ({totalBytes ? Math.round((breakdown['Resource Entries'] / totalBytes) * 1000) / 10 : 0}%)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded bg-purple-500" /> Resource Data ({totalBytes ? Math.round((breakdown['Resource Data'] / totalBytes) * 1000) / 10 : 0}%)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded bg-orange-500" /> Debug Data ({totalBytes ? Math.round((breakdown['Debug Data'] / totalBytes) * 1000) / 10 : 0}%)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded bg-gray-300" /> Unparsed ({totalBytes ? Math.round((breakdown['Unparsed'] / totalBytes) * 1000) / 10 : 0}%)</div>
        </div>
      </CardContent>
    </Card>
  );
};
