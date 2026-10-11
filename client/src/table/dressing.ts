import * as THREE from 'three';

/** Low-poly decorative props only. No shadows, extra lights, textures or pick meshes.
 * Prop coordinates are normalized decoration units, scaled by map span/40. One ruler tick buffer keeps draw calls bounded.
 * TableScene owns/disposes this group, including shared materials exactly once.
 */
export function createDressing(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'table-dressing';
  const brass = new THREE.MeshStandardMaterial({ color: 0x9c8150, roughness: 0.65 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x977b52, roughness: 0.85 });
  const ink = new THREE.MeshStandardMaterial({ color: 0x252729, roughness: 0.35 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xd8caa5, roughness: 0.95 });
  const addMesh = (
    parent: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const ruler = new THREE.Group();
  ruler.name = 'ruler';
  addMesh(ruler, new THREE.BoxGeometry(7, 0.12, 0.7), wood, 0, 0.08, 0);
  const ticks: number[] = [];
  for (let i = 0; i <= 14; i++) {
    const x = -3.25 + (i * 6.5) / 14;
    ticks.push(x, 0.15, -0.3, x, 0.15, i % 2 ? -0.05 : 0.15);
  }
  const tickGeometry = new THREE.BufferGeometry();
  tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  ruler.add(new THREE.LineSegments(tickGeometry, new THREE.LineBasicMaterial({ color: 0x403324 })));

  const dividers = new THREE.Group();
  dividers.name = 'dividers';
  for (const direction of [-1, 1]) {
    const leg = addMesh(
      dividers,
      new THREE.CylinderGeometry(0.05, 0.08, 2.4, 6),
      brass,
      direction * 0.45,
      0.12,
      0,
    );
    leg.rotation.set(Math.PI / 2, 0, direction * 0.4);
  }
  addMesh(dividers, new THREE.SphereGeometry(0.16, 8, 6), brass, 0, 0.13, -1.1);

  const inkwell = new THREE.Group();
  inkwell.name = 'inkwell';
  addMesh(inkwell, new THREE.CylinderGeometry(0.35, 0.42, 0.55, 8), ink, 0, 0.3, 0);
  addMesh(inkwell, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 8), brass, 0, 0.62, 0);

  const lamp = new THREE.Group();
  lamp.name = 'lamp';
  addMesh(lamp, new THREE.CylinderGeometry(0.5, 0.65, 0.2, 10), brass, 0, 0.1, 0);
  addMesh(lamp, new THREE.CylinderGeometry(0.08, 0.1, 1.8, 6), brass, 0, 1.1, 0);
  addMesh(lamp, new THREE.ConeGeometry(0.75, 0.6, 10, 1, true), paper, 0, 2, 0);
  root.add(ruler, dividers, inkwell, lamp);
  return root;
}

/** Keep dressing on the table border, outside the map picking plane. */
export function positionDressing(root: THREE.Group, width: number, height: number): void {
  const scale = Math.max(width, height) / 40;
  root.scale.setScalar(scale);
  width /= scale;
  height /= scale;
  root.getObjectByName('ruler')?.position.set(0, 0, height / 2 + 1.3);
  root.getObjectByName('dividers')?.position.set(-width / 2 - 1.8, 0, 0);
  root.getObjectByName('inkwell')?.position.set(width / 2 + 1.4, 0, height / 2 + 1.2);
  root.getObjectByName('lamp')?.position.set(-width / 2 - 1.5, 0, -height / 2 - 1.5);
}
