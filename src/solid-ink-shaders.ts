export const terrainShader = `
	varying vec2 at;
	uniform sampler2D terrainColor, terrainDepth;
	uniform mat4 liveToTerrain, terrainToLive;
	uniform vec4 terrainFloorDepth;
	uniform bool drawTerrainColor;
	void main() {
		vec2 baked = (liveToTerrain * vec4(at * 2. - 1., 0., 1.)).xy;
		vec2 uv = baked * .5 + .5;
		vec2 size = vec2(textureSize(terrainColor, 0));
		vec2 texel = uv * size;
		vec3 color = vec3(0.);
		if (drawTerrainColor) {
			// Keep the baked texels chunky, with a roughly one-pixel transition
			// at their edges so fractions of camera motion scroll smoothly.
			vec2 edge = floor(texel + .5);
			vec2 sampleUv = (edge + clamp((texel - edge) / max(fwidth(texel), vec2(.0001)), -.5, .5)) / size;
			color = textureGrad(terrainColor, sampleUv, dFdx(uv), dFdy(uv)).rgb;
		}
		float floorClip = dot(terrainFloorDepth.xyz, vec3(baked, 1.));
		float liveFloorDepth = (terrainToLive * vec4(baked, floorClip, 1.)).z * .5 + .5;
		// A fullscreen fragment writes one depth to all MSAA samples. Keep that
		// depth behind the sloped floor at each sample so native decals draw fully.
		float sampleBias = .5 * fwidth(liveFloorDepth);
		if (any(lessThan(uv, vec2(0.))) || any(greaterThanEqual(uv, vec2(1.)))) discard;
		vec2 cell = floor(texel);
		float depth = texelFetch(terrainDepth, ivec2(cell), 0).r;
		if (depth >= 1.) discard;
		float clipDepth = depth * 2. - 1.;
		vec2 cellCenter = (cell + .5) * 2. / size - 1.;
		// Ground decals and shadows sit just above the plane. Use the plane's
		// exact depth there, while preserving the sampled silhouettes of props.
		bool onFloor = abs(clipDepth - dot(terrainFloorDepth.xyz, vec3(cellCenter, 1.))) < terrainFloorDepth.w;
		float liveDepth = onFloor ? liveFloorDepth + (drawTerrainColor ? sampleBias : 0.) : (terrainToLive * vec4(baked, clipDepth, 1.)).z * .5 + .5;
		if (liveDepth <= 0. || liveDepth >= 1.) discard;
		gl_FragDepth = liveDepth;
		gl_FragColor = sRGBTransferOETF(vec4(color, 1.));
	}`;

// The color and surface buffers use the same four coverage samples per virtual pixel.
export const resolveShader = `
	uniform sampler2D paints, surfaces, depths;
	uniform float nearPlane, depthRange;
	uniform bool perspective;

	layout(location=1) out highp vec4 paintPixel;
	void main() {
		ivec2 origin=ivec2(gl_FragCoord.xy)*2;
		const int count=4;
		vec4 surface[4]; vec3 paint[4]; float depth[4];
		int occupied=0;
		for(int i=0;i<count;i++) {
			ivec2 pos=origin+ivec2(i%2,i/2);
			surface[i]=texelFetch(surfaces,pos,0);
			paint[i]=texelFetch(paints,pos,0).rgb;
			float sampleDepth=texelFetch(depths,pos,0).r;
			// Normalize linear eye-space distance for comparable world-space creases
			// in both perspective display cases and orthographic combat.
			depth[i]=perspective ? nearPlane*sampleDepth/(nearPlane+depthRange*(1.-sampleDepth)) : sampleDepth;
			if(surface[i].a>0.) occupied++;
		}
		if(2*occupied<count || occupied==0) {
			gl_FragColor=vec4(0.,0.,0.,1.);
			paintPixel=vec4(0.);
			return;
		}
		float tag=0., nearest=1.; int votes=0;
		for(int i=0;i<count;i++) {
			if(surface[i].a==0.) continue;
			int matching=0;
			for(int j=0;j<count;j++) if(surface[j].a==surface[i].a) matching++;
			if(matching>votes || (matching==votes && depth[i]<nearest)) {
				tag=surface[i].a; votes=matching; nearest=depth[i];
			}
		}
		vec3 mean=vec3(0.);
		for(int i=0;i<count;i++) if(surface[i].a==tag) mean+=paint[i];
		mean/=float(votes);
		int geometryTap=0, paintTap=0;
		float bestDepth=1e6, bestPaint=1e6;
		for(int i=0;i<count;i++) {
			if(surface[i].a!=tag) continue;
			// Use an actual median-depth surface. One stray subpixel cannot
			// move an interior seam to a distant layer.
			float deviation=0.;
			for(int j=0;j<count;j++) if(surface[j].a==tag) deviation+=abs(depth[i]-depth[j]);
			if(deviation<bestDepth || (deviation==bestDepth && depth[i]<depth[geometryTap])) {
				bestDepth=deviation; geometryTap=i;
			}
			vec3 delta=paint[i]-mean;
			float error=dot(delta,delta);
			if(error<bestPaint){bestPaint=error;paintTap=i;}
		}
		gl_FragColor=vec4(surface[geometryTap].xyz,2.*tag+depth[geometryTap]);
		paintPixel=vec4(paint[paintTap],1.);
	}`;

const cellSize = `
	uniform float units, nearPlane, depthRange;
	uniform bool perspective;
	float worldCell(float surface) {
		float normalizedDepth = surface - 2.*floor(surface*.5);
		return units * (perspective ? nearPlane + normalizedDepth*depthRange : 1.);
	}`;

