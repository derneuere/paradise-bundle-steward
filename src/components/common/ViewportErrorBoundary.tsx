// Error boundary for 3D viewports (react-three-fiber / three.js).
//
// react-three-fiber errors (WebGL context loss, shader compile failure, bad
// geometry) otherwise propagate uncaught and tear down the whole React tree
// — user sees a blank white screen and has to reload the page. This boundary
// catches the throw, shows the error + stack, and lets the user copy it to
// hand back to the developer. `resetKey` switches reset the boundary when
// the user changes resource so they aren't stuck on a stale crash.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
	resetKey?: unknown;
	children: ReactNode;
};

type State = {
	error: Error | null;
	componentStack: string | null;
	copied: boolean;
};

export class ViewportErrorBoundary extends Component<Props, State> {
	state: State = { error: null, componentStack: null, copied: false };

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		this.setState({ componentStack: info.componentStack ?? null });
		// Keep the original throw visible in DevTools too.
		console.error('[ViewportErrorBoundary]', error, info);
	}

	componentDidUpdate(prev: Props): void {
		if (this.state.error && prev.resetKey !== this.props.resetKey) {
			this.setState({ error: null, componentStack: null, copied: false });
		}
	}

	private handleReset = (): void => {
		this.setState({ error: null, componentStack: null, copied: false });
	};

	private handleCopy = async (): Promise<void> => {
		const { error, componentStack } = this.state;
		if (!error) return;
		const payload = [
			`Error: ${error.name}: ${error.message}`,
			'',
			'Stack:',
			error.stack ?? '(no stack)',
			'',
			'Component stack:',
			componentStack ?? '(no component stack)',
			'',
			`URL: ${typeof window !== 'undefined' ? window.location.href : '(unknown)'}`,
			`User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : '(unknown)'}`,
		].join('\n');
		try {
			await navigator.clipboard.writeText(payload);
			this.setState({ copied: true });
			setTimeout(() => this.setState({ copied: false }), 1500);
		} catch {
			// clipboard blocked — user can still select the <pre> text manually.
		}
	};

	render(): ReactNode {
		const { error, componentStack, copied } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="h-full overflow-auto p-4">
				<div className="max-w-3xl mx-auto rounded border border-destructive/40 bg-destructive/5 p-4 space-y-3">
					<div className="flex items-start justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold text-destructive">3D viewport crashed</h2>
							<p className="text-xs text-muted-foreground mt-1">
								Something threw while rendering the 3D view. Please copy the details below and
								send them to the developer — it helps pinpoint the bug. Try Reset or switching
								to a different resource to keep working.
							</p>
						</div>
						<div className="flex gap-1 shrink-0">
							<Button size="sm" variant="outline" className="h-7 text-xs" onClick={this.handleCopy}>
								{copied ? 'Copied' : 'Copy details'}
							</Button>
							<Button size="sm" className="h-7 text-xs" onClick={this.handleReset}>
								Reset
							</Button>
						</div>
					</div>

					<div>
						<div className="text-[11px] font-medium text-muted-foreground">Error</div>
						<pre className="mt-1 text-[11px] font-mono whitespace-pre-wrap break-words rounded bg-background/60 p-2 border border-border">
							{error.name}: {error.message}
						</pre>
					</div>

					{error.stack && (
						<div>
							<div className="text-[11px] font-medium text-muted-foreground">Stack</div>
							<pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-words rounded bg-background/60 p-2 border border-border max-h-60 overflow-auto">
								{error.stack}
							</pre>
						</div>
					)}

					{componentStack && (
						<div>
							<div className="text-[11px] font-medium text-muted-foreground">Component stack</div>
							<pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-words rounded bg-background/60 p-2 border border-border max-h-40 overflow-auto">
								{componentStack}
							</pre>
						</div>
					)}
				</div>
			</div>
		);
	}
}
