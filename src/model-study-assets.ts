import { loadPlayableMechFamily, playableMechUrl, type AuthoredChassis } from './authored-mech';
import type { AuthoredPoseContext } from './authored-pose';
import type { FrameId } from './frames';
import type { WalkerGait } from './gait';
import type { MechFeedback } from './mech-3d';
import { getMechAssetBinding, type MechAssetModel } from './mech-asset-registry';
import { createContactCadence } from './mech-cadence';

export const runModelStudy = async function (chassis: readonly AuthoredChassis[], withVariants: boolean, start: () => () => void) {
	const controller = new AbortController();
	const cleanup: (() => void)[] = [];
	const dispose = function () {
		controller.abort();
		for (const release of cleanup.splice(0).reverse()) release();
	};
	window.addEventListener('pagehide', function (event) { if (!event.persisted) dispose(); }, { signal: controller.signal });
	if (import.meta.hot) import.meta.hot.dispose(dispose);
	try {
		const families = await Promise.all(chassis.map(function (id) {
			return loadPlayableMechFamily(id, playableMechUrl(id), withVariants ? playableMechUrl(id, 'variants') : null);
		}));
		const factories = families.flat();
		for (const factory of factories) cleanup.push(factory.dispose);
		if (controller.signal.aborted) { dispose(); return; }
		for (const factory of factories) cleanup.push(factory.install());
		cleanup.push(start());
	} catch (error) { dispose(); throw error; }
};

export const createStudyPose = function (frame: FrameId | undefined) {
	const advance = frame && getMechAssetBinding(frame)?.advancePose;
	const cadence = createContactCadence();
	let pose: AuthoredPoseContext | undefined;
	return function (model: MechAssetModel, gait: WalkerGait, heading: number, feedback: MechFeedback) {
		if (!advance) { model.pose(gait, heading, feedback); return; }
		pose = advance(pose, gait.body, feedback.time);
		const legs = pose.gait ?? gait;
		cadence.advance(legs, feedback.time);
		model.pose(gait, heading, { ...feedback, authoredPose: pose, legGait: cadence.visualGait(legs) });
	};
};
