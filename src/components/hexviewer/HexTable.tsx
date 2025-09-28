import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { HexRow } from './types';
import { formatHex } from './utils.ts';

export const BYTE_CELL_CLASS = 'px-1 py-0.5 rounded text-xs font-mono';

const ROW_HEIGHT = 30; // fixed row height in px
const OVERSCAN = 20; // rows of overscan

type StaticProps = {
  rows: HexRow[];
  heightClass?: string;
};

type LazyProps = {
  rowCount: number;
  getRow: (rowIndex: number) => HexRow;
  heightClass?: string;
};

type HexTableProps = StaticProps | LazyProps;

export const HexTable: React.FC<HexTableProps> = (props) => {
  const isStatic = (props as StaticProps).rows !== undefined;
  const heightClass = props.heightClass ?? 'h-[70vh]';

  const totalRows = isStatic
    ? (props as StaticProps).rows.length
    : (props as LazyProps).rowCount;

  // virtualization state
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

  const getRow = (rowIndex: number): HexRow => {
    if (isStatic) return (props as StaticProps).rows[rowIndex];
    return (props as LazyProps).getRow(rowIndex);
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div ref={viewportRef} className={`${heightClass} overflow-auto`} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
          <div className="font-mono text-sm" style={{ height: totalRows * ROW_HEIGHT }}>
            <div className="flex mb-2 pb-2 border-b sticky top-0 bg-background px-4">
              <div className="w-20 text-muted-foreground">Offset</div>
              <div className="flex-1 text-muted-foreground">Hex Bytes</div>
              <div className="w-48 text-muted-foreground">ASCII</div>
            </div>
            <div style={{ transform: `translateY(${startRow * ROW_HEIGHT}px)` }}>
              {(() => {
                const items: JSX.Element[] = [];
                for (let rowIndex = startRow; rowIndex < endRow; rowIndex++) {
                  const row = getRow(rowIndex);
                  items.push(
                    <div key={row.offset} id={`row-${row.offset}`} className="flex hover:bg-muted/50 items-center px-4" style={{ height: ROW_HEIGHT }}>
                      <div className="w-20 text-muted-foreground pr-4">{row.offset.toString(16).toUpperCase().padStart(8, '0')}</div>
                      <div className="flex-1 flex gap-1">
                        {row.hexBytes.map((byteInfo, byteIndex) => (
                          <div key={byteIndex} className={`${BYTE_CELL_CLASS} ${byteInfo.color} text-white`} title={`${byteInfo.section} - Offset: 0x${byteInfo.offset.toString(16).toUpperCase()}`}>
                            {formatHex(byteInfo.byte)}
                          </div>
                        ))}
                      </div>
                      <div className="w-48 pl-4 font-mono text-muted-foreground">{row.ascii}</div>
                    </div>
                  );
                }
                return items;
              })()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
