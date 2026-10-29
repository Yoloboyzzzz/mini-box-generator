import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BoxResult } from './types';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // the printer's z is up

function geometry(tris: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
}

export class Viewer {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private controls: OrbitControls;
  private content = new THREE.Group();
  private dirty = true;

  constructor(private host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xeef1f5);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa6bb, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(120, -160, 240);
    this.scene.add(sun, this.content);
    const grid = new THREE.GridHelper(400, 40, 0xaab4c6, 0xd0d7e2);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);
    this.camera.position.set(90, -140, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => (this.dirty = true));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
    };
    loop();
  }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private clear() {
    for (const child of [...this.content.children]) {
      (child as THREE.Mesh).geometry?.dispose();
      this.content.remove(child);
    }
  }

  private frame() {
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(0.7, -1.1, 0.8).multiplyScalar(size * 0.9));
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty = true;
  }

  showMini(tris: Float32Array | null) {
    this.clear();
    if (tris) {
      const m = new THREE.Mesh(geometry(tris), new THREE.MeshStandardMaterial({ color: 0x5f84bd, roughness: 0.7 }));
      this.content.add(m);
      this.frame();
    }
    this.dirty = true;
  }

  showBox(r: BoxResult, explode: boolean, showLid: boolean) {
    this.clear();
    this.content.add(new THREE.Mesh(geometry(r.box), new THREE.MeshStandardMaterial({ color: 0x6f819e, roughness: 0.8 })));
    if (showLid) {
      const lid = new THREE.Mesh(
        geometry(r.lid),
        new THREE.MeshStandardMaterial({ color: 0xe0a03c, roughness: 0.6, transparent: true, opacity: 0.92 }),
      );
      // Printed ceiling-down; flip it over the box.
      lid.rotation.x = Math.PI;
      lid.position.set(r.lidOffset, r.depth - r.lidOffset, r.height + r.lidCeiling + (explode ? 30 : 0));
      this.content.add(lid);
    }
    this.frame();
  }
}
