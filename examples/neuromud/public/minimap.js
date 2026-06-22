// 3D minimap (three.js). The model never renders the map - it just keeps the rooms/exits accurate in the
// DB. This pulls that data from /__map and redraws after each command: a box per room, lines for grid
// passages, the player's room highlighted, camera slowly orbiting the player.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

let renderer, scene, camera, group, mount, compass, worldEl;
const target = new THREE.Vector3();
let angle = 0;
const toScene = (x, y, z) => new THREE.Vector3(x, z, -y); // grid -> scene (z is height)
// Which world a coordinate is in - matches the prompt's split (the Matrix block is anchored at 100,100).
const inMatrix = (x, y) => x >= 50 && y >= 50;

// A billboarded text label (always faces the camera) - used for the N/S/E/W compass markers.
function makeLabel(text) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c9a86a";
  ctx.font = "bold 44px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sprite.scale.set(0.9, 0.9, 0.9);
  return sprite;
}

// A flat compass: an N-S line and an E-W line crossing at the centre, with N/S/E/W labels at the ends.
// Built once; the loop keeps the whole group centred on the player, so it reads like a compass rose.
function buildCompass() {
  const g = new THREE.Group();
  const R = 6;
  const mat = new THREE.LineBasicMaterial({ color: 0x5b606e, transparent: true, opacity: 0.45 });
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -R), new THREE.Vector3(0, 0, R)]), mat));
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-R, 0, 0), new THREE.Vector3(R, 0, 0)]), mat));
  // ring through the N/S/E/W points
  const ring = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ring.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat));
  const dirs = { N: [0, 0, -1], S: [0, 0, 1], E: [1, 0, 0], W: [-1, 0, 0] };
  for (const k in dirs) {
    const s = makeLabel(k);
    s.position.set(dirs[k][0] * R, 0.4, dirs[k][2] * R);
    g.add(s);
  }
  return g;
}

function init() {
  mount = document.getElementById("minimap");
  if (!mount || renderer) return;
  const w = mount.clientWidth || 280,
    h = mount.clientHeight || 200;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  mount.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffd9a0, 0.9);
  key.position.set(4, 7, 3);
  scene.add(key);
  group = new THREE.Group();
  scene.add(group);
  compass = buildCompass();
  scene.add(compass);

  // Legend overlay (HTML, on top of the canvas) explaining the box and dot colours.
  const legend = document.createElement("div");
  legend.className = "map-legend";
  legend.innerHTML =
    '<div><span class="lg-box"></span> you</div>' +
    '<div><span class="lg-dot lg-item"></span> item</div>' +
    '<div><span class="lg-dot lg-monster"></span> target</div>' +
    '<div><span class="lg-dot lg-npc"></span> npc</div>' +
    '<div><span class="lg-dot lg-player"></span> player</div>';
  mount.appendChild(legend);

  // Shows which world the operator is currently in (the map renders only that world's rooms).
  worldEl = document.createElement("div");
  worldEl.className = "map-world";
  mount.appendChild(worldEl);

  addEventListener("resize", () => {
    if (!mount) return;
    const w2 = mount.clientWidth || 280,
      h2 = mount.clientHeight || 200;
    renderer.setSize(w2, h2);
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
  });
  loop();
}

function loop() {
  requestAnimationFrame(loop);
  angle += 0.004;
  const r = 9;
  camera.position.set(target.x + Math.cos(angle) * r, target.y + 6, target.z + Math.sin(angle) * r);
  camera.lookAt(target);
  compass.position.set(target.x, target.y - 1.5, target.z); // a compass rose on the ground below the room
  renderer.render(scene, camera);
}

async function refresh() {
  if (!group) return;
  let data;
  try {
    data = await (await fetch("/__map")).json();
  } catch {
    return;
  }
  group.clear();
  const P = data.player;
  // Render only the world the operator is in; null = no player (e.g. the /state overview) -> show all.
  const matrix = P ? inMatrix(P.x, P.y) : null;
  if (worldEl) {
    worldEl.textContent = matrix === null ? "" : matrix ? "THE MATRIX" : "THE SPRAWL";
    worldEl.className = "map-world" + (matrix === null ? "" : matrix ? " matrix" : " sprawl");
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5b606e });
  for (const e of data.exits || []) {
    if (matrix !== null && inMatrix(e.x, e.y) !== matrix) continue; // skip the other world's passages
    const g = new THREE.BufferGeometry().setFromPoints([toScene(e.x, e.y, e.z), toScene(e.to_x, e.to_y, e.to_z)]);
    group.add(new THREE.Line(g, lineMat));
  }
  for (const rm of data.rooms || []) {
    if (matrix !== null && inMatrix(rm.x, rm.y) !== matrix) continue; // only the current world's rooms
    const here = P && rm.x === P.x && rm.y === P.y && rm.z === P.z;
    const base = toScene(rm.x, rm.y, rm.z);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshStandardMaterial({ color: here ? 0xb388ff : 0x444954, emissive: here ? 0x3a1a7a : 0x111016, wireframe: true }),
    );
    mesh.position.copy(base);
    group.add(mesh);
    // content markers floating above the room: gold = item, red = target, teal = NPC, blue = another player
    const dots = [];
    if (rm.has_monster) dots.push(0xc0563f);
    if (rm.has_item) dots.push(0xffcf6b);
    if (rm.has_npc) dots.push(0x1fd6a0);
    if (rm.has_player) dots.push(0x5b8def);
    dots.forEach((col, i) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshBasicMaterial({ color: col }));
      const spread = (i - (dots.length - 1) / 2) * 0.26;
      dot.position.set(base.x + spread, base.y + 0.5, base.z);
      group.add(dot);
    });
  }
  if (P) target.lerp(toScene(P.x, P.y, P.z), 1);
}

addEventListener("DOMContentLoaded", () => {
  init();
  refresh();
});
document.addEventListener("hallu:finalize", refresh); // re-pull after each streamed command (document, not window: the event doesn't bubble)
