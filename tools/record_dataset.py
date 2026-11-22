"""Ghi một phiên chạy trong nông trang ảo thành bộ dữ liệu theo quy cách docs/DATASET.md.

    python tools/record_dataset.py --out dataset/sessions/thu_nghiem_01 --contributor "Tên bạn"

Trong lúc ghi, lái robot bằng phím W A S D trên trang giả lập. Bấm Ctrl+C để dừng.
"""
import argparse
import asyncio
import base64
import datetime
import json
import pathlib

import websockets

FORMAT_VERSION = "0.1"


async def run(args):
    out = pathlib.Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    meta = {
        "format_version": FORMAT_VERSION,
        "source": "sim",
        "simulator": "via-com-farm 0.1",
        "map": args.map,
        "crop": ["mulberry", "lemon"],
        "contributor": args.contributor,
        "license": "CC-BY-4.0",
        "created": datetime.datetime.now().isoformat(timespec="seconds"),
        "camera": {"width": 320, "height": 240, "vertical_fov_deg": 70},
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    count = 0

    async def handle(websocket, path=None):
        nonlocal count
        with open(out / "frames.jsonl", "a", encoding="utf-8") as frames:
            async for message in websocket:
                data = json.loads(message)
                count += 1
                if count % args.every:
                    continue
                name = f"images/{count:06d}.jpg"
                (out / name).write_bytes(base64.b64decode(data.pop("image")))
                data["image"] = name
                data["action"] = data.pop("velocity")
                frames.write(json.dumps(data, ensure_ascii=False) + "\n")
                frames.flush()
                if count % 50 == 0:
                    print(f"đã ghi tới khung {count}")

    async with websockets.serve(handle, "0.0.0.0", 4567, ping_interval=None, max_size=None):
        print("Đang ghi vào", out, "- lái robot bằng W A S D trên trang giả lập.")
        await asyncio.Future()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--map", default="lang_maker_v1")
    ap.add_argument("--contributor", default="chưa ghi tên")
    ap.add_argument("--every", type=int, default=2, help="ghi 1 khung trong mỗi N khung nhận được")
    try:
        asyncio.run(run(ap.parse_args()))
    except KeyboardInterrupt:
        print("Đã dừng ghi.")
