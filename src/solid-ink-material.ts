import { MeshBasicMaterial, MeshStandardMaterial, type Vector3 } from 'three';

const ramps = {
	terrain: ['161e29', '233036', '314246', '465753', '687666', '8b957c'],
	steel: ['19222e', '303e50', '526675', '839b9e', 'b2bfad', 'ede3be'],
	navy: ['171e36', '293953', '3c5679', '617fa2', '95adbe', 'd3e0d9'],
	moss: ['1e2631', '354339', '526950', '7d8c65', 'abb384', 'd6d6a6'],
	sand: ['2c2935', '504344', '796449', 'a3895a', 'c9af7c', 'efdbac'],
	rust: ['302432', '573744', '864a47', 'b36b4c', 'df9962', 'f6cd93'],
};

const rampConstants = Object.entries(ramps).map(function ([name, stops]) {
	const colors = stops.map(function (hex) {
		const channels = [0, 2, 4].map(function (offset) {
			const channel = Number.parseInt(hex.slice(offset, offset + 2), 16);
			return (Math.round(channel * 31 / 255) / 31).toFixed(6);
		});
		return `vec3(${channels.join(',')})`;
	});
	return `const vec3 ${name}[6] = vec3[6](${colors.join(',')});`;
}).join('\n');

const housingAccent = `
	vec3 face = normalize(cross(dFdx(panelLocal), dFdy(panelLocal)));
	bool housing = panelLocal.z > -.22 && panelLocal.z < .025 && abs(panelLocal.x) > .202
		&& panelLocal.y < .779 && panelLocal.y > .695;
	if (lightPanel && housing && face.y > .52) {
		const vec3 luma = vec3(.2126, .7152, .0722);
		float luminance = dot(chosen, luma);
		vec3 accent = luminance < .28 ? navy[3] : navy[4];
		if (dot(accent, luma) > luminance) chosen = accent;
	}`;

export type InkSource = MeshBasicMaterial | MeshStandardMaterial;
export type InkSurface = 'yard' | 'mech' | 'gun';

export interface InkLighting { keyDirection: { value: Vector3 }; fillDirection: { value: Vector3 }; illumination: { value: Vector3 }; lightTint: { value: Vector3 } }

export const createInkMaterial = function (source: InkSource, surface: InkSurface, lightPanel: { value: boolean }, lighting: InkLighting) {
	const ink = source.clone();
	ink.customProgramCacheKey = function () { return `${source.customProgramCacheKey()}/solid-ink/${surface}`; };
	ink.onBeforeCompile = function (shader, renderer) {
		// Apply the original livery hook to the clone's shader first.
		source.onBeforeCompile(shader, renderer);
		const tag = surface === 'yard' ? '1.' : '3.';
		let normal = 'nonPerturbedNormal';
		let declarations = 'layout(location=1) out highp vec4 inkSurface;';
		if (source instanceof MeshStandardMaterial) {
			Object.assign(shader.uniforms, lighting);
			if (surface === 'gun') {
				declarations += '\nvarying vec3 panelLocal; uniform bool lightPanel;';
				shader.uniforms['lightPanel'] = lightPanel;
				shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying vec3 panelLocal; void main() { panelLocal=position;');
			}
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
				.replace('void main() {', `${rampConstants}
uniform vec3 keyDirection, fillDirection, illumination, lightTint;
vec3 paintBand(vec3 pigment, vec3 n, float shadow, float metal, float roughness) {
	vec3 c = clamp(sRGBTransferOETF(vec4(pigment,1.)).rgb,0.,1.);
	float value = dot(c,vec3(.28,.57,.15));
	vec3 key = keyDirection;
	float keyLight = max(0.,dot(n,key)) * shadow * illumination.x;
	float fill = max(0.,dot(n,fillDirection))*illumination.y;
	float spec = pow(max(0.,dot(n,normalize(key + normalize(vec3(1.,1.,1.))))),mix(18.,5.,roughness));
	float shade = (.095 + .72*value)*(.60*illumination.z + .93*keyLight + .15*max(n.y,0.) + .18*fill) + .10*metal*spec*shadow;
	int i = int(clamp(floor(shade*6.),0.,5.));
	if (c.r > c.g + .095 && c.r > c.b + .13) return (c.g-c.b > .08) ? sand[i] : rust[i];
	if (c.r > c.b + .07 && c.g > c.b + .045 && c.r >= c.g) return sand[i];
	if (c.g > c.b + .035 && c.g >= c.r*.97) return moss[i];
	${surface === 'yard' ? '' : 'if (c.b - c.r > max(.092,.145*c.b) && c.b >= c.g) return navy[i];'}
	return ${surface === 'yard' ? 'terrain' : 'steel'}[i];
}
void main() {`)
				.replace('#include <opaque_fragment>', `
	vec3 worldN = transformNormalByInverseViewMatrix(normalize(mix(nonPerturbedNormal,normal,.23)),viewMatrix);
	vec3 chosen = paintBand(diffuseColor.rgb,worldN,getShadowMask(),metalnessFactor,roughnessFactor);
	${surface === 'gun' ? housingAccent : ''}
	outgoingLight = sRGBTransferEOTF(vec4(chosen,1.)).rgb * lightTint + totalEmissiveRadiance;
	#include <opaque_fragment>`);
		} else {
			declarations += '\nvarying vec3 inkViewPosition;';
			shader.vertexShader = shader.vertexShader
				.replace('void main() {', 'varying vec3 inkViewPosition;\nvoid main() {')
				.replace('#include <project_vertex>', '#include <project_vertex>\ninkViewPosition = mvPosition.xyz;');
			normal = 'normalize(cross(dFdx(inkViewPosition),dFdy(inkViewPosition)))';
		}
		shader.fragmentShader = shader.fragmentShader
			.replace('void main() {', declarations + '\nvoid main() {')
			.replace('#include <opaque_fragment>', `#include <opaque_fragment>\ninkSurface = vec4(${normal}, ${tag});`);
	};
	return ink;
};
