// Schema-editor extension for ICE Data (resource type 0x1000D).
//
// ICE Data is one standalone camera take, so it reuses the dictionary's
// per-channel keyframe editor (IceTakeChannels) — but the take lives at the
// resource ROOT (model.take), not at entries[i].take like the dictionary. The
// take record's `runs` field is the same `iceTakeChannels` custom field; here it
// sits at ['take', 'runs'], so the extension reads the take one segment up at
// ['take'] and rewrites the whole take on edit (the codec re-emits byte-exact
// bits), routed through setData so the workspace marks the resource dirty.

import { IceTakeChannels } from '@/components/ice/IceTakeChannels';
import type { ExtensionRegistry, WholeResourceExtensionProps } from '../context';
import type { ParsedIceData } from '@/lib/core/iceData';
import type { IceTake } from '@/lib/core/iceVariableData';
import { setAtPath } from '@/lib/schema/walk';

function IceDataChannelsField({ path, data, setData }: WholeResourceExtensionProps<unknown>) {
	const root = data as ParsedIceData | undefined;
	const take = root?.take;

	if (!take) {
		return <div className="text-xs text-muted-foreground">Take not found.</div>;
	}

	const takePath = path.slice(0, path.length - 1); // drop the trailing 'runs' → ['take']

	const onChange = (next: IceTake) => {
		setData(setAtPath(data, takePath, next));
	};

	return <IceTakeChannels take={take} onChange={onChange} />;
}

export const iceDataExtensions: ExtensionRegistry = {
	iceTakeChannels: IceDataChannelsField as ExtensionRegistry[string],
};
