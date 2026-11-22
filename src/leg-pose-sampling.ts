import type { Object3D } from 'three';
import type { WalkerGait } from './gait';

// Hold solved local transforms, rather than solving held foot targets again
// against a moving pelvis. Travel, torso motion and weapon sockets stay live.
export const createLegPoseSampling = function (nodes: readonly Object3D[]) {
	const poses = nodes.map(function (node) {
		return { node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
	});
	let previous: WalkerGait | undefined;
	return function (gait: WalkerGait | undefined) {
		if (!gait) { previous = undefined; return; }
		const prior = previous;
		const changed = !prior || gait.feet.some(function (foot, index) {
			const old = prior.feet[index];
			return !old || foot.x !== old.x || foot.y !== old.y || foot.lift !== old.lift || foot.angle !== old.angle;
		});
		for (const pose of poses) {
			const { node, position, quaternion, scale } = pose;
			if (changed) {
				position.copy(node.position); quaternion.copy(node.quaternion); scale.copy(node.scale);
			} else {
				node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale);
			}
		}
		previous = gait;
	};
};
