// Nông trang ảo VIA Cốm – bản 0.1
// Một trang web duy nhất, không cần cài đặt. Giữ giao thức websocket của VIA B:
// chương trình Python của người học là "server" ở cổng 4567, giả lập kết nối tới,
// gửi ảnh camera và nhận lại lệnh lái. Xem docs/SIMULATION.md.
//
// Hệ trục dùng trong mã và trong dữ liệu gửi ra: chuẩn ROS (x về trước, y sang trái,
// z lên trên, góc theta ngược chiều kim đồng hồ). Three.js dùng y lên trên nên mọi
// toạ độ đi qua hàm P().

import * as THREE from './vendor/three.module.min.js';
import { mulberryPlant, mulberryLeaf, PALETTE } from './mulberry.js';
import { lemonPlant, leafClump, fruitColor, RIPE_AT } from './lemon.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { attachArm, POSES, JOINTS } from './so101.js';

const params = new URLSearchParams(location.search);
const MAP_URL = params.get('map') || '../maps/lang_maker_v1.json';
const WS_URL = params.get('ws') || 'ws://localhost:4567';
const SEND_HZ = Number(params.get('hz') || 10);

// ----- Thông số robot VIA C phần cứng v0.1: đế 2 bánh v2.0, đo từ file 3D (docs/HARDWARE-v0.1.md) -----
const ROBOT = {
  radius: 0.24,        // m, bán kính va chạm (thân 32 × 33 cm)
  track: 0.22,         // m, khoảng cách tâm hai bánh
  wheelR: 0.098,       // m, bán kính bánh
  groundOffset: 0.068, // m, tâm trục bánh cao hơn mặt đất
  vMax: 0.4,           // m/s
  wMax: 1.2,           // rad/s
  camX: 0.125,         // m, camera trước nằm ở mặt trước đế
  camHeight: 0.27,     // m, độ cao camera trước so với mặt đất
  camTilt: -0.05,      // rad, âm là hơi ngửa lên để thấy tán chanh và cây dâu
  camFov: 70,          // độ, góc nhìn dọc
  camW: 320, camH: 240,
  lidarRays: 180, lidarMax: 8.0,
  cmdTimeout: 0.5,     // s, quá hạn không có lệnh thì dừng
};
// ?cam=cot: giữ camera trên cột 0,75 m như bản 1 trong tài liệu định hướng, để so hai vị trí camera.
if (params.get('cam') === 'cot') Object.assign(ROBOT, { camX: -0.03, camHeight: 0.75, camTilt: 0.20 });

const P = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

function rng(seed) { // mulberry32: cùng seed thì vườn giống hệt nhau trên mọi máy
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- dựng cảnh
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.skyHorizon);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
sun.position.set(6, 12, 4);
scene.add(sun);

const viewCam = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
const robotCam = new THREE.PerspectiveCamera(ROBOT.camFov, ROBOT.camW / ROBOT.camH, 0.05, 60);
const camTarget = new THREE.WebGLRenderTarget(ROBOT.camW, ROBOT.camH);
camTarget.texture.colorSpace = THREE.SRGBColorSpace;
const camCanvas = document.getElementById('cam');
const camCtx = camCanvas.getContext('2d');
const camPixels = new Uint8Array(ROBOT.camW * ROBOT.camH * 4);
const camImage = camCtx.createImageData(ROBOT.camW, ROBOT.camH);

const world = {
  map: null,
  obstacles: [],   // {x, y, r} cho lidar và va chạm
  foliage: [],     // {c: Vector3 (three), r} để xét che khuất
  fruits: [],      // {p: Vector3 (three), r, cls}
  tags: [],        // {id, x, y}
};

function instanced(geo, color, items, place) {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), items.length);
  const m = new THREE.Matrix4();
  items.forEach((it, i) => { place(it, m); mesh.setMatrixAt(i, m); });
  scene.add(mesh);
  return mesh;
}

