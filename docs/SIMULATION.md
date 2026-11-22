# Mô phỏng: nông trang ảo VIA Cốm

Mục tiêu: một bạn học sinh chỉ có máy tính xách tay phổ thông vẫn lập trình được robot nông nghiệp. Vì vậy bậc đầu tiên của hệ mô phỏng phải **nhẹ nhất có thể**.

## Ba bậc mô phỏng

| Bậc | Công cụ | Dùng để | Trạng thái |
| --- | --- | --- | --- |
| 1. Nông trang ảo | Trang web 3D (three.js), khoảng 1 MB | Học lái dọc luống, đọc cảm biến, tạo ảnh có nhãn | Bản 0.1 đã chạy |
| 2. Nối ROS 2 | Gói `via_com_sim_bridge` | Chạy cùng bộ phần mềm của robot thật (lập bản đồ, dẫn đường) trên nông trang ảo | Đã viết, chưa chạy thử |
| 3. Tay máy có vật lý | Phần mềm 3D có mô phỏng lực (đề xuất MuJoCo, vì nhẹ và hệ LeRobot đã hỗ trợ) | Tập hái quả với tay SO-101, thu dữ liệu điều khiển từ xa | Kế hoạch 2027 |

Bậc 1 kế thừa trực tiếp giả lập VIA B: nhẹ, có bản đồ tự tạo, nối với Python qua websocket. Khác biệt là VIA B phải tải bản cài Unity theo từng hệ điều hành, còn nông trang ảo mở bằng trình duyệt.

## Chạy thử

```bash
pip install websockets
python tools/run_sim.py                 # mở http://localhost:8000/web/index.html
python examples/hello_com/drive.py      # robot tự đi dọc luống, dừng ở mốc cuối
```

Lái tay bằng phím `W A S D`. Phím `C` đổi góc nhìn, `R` đưa robot về vị trí đầu.

Đã kiểm tra ngày 22/11/2026 trên Chromium không có card đồ hoạ: robot tự đi hết một luống 12 m, giữ lệch tâm dưới 3 cm và dừng cách mốc cuối 1,2 m.

## Robot trong nông trang ảo

Theo bản 1 đã chốt: đế 2 bánh trên nền cứng, tốc độ tối đa 0,4 m/s, camera trên cột cao 0,75 m, lidar 2D quét 360°.

## Giao thức

Chương trình của người học mở websocket ở cổng 4567. Nông trang ảo kết nối tới và gửi 10 gói mỗi giây:

| Trường | Ý nghĩa |
| --- | --- |
| `image` | Ảnh camera 320×240, JPEG mã hoá base64 (giống VIA B) |
| `pose` | Vị trí thật của robot: `x`, `y` (mét), `theta` (radian) |
| `velocity` | Tốc độ hiện tại: `linear` (m/s), `angular` (rad/s) |
| `lidar` | 180 tia quanh robot: `angle_min`, `angle_increment`, `range_max`, `ranges` (mét, `null` nếu không gặp vật) |
| `tags` | Các mốc đang thấy: `id`, `distance`, `bearing` |
| `labels` | Nhãn tự động của quả chanh thấy được: `class` (`lemon_ripe`, `lemon_unripe`), `bbox` [x, y, rộng, cao], `distance` |
| `time` | Thời gian mô phỏng (giây) |

Chương trình trả lời bằng một trong ba kiểu lệnh:

```json
{"linear": 0.3, "angular": 0.5}
{"left": 0.5, "right": 0.8}
{"throttle": 0.5, "steering": -0.2}
```

Kiểu thứ ba là kiểu của VIA B. Nếu quá 0,5 giây không có lệnh, robot tự dừng.

Hệ trục theo chuẩn ROS: x về phía trước, y sang trái, góc quay ngược chiều kim đồng hồ.

## Bản đồ vườn

Mỗi vườn là một tệp JSON trong `sim/maps/`: kích thước, lối đi, các luống (loại cây, điểm đầu, điểm cuối, khoảng cách cây), mốc và vị trí xuất phát. Chạy bản đồ khác:

```bash
python tools/run_sim.py --map ../maps/ten_ban_do.json
```

Số đo trong `lang_maker_v1.json` là giả định, cần thay bằng số đo thật ở Làng Maker.

### Kiểu cây dâu

Cây dâu lấy kiểu dáng từ vườn dâu nuôi tằm của dự án [BLUESILK VR](https://github.com/tuanln/bluesilk-vr): gốc đốn thấp sát đất, 5–7 cành mảnh xoè như bình hoa, lá to hình tim mép răng cưa mọc so le, ngọn có lá non, vài quả dâu tím. Nền vườn dùng cùng bảng màu pastel. Mã ở `sim/web/mulberry.js`. Cả vườn dâu chỉ vẽ bằng 4 lớp hình lặp lại (cành, u gốc, lá, quả), nên máy yếu vẫn chạy được.

## Nối với ROS 2

```bash
cd ros2 && colcon build && source install/setup.bash
ros2 launch via_com_sim_bridge sim_bridge.launch.py
```

Gói này phát `/camera/image_raw/compressed`, `/scan`, `/odom`, `/tags`, `/fruit_labels` và nhận `/cmd_vel`. Robot thật sẽ dùng đúng các tên này, nên phần mềm viết trên nông trang ảo chuyển sang robot thật không phải sửa.

## Giới hạn của bản 0.1

- Chưa có tay máy và chưa có vật lý (robot không trượt, không nghiêng).
- Mốc chưa phải mẫu AprilTag thật; giả lập trả thẳng số hiệu, khoảng cách và góc.
- Chưa có nhãn cho lá dâu, mới có nhãn quả chanh.
- Cây là hình khối đơn giản. Ảnh giả lập chỉ để tập và thử thuật toán, không thay được ảnh thật.
- Chưa có camera đo chiều sâu.
