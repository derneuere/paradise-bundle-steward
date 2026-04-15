// Unity-style 3-pane layout: hierarchy tree left, viewport center, inspector right.

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { HierarchyTree } from './HierarchyTree';
import { InspectorPanel } from './InspectorPanel';
import { ViewportPane } from './ViewportPane';

export function SchemaEditor() {
	return (
		<div className="h-[calc(100vh-180px)] border rounded-lg overflow-hidden bg-card">
			<ResizablePanelGroup direction="horizontal">
				{/* Left — Hierarchy */}
				<ResizablePanel defaultSize={20} minSize={14} className="bg-background">
					<div className="h-full flex flex-col">
						<div className="px-3 py-2 border-b text-xs font-semibold tracking-wide text-muted-foreground">
							Hierarchy
						</div>
						<div className="flex-1 min-h-0">
							<HierarchyTree />
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle withHandle />

				{/* Center — Viewport */}
				<ResizablePanel defaultSize={50} minSize={20}>
					<div className="h-full flex flex-col">
						<div className="px-3 py-2 border-b text-xs font-semibold tracking-wide text-muted-foreground">
							Scene
						</div>
						<div className="flex-1 min-h-0">
							<ViewportPane />
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle withHandle />

				{/* Right — Inspector */}
				<ResizablePanel defaultSize={30} minSize={18} className="bg-background">
					<div className="h-full flex flex-col">
						<div className="px-3 py-2 border-b text-xs font-semibold tracking-wide text-muted-foreground">
							Inspector
						</div>
						<div className="flex-1 min-h-0">
							<InspectorPanel />
						</div>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
