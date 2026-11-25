// Keyframes on the animation clock. The score and combat handoff use elapsed time.
export const LAUNCH_TIMING = {
	carrier: 2.5,
	release: 4,
	descent: 5.5,
	approach: 7.5,
	touchdown: 9,
	lift: 13.5,
	end: 16,
} as const;

export const cloudEntry = LAUNCH_TIMING.approach - .85;
export const cloudExit = LAUNCH_TIMING.approach + .65;
const extraCloudSeconds = 1; // Two beats at 120 BPM.
export const LAUNCH_DURATION = LAUNCH_TIMING.end + extraCloudSeconds;

// Ease into and out of the extra beats. Both cameras and the drifting clouds
// keep moving through the cut and return to their authored speed at the edges.
export const launchSceneTime = function (elapsed: number) {
	const progress = Math.max(0, Math.min(1, (elapsed - cloudEntry) / (cloudExit + extraCloudSeconds - cloudEntry)));
	const delay = extraCloudSeconds * progress * progress * (3 - 2 * progress);
	return Math.min(elapsed - delay, LAUNCH_TIMING.end);
};

// Eight held poses per scene second. Travel and camera motion use continuous scene time.
export const sampleLaunchPoseTime = function (sceneTime: number) {
	return Math.floor(Math.min(sceneTime, LAUNCH_TIMING.end) * 8) / 8;
};

export const launchCues = [
	{ at: 2, kind: 'latch' },
	{ at: LAUNCH_TIMING.release, kind: 'release' },
	{ at: LAUNCH_TIMING.touchdown + 0.5 + extraCloudSeconds, kind: 'land' },
	{ at: LAUNCH_TIMING.lift + extraCloudSeconds, kind: 'lift' },
] as const;
export type LaunchCue = (typeof launchCues)[number]['kind'];
