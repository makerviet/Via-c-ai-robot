// Cây chanh low-poly cho nông trang ảo VIA Cốm, cùng phong cách vườn dâu BLUESILK.
// Cây thấp hơn cây dâu (ngọn khoảng 1,0–1,1 m so với 1,2–1,5 m của dâu): gốc ngắn,
// vài cành chạc, tán gồm nhiều khối lá xanh sẫm bóng chồng nhau.
// Quả chanh có độ chín từ 0 (xanh) tới 1 (vàng); màu quả đi theo độ chín để
// AI học nhận biết quả chín bằng màu, đúng như người hái nhìn ngoài vườn.
//
// Toạ độ là hệ three.js cục bộ của một gốc (y lên trên, gốc cây tại 0,0,0).

import * as THREE from './vendor/three.module.min.js';

export const LEMON_COLORS = {
  bark: 0x7a6650, barkDark: 0x5f4e3d,
  leaf: [0x3f7f35, 0x4c8f3c, 0x5c9e46],
  // ba mốc màu quả: xanh non, xanh ngả vàng, vàng chín
  fruit: [0x78c03c, 0xcad53a, 0xf7d81f],
};
export const RIPE_AT = 0.6; // độ chín từ mức này trở lên gắn nhãn lemon_ripe

const _a = new THREE.Color(), _b = new THREE.Color();
export function fruitColor(ripeness, out = new THREE.Color()) {
  const [g, m, y] = LEMON_COLORS.fruit;
  if (ripeness < 0.5) return out.copy(_a.set(g)).lerp(_b.set(m), ripeness / 0.5);
  return out.copy(_a.set(m)).lerp(_b.set(y), (ripeness - 0.5) / 0.5);
}

// Khối lá góc cạnh: icosahedron xô lệch đỉnh theo vị trí (đỉnh trùng nhau lệch như nhau
// nên không hở mặt). Tạo sẵn vài biến thể để vẽ bằng InstancedMesh.
export function leafClump(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const h = (x, y, z, k) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.3 + k * 51.9) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i < p.count; i++) {
    const x = +p.getX(i).toFixed(4), y = +p.getY(i).toFixed(4), z = +p.getZ(i).toFixed(4);
    const f = 1 + (h(x, y, z, 0) - 0.5) * 0.35;
    p.setXYZ(i, x * f, y * f * 0.85, z * f);
  }
  g.computeVertexNormals();
  return g;
}

// Một gốc chanh. `r` là hàm ngẫu nhiên tất định.
export function lemonPlant(r, { height = 1.0 } = {}) {
  const C = LEMON_COLORS, segs = [], clumps = [], fruits = [];
  const trunkH = 0.22 + r() * 0.08;
  segs.push({ p0: [0, 0, 0], p1: [0, trunkH, 0], r0: 0.055, r1: 0.04, color: C.barkDark });
  const nb = 3 + Math.floor(r() * 2);
  const crownY = height * 0.62, crownR = 0.36 + r() * 0.05;
  for (let b = 0; b < nb; b++) { // cành chạc từ đầu gốc lên giữa tán
    const a = (b / nb) * Math.PI * 2 + r() * 0.6;
    const end = [Math.cos(a) * crownR * 0.5, crownY + (r() - 0.5) * 0.1, Math.sin(a) * crownR * 0.5];
    segs.push({ p0: [0, trunkH, 0], p1: end, r0: 0.028, r1: 0.016, color: C.bark });
  }
  // tán: một khối giữa và các khối quanh, hơi dẹt, đáy tán cách đất khoảng 0,35 m
  clumps.push({ p: [0, crownY + 0.05, 0], s: crownR * 0.85, variant: 0, color: C.leaf[1] });
  const nc = 6 + Math.floor(r() * 3);
  for (let k = 0; k < nc; k++) {
    const a = (k / nc) * Math.PI * 2 + r() * 0.5, up = (r() - 0.35) * 0.5;
    const d = crownR * (0.5 + r() * 0.1);
    clumps.push({
      p: [Math.cos(a) * d, crownY + up * crownR, Math.sin(a) * d],
      s: crownR * (0.4 + r() * 0.1), variant: 1 + (k % 2), color: C.leaf[Math.floor(r() * 3)],
    });
  }
  // quả: trên mặt tán, nghiêng về nửa dưới; mỗi quả một độ chín
  const nf = 5 + Math.floor(r() * 5);
  for (let j = 0; j < nf; j++) {
    const az = r() * Math.PI * 2, el = -0.95 + r() * 1.05;
    const rr = crownR * 1.12;
    const ripeness = Math.min(1, Math.max(0, r() * 1.15 - 0.05));
    fruits.push({
      p: [Math.cos(az) * Math.cos(el) * rr, crownY + Math.sin(el) * rr * 0.85, Math.sin(az) * Math.cos(el) * rr],
      r: 0.034 + r() * 0.008, ripeness, tilt: r() * Math.PI,
    });
  }
  return { segs, clumps, fruits, crown: { y: crownY, r: crownR } };
}
