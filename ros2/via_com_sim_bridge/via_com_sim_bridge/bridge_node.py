"""Cầu nối nông trang ảo VIA Cốm <-> ROS 2.

Node này đóng vai "server" websocket (cổng 4567) giống chương trình Python của
VIA B. Dữ liệu từ giả lập được phát thành topic ROS 2 chuẩn, nên cùng một bộ
phần mềm (Nav2, nhận dạng, policy) chạy được trên giả lập và trên robot thật.

Phát:
    /camera/image_raw/compressed  sensor_msgs/CompressedImage (JPEG)
    /scan                         sensor_msgs/LaserScan
    /odom                         nav_msgs/Odometry  (+ TF odom -> base_footprint, khớp URDF hardware/v0.1)
    /joint_states                 sensor_msgs/JointState (6 khớp SO-101, radian, tên như LeRobot)
    /tags                         std_msgs/String    (JSON: id, distance, bearing)
    /fruit_labels                 std_msgs/String    (JSON: nhãn tự động của giả lập)
Nhận:
    /cmd_vel                      geometry_msgs/Twist
    /arm/joint_commands           sensor_msgs/JointState (đích cho các khớp tay, radian)

Mô tả robot: chạy robot_state_publisher với hardware/v0.1/via_c_v0_1.urdf để có đủ TF của đế và tay.

LƯU Ý: bản 0.1, chưa chạy thử trên máy có ROS 2. Xem docs/SIMULATION.md.
"""
import asyncio
import base64
import json
import math
import threading

import rclpy
import websockets
from geometry_msgs.msg import TransformStamped, Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage, JointState, LaserScan
from std_msgs.msg import String
from tf2_ros import TransformBroadcaster


class SimBridge(Node):
    def __init__(self):
        super().__init__("via_com_sim_bridge")
        self.port = self.declare_parameter("port", 4567).value
        self.pub_image = self.create_publisher(CompressedImage, "camera/image_raw/compressed", 10)
        self.pub_scan = self.create_publisher(LaserScan, "scan", 10)
        self.pub_odom = self.create_publisher(Odometry, "odom", 10)
        self.pub_tags = self.create_publisher(String, "tags", 10)
        self.pub_labels = self.create_publisher(String, "fruit_labels", 10)
        self.tf = TransformBroadcaster(self)
        self.pub_joints = self.create_publisher(JointState, "joint_states", 10)
        self.create_subscription(Twist, "cmd_vel", self.on_cmd, 10)
        self.create_subscription(JointState, "arm/joint_commands", self.on_arm, 10)
        self.cmd = (0.0, 0.0)
        self.arm = None
        self.lock = threading.Lock()

    def on_cmd(self, msg):
        with self.lock:
            self.cmd = (msg.linear.x, msg.angular.z)

    def on_arm(self, msg):
        with self.lock:
            self.arm = dict(zip(msg.name, (float(p) for p in msg.position)))

    def publish(self, data):
        now = self.get_clock().now().to_msg()

        img = CompressedImage()
        img.header.stamp = now
        img.header.frame_id = "camera_front_link"
        img.format = "jpeg"
        img.data = base64.b64decode(data["image"])
        self.pub_image.publish(img)

        lidar = data["lidar"]
        scan = LaserScan()
        scan.header.stamp = now
        scan.header.frame_id = "base_link"
        scan.angle_min = lidar["angle_min"]
        scan.angle_increment = lidar["angle_increment"]
        scan.angle_max = lidar["angle_min"] + lidar["angle_increment"] * (len(lidar["ranges"]) - 1)
        scan.range_min = 0.05
        scan.range_max = lidar["range_max"]
        scan.ranges = [float("inf") if r is None else float(r) for r in lidar["ranges"]]
        self.pub_scan.publish(scan)

        pose, vel = data["pose"], data["velocity"]
        qz, qw = math.sin(pose["theta"] / 2), math.cos(pose["theta"] / 2)
        odom = Odometry()
        odom.header.stamp = now
        odom.header.frame_id = "odom"
        odom.child_frame_id = "base_footprint"
        odom.pose.pose.position.x = pose["x"]
        odom.pose.pose.position.y = pose["y"]
        odom.pose.pose.orientation.z = qz
        odom.pose.pose.orientation.w = qw
        odom.twist.twist.linear.x = vel["linear"]
        odom.twist.twist.angular.z = vel["angular"]
        self.pub_odom.publish(odom)

        t = TransformStamped()
        t.header.stamp = now
        t.header.frame_id = "odom"
        t.child_frame_id = "base_footprint"
        t.transform.translation.x = pose["x"]
        t.transform.translation.y = pose["y"]
        t.transform.rotation.z = qz
        t.transform.rotation.w = qw
        self.tf.sendTransform(t)

        self.pub_tags.publish(String(data=json.dumps(data["tags"])))
        self.pub_labels.publish(String(data=json.dumps(data["labels"])))

        if "arm" in data:
            js = JointState()
            js.header.stamp = now
            js.name = list(data["arm"].keys())
            js.position = [float(v) for v in data["arm"].values()]
            self.pub_joints.publish(js)

    async def handle(self, websocket, path=None):
        self.get_logger().info("Nông trang ảo đã kết nối.")
        async for message in websocket:
            self.publish(json.loads(message))
            with self.lock:
                linear, angular = self.cmd
                arm, self.arm = self.arm, None
            out = {"linear": linear, "angular": angular}
            if arm:
                out["arm"] = arm
            await websocket.send(json.dumps(out))

    async def serve(self):
        async with websockets.serve(self.handle, "0.0.0.0", self.port, ping_interval=None, max_size=None):
            self.get_logger().info(f"Đang chờ nông trang ảo ở cổng {self.port} ...")
            await asyncio.Future()


def main():
    rclpy.init()
    node = SimBridge()
    threading.Thread(target=rclpy.spin, args=(node,), daemon=True).start()
    try:
        asyncio.run(node.serve())
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
