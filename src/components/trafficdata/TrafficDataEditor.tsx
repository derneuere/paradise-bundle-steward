import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import { useTrafficSelection } from './useTrafficSelection';
import { OverviewTab } from './OverviewTab';
import { SectionsTab } from './SectionsTab';
import { LaneRungsTab } from './LaneRungsTab';
import { JunctionsTab } from './JunctionsTab';
import { FlowTypesTab } from './FlowTypesTab';
import { KillZonesTab } from './KillZonesTab';
import { VehiclesTab } from './VehiclesTab';
import { TrafficLightsTab } from './TrafficLightsTab';
import { PaintColoursTab } from './PaintColoursTab';
import { TrafficDataViewport } from './TrafficDataViewport';

type Props = {
	data: ParsedTrafficData;
	onChange: (next: ParsedTrafficData) => void;
};

export const TrafficDataEditor: React.FC<Props> = ({ data, onChange }) => {
	const { selected, select, activeHullIndex, setActiveHullIndex, tab, setTab, scrollToIndexRef } = useTrafficSelection();
	const [showViewport, setShowViewport] = useState(true);

	const hull = data.hulls[activeHullIndex];
	const perHullTabs = ['sections', 'rungs', 'junctions'];
	const isPerHull = perHullTabs.includes(tab);

	return (
		<>
			<div className="flex items-center justify-between mb-2 gap-2">
				{/* Hull selector — shown when a per-hull tab is active */}
				{isPerHull && data.hulls.length > 0 && (
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground">Hull:</span>
						<Select
							value={String(activeHullIndex)}
							onValueChange={(v) => setActiveHullIndex(Number(v))}
						>
							<SelectTrigger className="h-8 w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{data.hulls.map((_, i) => (
									<SelectItem key={i} value={String(i)}>
										Hull {i} ({data.hulls[i].sections.length} sec)
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
				<div className="ml-auto">
					<Button size="sm" variant="outline" onClick={() => setShowViewport((v) => !v)}>
						{showViewport ? 'Hide 3D' : 'Show 3D'}
					</Button>
				</div>
			</div>

			{showViewport && (
				<TrafficDataViewport
					data={data}
					activeHullIndex={activeHullIndex}
					selected={selected}
					onSelect={select}
					activeTab={tab}
				/>
			)}

			<Tabs value={tab} onValueChange={setTab} className="mt-4">
				<TabsList className="flex-wrap">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="sections">Sections{hull ? ` (${hull.sections.length})` : ''}</TabsTrigger>
					<TabsTrigger value="rungs">Rungs{hull ? ` (${hull.rungs.length})` : ''}</TabsTrigger>
					<TabsTrigger value="junctions">Junctions{hull ? ` (${hull.junctions.length})` : ''}</TabsTrigger>
					<TabsTrigger value="flowTypes">Flow Types ({data.flowTypes.length})</TabsTrigger>
					<TabsTrigger value="killZones">Kill Zones ({data.killZones.length})</TabsTrigger>
					<TabsTrigger value="vehicles">Vehicles ({data.vehicleTypes.length})</TabsTrigger>
					<TabsTrigger value="lights">Lights</TabsTrigger>
					<TabsTrigger value="paint">Paint ({data.paintColours.length})</TabsTrigger>
				</TabsList>

				<TabsContent value="overview">
					<OverviewTab data={data} onChange={onChange} onHullClick={setActiveHullIndex} />
				</TabsContent>
				<TabsContent value="sections">
					{hull && (
						<SectionsTab
							data={data}
							hullIndex={activeHullIndex}
							onChange={onChange}
							selected={selected}
							onSelect={select}
							scrollToIndexRef={scrollToIndexRef}
						/>
					)}
				</TabsContent>
				<TabsContent value="rungs">
					{hull && (
						<LaneRungsTab
							data={data}
							hullIndex={activeHullIndex}
							onChange={onChange}
							scrollToIndexRef={scrollToIndexRef}
						/>
					)}
				</TabsContent>
				<TabsContent value="junctions">
					{hull && (
						<JunctionsTab
							data={data}
							hullIndex={activeHullIndex}
							onChange={onChange}
							selected={selected}
							onSelect={select}
							scrollToIndexRef={scrollToIndexRef}
						/>
					)}
				</TabsContent>
				<TabsContent value="flowTypes">
					<FlowTypesTab data={data} onChange={onChange} />
				</TabsContent>
				<TabsContent value="killZones">
					<KillZonesTab data={data} onChange={onChange} />
				</TabsContent>
				<TabsContent value="vehicles">
					<VehiclesTab data={data} onChange={onChange} />
				</TabsContent>
				<TabsContent value="lights">
					<TrafficLightsTab data={data} onChange={onChange} />
				</TabsContent>
				<TabsContent value="paint">
					<PaintColoursTab data={data} onChange={onChange} />
				</TabsContent>
			</Tabs>
		</>
	);
};
