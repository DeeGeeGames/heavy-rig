export const LAUNCH_TIMING = {
	carrier: 2.5,
	release: 4,
	approach: 5.5,
	touchdown: 7,
	lift: 11.5,
	end: 14,
} as const;

// Eight held model poses per second. Travel and camera motion use elapsed time.
export const sampleLaunchPoseTime = function (elapsed: number) {
	return Math.floor(Math.min(elapsed, LAUNCH_TIMING.end) * 8) / 8;
};

export const launchCues = [
	{ at: 2, kind: 'latch' },
	{ at: LAUNCH_TIMING.release, kind: 'release' },
	{ at: LAUNCH_TIMING.touchdown + 0.5, kind: 'land' },
	{ at: LAUNCH_TIMING.lift, kind: 'lift' },
] as const;
export type LaunchCue = (typeof launchCues)[number]['kind'];
