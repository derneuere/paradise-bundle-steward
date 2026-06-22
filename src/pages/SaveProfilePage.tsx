// Standalone Burnout Paradise save-profile editor (/save). The profile is a
// platform-headered ProfileStoredData file, not a BND2 bundle, so it has its
// own route/layout and never touches the bundle Workspace.

import { useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Upload, Download, Save, Layers, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SaveProfileProvider, useSaveProfile } from '@/context/SaveProfileContext';
import { HeaderInfoPanel } from '@/components/saveprofile/HeaderInfoPanel';
import { ChunkEditor } from '@/components/saveprofile/ChunkEditor';

const ACCEPT = '.BurnoutParadiseSave,.sav,.dat,application/octet-stream';

function SaveProfileInner() {
	const { save, fileName, dirty, error, load, download } = useSaveProfile();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [selected, setSelected] = useState<string>('header');

	const selectedChunk = save?.chunks.find((c) => c.key === selected) ?? null;

	return (
		<div className="h-screen flex flex-col bg-background">
			<header className="border-b bg-card/50 backdrop-blur">
				<div className="px-6 py-4 flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold tracking-tight">Save Profile Editor</h1>
						<p className="text-muted-foreground">Burnout Paradise progression profile (Profile.BurnoutParadiseSave)</p>
					</div>
					<div className="flex items-center gap-3">
						{save && <Badge variant="outline">{save.variant.label}</Badge>}
						{dirty && <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Modified</Badge>}
						<input ref={fileInputRef} type="file" accept={ACCEPT} className="hidden"
							onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
						<Button onClick={() => fileInputRef.current?.click()} className="gap-2">
							<Upload className="w-4 h-4" /> Load Profile
						</Button>
						{save && (
							<Button onClick={download} variant="outline" className="gap-2">
								<Download className="w-4 h-4" /> Save Profile
							</Button>
						)}
					</div>
				</div>
				<nav className="px-6 py-2 border-t flex items-center gap-2">
					<NavLink to="/workspace" className="px-3 py-1.5 rounded hover:bg-muted/60 text-sm">
						<Layers className="inline w-4 h-4 mr-1" /> Bundle Workspace
					</NavLink>
					<NavLink to="/save" className="px-3 py-1.5 rounded bg-muted text-sm">
						<Save className="inline w-4 h-4 mr-1" /> Save Editor
					</NavLink>
				</nav>
			</header>

			<main className="flex-1 min-h-0 overflow-hidden">
				{!save ? (
					<EmptyState error={error} onLoad={() => fileInputRef.current?.click()} />
				) : (
					<div className="h-full flex">
						<aside className="w-64 shrink-0 border-r overflow-auto p-2">
							<SidebarItem label="File Header" active={selected === 'header'} onClick={() => setSelected('header')} />
							<div className="px-2 py-1 mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Chunks</div>
							{save.chunks.map((c) => (
								<SidebarItem key={c.key} label={c.name} decoded={!!c.spec} sub={`0x${c.size.toString(16)}`}
									active={selected === c.key} onClick={() => setSelected(c.key)} />
							))}
						</aside>
						<section className="flex-1 min-w-0 overflow-auto p-6">
							{selected === 'header' && <HeaderInfoPanel save={save} />}
							{selectedChunk && <ChunkEditor save={save} chunk={selectedChunk} />}
						</section>
					</div>
				)}
			</main>
		</div>
	);
}

function SidebarItem({ label, sub, active, decoded, onClick }: { label: string; sub?: string; active: boolean; decoded?: boolean; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick}
			className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between gap-2 ${active ? 'bg-muted font-medium' : 'hover:bg-muted/50'}`}>
			<span className="truncate">{label}</span>
			<span className="flex items-center gap-1 shrink-0">
				{decoded && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="decoded into fields" />}
				{sub && <span className="text-[10px] font-mono text-muted-foreground">{sub}</span>}
			</span>
		</button>
	);
}

function EmptyState({ error, onLoad }: { error: string | null; onLoad: () => void }) {
	return (
		<div className="h-full flex flex-col items-center justify-center text-center space-y-4 p-6">
			<div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
				{error ? <FileWarning className="w-8 h-8 text-yellow-600" /> : <Upload className="w-8 h-8 text-muted-foreground" />}
			</div>
			<div>
				<h3 className="text-lg font-medium">No profile loaded</h3>
				<p className="text-muted-foreground max-w-md">
					Load a <code className="px-1 rounded bg-muted">Profile.BurnoutParadiseSave</code> (PC / Remastered RGMH,
					Xbox 360 MC02, or a raw PS3/PS4/Switch profile). Editing patches bytes in place; saving round-trips byte-exact.
				</p>
				{error && <p className="text-sm text-yellow-600 mt-2">{error}</p>}
			</div>
			<Button onClick={onLoad} className="gap-2"><Upload className="w-4 h-4" /> Load Profile File</Button>
		</div>
	);
}

export default function SaveProfilePage() {
	return (
		<SaveProfileProvider>
			<SaveProfileInner />
		</SaveProfileProvider>
	);
}
