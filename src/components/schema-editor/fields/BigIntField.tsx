import { Input } from '@/components/ui/input';
import { FieldShell, type FieldRendererProps } from './common';

type Props = FieldRendererProps<bigint> & {
	hex?: boolean;
};

// BigInt rendered either as decimal or hex. Rejects invalid input silently
// (re-renders from the current value).
export function BigIntField({ label, value, onChange, meta, hex }: Props) {
	const current = value ?? 0n;
	const display = hex ? `0x${current.toString(16).toUpperCase()}` : current.toString();
	return (
		<FieldShell label={label} description={meta?.description} warning={meta?.warning}>
			<Input
				className="h-8 font-mono text-xs"
				disabled={meta?.readOnly}
				value={display}
				onChange={(e) => {
					const raw = e.target.value.trim();
					try {
						if (hex) {
							const stripped = raw.replace(/^0x/i, '') || '0';
							onChange(BigInt(`0x${stripped}`));
						} else {
							onChange(BigInt(raw || '0'));
						}
					} catch {
						// ignore — re-render reverts to previous value
					}
				}}
			/>
		</FieldShell>
	);
}
