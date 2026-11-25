import { Color, type Mesh, type MeshStandardMaterial, type Object3D, type Vector2 } from 'three';
import type { AuthoredChassis } from './authored-mech';
import { paintColorForZone, type PaintSide, type PaintZone, type SolidMechPaint } from './mech-paint';
import { mechPlateShader } from './mech-skin-material';

export const authoredPaintZone = function (mesh: Mesh): { zone: PaintZone; side: PaintSide } {
	// A replacement cartridge inherits its socket's side and paint area. A glTF
	// mesh with multiple materials can add an extra unnamed level below the rig.
	let joint: Object3D | null = mesh;
	while (joint && !joint.name.startsWith('rig_')) joint = joint.parent;
	const name = joint?.name ?? '';
	const side = name.includes('left') ? 'left' : name.includes('right') ? 'right' : 'center';
	if (name.startsWith('rig_leg_')) return { zone: 'leg', side };
	if (name.startsWith('rig_mount_')) return { zone: name.includes('shoulder') || name.endsWith('-silo') ? 'shoulder' : 'arm', side };
	return { zone: name === 'rig_pelvis' ? 'pelvis' : 'hull', side: 'center' };
};

// Fixed fairings and pauldrons belong to the torso mesh. These coordinates
// come from the pixel_mechs authoring recipes, in native rig_torso space.
const fixedArmor = {
	kit: `
		if (abs(position.x) > shoulderEdge && position.y > 0.) return position.x < 0. ? rightShoulder : leftShoulder;
	`,
	warden: `
		// The two pale cheek fairings sit outboard of the narrow pale nose panel.
		if (plate.x > 1.5 && abs(position.x) > .05) {
			if (position.x < 0. && emptyShoulders.y > .5) return rightShoulder;
			if (position.x > 0. && emptyShoulders.x > .5) return leftShoulder;
		}
	`,
	kestrel: `
		// The four cross-sections of each fairing have distinct longitudinal stations.
		vec4 stations = abs(position.z - vec4(-.2228, -.1418, .0112, .1062));
		if (any(lessThan(stations, vec4(.0002)))) return position.x < 0. ? rightShoulder : leftShoulder;
		if (abs(position.x) > .169) return position.x < 0. ? rightArm : leftArm;
	`,
	maul: `
		// The breastplate ends at 156.5 mm. The pauldrons and their inner lugs
		// start beyond 163.5 mm, above the arm braces except for the lowest lip.
		if (abs(position.x) > .160) {
			if (position.y > .183 || abs(position.y - .155) < .0002) return position.x < 0. ? rightShoulder : leftShoulder;
			return position.x < 0. ? rightArm : leftArm;
		}
	`,
};

export const applySolidPlatePaint = function (material: MeshStandardMaterial, mesh: Mesh, chassis: AuthoredChassis, paint: SolidMechPaint, emptyShoulders?: Vector2): void {
	const { zone, side } = authoredPaintZone(mesh);
	const masked = mesh.geometry.hasAttribute('_mech_paint');
	const fixed = zone !== 'hull' ? undefined : masked && (mesh.name.startsWith('plates_rig_torso') || mesh.parent?.name === 'plates_rig_torso') ? 'kit'
		: chassis === 'kestrel' || chassis === 'maul' || chassis === 'warden' && emptyShoulders ? chassis : undefined;
	const pigment = function (area: PaintZone, flank: PaintSide) { return { value: new Color(paintColorForZone(paint, area, flank)) }; };
	material.userData['mechSkin'] = 'solid';
	material.customProgramCacheKey = function () { return `solid-plates:${fixed ?? 'part'}:${masked}`; };
	material.onBeforeCompile = function (shader) {
		shader.uniforms['partPaint'] = pigment(zone, side);
		let fixedZones = '';
		if (fixed) {
			shader.uniforms['leftShoulder'] = pigment('shoulder', 'left');
			shader.uniforms['rightShoulder'] = pigment('shoulder', 'right');
			fixedZones = 'uniform vec3 leftShoulder, rightShoulder;';
			if (fixed === 'kit') {
				mesh.geometry.computeBoundingBox();
				const box = mesh.geometry.boundingBox;
				shader.uniforms['shoulderEdge'] = { value: box ? Math.max(-box.min.x, box.max.x) * .6 : Infinity };
				fixedZones += '\nuniform float shoulderEdge;';
			} else if (emptyShoulders) {
				shader.uniforms['emptyShoulders'] = { value: emptyShoulders };
				fixedZones += '\nuniform vec2 emptyShoulders;';
			} else {
				shader.uniforms['leftArm'] = pigment('arm', 'left');
				shader.uniforms['rightArm'] = pigment('arm', 'right');
				fixedZones += '\nuniform vec3 leftArm, rightArm;';
			}
		}
		shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform vec3 partPaint;
${fixedZones}
${mechPlateShader(masked)}
vec3 solidArmorColor(vec2 plate) {
	${fixed ? fixedArmor[fixed] : ''}
	return partPaint;
}`).replace('#include <color_vertex>', `#include <color_vertex>
vec2 plate = mechPlate(color.rgb);
if (plate.x > .5) vColor.rgb = solidArmorColor(plate) * ${masked ? 'plate.y' : '(plate.y < 1. ? .79 : 1.)'};`);
	};
};
