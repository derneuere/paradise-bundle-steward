// Schema-editor extension for the ICE Take Dictionary (resource type 0x41).
//
// A take's 48 keyframed elements can't be described as a static record: the
// right control for each value depends on the element's data type, token list,
// and range (resolved from the ICE element-descriptions table at runtime). So
// the take record's `runs` field is a `custom` field rendered here, mounting
// the reusable IceTakeChannels editor.
//
// The custom field sits at `entries[i].take.runs`; `value` is the runs array.
// We read the whole take from the resource root at the parent path so the
// editor can group by channel and recompute packed bits on edit, then write a
// new take back through setData (the codec re-emits byte-exact bits).

import { IceTakeChannels } from '@/components/ice/IceTakeChannels';
import type { ExtensionRegistry, WholeResourceExtensionProps } from '../context';
import type {
	IceDictionaryEntry,
	IceTakeDictionary,
} from '@/lib/core/iceTakeDictionary';
import type { IceTake } from '@/lib/core/iceVariableData';
import { setAtPath } from '@/lib/schema/walk';

// The runs custom field path is ['entries', i, 'take', 'runs']; the take lives
// one segment up at ['entries', i, 'take']. We rewrite the whole take on edit
// (the runs array alone isn't enough — the writer needs the full take), routed
// through setData so the workspace marks the resource dirty.
function IceTakeChannelsField({ path, data, setData }: WholeResourceExtensionProps<unknown>) {
	const root = data as IceTakeDictionary | undefined;
	const entryIndex = typeof path[1] === 'number' ? path[1] : Number(path[1]);
	const entry: IceDictionaryEntry | undefined = root?.entries?.[entryIndex];
	const take = entry?.take;

	if (!take) {
		return <div className="text-xs text-muted-foreground">Take not found.</div>;
	}

	const takePath = path.slice(0, path.length - 1); // drop the trailing 'runs'

	const onChange = (next: IceTake) => {
		setData(setAtPath(data, takePath, next));
	};

	return <IceTakeChannels take={take} onChange={onChange} />;
}

export const iceTakeDictionaryExtensions: ExtensionRegistry = {
	iceTakeChannels: IceTakeChannelsField as ExtensionRegistry[string],
};
