from setuptools import setup

package_name = "via_com_sim_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/sim_bridge.launch.py"]),
    ],
    install_requires=["setuptools", "websockets"],
    zip_safe=True,
    maintainer="Maker Viet",
    maintainer_email="makerviet.official@gmail.com",
    description="Cầu nối giữa nông trang ảo VIA Cốm và ROS 2.",
    license="MIT",
    entry_points={"console_scripts": ["sim_bridge = via_com_sim_bridge.bridge_node:main"]},
)