function tagTexture(id) {
  // Bảng mốc có số. Bản 0.1 chưa vẽ mẫu AprilTag thật; giả lập trả thẳng
  // id, khoảng cách và góc của mốc trong trường "tags".
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#000'; g.fillRect(8, 8, 112, 112);
  g.fillStyle = '#fff';
  const r = rng(1000 + id);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (r() > 0.5) g.fillRect(24 + i * 20, 24 + j * 20, 20, 20);
  g.fillStyle = '#fff'; g.fillRect(40, 44, 48, 40);
  g.fillStyle = '#000'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(id), 64, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildFarm(map) {
  world.map = map;
  const [sx, sy] = map.size;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(sx + 8, sy + 8), new THREE.MeshLambertMaterial({ color: PALETTE.grass }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  for (const p of map.paths || []) { // lối đi nền cứng
    const [x0, y0] = p.from, [x1, y1] = p.to;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len + p.width, p.width), new THREE.MeshLambertMaterial({ color: PALETTE.path }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    m.position.copy(P((x0 + x1) / 2, (y0 + y1) / 2, 0.005)); scene.add(m);
  }

  const trunks = [], leavesLemon = [], leavesMul = [], ripe = [], unripe = [], soil = [], mulberries = [], lemons = [];
  const r = rng(2026);
  for (const row of map.rows || []) {
    const [x0, y0] = row.start, [x1, y1] = row.end;
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / row.spacing) + 1;
    soil.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, len, a: Math.atan2(y1 - y0, x1 - x0) });
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const x = x0 + (x1 - x0) * t + (r() - 0.5) * 0.08, y = y0 + (y1 - y0) * t + (r() - 0.5) * 0.08;
      if (row.crop === 'lemon') {
        // chanh: cây thấp hơn dâu, tán tròn sẫm, quả từ xanh ngả vàng theo độ chín
        const plant = lemonPlant(r, { height: 0.4 + r() * 0.3 });
        const rot = r() * Math.PI * 2;
        lemons.push({ x, y, rot, plant });
        world.obstacles.push({ x, y, r: 0.05 });
        leavesLemon.push({ x, y, z: plant.crown.y + 0.06, r: plant.crown.r * 0.7 });
        const c = Math.cos(rot), sn = Math.sin(rot);
        for (const f of plant.fruits) { // đổi toạ độ quả từ hệ cục bộ của cây sang hệ ROS
          const [lx, ly, lz] = f.p; // three cục bộ: x, y lên, z
          const tx = lx * c + lz * sn, tz = -lx * sn + lz * c; // quay quanh trục đứng
          (f.ripeness >= RIPE_AT ? ripe : unripe).push({ x: x + tx, y: y - tz, z: ly + 0.06, r: f.r, ripeness: f.ripeness });
        }
      } else { // dâu: gốc đốn thấp, cành xoè, lá hình tim (kiểu vườn dâu BLUESILK)
        const plant = mulberryPlant(r);
        mulberries.push({ x, y, rot: r() * Math.PI * 2, plant });
        world.obstacles.push({ x, y, r: 0.10 });
        // vùng tán lá dùng để xét che khuất khi gắn nhãn quả
        for (let j = 0; j < 2; j++) leavesMul.push({ x, y, z: 0.75 + j * 0.45, r: 0.32 });
      }
    }
  }

  instanced(new THREE.BoxGeometry(1, 0.06, 0.5), PALETTE.earthDark, soil, (s, m) => {
    m.compose(P(s.x, s.y, 0.03), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.a), new THREE.Vector3(s.len + 0.6, 1, 1));
  });
  instanced(new THREE.CylinderGeometry(1, 1, 1, 8), 0x6e5338, trunks, (t, m) => {
    m.compose(P(t.x, t.y, t.h / 2), new THREE.Quaternion(), new THREE.Vector3(t.r, t.h, t.r));
  });
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const place = (s, m) => m.compose(P(s.x, s.y, s.z), new THREE.Quaternion(), new THREE.Vector3(s.r, s.r, s.r));
  drawMulberries(mulberries);
  drawLemons(lemons);

  for (const t of trunks) world.obstacles.push({ x: t.x, y: t.y, r: t.r + 0.03 });
  for (const s of [...leavesLemon, ...leavesMul]) world.foliage.push({ c: P(s.x, s.y, s.z), r: s.r * 0.97 });
  for (const f of ripe) world.fruits.push({ p: P(f.x, f.y, f.z), r: f.r, cls: 'lemon_ripe', ripeness: f.ripeness });
  for (const f of unripe) world.fruits.push({ p: P(f.x, f.y, f.z), r: f.r, cls: 'lemon_unripe', ripeness: f.ripeness });

  for (const t of map.tags || []) {
    const [x, y] = t.pos;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x555555 }));
    post.position.copy(P(x, y, 0.4)); scene.add(post);
    const tex = tagTexture(t.id);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.3), [
      new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex }),
      ...Array(4).fill(new THREE.MeshLambertMaterial({ color: 0xffffff }))]);
    board.position.copy(P(x, y, 0.95)); scene.add(board);
    world.obstacles.push({ x, y, r: 0.04 });
    world.tags.push({ id: t.id, x, y });
  }
  document.getElementById('mapname').textContent = map.name || '';
}

