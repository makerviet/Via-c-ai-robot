// Tay SO-101 có khớp trong mô hình models/via_c_v0_1_khop.glb.
// Tên khớp, thứ tự và giới hạn lấy đúng theo URDF của SO-101 (LeRobot), đơn vị radian.
// Mỗi khớp xoay nút khâu con quanh trục z cục bộ, nên chỉ cần đặt rotation.z.

import * as THREE from './vendor/three.module.min.js';

export const JOINTS = [
  { name: 'shoulder_pan',  link: 'so101_shoulder_link',            min: -1.91986, max: 1.91986 },
  { name: 'shoulder_lift', link: 'so101_upper_arm_link',           min: -1.74533, max: 1.74533 },
  { name: 'elbow_flex',    link: 'so101_lower_arm_link',           min: -1.69,    max: 1.69 },
  { name: 'wrist_flex',    link: 'so101_wrist_link',               min: -1.65806, max: 1.65806 },
  { name: 'wrist_roll',    link: 'so101_gripper_link',             min: -2.74385, max: 2.84121 },
  { name: 'gripper',       link: 'so101_moving_jaw_so101_v1_link', min: -0.17453, max: 1.74533 },
];

// Tư thế mẫu. Dương ở vai, khuỷu, cổ tay là gập về trước và xuống.
export const POSES = {
  san_sang: { shoulder_pan: 0, shoulder_lift: -0.25, elbow_flex: 0.95, wrist_flex: 0.75, wrist_roll: 0, gripper: 0.15 },
  vuon_hai: { shoulder_pan: 0.25, shoulder_lift: 0.55, elbow_flex: -0.2, wrist_flex: 0.35, wrist_roll: 0, gripper: 0.9 },
  gap:      { shoulder_pan: 0, shoulder_lift: -1.7, elbow_flex: 1.65, wrist_flex: 0.8, wrist_roll: 0, gripper: 0 },
};

// Gắn vào cảnh glTF đã nạp. `speed` là tốc độ quay tối đa mỗi khớp (rad/s), gần servo STS3215.
export function attachArm(root, { speed = 2.0 } = {}) {
  const nodes = {}, q = {}, target = {};
  for (const j of JOINTS) {
    nodes[j.name] = root.getObjectByName(j.link);
    q[j.name] = target[j.name] = 0;
  }
  const tip = root.getObjectByName('so101_gripper_frame_link');
  const clamp = (j, v) => Math.min(j.max, Math.max(j.min, v));
  return {
    q, target,
    // đặt đích cho một số khớp; khớp không nhắc tới giữ nguyên
    command(obj) {
      for (const j of JOINTS) if (typeof obj[j.name] === 'number' && isFinite(obj[j.name])) target[j.name] = clamp(j, obj[j.name]);
    },
    snap(obj) { this.command(obj); for (const j of JOINTS) q[j.name] = target[j.name]; this.apply(); },
    step(dt) {
      for (const j of JOINTS) {
        const d = target[j.name] - q[j.name], m = speed * dt;
        q[j.name] += Math.max(-m, Math.min(m, d));
      }
      this.apply();
    },
    apply() { for (const j of JOINTS) if (nodes[j.name]) nodes[j.name].rotation.z = q[j.name]; },
    tipWorld(out = new THREE.Vector3()) { return tip ? tip.getWorldPosition(out) : out.set(0, 0, 0); },
  };
}
