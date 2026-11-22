# Cổng công cụ VIA và các đầu công cụ thay nhanh

Bản nháp 0.1 · 22/11/2026 · Đề xuất chuẩn mở, lấy từ tài liệu định hướng VIA Cốm 2026–2030. Các con số là giả định thiết kế, cần thử thật.

Mọi đầu công cụ cắm vào cùng một **Cổng công cụ VIA**. Nhờ vậy một robot đổi việc trong vài phút, và học sinh, sinh viên, xưởng maker đều có thể tự thiết kế đầu mới rồi chia sẻ bản vẽ.

## Chuẩn cổng (đề xuất)

| Phần | Quy định |
| --- | --- |
| Cơ khí | Khớp xoay-khoá, một kiểu lỗ vít chung. Đầu công cụ nặng tối đa khoảng 300 g, vật hái tối đa 200 g |
| Điện | Nguồn 12V và bus CAN |
| Khí | 2 đường: áp suất và chân không, dùng chung bơm đặt trên đế |
| Nhận dạng | Mỗi đầu có một vi điều khiển nhỏ tự khai báo loại đầu; robot tự nạp đúng chương trình và đúng policy |
| An toàn | Một dây khoá liên động riêng. Chỉ đầu được phép mới được cấp năng lượng nguy hiểm (laser, dao cắt) |

Phía robot, cổng nhận CAN, 12V và dây khoá liên động từ mạch công suất VIA (xem [ARCHITECTURE.md](ARCHITECTURE.md#bo-mạch-hai-phần)). Khí nén đi từ bơm áp và bơm chân không trên đế, qua van do mạch công suất đóng mở.

## Các đầu công cụ

| Đầu | Cách làm việc | Dùng gì từ cổng | Độ khó | Giai đoạn |
| --- | --- | --- | --- | --- |
| Đầu quan sát | Camera cận cảnh và cảm biến đất; chụp lá, đo ẩm | Điện, CAN | Thấp | v0–v1 |
| Tay mềm hái quả | 3 xúc tu lụa–silicone ôm và hút, không làm dập; thêm lưỡi nhỏ cắt cuống chanh | Khí, CAN | Trung bình | v0–v1 |
| Đầu hái lá dâu | Ngón mềm giữ cành, vòng tuốt chạy dọc cành cho lá rơi vào khay; hoặc hút và cắt từng lá | Khí, điện, khoá liên động | Trung bình | v0–v1 |
| Đầu gieo hạt | Phễu hạt, vòi hút chân không nhả từng hạt, que chọc lỗ | Chân không, CAN | Thấp–trung bình | v1 |
| Đầu laser diệt cỏ | Laser diode chiếu thẳng xuống mầm cỏ, có váy che kín và camera ngắm | Điện, khoá liên động | Cao | v2 trở đi |

Hai đầu dùng cho bản 1 là **tay mềm hái quả** (hái chanh) và **đầu hái lá dâu**. Đầu hái lá dâu khép vòng câu chuyện tơ tằm: robot hái dâu nuôi tằm, tằm cho tơ, tơ làm lớp da cảm biến cho chính bàn tay robot.

### Lưu ý về laser

Laser là đầu rủi ro nhất. Loại đủ mạnh để diệt cỏ có thể gây mù và cháy, nên chỉ làm khi đã có váy che kín, khoá liên động phần cứng và quy trình an toàn. Bản đầu nên gắn dưới gầm đế, chĩa xuống đất, không đặt ở đầu cánh tay. Laser diode công suất nhỏ chỉ hiệu quả với cỏ mầm và cần chiếu vài giây mỗi cây (hiểu biết chung, chưa thử nghiệm).

## Cánh tay mang đầu công cụ

Cánh tay đi hai bước để giảm rủi ro:

| Bước | Cánh tay | Đầu công cụ |
| --- | --- | --- |
| Bước 1 (v0–v1) | Khung cứng SO-101 trên cột nâng | Lụa–silicone |
| Bước 2 (v2 trở đi) | Cánh tay mềm VIA gồm 2–3 đốt lụa–silicone, uốn bằng khí nén hoặc dây kéo, an toàn khi chạm cây và người | Lụa–silicone |
| Về sau | AR4 cho quả nặng hơn ngưỡng của SO-101 | Theo chuẩn cổng |

Cánh tay lụa–silicone là thân silicone có vải lụa làm lớp chịu kéo và làm da cảm biến. Tay mềm kém chính xác và yếu hơn tay cứng, nên việc nặng (laser, chở hàng) luôn đặt trên đế.

## Chợ đầu công cụ

Khi chuẩn cổng ổn định, Maker Việt công bố bản vẽ và mã nguồn mẫu. Cộng đồng tự làm đầu mới theo chuẩn, và mỗi đầu mới đi kèm:

- bản vẽ cơ khí và sơ đồ mạch theo giấy phép phần cứng mở;
- chương trình cho vi điều khiển nhận dạng;
- dữ liệu điều khiển tay (teleop) và policy LeRobot cho đầu đó, nếu có;
- mô hình 3D để dùng trong tay máy ảo.

## Trong mô phỏng

Tay máy ảo có vật lý (dự kiến 2027) sẽ có cùng Cổng công cụ: mỗi đầu công cụ có một mô hình ảo khai báo cùng mã loại đầu như bản thật, để policy tập trên máy tính rồi chạy trên robot.

## Việc cần chốt

- Kiểu khớp xoay-khoá và kích thước lỗ vít chung.
- Giao thức khai báo loại đầu qua CAN (mã loại, phiên bản, giới hạn khí và điện).
- Áp suất làm việc của đường khí và lưu lượng bơm.
- Quy trình an toàn bằng văn bản trước khi làm bất kỳ đầu nào có dao hoặc laser.