// Vẽ cả vườn dâu bằng 4 InstancedMesh: đoạn cành, u gốc, lá, quả.
function drawMulberries(list) {
  if (!list.length) return;
  const segs = [], knobs = [], leaves = [], fruits = [];
  const m = new THREE.Matrix4(), base = new THREE.Matrix4(), q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (const it of list) {
    base.compose(P(it.x, it.y, 0.06), q.setFromAxisAngle(up, it.rot), s.set(1, 1, 1));
    for (const g of it.plant.segs) segs.push({ g, base: base.clone() });
    for (const k of it.plant.knobs) knobs.push({ k, base: base.clone() });
    for (const l of it.plant.leaves) leaves.push({ l, base: base.clone() });
    for (const f of it.plant.fruits) fruits.push({ f, base: base.clone() });
  }
  const mat = opts => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0, ...opts });
  const fill = (geo, material, items, place, cast = true) => {
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    const c = new THREE.Color();
    items.forEach((it, i) => { place(it, m); mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.set(it.color)); });
    mesh.castShadow = cast; scene.add(mesh); return mesh;
  };
  // cành: trụ đơn vị (cao 1, từ y=0 tới y=1) kéo giữa hai điểm, thon dần
  const rod = new THREE.CylinderGeometry(0.6, 1, 1, 5); rod.translate(0, 0.5, 0);
  fill(rod, mat({}), segs.map(x => ({ ...x, color: x.g.color })), (x, out) => {
    const a = new THREE.Vector3(...x.g.p0), b = new THREE.Vector3(...x.g.p1);
    d.subVectors(b, a); const len = d.length();
    out.compose(a, new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), v.set(x.g.r0, len, x.g.r0)).premultiply(x.base);
  });
  fill(new THREE.IcosahedronGeometry(1, 0), mat({}), knobs.map(x => ({ ...x, color: x.k.color })), (x, out) =>
    out.compose(new THREE.Vector3(...x.k.p), q.identity(), v.setScalar(x.k.s)).premultiply(x.base));
  fill(mulberryLeaf(), mat({ vertexColors: true, roughness: 0.42, side: THREE.DoubleSide }), leaves.map(x => ({ ...x, color: x.l.color })), (x, out) =>
    out.compose(new THREE.Vector3(...x.l.p), x.l.q, v.setScalar(x.l.s)).premultiply(x.base));
  fill(new THREE.IcosahedronGeometry(1, 1), mat({ roughness: 0.6 }), fruits.map(x => ({ ...x, color: x.f.color })), (x, out) =>
    out.compose(new THREE.Vector3(...x.f.p), q.identity(), v.set(0.016, 0.027, 0.016)).premultiply(x.base));
}

// Vẽ cả vườn chanh: cành, 3 biến thể khối lá, quả (màu theo độ chín).
function drawLemons(list) {
  if (!list.length) return;
  const m = new THREE.Matrix4(), base = new THREE.Matrix4(), q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const segs = [], clumps = [[], [], []], fruits = [];
  for (const it of list) {
    base.compose(P(it.x, it.y, 0.06), q.setFromAxisAngle(up, it.rot), one);
    for (const g of it.plant.segs) segs.push({ g, base: base.clone(), color: g.color });
    for (const k of it.plant.clumps) clumps[k.variant].push({ k, base: base.clone(), color: k.color });
    for (const f of it.plant.fruits) fruits.push({ f, base: base.clone(), color: fruitColor(f.ripeness) });
  }
  const mat = opts => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0, ...opts });
  const fill = (geo, material, items, place) => {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    const c = new THREE.Color();
    items.forEach((it, i) => { place(it, m); mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.set(it.color)); });
    scene.add(mesh);
  };
  const rod = new THREE.CylinderGeometry(0.7, 1, 1, 5); rod.translate(0, 0.5, 0);
  fill(rod, mat({}), segs, (x, out) => {
    const a = new THREE.Vector3(...x.g.p0), b = new THREE.Vector3(...x.g.p1);
    d.subVectors(b, a); const len = d.length();
    out.compose(a, new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), v.set(x.g.r0, len, x.g.r0)).premultiply(x.base);
  });
  clumps.forEach((items, i) => fill(leafClump(i + 1), mat({ roughness: 0.5 }), items, (x, out) =>
    out.compose(new THREE.Vector3(...x.k.p), q.identity(), v.setScalar(x.k.s)).premultiply(x.base)));
  // quả chanh hơi thuôn, nằm nghiêng ngẫu nhiên
  fill(new THREE.IcosahedronGeometry(1, 1), mat({ roughness: 0.45 }), fruits, (x, out) =>
    out.compose(new THREE.Vector3(...x.f.p), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), x.f.tilt),
      v.set(x.f.r, x.f.r * 1.3, x.f.r)).premultiply(x.base));
}

