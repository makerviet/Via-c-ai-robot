// Cây chanh low-poly cho nông trang ảo VIA Cốm, cùng phong cách vườn dâu BLUESILK.
// Cây cao 0,4–0,7 m, thấp hơn hẳn cây dâu (1,2–1,5 m): thân ngắn,
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

// Một gốc chanh. `r` là hàm ngẫu nhiên tất định. `height` là chiều cao ngọn (m).
// Quả luôn mọc TRÊN cây: mỗi quả treo ở mặt ngoài một khối lá, có cuống nối vào tán.
export function lemonPlant(r, { height = 0.55 } = {}) {
  const C = LEMON_COLORS, segs = [], clumps = [], fruits = [];
  const crownR = height * (0.34 + r() * 0.04);           // bán kính tán
  const crownY = height - crownR * 0.95;                  // tâm tán, ngọn tán chạm `height`
  const trunkH = Math.max(0.06, crownY - crownR * 0.75);  // thân lộ dưới tán
  segs.push({ p0: [0, 0, 0], p1: [0, trunkH, 0], r0: 0.03, r1: 0.022, color: C.barkDark });
  const nb = 3 + Math.floor(r() * 2);
  for (let b = 0; b < nb; b++) { // cành chạc từ đầu thân vào trong tán
    const a = (b / nb) * Math.PI * 2 + r() * 0.6;
    const end = [Math.cos(a) * crownR * 0.5, crownY + (r() - 0.5) * crownR * 0.3, Math.sin(a) * crownR * 0.5];
    segs.push({ p0: [0, trunkH, 0], p1: end, r0: 0.016, r1: 0.009, color: C.bark });
  }
  clumps.push({ p: [0, crownY + crownR * 0.1, 0], s: crownR * 0.85, variant: 0, color: C.leaf[1] });
  const nc = 6 + Math.floor(r() * 3);
  for (let k = 0; k < nc; k++) {
    const a = (k / nc) * Math.PI * 2 + r() * 0.5, up = (r() - 0.4) * 0.6;
    const d = crownR * (0.5 + r() * 0.1);
    clumps.push({
      p: [Math.cos(a) * d, crownY + up * crownR, Math.sin(a) * d],
      s: crownR * (0.42 + r() * 0.1), variant: 1 + (k % 2), color: C.leaf[Math.floor(r() * 3)], a,
    });
  }
  // quả: chọn một khối lá ngoài, treo ở mặt ngoài phía dưới của khối đó, có cuống ngắn
  const outer = clumps.slice(1);
  const nf = 4 + Math.floor(r() * 5);
  for (let j = 0; j < nf; j++) {
    const c = outer[Math.floor(r() * outer.length)];
    const az = c.a + (r() - 0.5) * 1.2, el = -0.7 + r() * 0.8; // hướng ra ngoài, hơi chúc xuống
    const dir = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    const fr = 0.022 + r() * 0.008;
    const surf = c.p.map((v, i) => v + dir[i] * c.s * 0.82);      // điểm trên mặt khối lá
    const p = [surf[0] + dir[0] * fr * 0.4, surf[1] - fr * 1.1, surf[2] + dir[2] * fr * 0.4]; // quả treo dưới điểm đó
    segs.push({ p0: surf, p1: [p[0], p[1] + fr * 1.1, p[2]], r0: 0.003, r1: 0.003, color: C.bark }); // cuống
    const ripeness = Math.min(1, Math.max(0, r() * 1.15 - 0.05));
    fruits.push({ p, r: fr, ripeness, tilt: (r() - 0.5) * 0.5 });
  }
  return { segs, clumps, fruits, crown: { y: crownY, r: crownR } };
}
