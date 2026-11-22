"""Hello Cốm! - cho robot tự đi dọc luống trong nông trang ảo.

Cách chạy (xem docs/SIMULATION.md):
    1. python tools/run_sim.py          # mở nông trang ảo trên trình duyệt
    2. python examples/hello_com/drive.py

Giống VIA B: chương trình này là "server" websocket ở cổng 4567. Giả lập kết nối
tới, gửi dữ liệu cảm biến 10 lần mỗi giây, và nhận lại lệnh lái.
"""
import asyncio
import json
import math

import websockets

SPEED = 0.35          # m/s
STOP_AT_TAG = 1.2     # m, dừng khi tới gần mốc cuối luống


def calculate_control_signal(data):
    """Nhận một gói dữ liệu từ giả lập, trả về (tốc độ thẳng m/s, tốc độ quay rad/s).

    Ý tưởng: lidar thấy thân cây hai bên lối đi. Lấy trung bình vị trí ngang của
    cây bên trái và bên phải, rồi lái để robot nằm giữa hai hàng.
    """
    lidar = data["lidar"]
    left, right = [], []
    for i, r in enumerate(lidar["ranges"]):
        if r is None:
            continue
        a = lidar["angle_min"] + i * lidar["angle_increment"]
        x, y = r * math.cos(a), r * math.sin(a)      # x: phía trước, y: bên trái
        if -0.5 < x < 2.5 and 0.2 < abs(y) < 1.8:
            (left if y > 0 else right).append(y)

    for tag in data["tags"]:                          # mốc cuối luống
        if tag["distance"] < STOP_AT_TAG and abs(tag["bearing"]) < 1.0:
            return 0.0, 0.0

    if not left or not right:                         # chưa thấy đủ hai hàng: đi thẳng chậm
        return SPEED * 0.5, 0.0
    center = (sum(left) / len(left) + sum(right) / len(right)) / 2
    return SPEED, 1.5 * center


async def handle(websocket, path=None):
    print("Nông trang ảo đã kết nối.")
    async for message in websocket:
        data = json.loads(message)
        linear, angular = calculate_control_signal(data)
        pose = data["pose"]
        print(f"x={pose['x']:6.2f} y={pose['y']:5.2f}  quả thấy được: {len(data['labels']):2d}  "
              f"lệnh: {linear:.2f} m/s, {angular:+.2f} rad/s")
        await websocket.send(json.dumps({"linear": linear, "angular": angular}))


async def main():
    async with websockets.serve(handle, "0.0.0.0", 4567, ping_interval=None, max_size=None):
        print("Đang chờ nông trang ảo ở cổng 4567 ...")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
