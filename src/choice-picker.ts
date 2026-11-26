import { html, nothing, render } from 'lit-html';
import { focusMenuControl } from './menu-focus';

interface Choice<T> {
	value: T;
	label: string;
	detail?: string;
	disabled?: boolean;
}

export const mountChoicePicker = function (container: HTMLElement, signal: AbortSignal, changed: () => void) {
	const overlay = document.createElement('div');
	overlay.id = 'choice-picker';
	overlay.className = 'choice-overlay';
	overlay.hidden = true;
	container.append(overlay);
	let active: { trigger: HTMLButtonElement; surface: HTMLElement } | undefined;

	const dismiss = function (restoreFocus: boolean, apply?: () => void) {
		if (!active) return false;
		const { trigger, surface } = active;
		active = undefined;
		overlay.hidden = true;
		render(nothing, overlay);
		surface.inert = Boolean(surface.hidden);
		trigger.setAttribute('aria-expanded', 'false');
		apply?.();
		if (restoreFocus) {
			const opener = document.getElementById(trigger.id);
			if (opener instanceof HTMLButtonElement && surface.contains(opener) && !opener.closest('[hidden], [inert]')) focusMenuControl(opener);
		}
		if (!signal.aborted) changed();
		return true;
	};
	const close = function (restoreFocus = true) { return dismiss(restoreFocus); };
	overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); }, { signal });
	signal.addEventListener('abort', function () { close(false); overlay.remove(); }, { once: true });

	const field = function <T extends string | number | null>(id: string, label: string, value: T, choices: readonly Choice<T>[], choose: (value: T) => void, title = label, disabled = false) {
		const draw = function () {
			render(html`<section class="choice-panel" role="dialog" aria-modal="true" aria-labelledby="choice-heading">
				<h2 id="choice-heading">${title}</h2>
				<div class="choice-options">
					${choices.map(function (choice) {
						return html`<button type="button" class="choice-option" value=${choice.value ?? ''} aria-pressed=${choice.value === value}
							?disabled=${Boolean(choice.disabled)} @click=${function () {
								if (!choice.disabled) dismiss(true, choice.value === value ? undefined : function () { choose(choice.value); });
							}}>
							<span>${choice.label}</span>${choice.detail ? html`<small>${choice.detail}</small>` : ''}
						</button>`;
					})}
					<button type="button" class="choice-cancel" @click=${function () { close(); }}>Cancel</button>
				</div>
			</section>`, overlay);
		};
		const expanded = active?.trigger.id === id;
		// A newly claimed controller can change binding labels while this list is open.
		if (expanded) draw();
		const open = function (event: Event) {
			const trigger = event.currentTarget;
			if (active || !(trigger instanceof HTMLButtonElement) || trigger.closest('[inert], [hidden]')) return;
			const surface = trigger.closest<HTMLElement>('.menu-surface');
			if (!surface) return;
			active = { trigger, surface };
			trigger.setAttribute('aria-expanded', 'true');
			surface.inert = true;
			overlay.hidden = false;
			draw();
			const current = overlay.querySelector<HTMLButtonElement>('.choice-option[aria-pressed="true"]:enabled') ?? overlay.querySelector<HTMLButtonElement>('button:enabled');
			if (current) focusMenuControl(current);
			changed();
		};
		return html`<button type="button" class="choice-field" ?disabled=${disabled} id=${id} value=${value ?? ''}
			aria-haspopup="dialog" aria-expanded=${expanded} aria-controls="choice-picker" @click=${open}>
			<span class="choice-caption">${label}</span><span class="choice-value">${choices.find(function (option) { return option.value === value; })?.label}</span>
		</button>`;
	};
	return { field, close, get root() { return active ? overlay : undefined; } };
};
export type ChoicePicker = ReturnType<typeof mountChoicePicker>;
