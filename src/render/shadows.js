// Sun shadow map: one orthographic depth pass around the player, snapped to its own
// texel grid so shadow edges never crawl while walking.

import * as THREE from 'three';
import { env } from './texel.js';
import { SHADOW_LAYER } from '../world/chunks.js';

export class ShadowPass {
  constructor(size, extent) {
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    this.cam.layers.set(SHADOW_LAYER);
    this.override = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.lastDir = new THREE.Vector3();
    this.setSize(size, extent);
  }

  setSize(size, extent) {
    if (this.target) this.target.dispose();
    this.size = size;
    this.extent = extent;
    const depth = new THREE.DepthTexture(size, size);
    depth.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      depthTexture: depth, depthBuffer: true,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    const c = this.cam;
    c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent;
    c.updateProjectionMatrix();
    env.uShadowMap.value = depth;
    env.uShadowTexel.value = 1 / size;
  }

  render(renderer, scene, center, lightDir) {
    if (lightDir.y < 0.05) { env.uShadowOn.value = 0; return; }
    const c = this.cam;
    const texel = (this.extent * 2) / this.size;
    // light-space basis
    const fwd = lightDir.clone().negate();
    const up = Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const camUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
    // snap the center to whole shadow texels in the light's plane
    const r = Math.round(center.dot(right) / texel) * texel;
    const u = Math.round(center.dot(camUp) / texel) * texel;
    const f = center.dot(fwd);
    const snapped = right.clone().multiplyScalar(r).addScaledVector(camUp, u).addScaledVector(fwd, f);
    c.position.copy(snapped).addScaledVector(lightDir, 200);
    c.up.copy(camUp);
    c.lookAt(snapped);
    c.updateMatrixWorld();
    env.uShadowMatrix.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);

    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.overrideMaterial = this.override;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, c);
    renderer.setRenderTarget(null);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    env.uShadowOn.value = 1;
  }
}
