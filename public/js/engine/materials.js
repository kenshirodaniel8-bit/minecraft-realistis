// Materials and shaders. Terrain uses Three's physically based
// MeshStandardMaterial (so we get real sun shadows), patched to read from
// texture arrays, apply normal/roughness maps, voxel AO, sky light, torch
// light, waving foliage and an atmospheric fog that matches the sky.

import * as THREE from 'three';

// Shared uniforms (the same objects are injected into every shader).
export const U = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
  uDay: { value: 1 },
  uSunset: { value: 0 },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
  uSunIntensity: { value: 3 },
  uFogNear: { value: 80 },
  uFogFar: { value: 128 },
  uHaze: { value: 0.0025 },
  uUnderwater: { value: 0 },
  uWaterFog: { value: new THREE.Color(0.03, 0.12, 0.2) },
  uTorchColor: { value: new THREE.Color(1.0, 0.62, 0.3) },
  uMinAmbient: { value: 0.02 },
  uNormalScale: { value: 1 },
  uAlbedoArr: { value: null },
  uNormalArr: { value: null },
  uRain: { value: 0 },
  uReflTex: { value: null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflEnabled: { value: 0 },
};

// Height of the water surface at sea level (water tops sit at 14/16 of a block).
export const WATER_SURFACE_Y = 62 + 14 / 16;

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform float uDay;
uniform float uSunset;
uniform float uRain;

vec3 skyColor(vec3 dir) {
  float y = dir.y;
  float yc = max(y, 0.0);
  vec3 zenithDay = vec3(0.075, 0.24, 0.78);
  vec3 horizonDay = vec3(0.46, 0.66, 0.96);
  vec3 zenithNight = vec3(0.0025, 0.005, 0.016);
  vec3 horizonNight = vec3(0.012, 0.02, 0.045);
  vec3 zenith = mix(zenithNight, zenithDay, uDay);
  vec3 horizon = mix(horizonNight, horizonDay, uDay);
  float sunAmt = max(dot(dir, uSunDir), 0.0);
  vec3 sunsetCol = vec3(1.0, 0.38, 0.1);
  float sunsetMask = uSunset * (0.18 + 0.82 * pow(sunAmt, 2.5)) * (1.0 - yc * 0.9);
  horizon = mix(horizon, sunsetCol * (0.35 + 0.9 * uDay), clamp(sunsetMask, 0.0, 1.0));
  zenith = mix(zenith, vec3(0.25, 0.22, 0.45) * (0.2 + 0.5 * uDay), uSunset * 0.35);
  vec3 col = mix(horizon, zenith, pow(yc, 0.42));
  col = mix(col, horizon * 0.8, 1.0 - smoothstep(-0.25, 0.0, y));
  // Mie scattering glow around the sun.
  col += vec3(1.0, 0.82, 0.58) * pow(sunAmt, 10.0) * 0.45 * (uDay + uSunset * 0.7);
  col += vec3(1.0, 0.62, 0.32) * pow(sunAmt, 3.0) * 0.22 * uSunset;
  // Overcast
  float grey = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(grey) * 0.75, uRain * 0.8);
  return col;
}
`;

const FOG_GLSL = /* glsl */`
uniform float uFogNear;
uniform float uFogFar;
uniform float uHaze;
uniform float uUnderwater;
uniform vec3 uWaterFog;

vec3 applyFog(vec3 color, vec3 worldPos) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 vdir = toFrag / max(dist, 1e-4);
  if (uUnderwater > 0.5) {
    float f = 1.0 - exp(-dist * 0.075);
    return mix(color, uWaterFog, f);
  }
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  float haze = (1.0 - exp(-dist * uHaze)) * 0.85;
  fogF = max(fogF, haze);
  return mix(color, skyColor(vdir), clamp(fogF, 0.0, 1.0));
}
`;

// ---------------------------------------------------------------------------
// Terrain

const TERRAIN_VERT_HEAD = /* glsl */`
attribute vec2 aTexUv;
attribute vec4 aData;
attribute vec3 aTint;
varying vec3 vTexCoord;
varying vec4 vVox;
varying vec3 vTintC;
varying vec3 vWorldPos;
uniform float uTime;
uniform float uWind;

