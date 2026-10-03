// Track reflections: the scene is rendered from a camera mirrored in the
// track surface under the followed craft, at reduced resolution, and the road
// shader blends that image in by fresnel and glossiness. A local planar mirror
// is accurate near the craft and fades out where the track curves away.
import * as THREE from '../vendor/three.module.min.js';

const _n = new THREE.Vector3();
const _view = new THREE.Vector3();
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

export class TrackReflection {
  constructor(scale) {
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.camera = new THREE.PerspectiveCamera();
    this.uniforms = {
      tReflect: { value: this.rt.texture },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflPlane: { value: new THREE.Vector4(0, 1, 0, 0) },
      uReflStrength: { value: 1 },
    };
    this.hidden = [];
  }

  // Add reflection sampling to a MeshStandardMaterial (the road).
  patch(material) {
    const u = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vReflWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvReflWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tReflect; uniform mat4 uReflMatrix; uniform vec4 uReflPlane; uniform float uReflStrength;
          varying vec3 vReflWorld;`)
        .replace('#include <opaque_fragment>', `
          {
            vec4 rc = uReflMatrix * vec4(vReflWorld, 1.0);
            vec2 ruv = rc.xy / rc.w + normal.xy * 0.035;
            vec3 refl = texture2D(tReflect, clamp(ruv, 0.001, 0.999)).rgb;
            float fres = 0.06 + 0.94 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
            float onPlane = 1.0 - smoothstep(0.6, 5.0, abs(dot(uReflPlane.xyz, vReflWorld) + uReflPlane.w));
            float gloss = pow(1.0 - clamp(roughnessFactor, 0.0, 1.0), 1.5);
            float inView = step(0.0, rc.w);
            outgoingLight += refl * fres * gloss * onPlane * inView * uReflStrength;
          }
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'track-reflection';
    material.needsUpdate = true;
  }

  setSize(w, h) {
    this.rt.setSize(Math.max(1, Math.floor(w * this.scale)), Math.max(1, Math.floor(h * this.scale)));
  }

  // point/normal: the track surface under the craft. `hide`: objects that must
  // not appear in the mirror (the road itself).
  render(renderer, scene, camera, point, normal, hide) {
    _n.copy(normal).normalize();
    _view.subVectors(point, camera.position);
    if (_view.dot(_n) > 0) return; // camera below the track surface
    _view.reflect(_n).negate().add(point);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(camera.position);
    _target.subVectors(point, _look).reflect(_n).negate().add(point);

    const vc = this.camera;
    vc.position.copy(_view);
    vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
    vc.lookAt(_target);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    const tm = this.uniforms.uReflMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    _plane.setFromNormalAndCoplanarPoint(_n, point);
    this.uniforms.uReflPlane.value.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);

    // Oblique near plane so nothing below the track surface is drawn.
    _plane.applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + pm[8]) / pm[0], (Math.sign(_clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    pm[2] = _clip.x; pm[6] = _clip.y; pm[10] = _clip.z + 1 - 0.003; pm[14] = _clip.w;

    for (const o of hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    for (const o of hide) o.visible = true;
  }

  dispose() { this.rt.dispose(); }
}
