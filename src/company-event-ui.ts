import { html, render } from 'lit-html';
import type { Campaign } from './campaign';
import { describeEvent } from './company-event-catalog';
import { getPlanet } from './universe';

export const renderCompanyEvent = function (root: HTMLElement, campaign: Campaign, choose: (id: string) => void, close: () => void) {
	const pending = campaign.events?.pending;
	const last = campaign.events?.last;
	const report = pending ? describeEvent(campaign, pending) : undefined;
	if (!report && !last) return;
	render(html`
		<div class="event-dispatch">
			<header class="dialog-heading">
				<span class="eyebrow">${report?.category ?? 'Decision recorded'} · Day ${campaign.day}</span>
				<h2 id="company-event-title">${report?.title ?? last?.title}</h2>
			</header>
			<div class="event-context"><span>Wayfarer / ${getPlanet(campaign.planetId).name}</span><span>${campaign.credits.toLocaleString()} CR</span></div>
			${report ? html`
				<p class="event-narrative">${report.body}</p>
				<div class="event-choices">${report.choices.map(function (option) {
					return html`<button type="button" data-event-choice=${option.id} ?disabled=${!option.enabled} @click=${function () { choose(option.id); }}>
						<strong>${option.label}</strong><small>${option.detail}</small>
					</button>`;
				})}</div>` : html`
				<h3 class="event-order">${last?.choice}</h3>
				<p class="event-narrative" data-event-outcome>${last?.outcome}</p>
				<button type="button" class="primary" data-event-continue @click=${close}>Return to ship →</button>`}
		</div>`, root);
};
