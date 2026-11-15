import * as THREE from "three";

/**
 * Shader patch that gives every instance of an InstancedMesh its own life
 * window, evaluated on the GPU against a shared "year" uniform. Scrubbing the
 * timeline therefore costs nothing per instance on the CPU.
 *
 * aLife = (appear start, appear end, vanish start, vanish end) in timeline years.
 * aFx   = (burns: 0|1, evidence tint index, unused)
 */
export interface LifeUniforms {
  uYear: { value: number };
  uEvidence: { value: number };
}

export const lifeUniforms: LifeUniforms = { uYear: { value: 0 }, uEvidence: { value: 0 } };

const VERT_DECL = `
attribute vec4 aLife;
attribute vec3 aFx;
uniform float uYear;
varying float vBurn;
varying float vEv;
`;
const VERT_BODY = `
#include <begin_vertex>
float lifeUp = smoothstep(aLife.x, aLife.y, uYear);
float lifeDown = smoothstep(aLife.z, aLife.w, uYear);
float lifeS = lifeUp * (1.0 - lifeDown);
transformed.y *= lifeS;
if (lifeS < 0.004) transformed *= 0.0;
vBurn = aFx.x * lifeDown * (1.0 - lifeDown) * 4.0;
vEv = aFx.y;
`;

export function patchLife<T extends THREE.Material>(mat: T, opts: { tint?: boolean } = {}): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uYear = lifeUniforms.uYear;
    shader.uniforms.uEvidence = lifeUniforms.uEvidence;
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace("#include <begin_vertex>", VERT_BODY);
    if (opts.tint !== false && shader.fragmentShader.includes("#include <emissivemap_fragment>")) {
      shader.fragmentShader =
        "uniform float uEvidence;\nvarying float vBurn;\nvarying float vEv;\n" +
        shader.fragmentShader.replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           totalEmissiveRadiance += vec3(1.0, 0.32, 0.04) * vBurn * 1.6;
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35, clamp(vBurn, 0.0, 1.0));
           vec3 evTint = vEv < 0.5 ? vec3(0.25, 0.75, 0.55) : (vEv < 1.5 ? vec3(0.95, 0.68, 0.2) : vec3(0.78, 0.35, 0.85));
           diffuseColor.rgb = mix(diffuseColor.rgb, evTint * (0.35 + 0.65 * dot(diffuseColor.rgb, vec3(0.33))), uEvidence * 0.8);`,
        );
    }
  };
  mat.customProgramCacheKey = () => "life" + (opts.tint === false ? "0" : "1");
  return mat;
}

/** Depth material carrying the same vertex patch, so shadows grow and vanish with the instance. */
export function lifeDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uYear = lifeUniforms.uYear;
    shader.vertexShader =
      "attribute vec4 aLife;\nuniform float uYear;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float lifeS = smoothstep(aLife.x, aLife.y, uYear) * (1.0 - smoothstep(aLife.z, aLife.w, uYear));
         transformed.y *= lifeS;
         if (lifeS < 0.004) transformed *= 0.0;`,
      );
  };
  m.customProgramCacheKey = () => "lifeDepth";
  return m;
}

export const EVIDENCE_INDEX: Record<string, number> = {
  "attested-standing": 0,
  "attested-excavated": 0,
  "attested-documentary": 0,
  "attested-pictorial": 0,
  reconstructed: 1,
  conjectural: 2,
};
export const EVIDENCE_COLORS = [0x40bf8c, 0xf2ad33, 0xc759d9];