// ---------------------------------------------------------------- robot
const robot = { x: 0, y: 0, theta: 0, v: 0, w: 0, cmdV: 0, cmdW: 0, cmdAt: -1, body: new THREE.Group() };

// Robot VIA C phần cứng v0.1: đế 2 bánh v2.0 + cột nâng 12 cm + tay SO-101 (docs/HARDWARE-v0.1.md).
// Mô hình nằm trong models/via_c_v0_1_khop.glb, đã đổi sang trục three (y lên trên, mũi robot theo +x),
// 6 khớp SO-101 xoay được (so101.js). Gốc mô hình ở tâm trục bánh, đáy bánh thấp hơn gốc 6,8 cm nên nâng lên.
let arm = null;
function buildRobot() {
  const g = robot.body;
  new GLTFLoader().load('models/via_c_v0_1_khop.glb', (gltf) => {
    gltf.scene.position.y = ROBOT.groundOffset;
    g.add(gltf.scene);
    arm = attachArm(gltf.scene); arm.snap(POSES.san_sang); window.__sim.arm = arm;
  }, undefined, (e) => console.warn('Không nạp được mô hình robot', e));
  robotCam.rotation.order = 'YXZ';
  robotCam.rotation.set(-ROBOT.camTilt, -Math.PI / 2, 0); // nhìn theo +x của robot
  robotCam.position.set(ROBOT.camX, ROBOT.camHeight, 0);
  g.add(robotCam);
  scene.add(g);
}

function resetRobot() {
  const s = (world.map.robot && world.map.robot.start) || [0, 0, 0];
  robot.x = s[0]; robot.y = s[1]; robot.theta = (s[2] || 0) * Math.PI / 180; robot.v = robot.w = 0;
}

function blocked(x, y) {
  const [sx, sy] = world.map.size;
  if (Math.abs(x) > sx / 2 + 2 || Math.abs(y) > sy / 2 + 2) return true;
  for (const o of world.obstacles) if (Math.hypot(o.x - x, o.y - y) < o.r + ROBOT.radius) return true;
  return false;
}

const keys = {};
const ARM_KEYS = { 1: 'san_sang', 2: 'vuon_hai', 3: 'gap' };
addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'c') topView = !topView;
  if (e.key.toLowerCase() === 'r') resetRobot();
  if (arm && ARM_KEYS[e.key]) arm.command(POSES[ARM_KEYS[e.key]]);
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
let topView = params.get('view') === 'top';
let simTime = 0;

function stepRobot(dt) {
  let v = 0, w = 0;
  const manual = keys.w || keys.s || keys.a || keys.d;
  if (manual) {
    v = ((keys.w ? 1 : 0) - (keys.s ? 1 : 0)) * ROBOT.vMax;
    w = ((keys.a ? 1 : 0) - (keys.d ? 1 : 0)) * ROBOT.wMax * 0.7;
  } else if (simTime - robot.cmdAt < ROBOT.cmdTimeout) { v = robot.cmdV; w = robot.cmdW; }
  // tăng giảm tốc mềm, cho giống động cơ thật
  robot.v += Math.max(-1.0 * dt, Math.min(1.0 * dt, v - robot.v));
  robot.w += Math.max(-4.0 * dt, Math.min(4.0 * dt, w - robot.w));
  const nx = robot.x + Math.cos(robot.theta) * robot.v * dt, ny = robot.y + Math.sin(robot.theta) * robot.v * dt;
  if (blocked(nx, ny)) robot.v = 0; else { robot.x = nx; robot.y = ny; }
  robot.theta = Math.atan2(Math.sin(robot.theta + robot.w * dt), Math.cos(robot.theta + robot.w * dt));
  robot.body.position.copy(P(robot.x, robot.y, 0));
  robot.body.rotation.y = robot.theta;
}