vec3 waveOffset(vec3 p, float wave) {
  float t = uTime;
  float w = uWind;
  if (wave < 1.5) {
    return vec3(
      sin(t * 1.7 + p.x * 0.6 + p.y * 0.4) + 0.5 * sin(t * 3.1 + p.z * 1.1),
      0.4 * sin(t * 2.3 + p.z * 0.7 + p.x * 0.3),
      cos(t * 1.9 + p.z * 0.6 + p.y * 0.5) + 0.5 * cos(t * 2.9 + p.x * 1.3)
    ) * 0.028 * w;
  } else if (wave < 2.5) {
    float gust = 0.6 + 0.4 * sin(t * 0.7 + p.x * 0.05 + p.z * 0.04);
    return vec3(
      sin(t * 2.1 + p.x * 0.9 + p.z * 0.5) + 0.45 * sin(t * 4.3 + p.z * 1.7),
      0.0,
      cos(t * 1.8 + p.z * 0.8 + p.x * 0.4) + 0.45 * cos(t * 3.7 + p.x * 1.5)
    ) * 0.085 * w * gust;
  }
  return vec3(sin(t * 1.3 + p.y * 0.7 + p.x), 0.0, cos(t * 1.1 + p.y * 0.6 + p.z)) * 0.05 * w;
}
`;

const TERRAIN_BEGIN_VERTEX = /* glsl */`
vec3 transformed = vec3(position);
float vFlags = aData.y;
float aoRaw = mod(vFlags, 4.0);
float waveType = floor(vFlags / 4.0 + 0.01);
if (waveType > 0.5) {
  vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
  // Chunk meshes are scaled by 1/16, so convert the world offset back.
  transformed += waveOffset(wp0, waveType) * 16.0;
}
vTexCoord = vec3(aTexUv / 16.0, aData.x);
vVox = vec4(aoRaw / 3.0, aData.z / 255.0, aData.w / 255.0, waveType > 0.5 ? 1.0 : 0.0);
vTintC = aTint;
`;

const TERRAIN_FRAG_HEAD = /* glsl */`
uniform highp sampler2DArray uAlbedoArr;
uniform highp sampler2DArray uNormalArr;
uniform vec3 uTorchColor;
uniform float uMinAmbient;
uniform float uNormalScale;
varying vec3 vTexCoord;
varying vec4 vVox;
varying vec3 vTintC;
varying vec3 vWorldPos;
uniform vec3 uSunColor;
uniform float uSunIntensity;
${SKY_GLSL}
${FOG_GLSL}

vec3 perturbNormalTex(vec3 eyePos, vec3 surfNorm, vec2 uv, vec3 mapN) {
  vec3 q0 = dFdx(eyePos);
  vec3 q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);
  vec3 N = surfNorm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
  return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + N * mapN.z);
}
`;

const TERRAIN_MAP_FRAGMENT = /* glsl */`
vec4 texel = texture(uAlbedoArr, vTexCoord);
#ifdef CUTOUT
  // Keep foliage dense at a distance: compensate alpha for mip averaging.
  vec2 dUv = fwidth(vTexCoord.xy) * 64.0;
  float lod = max(0.0, log2(max(max(dUv.x, dUv.y), 1e-4)));
  if (texel.a * (1.0 + lod * 0.45) < 0.5) discard;
  diffuseColor.rgb *= texel.rgb * vTintC;
#else
  diffuseColor.rgb *= texel.rgb * mix(vec3(1.0), vTintC, texel.a);
