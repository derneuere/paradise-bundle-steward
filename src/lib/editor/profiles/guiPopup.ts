import { defineProfile } from '../types';
import type { ParsedGuiPopup } from '@/lib/core/guiPopup';
import { guiPopupResourceSchema } from '@/lib/schema/resources/guiPopup';

export const guiPopupProfile = defineProfile<ParsedGuiPopup>({
	kind: 'default',
	displayName: 'GUI Popup',
	schema: guiPopupResourceSchema,
});
