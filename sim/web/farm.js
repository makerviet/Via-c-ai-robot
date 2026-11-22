// Nông trang ảo VIA Cốm – bản 0.1
// Một trang web duy nhất, không cần cài đặt. Giữ giao thức websocket của VIA B:
// chương trình Python của người học là "server" ở cổng 4567, giả lập kết nối tới,
// gửi ảnh camera và nhận lại lệnh lái. Xem docs/SIMULATION.md.
//
// Hệ trục dùng trong mã và trong dữ liệu gửi ra: chuẩn ROS (x về trước, y sang trái,
// z lên trên, góc theta ngược chiều kim đồng hồ). Three.js dùng y lên trên nên mọi
// toạ độ đi qua hàm P().

import * as THREE from './vendor/three.module.min.js';

const params = new URLSearchParams(location.search);
const MAP_URL = params.get('map') || '../maps/lang_maker_v1.json';
const WS_URL = params.get('ws') || 'ws://localhost:4567';
const SEND_HZ = Number(params.get('hz') || 10);

// ----- Thông số robot bản 1: đế 2 bánh trên nền cứng (theo tài liệu định hướng) -----
const ROBOT = {
  radius: 0.25,        // m, bán kính va chạm
  track: 0.40,         // m, khoảng cách hai bánh
  vMax: 0.4,           // m/s
  wMax: 1.2,           // rad/s
  camHeight: 0.75,     // m, camera trên cột
  camTilt: 0.20,       // rad, chúc xuống
  camFov: 70,          // độ, góc nhìn dọc
  camW: 320, camH: 240,
  lidarRays: 180, lidarMax: 8.0,
  cmdTimeout: 0.5,     // s, quá hạn không có lệnh thì dừng
};

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
scene.background = new THREE.Color(0xcfe6f5);
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
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(sx + 8, sy + 8), new THREE.MeshLambertMaterial({ color: 0x7a9a55 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  for (const p of map.paths || []) { // lối đi nền cứng
    const [x0, y0] = p.from, [x1, y1] = p.to;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len + p.width, p.width), new THREE.MeshLambertMaterial({ color: 0xc9c2b2 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    m.position.copy(P((x0 + x1) / 2, (y0 + y1) / 2, 0.005)); scene.add(m);
  }

  const trunks = [], leavesLemon = [], leavesMul = [], ripe = [], unripe = [], soil = [];
  const r = rng(2026);
  for (const row of map.rows || []) {
    const [x0, y0] = row.start, [x1, y1] = row.end;
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / row.spacing) + 1;
    soil.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, len, a: Math.atan2(y1 - y0, x1 - x0) });
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const x = x0 + (x1 - x0) * t + (r() - 0.5) * 0.08, y = y0 + (y1 - y0) * t + (r() - 0.5) * 0.08;
      if (row.crop === 'lemon') {
        const h = 0.95 + r() * 0.25, fr = 0.40 + r() * 0.10;
        trunks.push({ x, y, h: h - fr * 0.6, r: 0.05 });
        leavesLemon.push({ x, y, z: h, r: fr });
        const k = 5 + Math.floor(r() * 5);
        for (let j = 0; j < k; j++) { // quả nằm trên mặt tán, lệch về nửa dưới
          const az = r() * Math.PI * 2, el = -0.9 + r() * 1.3;
          const fx = x + Math.cos(az) * Math.cos(el) * fr, fy = y + Math.sin(az) * Math.cos(el) * fr, fz = h + Math.sin(el) * fr;
          (r() > 0.35 ? ripe : unripe).push({ x: fx, y: fy, z: fz, r: 0.035 });
        }
      } else { // dâu: bụi cao, nhiều tầng lá
        trunks.push({ x, y, h: 0.5, r: 0.04 });
        for (let j = 0; j < 3; j++) leavesMul.push({ x: x + (r() - 0.5) * 0.2, y: y + (r() - 0.5) * 0.2, z: 0.5 + j * 0.3, r: 0.30 + r() * 0.08 });
      }
    }
  }

  instanced(new THREE.BoxGeometry(1, 0.06, 0.5), 0x6b4f32, soil, (s, m) => {
    m.compose(P(s.x, s.y, 0.03), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.a), new THREE.Vector3(s.len + 0.6, 1, 1));
  });
  instanced(new THREE.CylinderGeometry(1, 1, 1, 8), 0x6e5338, trunks, (t, m) => {
    m.compose(P(t.x, t.y, t.h / 2), new THREE.Quaternion(), new THREE.Vector3(t.r, t.h, t.r));
  });
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const place = (s, m) => m.compose(P(s.x, s.y, s.z), new THREE.Quaternion(), new THREE.Vector3(s.r, s.r, s.r));
  instanced(ball, 0x2f6b2c, leavesLemon, place);
  instanced(ball, 0x4f9a3a, leavesMul, place);
  instanced(new THREE.SphereGeometry(1, 10, 8), 0xf3d32b, ripe, place);
  instanced(new THREE.SphereGeometry(1, 10, 8), 0x8fc43a, unripe, place);

  for (const t of trunks) world.obstacles.push({ x: t.x, y: t.y, r: t.r + 0.03 });
  for (const s of [...leavesLemon, ...leavesMul]) world.foliage.push({ c: P(s.x, s.y, s.z), r: s.r * 0.97 });
  for (const f of ripe) world.fruits.push({ p: P(f.x, f.y, f.z), r: f.r, cls: 'lemon_ripe' });
  for (const f of unripe) world.fruits.push({ p: P(f.x, f.y, f.z), r: f.r, cls: 'lemon_unripe' });

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

// ---------------------------------------------------------------- robot
const robot = { x: 0, y: 0, theta: 0, v: 0, w: 0, cmdV: 0, cmdW: 0, cmdAt: -1, body: new THREE.Group() };

function buildRobot() {
  const g = robot.body;
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.36), mat(0xf2a53a)); base.position.y = 0.14; g.add(base);
  for (const s of [-1, 1]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16), mat(0x222222));
    wh.rotation.x = Math.PI / 2; wh.position.set(0, 0.08, s * 0.2); g.add(wh);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), mat(0x888888)); mast.position.set(-0.1, 0.5, 0); g.add(mast);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.16), mat(0x333333)); head.position.set(-0.08, ROBOT.camHeight, 0); g.add(head);
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 16), mat(0x1c4fa0)); lidar.position.set(0.1, 0.24, 0); g.add(lidar);
  robotCam.rotation.order = 'YXZ';
  robotCam.rotation.set(-ROBOT.camTilt, -Math.PI / 2, 0); // nhìn theo +x của robot, chúc xuống
  robotCam.position.set(-0.03, ROBOT.camHeight, 0);
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
addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'c') topView = !topView; if (e.key.toLowerCase() === 'r') resetRobot(); });
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
    out.push({ class: fr.cls, bbox: [+(cx - pr).toFixed(1), +(cy - pr).toFixed(1), +(2 * pr).toFixed(1), +(2 * pr).toFixed(1)], distance: +dist.toFixed(3) });
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