// ---------------------------------------------------------------- cảm biến
function scanLidar() {
  const n = ROBOT.lidarRays, ranges = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = robot.theta - Math.PI + (2 * Math.PI * i) / n, dx = Math.cos(a), dy = Math.sin(a);
    let best = ROBOT.lidarMax;
    for (const o of world.obstacles) {
      const ox = o.x - robot.x, oy = o.y - robot.y, b = ox * dx + oy * dy;
      if (b <= 0) continue;
      const d2 = ox * ox + oy * oy - b * b;
      if (d2 > o.r * o.r) continue;
      const t = b - Math.sqrt(o.r * o.r - d2);
      if (t > 0 && t < best) best = t;
    }
    ranges[i] = best >= ROBOT.lidarMax ? null : Math.round(best * 1000) / 1000; // null = không gặp vật
  }
  return { angle_min: -Math.PI, angle_increment: (2 * Math.PI) / n, range_max: ROBOT.lidarMax, ranges };
}

function seenTags() {
  const out = [], half = (ROBOT.camFov * ROBOT.camW / ROBOT.camH) * Math.PI / 360;
  for (const t of world.tags) {
    const d = Math.hypot(t.x - robot.x, t.y - robot.y);
    let b = Math.atan2(t.y - robot.y, t.x - robot.x) - robot.theta;
    b = Math.atan2(Math.sin(b), Math.cos(b));
    if (d < 6 && Math.abs(b) < half) out.push({ id: t.id, distance: +d.toFixed(3), bearing: +b.toFixed(4) });
  }
  return out;
}

const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _oc = new THREE.Vector3();
function fruitLabels() { // nhãn tự động: khung bao từng quả chanh trong ảnh camera
  const out = [], W = ROBOT.camW, H = ROBOT.camH;
  robotCam.getWorldPosition(_c);
  const f = (H / 2) / Math.tan((ROBOT.camFov * Math.PI) / 360);
  for (const fr of world.fruits) {
    const dist = _c.distanceTo(fr.p);
    if (dist > 6) continue;
    _v.copy(fr.p).project(robotCam);
    if (Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1 || _v.z < -1 || _v.z > 1) continue;
    _d.copy(fr.p).sub(_c).normalize();
    let hidden = false;
    for (const s of world.foliage) { // tia từ camera tới quả có xuyên qua tán lá nào không
      _oc.copy(s.c).sub(_c);
      const b = _oc.dot(_d);
      if (b <= 0) continue;
      const d2 = _oc.lengthSq() - b * b;
      if (d2 > s.r * s.r) continue;
      if (b - Math.sqrt(s.r * s.r - d2) < dist - 0.05) { hidden = true; break; }
    }
    if (hidden) continue;
    const pr = Math.max(1.5, (fr.r * f) / dist), cx = ((_v.x + 1) / 2) * W, cy = ((1 - _v.y) / 2) * H;
    out.push({ class: fr.cls, ripeness: +fr.ripeness.toFixed(2), bbox: [+(cx - pr).toFixed(1), +(cy - pr).toFixed(1), +(2 * pr).toFixed(1), +(2 * pr).toFixed(1)], distance: +dist.toFixed(3) });
  }
  return out;
}

