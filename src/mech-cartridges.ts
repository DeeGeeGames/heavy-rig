import type { Group, Object3D } from 'three';
import { getFrame, type FrameId } from './frames';
import { getHardpoints } from './hardpoints';

export interface CartridgeSocket {
	readonly group: string;
	readonly muzzle: string;
	readonly side: 'left' | 'right' | 'center';
	readonly launcher: boolean;
	readonly exits?: readonly string[];
}

export const named = function (root: Object3D, name: string): Object3D {
	const found: Object3D[] = [];
	root.traverse(function (node) { if (node.name === name || node.userData['name'] === name) found.push(node); });
	const node = found[0];
	if (!node || found.length !== 1) throw new Error(`Expected one authored node ${name}; found ${found.length}`);
	return node;
};

// Each fitting references either an A cartridge on the base or an alternate
// in the module package. Neutral socket transforms come only from the base.
export const fitMechCartridges = function (frame: FrameId, base: Group, modules?: Object3D) {
	const variant = getFrame(frame).variant.toLowerCase();
	const packageRoot = variant === 'a' ? base : modules;
	const layout: unknown = packageRoot?.userData[`fit_${variant}`];
	const mounts = getHardpoints(frame);
	if (!packageRoot || !Array.isArray(layout) || layout.length !== mounts.length) throw new Error(`Missing cartridge layout for ${frame}`);
	const scene = variant === 'a' ? base : base.clone(true);
	const attach = function (parent: Object3D, name: string) {
		const original = base.getObjectByName(name) ?? (modules && named(modules, name));
		if (!original) throw new Error(`Missing ${frame} module ${name}`);
		const part = original.clone(true);
		part.position.set(0, 0, 0);
		parent.add(part);
		return part;
	};
	const weapons = mounts.map(function (mount, slot): CartridgeSocket {
		const id: unknown = layout[slot];
		if (typeof id !== 'string') throw new Error(`Invalid ${frame} cartridge at ${slot}`);
		const socket = named(scene, 'rig_torso').children.find(function (node) { return node.userData['mountSlot'] === slot; });
		if (!socket) throw new Error(`Missing ${frame} socket ${slot}`);
		const fitted = socket.getObjectByName(id);
		if (!fitted && variant === 'a') throw new Error(`Missing stock ${frame} cartridge ${id}`);
		if (!fitted) socket.clear();
		const part = fitted ?? attach(socket, id);
		const count: unknown = part.userData['tubeCount'];
		const launcher = mount.family === 'launcher';
		if (part.userData['socket'] !== socket.name || typeof count !== 'number' || !Number.isInteger(count)
			|| count < 0 || count > 12 || (launcher ? count === 0 : count > 0 && mount.id !== 'dorsal-artillery')) throw new Error(`Invalid ${frame} cartridge on ${socket.name}`);
		return { group: socket.name, side: socket.name.includes('left') ? 'left' : socket.name.includes('right') ? 'right' : 'center',
			muzzle: `${id}_muzzle`, launcher, exits: Array.from({ length: count }, function (_, index) { return `${id}_tube_${index}`; }) };
	});
	const baseBrace: unknown = base.userData['brace_a'];
	const brace: unknown = packageRoot.userData[`brace_${variant}`];
	if (baseBrace !== brace) {
		if (typeof baseBrace === 'string') named(scene, baseBrace).removeFromParent();
		if (typeof brace === 'string') attach(named(scene, 'rig_torso'), brace);
	}
	return { scene, weapons };
};
