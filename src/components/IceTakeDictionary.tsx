import { useMemo, useState } from 'react';
import type { ParsedIceTakeDictionary, ICETakeHeader } from '@/lib/core/iceTakeDictionary';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const IceTakeDictionaryComponent = ({ dictionary }: { dictionary: ParsedIceTakeDictionary }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ICETakeHeader | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'length' | 'keys'>('name');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [showEmptyChannels, setShowEmptyChannels] = useState<boolean>(false);

  const channelNames = [
    'Main', 'Blend', 'Raw Focus', 'Shake', 'Time', 'Tag',
    'Overlay', 'Letterbox', 'Fade', 'PostFX', 'Assembly', 'Shake Data'
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = dictionary.takes.filter(t => (
      (q.length === 0 || t.name.toLowerCase().includes(q) || t.guid.toString().includes(q)) &&
      (channelFilter === 'all' || t.elementCounts[Number(channelFilter)]?.mu16Keys > 0)
    ));

    // Sort
    list = list.slice().sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'length') return b.lengthSeconds - a.lengthSeconds;
      const aKeys = a.elementCounts.reduce((s, e) => s + e.mu16Keys, 0);
      const bKeys = b.elementCounts.reduce((s, e) => s + e.mu16Keys, 0);
      return bKeys - aKeys;
    });
    return list;
  }, [dictionary.takes, query, sortBy, channelFilter]);

  const totalKeys = (t: ICETakeHeader) => t.elementCounts.reduce((sum, e) => sum + e.mu16Keys, 0);
  const activeChannels = (t: ICETakeHeader) => t.elementCounts.reduce((sum, e) => sum + (e.mu16Keys > 0 ? 1 : 0), 0);

  const ChannelBar = ({ t }: { t: ICETakeHeader }) => {
    const total = totalKeys(t) || 1;
    return (
      <div className="flex h-2 w-full rounded overflow-hidden bg-muted">
        {t.elementCounts.map((e, idx) => {
          const pct = Math.max(0.5, (e.mu16Keys / total) * 100);
          if (!showEmptyChannels && e.mu16Keys === 0) return null;
          return (
            <div
              key={idx}
              className="h-full"
              style={{ width: `${pct}%`, backgroundColor: channelColor(idx) }}
              title={`${channelNames[idx]}: ${e.mu16Keys} keys`}
            />
          );
        })}
      </div>
    );
  };

  const channelColor = (idx: number): string => {
    const palette = [
      '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316', '#22c55e', '#ef4444',
      '#eab308', '#14b8a6', '#f43f5e', '#a3e635', '#6366f1', '#f59e0b'
    ];
    return palette[idx % palette.length];
  };

  const ChannelTimeline = ({ keys, intervals, color, lengthSeconds }: { keys: number; intervals: number; color: string; lengthSeconds: number }) => {
    const intervalPositions = useMemo(() => {
      const n = Math.max(0, intervals);
      // draw separators between segments (exclude start/end)
      return Array.from({ length: Math.max(0, n - 1) }, (_, i) => ((i + 1) / n) * 100);
    }, [intervals]);

    const keyPositions = useMemo(() => {
      const k = Math.max(0, keys);
      // spread keys evenly across duration if we only know count
      return Array.from({ length: k }, (_, i) => ((i + 1) / (k + 1)) * 100);
    }, [keys]);

    return (
      <div className="mt-2">
        <div className="relative h-6 w-full rounded bg-muted">
          {/* baseline */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-border" />
          {/* interval separators */}
          {intervalPositions.map((pct, i) => (
            <div key={`i-${i}`} className="absolute top-0 bottom-0 w-px bg-border/70" style={{ left: `${pct}%` }} title={`Interval ${i + 1}/${intervals}`} />
          ))}
          {/* key markers */}
          {keyPositions.map((pct, i) => (
            <div
              key={`k-${i}`}
              className="absolute -translate-x-1/2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
              style={{ left: `${pct}%`, backgroundColor: color }}
              title={`Key ${i + 1}/${keys}${lengthSeconds ? ` @ ${(pct / 100 * lengthSeconds).toFixed(2)}s` : ''}`}
            />
          ))}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {intervals} intervals • {keys} keys
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">ICE Dictionary</Badge>
          <span className="text-sm text-muted-foreground">
            {dictionary.totalTakes} takes • {dictionary.is64Bit ? '64-bit' : '32-bit'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: Name</SelectItem>
                <SelectItem value="length">Sort: Length</SelectItem>
                <SelectItem value="keys">Sort: Keys</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                {channelNames.map((n, i) => (
                  <SelectItem key={i} value={String(i)}>Has {n} keys</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={showEmptyChannels} onChange={(e) => setShowEmptyChannels(e.target.checked)} />
            Show empty channels
          </label>
          <div className="w-72">
            <Input
              placeholder="Search takes by name or GUID..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Takes ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[480px] overflow-auto">
            {filtered.length === 0 && (
              <div className="text-sm text-muted-foreground">No takes match your search.</div>
            )}
            {filtered.map((t) => (
              <button
                key={`${t.offset}-${t.guid}-${t.name}`}
                onClick={() => setSelected(t)}
                className={`w-full text-left p-2 rounded border transition-colors ${selected?.offset === t.offset ? 'bg-muted' : 'hover:bg-muted/60'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="truncate">
                    <div className="text-sm font-medium truncate" title={t.name}>{t.name || '(unnamed)'}</div>
                    <div className="text-xs text-muted-foreground">Len {t.lengthSeconds.toFixed(2)}s • Keys {totalKeys(t)} • {activeChannels(t)} ch</div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap ml-2">GUID {t.guid}</div>
                </div>
                <div className="mt-2"><ChannelBar t={t} /></div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.elementCounts.map((e, idx) => {
                    if (!showEmptyChannels && e.mu16Keys === 0) return null;
                    return (
                      <span key={idx} className="px-1.5 py-0.5 rounded text-[10px] border" style={{ borderColor: channelColor(idx), color: channelColor(idx) }}>
                        {channelNames[idx]}: {e.mu16Keys}
                      </span>
                    );
                  })}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Details</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <div className="text-sm text-muted-foreground">Select a take to view details.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-medium">{selected.name || '(unnamed)'}</div>
                  <Badge variant="secondary" className="text-xs">{dictionary.is64Bit ? '64-bit' : '32-bit'}</Badge>
                  <Badge variant="secondary" className="text-xs">Len {selected.lengthSeconds.toFixed(3)}s</Badge>
                  <Badge variant="secondary" className="text-xs">GUID {selected.guid}</Badge>
                  <Badge variant="secondary" className="text-xs">Allocated {selected.allocated}</Badge>
                  <Badge variant="secondary" className="text-xs">Offset {selected.offset}</Badge>
                  <Badge variant="secondary" className="text-xs">Total Keys {totalKeys(selected)}</Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {selected.elementCounts.map((c, idx) => (
                    <div key={idx} className="border rounded p-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: channelColor(idx) }} />
                          {channelNames[idx]}
                        </div>
                        <div className="text-xs" style={{ color: channelColor(idx) }}>{c.mu16Keys} keys</div>
                      </div>
                      <ChannelTimeline keys={c.mu16Keys} intervals={c.mu16Intervals} color={channelColor(idx)} lengthSeconds={selected.lengthSeconds} />
                    </div>
                  ))}
                </div>

                <div className="text-xs text-muted-foreground">
                  Offset: 0x{selected.offset.toString(16).toUpperCase()}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};