function grabCamera() {
  const W = ROBOT.camW, H = ROBOT.camH;
  renderer.setRenderTarget(camTarget);
  renderer.render(scene, robotCam);
  renderer.readRenderTargetPixels(camTarget, 0, 0, W, H, camPixels);
  renderer.setRenderTarget(null);
  for (let y = 0; y < H; y++) camImage.data.set(camPixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  camCtx.putImageData(camImage, 0, 0);
}

// ---------------------------------------------------------------- kết nối
let ws = null, wsOk = false;
const wsEl = document.getElementById('ws');
function connect() {
  try { ws = new WebSocket(WS_URL); } catch (e) { setTimeout(connect, 2000); return; }
  ws.onopen = () => { wsOk = true; wsEl.textContent = 'đã nối ' + WS_URL; wsEl.className = 'ok'; };
  ws.onclose = () => { wsOk = false; wsEl.textContent = 'chưa có chương trình điều khiển'; wsEl.className = 'off'; setTimeout(connect, 2000); };
  ws.onerror = () => {};
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    const clip = (x, a) => Math.max(-a, Math.min(a, Number(x) || 0));
    if (m.arm && arm) { // lệnh tay: {"arm": {"shoulder_pan": 0.2, ...}} theo radian,
      const a = {};      // hoặc khoá kiểu LeRobot "shoulder_pan.pos" theo độ
      for (const [k, v] of Object.entries(m.arm)) a[k.endsWith('.pos') ? k.slice(0, -4) : k] = k.endsWith('.pos') ? Number(v) * Math.PI / 180 : Number(v);
      arm.command(a);
    }
    if (!('linear' in m || 'angular' in m || 'left' in m || 'right' in m || 'throttle' in m || 'steering' in m)) return;
    if ('linear' in m || 'angular' in m) { robot.cmdV = clip(m.linear, ROBOT.vMax); robot.cmdW = clip(m.angular, ROBOT.wMax); }
    else if ('left' in m || 'right' in m) { // tốc độ hai bánh, -1..1
      const l = clip(m.left, 1) * ROBOT.vMax, r = clip(m.right, 1) * ROBOT.vMax;
      robot.cmdV = (l + r) / 2; robot.cmdW = clip((r - l) / ROBOT.track, ROBOT.wMax);
    } else { // kiểu VIA B: throttle, steering (dương = rẽ phải)
      robot.cmdV = clip(m.throttle, 1) * ROBOT.vMax; robot.cmdW = -clip(m.steering, 1) * ROBOT.wMax;
    }
    robot.cmdAt = simTime;
  };
}

let lastSend = 0, lastLabels = [];
const _tip = new THREE.Vector3();
function publish() {
  grabCamera();
  lastLabels = fruitLabels();
  const msg = {
    image: camCanvas.toDataURL('image/jpeg', 0.75).split(',')[1],
    time: +simTime.toFixed(3),
    pose: { x: +robot.x.toFixed(4), y: +robot.y.toFixed(4), theta: +robot.theta.toFixed(4) },
    velocity: { linear: +robot.v.toFixed(3), angular: +robot.w.toFixed(3) },
    lidar: scanLidar(),
    tags: seenTags(),
    labels: lastLabels,
  };
  if (arm) {
    msg.arm = Object.fromEntries(JOINTS.map((j) => [j.name, +arm.q[j.name].toFixed(4)]));
    const t = arm.tipWorld(_tip); // đầu kẹp theo toạ độ vườn (x, y trên mặt đất, z lên trên)
    msg.gripper_tip = [+t.x.toFixed(3), +(-t.z).toFixed(3), +t.y.toFixed(3)];
  }
  window.__sim.last = msg;
  if (wsOk && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------- vòng lặp
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); viewCam.aspect = w / h; viewCam.updateProjectionMatrix();
}
addEventListener('resize', resize);

const clock = new THREE.Clock();
const poseEl = document.getElementById('pose'), velEl = document.getElementById('vel'), nEl = document.getElementById('nlabels');
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  simTime += dt;
  stepRobot(dt);
  if (arm) arm.step(dt);
  robot.body.updateMatrixWorld(true);
  if (simTime - lastSend >= 1 / SEND_HZ) { lastSend = simTime; publish(); }
  if (topView) { viewCam.position.copy(P(robot.x, robot.y, 9)); viewCam.up.set(1, 0, 0); viewCam.lookAt(P(robot.x, robot.y, 0)); }
  else {
    const bx = robot.x - Math.cos(robot.theta) * 2.2, by = robot.y - Math.sin(robot.theta) * 2.2;
    viewCam.up.set(0, 1, 0); viewCam.position.lerp(P(bx, by, 1.6), 0.08); viewCam.lookAt(P(robot.x + Math.cos(robot.theta), robot.y + Math.sin(robot.theta), 0.5));
  }
  renderer.render(scene, viewCam);
  poseEl.textContent = `x ${robot.x.toFixed(2)} m, y ${robot.y.toFixed(2)} m, góc ${(robot.theta * 180 / Math.PI).toFixed(0)}°`;
  velEl.textContent = `${robot.v.toFixed(2)} m/s`;
  nEl.textContent = lastLabels.length;
  requestAnimationFrame(frame);
}

window.__sim = { robot, world, ROBOT, last: null, ready: false };
const map = await (await fetch(MAP_URL)).json();
buildFarm(map); buildRobot(); resetRobot(); resize(); connect();
viewCam.position.copy(P(robot.x - 2.2, robot.y, 1.6));
window.__sim.ready = true;
requestAnimationFrame(frame);
