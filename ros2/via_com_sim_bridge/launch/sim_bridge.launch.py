from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        Node(package="via_com_sim_bridge", executable="sim_bridge", output="screen",
             parameters=[{"port": 4567}]),
    ])
