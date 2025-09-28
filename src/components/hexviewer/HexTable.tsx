import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { HexRow } from './types';
import { formatHex } from './utils.ts';

type HexTableProps = {
  rows: HexRow[];
};

export const HexTable: React.FC<HexTableProps> = ({ rows }) => {
  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="h-[70vh]">
          <div className="font-mono text-sm p-4">
            <div className="flex mb-2 pb-2 border-b sticky top-0 bg-background">
              <div className="w-20 text-muted-foreground">Offset</div>
              <div className="flex-1 text-muted-foreground">Hex Bytes</div>
              <div className="w-48 text-muted-foreground">ASCII</div>
            </div>
            {rows.map((row) => (
              <div key={row.offset} id={`row-${row.offset}`} className="flex hover:bg-muted/50 py-1">
                <div className="w-20 text-muted-foreground pr-4">{row.offset.toString(16).toUpperCase().padStart(8, '0')}</div>
                <div className="flex-1 flex gap-1">
                  {row.hexBytes.map((byteInfo, byteIndex) => (
                    <div key={byteIndex} className={`px-1 py-0.5 rounded text-xs ${byteInfo.color} text-white font-mono`} title={`${byteInfo.section} - Offset: 0x${byteInfo.offset.toString(16).toUpperCase()}`}>
                      {formatHex(byteInfo.byte)}
                    </div>
                  ))}
                </div>
                <div className="w-48 pl-4 font-mono text-muted-foreground">{row.ascii}</div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
