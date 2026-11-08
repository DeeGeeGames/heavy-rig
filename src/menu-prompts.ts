import { render } from 'lit-html';
import { renderGlyph, type PromptAction, type PromptDevice } from './input-prompts';

const actions: readonly PromptAction[] = ['previousDepartment', 'nextDepartment', 'previousPage', 'nextPage', 'confirm', 'back', 'help', 'discard', 'move', 'settings'];
export const refreshNavigationGlyphs = function (root: HTMLElement, device: PromptDevice) {
	for (const target of root.querySelectorAll<HTMLElement>('[data-menu-glyph]')) {
		const action = actions.find(function (candidate) { return candidate === target.dataset['menuGlyph']; });
		if (!action || target.dataset['glyphDevice'] === device) continue;
		render(renderGlyph(device, action), target); target.dataset['glyphDevice'] = device;
	}
};
export const menuActionLabel = function (target: HTMLElement | undefined) {
	if (!target) return 'Select';
	if (target.matches('[data-loadout-slot]')) return 'Change mount';
	if (target.matches('[data-equip-weapon]')) return 'Fit weapon';
	if (target.matches('[data-contract]')) return 'View briefing';
	if (target.matches('[data-market-weapon], [data-market-frame]')) return 'Inspect item';
	if (target.matches('[data-owned-frame]')) return 'Select frame';
	if (target.matches('[data-page-previous]')) return 'Previous content page';
	if (target.matches('[data-page-next]')) return 'Next content page';
	if (target.matches('input, select')) return 'Adjust';
	return target.getAttribute('aria-label') ?? target.textContent?.replace(/\s+/g, ' ').trim() ?? 'Select';
};