#endif
vec4 nTex = texture(uNormalArr, vTexCoord);
`;

const TERRAIN_ROUGHNESS = /* glsl */`
float roughnessFactor = clamp(nTex.a, 0.04, 1.0);
`;

const TERRAIN_NORMAL_MAPS = /* glsl */`
{
  vec3 mapN = nTex.xyz * 2.0 - 1.0;
  mapN.xy *= uNormalScale;
  normal = perturbNormalTex(-vViewPosition, normal, vTexCoord.xy, mapN);
}
`;

const VOXEL_LIGHTING = /* glsl */`
{
  float ao = vVox.x;
  float aoF = 0.32 + 0.68 * ao * ao * (3.0 - 2.0 * ao);
  float sky = vVox.y;
  float blk = vVox.z;
  float foliage = vVox.w;
  float skyAmb = pow(sky, mix(1.4, 1.0, foliage));
  reflectedLight.indirectDiffuse *= aoF * (uMinAmbient + (1.0 - uMinAmbient) * skyAmb);
  reflectedLight.indirectSpecular *= aoF * skyAmb;
  float sunVis = smoothstep(0.45, 0.9, sky);
  reflectedLight.directDiffuse *= sunVis * mix(0.55, 1.0, ao);
  reflectedLight.directSpecular *= sunVis * ao;
  // Leaves and grass let some sunlight through (cheap translucency).
  reflectedLight.indirectDiffuse += foliage * diffuseColor.rgb * uSunColor * uSunIntensity * 0.07 * smoothstep(0.3, 0.8, sky);
  vec3 torch = uTorchColor * pow(blk, 3.0) * 1.5;
  reflectedLight.indirectDiffuse += torch * BRDF_Lambert(diffuseColor.rgb) * aoF * 3.14159;
}
`;

const FOG_FRAGMENT = /* glsl */`
gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorldPos);
`;

// Water absorbs red light first: submerged terrain turns blue-green with depth.
// Sky light drops by one level per block of water, which gives the depth.
const TERRAIN_FOG_FRAGMENT = /* glsl */`
if (vWorldPos.y < 62.95 && vVox.y > 0.01 && vVox.y < 0.995 && uUnderwater < 0.5) {
  float depthApprox = (1.0 - vVox.y) * 15.0;
  gl_FragColor.rgb *= exp(-vec3(0.42, 0.13, 0.08) * (depthApprox + 0.6));
}
gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorldPos);
`;

function patchTerrain(shader, cutout) {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + TERRAIN_VERT_HEAD)
    .replace('#include <begin_vertex>', TERRAIN_BEGIN_VERTEX)
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = (cutout ? '#define CUTOUT\n' : '') + shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + TERRAIN_FRAG_HEAD)
    .replace('#include <map_fragment>', TERRAIN_MAP_FRAGMENT)
    .replace('#include <roughnessmap_fragment>', TERRAIN_ROUGHNESS)
    .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL_MAPS)
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + VOXEL_LIGHTING)
    .replace('#include <fog_fragment>', TERRAIN_FOG_FRAGMENT);
}

export function createTerrainMaterial(kind) {
  const cutout = kind === 'cutout';
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.FrontSide });
  mat.name = 'terrain-' + kind;
  mat.onBeforeCompile = (shader) => patchTerrain(shader, cutout);
  mat.customProgramCacheKey = () => 'terrain-' + kind;
  return mat;
}

// Depth material used for shadow casting (handles waving + alpha cutout).
export function createTerrainDepthMaterial(kind) {
  const cutout = kind === 'cutout';
  const mat = new THREE.MeshDepthMaterial();
  mat.name = 'terrain-depth-' + kind;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_VERT_HEAD)
      .replace('#include <begin_vertex>', TERRAIN_BEGIN_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uAlbedoArr;
varying vec3 vTexCoord;
varying vec4 vVox;
varying vec3 vTintC;
varying vec3 vWorldPos;`)
      .replace('#include <alphatest_fragment>', cutout ? 'if (texture(uAlbedoArr, vTexCoord).a < 0.5) discard;' : '');
  };
  mat.customProgramCacheKey = () => 'terrain-depth-' + kind;
  return mat;
}

// ---------------------------------------------------------------------------
// Entities (players). Standard material + fog + per-entity world light.