export const edgeShader = `
	varying vec2 at;
	uniform sampler2D geometry;
	uniform vec2 cell;
	${cellSize}
	const vec2 dir[4]=vec2[4](vec2(-1,0),vec2(1,0),vec2(0,-1),vec2(0,1));
	void main() {
		vec4 here=texture2D(geometry,at);
		float tag=floor(here.a*.5);
		vec4 edges=vec4(0.);
		if(tag>0.) for(int i=0;i<4;i++) {
			vec4 next=texture2D(geometry,at+cell*dir[i]);
			float other=floor(next.a*.5);
			float dz=((next.a-2.*other)-(here.a-2.*tag))*depthRange;
			if(other==0. || (other!=tag && dz>=0.)) edges[i]=1.;
			else if(other==tag && dz>max(4.,worldCell(here.a)*3.1)) edges[i]=.70;
			else if(other==tag && dot(here.xyz,next.xyz)<.48) {
				// Ink just the more edge-on face of a crease, independent of the paint.
				float facing=abs(next.z)-abs(here.z);
				if(facing>.015 || (abs(facing)<=.015 && (i==0 || i==3))) edges[i]=.4;
			}
		}
		gl_FragColor=edges;
	}`;

export const inkShader = `
	varying vec2 at;
	uniform sampler2D paintPixels, geometry, lines;
	uniform vec2 cell;
	${cellSize}
	uniform vec3 paper;
	const vec3 outline=vec3(16,22,35)/255.;
	const vec3 thinInk=vec3(53,65,80)/255.;
	bool onSurface(vec2 uv, float surface) {
		return abs(texture2D(geometry,uv).a-surface)*depthRange<=max(4.,worldCell(surface)*3.1);
	}
	// An internal line can bridge one missing cell only when both ends face
	// the same way and belong to the same nearby visible surface.
	vec4 nearbyLines(vec2 uv, float surface) {
		float other=texture2D(geometry,uv).a;
		return abs(surface-other)*depthRange<=worldCell(surface)*2.4 ? texture2D(lines,uv) : vec4(0.);
	}
	void main() {
		vec4 src=texture2D(paintPixels,at);
		if(src.a==0.){gl_FragColor=vec4(paper,0.);return;}
		vec3 color=sRGBTransferOETF(vec4(src.rgb,1.)).rgb;
		vec4 edge=texture2D(lines,at);
		float strength=max(max(edge.x,edge.y),max(edge.z,edge.w));
		if(strength<.6) {
			float surface=texture2D(geometry,at).a;
			vec2 x=vec2(cell.x,0.), y=vec2(0.,cell.y);
			vec2 across=min(nearbyLines(at-x,surface).zw,nearbyLines(at+x,surface).zw);
			vec2 along=min(nearbyLines(at-y,surface).xy,nearbyLines(at+y,surface).xy);
			float bridge=max(max(across.x,across.y),max(along.x,along.y));
			strength=max(strength,min(.70,bridge));
		}
		if(strength>.9) {
			// A diagonal one-cell barrel can touch two neighbours at right
			// angles. Look for a filled 2x2 patch before assigning full ink.
			float surface=texture2D(geometry,at).a;
			bool hasInterior=(edge.x<.6 && edge.z<.6 && onSurface(at-cell,surface))
				|| (edge.x<.6 && edge.w<.6 && onSurface(at+vec2(-cell.x,cell.y),surface))
				|| (edge.y<.6 && edge.z<.6 && onSurface(at+vec2(cell.x,-cell.y),surface))
				|| (edge.y<.6 && edge.w<.6 && onSurface(at+cell,surface));
			color=hasInterior ? outline : thinInk;
		} else if(strength>.6) {
			color=min(mix(color,outline,.58),vec3(47,58,74)/255.);
		} else if(strength>.3) {
			color=min(mix(color,outline,.40),vec3(73,87,101)/255.);
		}
		gl_FragColor=vec4(floor(color*255.+.5)/255.,max(.1,strength));
	}`;

// Close an isolated light cell inside an inked line. A connected highlight or
// an uninked paint field does not qualify. Keep an existing neighbour's ink hue.
export const repairShader = `
	varying vec2 at;
	uniform sampler2D inked, geometry;
	uniform float clearAlpha;
	uniform vec2 cell;
	const vec3 luma=vec3(.299,.587,.114);
	const vec2 axes[4]=vec2[4](vec2(1,0),vec2(0,1),vec2(1,1),vec2(1,-1));
	void main() {
		vec4 here=texture2D(inked,at);
		gl_FragColor=vec4(here.rgb,here.a==0. ? clearAlpha : 1.);
		float light=dot(here.rgb,luma);
		if(here.a==0. || here.a>.35 || light<.39) return;
		float tag=floor(texture2D(geometry,at).a*.5);
		float darkLimit=min(.34,light-.16);
		int darkCount=0;
		vec3 fill=vec3(0.);
		float best=-1.;
		for(int i=0;i<4;i++) {
			vec2 delta=cell*axes[i];
			vec4 a=texture2D(inked,at-delta), b=texture2D(inked,at+delta);
			float la=dot(a.rgb,luma), lb=dot(b.rgb,luma);
			bool sameA=floor(texture2D(geometry,at-delta).a*.5)==tag;
			bool sameB=floor(texture2D(geometry,at+delta).a*.5)==tag;
			if((sameA && la>=light-.08) || (sameB && lb>=light-.08)) return;
			bool darkA=sameA && la<=darkLimit, darkB=sameB && lb<=darkLimit;
			if(darkA) darkCount++;
			if(darkB) darkCount++;
			if(darkA && darkB && min(a.a,b.a)>.35 && max(la,lb)>best) {
				best=max(la,lb); fill=la>=lb ? a.rgb : b.rgb;
			}
		}
		if(darkCount>=6 && best>=0.)gl_FragColor=vec4(fill,1.);
	}`;
