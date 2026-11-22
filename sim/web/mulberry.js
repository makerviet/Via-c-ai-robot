// Cây dâu tằm low-poly cho nông trang ảo VIA Cốm.
// Kiểu dáng lấy từ vườn dâu của BLUESILK VR (github.com/tuanln/bluesilk-vr, src/world/style.js):
// gốc đốn thấp sát đất, 5–7 cành mảnh xoè như bình hoa, lá to hình tim mép răng cưa
// mọc so le dọc cành, ngọn có 2 lá non dựng lên, vài quả dâu tím đỏ.
//
// Mọi toạ độ ở đây là hệ three.js cục bộ của một gốc (y lên trên, gốc cây tại 0,0,0).
// Hàm trả về danh sách đoạn cành, lá, quả để farm.js vẽ chung bằng InstancedMesh
// cho cả vườn: hàng nghìn lá chỉ tốn một lệnh vẽ.

import * as THREE from './vendor/three.module.min.js';

export const MULBERRY_COLORS = {
  bark: 0x8e7d6b, barkDark: 0x6f604f, knob: 0x9c8a74,
  leaf: 0x5c9c42, leafDark: 0x467f33, leafYoung: 0x8fc25e,
  fruit: [0x4f1b38, 0x7e2344, 0xa8364f],
};

// Bảng màu pastel của BLUESILK, dùng cho nền vườn để cùng tông với cây dâu.
export const PALETTE = {
  grass: 0xa9c77a, grassDark: 0x8db064, earth: 0xe9e1c7, earthDark: 0xd6c59c,
  path: 0xd2cabb, skyHorizon: 0xf4eedb, leaf: 0x7faf5a, leafDark: 0x6e9e4c,
};

// Lá dâu: gốc lõm hình tim, hai thuỳ tròn, mép răng cưa, mũi nhọn; dài `length`.
// Mặt lá nằm trong mặt xy (cuống ở gốc toạ độ, mũi lá hướng +y), gân giữa gập nhẹ,
// mũi rủ. Màu đỉnh sáng ở gân giữa, sẫm dần ra mép.
export function mulberryLeaf({ length = 0.26 } = {}) {
  const half = [[0, 0.02], [0.04, -0.012], [0.075, 0.004], [0.092, 0.045], [0.088, 0.095],
    [0.07, 0.14], [0.045, 0.178], [0.02, 0.205], [0, 0.225]];
  const right = [half[0]];
  for (let k = 1; k < half.length; k++) {
    const [ax, ay] = half[k - 1], [bx, by] = half[k];
    if (k > 1 && k < half.length - 1) { // một răng cưa chĩa về phía mũi lá
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      right.push([ax + dx * 0.65 + (dy / L) * 0.012, ay + dy * 0.65 - (dx / L) * 0.012]);
    }
    right.push([bx, by]);
  }
  const loop = [...right, ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  const k = length / 0.225, c = [0, 0.09];
  const lift = (x, y) => [x * k, y * k + 0.03, (-Math.abs(x) * 0.35 - (y / 0.225) ** 2 * 0.035) * k];
  const pos = [], col = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    for (const [[x, y], shade] of [[c, 1], [a, 0.8], [b, 0.8]]) { pos.push(...lift(x, y)); col.push(shade, shade, shade); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Một gốc dâu. `r` là hàm ngẫu nhiên tất định (cùng seed thì cùng cây).
// `spreadScale` thu hẹp tán để cây không lấn ra lối đi của robot.
export function mulberryPlant(r, { height = 1.5, spreadScale = 0.7 } = {}) {
  const C = MULBERRY_COLORS, segs = [], knobs = [], leaves = [], fruits = [];
  const stumpH = 0.24 + r() * 0.06;
  segs.push({ p0: [0, 0, 0], p1: [0, stumpH, 0], r0: 0.1, r1: 0.07, color: C.barkDark });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    knobs.push({ p: [Math.cos(a) * 0.05, stumpH - 0.01 + r() * 0.03, Math.sin(a) * 0.05], s: 0.04 + r() * 0.015, color: C.knob });
  }
  const n = 5 + Math.floor(r() * 3);
  const bez = (a, b, c, t) => a.map((v, i) => (1 - t) ** 2 * v + 2 * (1 - t) * t * b[i] + t * t * c[i]);
  let fruitsLeft = 4 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2 + (r() - 0.5) * 0.7;
    const ca = Math.cos(a), sa = Math.sin(a);
    const spread = (0.28 + r() * 0.26) * spreadScale, H = height * (0.8 + r() * 0.2);
    const p0 = [ca * 0.05, stumpH, sa * 0.05];
    const p1 = [ca * spread * 0.75, stumpH + (H - stumpH) * 0.3, sa * spread * 0.75];
    const p2 = [ca * spread, H, sa * spread];
    const SEG = 4;
    for (let k = 0; k < SEG; k++) {
      const t0 = k / SEG, t1 = (k + 1) / SEG;
      segs.push({ p0: bez(p0, p1, p2, t0), p1: bez(p0, p1, p2, t1), r0: 0.017 - t0 * 0.009, r1: 0.017 - t1 * 0.009, color: k ? C.bark : C.barkDark });
    }
    // lá so le (lệch ~144° mỗi lá), to nhất ở giữa cành; ngọn có 2 lá non dựng lên
    const m = 7 + Math.floor(r() * 3);
    let phi = a + r() * Math.PI;
    for (let j = 0; j < m + 2; j++) {
      const young = j >= m;
      const t = young ? 0.97 + (j - m) * 0.02 : 0.28 + 0.66 * (j / (m - 1));
      const p = bez(p0, p1, p2, Math.min(1, t));
      phi += 2.51;
      const droop = young ? -0.5 : 0.25 + r() * 0.45 - t * 0.15;
      const sc = young ? 0.45 + r() * 0.1 : 0.8 + 0.4 * Math.sin(Math.PI * t) + (r() - 0.5) * 0.15;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -phi - Math.PI / 2, 0))
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - droop, 0, 0)))
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (r() - 0.5) * 0.6, 0)));
      const color = young ? C.leafYoung : r() < 0.55 ? C.leaf : C.leafDark;
      leaves.push({ p, q, s: sc, color });
      if (!young && fruitsLeft > 0 && t > 0.4 && t < 0.85 && r() < 0.3) { // quả dâu dưới nách lá
        fruitsLeft--;
        fruits.push({ p: [p[0] + Math.cos(phi) * 0.04, p[1] - 0.055, p[2] + Math.sin(phi) * 0.04], color: C.fruit[Math.floor(r() * 3)] });
      }
    }
  }
  return { segs, knobs, leaves, fruits, height };
}