export function createEntityMaterial(params = {}) {
  const mat = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, params));
  mat.userData.lightUniforms = {
    uEntitySky: { value: 1 },
    uEntityBlock: { value: 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, mat.userData.lightUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
uniform float uEntitySky;
uniform float uEntityBlock;
uniform vec3 uTorchColor;
uniform float uMinAmbient;
${SKY_GLSL}
${FOG_GLSL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float skyAmb = uEntitySky * uEntitySky;
  reflectedLight.indirectDiffuse *= (uMinAmbient + (1.0 - uMinAmbient) * skyAmb);
  reflectedLight.directDiffuse *= smoothstep(0.45, 0.9, uEntitySky);
  reflectedLight.directSpecular *= smoothstep(0.45, 0.9, uEntitySky);
  reflectedLight.indirectDiffuse += uTorchColor * pow(uEntityBlock, 3.0) * 1.5 * BRDF_Lambert(diffuseColor.rgb) * 3.14159;
}`)
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
  };
  mat.customProgramCacheKey = () => 'entity';
  return mat;
}

// ---------------------------------------------------------------------------
// Water

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    name: 'water',
    uniforms: U,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec4 aData;
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying vec2 vLightV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float surf = mod(aData.y, 2.0);
        if (surf > 0.5) {
          wp.y += (sin(wp.x * 0.7 + uTime * 1.5) * 0.5 + sin(wp.z * 0.55 + uTime * 1.2 + wp.x * 0.3) * 0.5) * 0.03 - 0.02;
        }
        vWorldPos = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vLightV = vec2(aData.z, aData.w) / 255.0;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform vec3 uTorchColor;
      uniform sampler2D uReflTex;
      uniform mat4 uReflMatrix;
      uniform float uReflEnabled;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying vec2 vLightV;
      ${SKY_GLSL}
      ${FOG_GLSL}

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
      }
      float waterHeight(vec2 p) {
        float t = uTime;
        float h = 0.0;
        h += vnoise(p * 0.35 + vec2(t * 0.25, t * 0.18)) * 0.5;
        h += vnoise(p * 0.9 + vec2(-t * 0.35, t * 0.3)) * 0.25;
        h += vnoise(p * 2.1 + vec2(t * 0.6, -t * 0.45)) * 0.12;
        h += vnoise(p * 4.7 + vec2(-t * 0.9, -t * 0.8)) * 0.05;
        return h;
      }
      void main() {
        vec3 N = normalize(vNormalW);
        vec3 toCam = cameraPosition - vWorldPos;
        float dist = length(toCam);
        vec3 V = toCam / max(dist, 1e-4);
        if (N.y > 0.5) {
          vec2 p = vWorldPos.xz;
          float e = 0.08;
          float h0 = waterHeight(p);
          float hx = waterHeight(p + vec2(e, 0.0));
          float hz = waterHeight(p + vec2(0.0, e));
          float strength = 0.55 * (1.0 - smoothstep(20.0, 120.0, dist) * 0.7);
          N = normalize(vec3(-(hx - h0) / e * strength, 1.0, -(hz - h0) / e * strength));
        }
        bool below = !gl_FrontFacing;
        if (below) N = -N;
        float NdotV = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        float skyL = vLightV.x;
        float skyAmb = 0.08 + 0.92 * skyL * skyL;
        vec3 refl = skyColor(normalize(R)) * skyAmb;
        // Planar reflection of the world (sea-level water only).
        if (uReflEnabled > 0.5 && !below && vNormalW.y > 0.5 && abs(vWorldPos.y - ${WATER_SURFACE_Y.toFixed(4)}) < 0.25) {
          vec4 rc = uReflMatrix * vec4(vWorldPos.x, ${WATER_SURFACE_Y.toFixed(4)}, vWorldPos.z, 1.0);
          vec2 ruv = rc.xy / rc.w + N.xz * 0.035;
          ruv = clamp(ruv, vec2(0.001), vec2(0.999));
          vec3 world = texture2D(uReflTex, ruv).rgb;
          refl = mix(refl, world * (0.35 + 0.65 * skyAmb), 0.92);
        }
        float sunUp = smoothstep(-0.02, 0.1, uSunDir.y);
        float spec = pow(max(dot(R, uSunDir), 0.0), 420.0) * 22.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.6;
        vec3 deep = vec3(0.01, 0.07, 0.1);
        vec3 ambient = skyColor(vec3(0.0, 1.0, 0.0)) * skyAmb + uSunColor * uSunIntensity * 0.08 * sunUp * skyL;
        ambient += uTorchColor * pow(vLightV.y, 3.0) * 1.0;
        vec3 body = deep * ambient * 2.2;
        vec3 col = mix(body, refl, fres) + uSunColor * spec * sunUp * smoothstep(0.6, 0.95, skyL);
        float alpha = mix(0.66, 0.97, fres);
        if (below) {
          col = mix(uWaterFog * 1.5, refl, 0.35);
          alpha = 0.75;
        }
        col = applyFog(col, vWorldPos);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Sky dome

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'sky',
    uniforms: U,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSunColor;
      varying vec3 vDir;
      ${SKY_GLSL}
      float hash13(vec3 p3) {
        p3 = fract(p3 * 0.1031);
        p3 += dot(p3, p3.zyx + 31.32);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyColor(dir);
        // Sun disk with limb darkening.
        float sd = dot(dir, uSunDir);
        float sunDisk = smoothstep(0.99975, 0.99988, sd);
        float sunUp = smoothstep(-0.05, 0.02, uSunDir.y);
        col += uSunColor * sunDisk * 40.0 * sunUp * (1.0 - uRain);
        // Moon opposite the sun.
        vec3 moonDir = -uSunDir;
        float md = dot(dir, moonDir);
        float moon = smoothstep(0.99935, 0.9995, md);
        float moonUp = smoothstep(-0.05, 0.05, moonDir.y);
        vec3 mcol = vec3(0.85, 0.88, 0.95) * (0.75 + 0.25 * hash13(floor(dir * 900.0)));
        col += mcol * moon * 2.2 * moonUp;
        col += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 300.0) * 0.25 * moonUp;
        // Stars
        float night = 1.0 - smoothstep(0.0, 0.35, uDay + uSunset * 0.5);
        if (night > 0.01 && dir.y > 0.0) {
          vec3 g = floor(dir * 260.0);
          float h = hash13(g);
          if (h > 0.9965) {
            vec3 c = (g + 0.5) / 260.0;
            float d = length(normalize(c) - dir) * 260.0;
            float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h * 3.0) + h * 100.0);
            col += vec3(0.9, 0.93, 1.0) * smoothstep(0.55, 0.0, d) * night * tw * 1.6 * smoothstep(0.0, 0.25, dir.y) * (1.0 - uRain);
          }
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Clouds: a single fbm layer that drifts with the wind.

export function createCloudMaterial() {
  return new THREE.ShaderMaterial({
    name: 'clouds',
    uniforms: Object.assign({ uCloudCover: { value: 0.48 } }, U),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uCloudCover;
      uniform vec3 uSunColor;
      varying vec3 vWorldPos;
      ${SKY_GLSL}
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
        return s;
      }
      void main() {
        vec2 p = vWorldPos.xz / 220.0 + vec2(uTime * 0.006, uTime * 0.0025);
        float base = fbm(p);
        float cover = mix(uCloudCover, 0.85, uRain);
        float d = smoothstep(1.0 - cover, 1.0 - cover + 0.28, base);
        if (d < 0.003) discard;
        // Cheap self-shadowing: sample towards the sun.
        float toward = fbm(p + uSunDir.xz * 0.05);
        float shadow = clamp((toward - base) * 3.0 + 0.5, 0.0, 1.0);
        vec3 up = skyColor(vec3(0.0, 1.0, 0.0));
        vec3 lit = uSunColor * (0.75 + 0.25 * uDay) * max(uDay, uSunset * 0.7) * 1.4 + up * 0.6;
        vec3 dark = up * 0.55 + vec3(0.02);
        vec3 col = mix(lit, dark, shadow * 0.6 + d * 0.25);
        col = mix(col, col * vec3(0.55), uRain * 0.6);
        vec3 toFrag = vWorldPos - cameraPosition;
        float dist = length(toFrag);
        vec3 vdir = toFrag / dist;
        float fade = 1.0 - smoothstep(600.0, 1400.0, dist);
        col = mix(skyColor(vdir), col, 0.25 + 0.75 * exp(-dist * 0.0012));
        gl_FragColor = vec4(col, d * 0.92 * fade);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Texture arrays from worker data.

export function createTextureArrays(tex, renderer) {
  const albedo = new THREE.DataArrayTexture(tex.albedo, tex.size, tex.size, tex.count);
  albedo.format = THREE.RGBAFormat;
  albedo.type = THREE.UnsignedByteType;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.magFilter = THREE.NearestFilter;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.wrapS = albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.generateMipmaps = true;
  albedo.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  albedo.needsUpdate = true;

  const normal = new THREE.DataArrayTexture(tex.normal, tex.size, tex.size, tex.count);
  normal.format = THREE.RGBAFormat;
  normal.type = THREE.UnsignedByteType;
  normal.colorSpace = THREE.NoColorSpace;
  normal.magFilter = THREE.NearestFilter;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
  normal.generateMipmaps = true;
  normal.anisotropy = albedo.anisotropy;
  normal.needsUpdate = true;

  U.uAlbedoArr.value = albedo;
  U.uNormalArr.value = normal;
  return { albedo, normal };
}
