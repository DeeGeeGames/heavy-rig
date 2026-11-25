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
