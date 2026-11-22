"""Hello tay SO-101 - robot đi dọc luống, thấy quả chanh chín ở gần thì xoay tay chỉ về phía quả.

Cách chạy (xem docs/SIMULATION.md):
    1. python tools/run_sim.py
    2. python examples/hello_com/arm_point.py

Đây là bộ khung cho bài hái quả: đế lo đi giữa luống (giống drive.py), tay nhận lệnh
6 khớp theo đúng tên của LeRobot. Bước sau thay phần "chỉ tay" bằng policy học từ dữ liệu.
"""
import asyncio
import json
import math

import websockets

from drive import calculate_control_signal

CAM_W, CAM_H, CAM_FOV = 320, 240, 70           # ảnh camera trước của đế
F = (CAM_H / 2) / math.tan(math.radians(CAM_FOV) / 2)
NEAR = 2.0                                     # m, quả gần hơn mức này thì chỉ tay

READY = {"shoulder_pan": 0.0, "shoulder_lift": -0.25, "elbow_flex": 0.95, "wrist_flex": 0.75, "wrist_roll": 0.0, "gripper": 0.15}
REACH = {"shoulder_lift": 0.55, "elbow_flex": -0.2, "wrist_flex": 0.35, "wrist_roll": 0.0, "gripper": 0.9}


def arm_command(labels):
    """Chọn quả chín gần nhất trong ảnh, trả về lệnh 6 khớp (radian)."""
    ripe = [l for l in labels if l["class"] == "lemon_ripe" and l["distance"] < NEAR]
    if not ripe:
        return READY, None
    best = min(ripe, key=lambda l: l["distance"])
    x, y, w, h = best["bbox"]
    bearing = math.atan(((x + w / 2) - CAM_W / 2) / F)  # dương là quả lệch phải
    # khớp vai dương xoay tay sang phải robot, giới hạn ±1,9 rad
    return dict(REACH, shoulder_pan=max(-1.9, min(1.9, bearing * 1.5))), best


async def handle(websocket, path=None):
    print("Nông trang ảo đã kết nối.")
    async for message in websocket:
        data = json.loads(message)
        linear, angular = calculate_control_signal(data)
        arm, fruit = arm_command(data["labels"])
        if fruit:
            linear *= 0.4                                  # thấy quả thì đi chậm lại
        tip = data.get("gripper_tip")
        print(f"x={data['pose']['x']:6.2f}  quả chín gần: {'có' if fruit else 'không':5s}  "
              f"vai xoay {arm['shoulder_pan']:+.2f} rad  đầu kẹp {tip}")
        await websocket.send(json.dumps({"linear": linear, "angular": angular, "arm": arm}))


async def main():
    async with websockets.serve(handle, "0.0.0.0", 4567, ping_interval=None, max_size=None):
        print("Đang chờ nông trang ảo ở cổng 4567 ...")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
