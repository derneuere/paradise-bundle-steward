import React, { useEffect, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { HexRow } from './types';
import { formatHex } from './utils.ts';
import { useVirtualizer } from '@tanstack/react-virtual';

export const BYTE_CELL_CLASS = 'px-1 py-0.5 rounded text-xs font-mono';

const ROW_HEIGHT = 30; // estimated row height in px
const OVERSCAN = 20; // rows of overscan

type StaticProps = {
  rows: HexRow[];
  heightClass?: string;
  onClickByte?: (offset: number) => void;
  scrollToRowIndex?: number | null;
};

type LazyProps = {
  rowCount: number;
  getRow: (rowIndex: number) => HexRow;
  heightClass?: string;
  onClickByte?: (offset: number) => void;
  scrollToRowIndex?: number | null;
};

type HexTableProps = StaticProps | LazyProps;

export const HexTable: React.FC<HexTableProps> = (props) => {
  const isStatic = (props as StaticProps).rows !== undefined;
  const heightClass = props.heightClass ?? 'h-[70vh]';
  const onClickByte = (props as any).onClickByte as ((offset: number) => void) | undefined;
  const scrollToRowIndex = (props as any).scrollToRowIndex as number | null | undefined;

  const totalRows = isStatic
    ? (props as StaticProps).rows.length
    : (props as LazyProps).rowCount;

  const getRow = (rowIndex: number): HexRow => {
    if (isStatic) return (props as StaticProps).rows[rowIndex];
    return (props as LazyProps).getRow(rowIndex);
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Programmatic scrolling to a given row index
  useEffect(() => {
    if (typeof scrollToRowIndex === 'number' && !Number.isNaN(scrollToRowIndex)) {
      const idx = Math.max(0, Math.min(totalRows - 1, Math.floor(scrollToRowIndex)));
      rowVirtualizer.scrollToIndex(idx, { align: 'center' });
    }
  }, [scrollToRowIndex, totalRows]);

  const items = rowVirtualizer.getVirtualItems();

  return (
    <Card>
      <CardContent className="p-0">
        <div ref={parentRef} className={`${heightClass} overflow-auto`}>
          <div className="font-mono text-sm" style={{ height: rowVirtualizer.getTotalSize() }}>
            <div className="flex mb-2 pb-2 border-b sticky top-0 bg-background px-4">
              <div className="w-20 text-muted-foreground">Offset</div>              
              <div className="flex-1 text-muted-foreground">Hex Bytes</div>
              <div className="w-48 text-muted-foreground">Decoded</div>
              <div className="w-48 text-muted-foreground">ASCII</div>
            </div>
            <div style={{ position: 'relative' }}>
              {items.map(vi => {
                const rowIndex = vi.index;
                const row = getRow(rowIndex);
                return (
                  <div
                    key={vi.key}
                    className="flex hover:bg-muted/50 items-center px-4 absolute left-0 right-0"
                    style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                    ref={rowVirtualizer.measureElement}
                    data-index={rowIndex}
                    id={`row-${row.offset}`}
                  >
                    <div className="w-20 text-muted-foreground pr-4">{row.offset.toString(16).toUpperCase().padStart(8, '0')}</div>
                    <div className="flex gap-1 flex-shrink-0">
                      {(() => {
                        const nodes: JSX.Element[] = [];
                        const groups = row.groups?.slice().sort((a, b) => a.colStart - b.colStart) ?? [];
                        const rowLen = row.hexBytes.length;
                        let cursor = 0;

                        const renderRange = (start: number, end: number) => {
                          for (let i = start; i < end; i++) {
                            const byteInfo = row.hexBytes[i];
                            nodes.push(
                              <div key={`b-${i}`} className={`${BYTE_CELL_CLASS} ${byteInfo.color} text-white`} title={`${byteInfo.section} - Offset: 0x${byteInfo.offset.toString(16).toUpperCase()}`} onClick={() => onClickByte?.(byteInfo.offset)}>
                                {formatHex(byteInfo.byte)}
                              </div>
                            );
                          }
                        };

                        for (const [gi, g] of groups.entries()) {
                          const s = Math.max(0, g.colStart);
                          const e = Math.min(rowLen, g.colEnd);
                          if (e <= s) continue;
                          if (cursor < s) renderRange(cursor, s);
                          nodes.push(
                            <div key={`g-${gi}-${row.offset}`} className={`flex gap-1 ${g.classes}`} title={g.title}>
                              {(() => {
                                const inner: JSX.Element[] = [];
                                for (let i = s; i < e; i++) {
                                  const byteInfo = row.hexBytes[i];
                                  inner.push(
                                    <div key={`gb-${i}`} className={`${BYTE_CELL_CLASS} ${byteInfo.color} text-white`} onClick={() => onClickByte?.(byteInfo.offset)}>
                                      {formatHex(byteInfo.byte)}
                                    </div>
                                  );
                                }
                                return inner;
                              })()}
                            </div>
                          );
                          cursor = e;
                        }
                        if (cursor < rowLen) renderRange(cursor, rowLen);
                        return nodes;
                      })()}
                    </div>
                    {(() => {
                      const title = row.decodedItems && row.decodedItems.length > 0
                        ? row.decodedItems.map(it => `${it.label ? it.label + ': ' : ''}${it.value}`).join(' • ')
                        : (row.decoded || '');
                      return (
                        <div className="flex-1 min-w-0 pl-4 font-mono text-muted-foreground overflow-none whitespace-nowrap" title={title}>
                          {row.decodedItems && row.decodedItems.length > 0 ? (
                            <div className="inline-flex items-start gap-1 whitespace-nowrap">
                              {row.decodedItems.map((it, idx) => (
                                <span key={idx} className="inline-flex flex-col items-start rounded border border-border bg-secondary/60 px-1.5 py-1 text-foreground">
                                  {it.label ? <span className="text-[10px] text-muted-foreground leading-none">{it.label}</span> : null}
                                  <span className="text-[11px] leading-none">{it.value}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="whitespace-nowrap">{row.decoded}</div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="w-48 pl-4 font-mono text-muted-foreground truncate">{row.ascii}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
