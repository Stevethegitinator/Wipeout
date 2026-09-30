// Accumulates non-indexed triangles (position, uv, colour) for one material.
import * as THREE from '../vendor/three.module.min.js';

export class MeshBuilder {
  constructor() { this.pos = []; this.uv = []; this.col = []; }

  vert(p, u, v, c) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    if (typeof c === 'number') this.col.push(c, c, c);
    else this.col.push(c.r, c.g, c.b);
  }

  // Quad a-b-c-d (counter-clockwise when viewed from the front).
  quad(a, b, c, d, uvs = [0, 0, 1, 0, 1, 1, 0, 1], cols = [1, 1, 1, 1]) {
    const P = [a, b, c, d];
    for (const k of [0, 1, 2, 0, 2, 3]) this.vert(P[k], uvs[k * 2], uvs[k * 2 + 1], cols[k]);
  }

  tri(a, b, c, uvs = [0, 0, 1, 0, 0.5, 1], cols = [1, 1, 1]) {
    const P = [a, b, c];
    for (let k = 0; k < 3; k++) this.vert(P[k], uvs[k * 2], uvs[k * 2 + 1], cols[k]);
  }

  // Append an existing geometry transformed by `matrix`, tinted by `color`.
  addGeometry(geo, matrix, color = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, uv = g.attributes.uv, col = g.attributes.color;
    const v = new THREE.Vector3();
    const tint = typeof color === 'number' ? { r: color, g: color, b: color } : color;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      const cr = col ? col.getX(i) : 1, cg = col ? col.getY(i) : 1, cb = col ? col.getZ(i) : 1;
      this.col.push(cr * tint.r, cg * tint.g, cb * tint.b);
    }
  }

  get empty() { return this.pos.length === 0; }

  build(material, computeNormals = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.matrixAutoUpdate = false;
    return m;
  }
}
