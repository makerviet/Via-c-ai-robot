"""Mở nông trang ảo VIA Cốm trên trình duyệt. Không cần cài gì ngoài Python 3."""
import argparse
import functools
import http.server
import pathlib
import webbrowser

SIM_DIR = pathlib.Path(__file__).resolve().parent.parent / "sim"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--map", default="../maps/lang_maker_v1.json", help="đường dẫn bản đồ, tính từ sim/web/")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    url = f"http://localhost:{args.port}/web/index.html?map={args.map}"
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SIM_DIR))
    with http.server.ThreadingHTTPServer(("0.0.0.0", args.port), handler) as httpd:
        print("Nông trang ảo:", url)
        if not args.no_browser:
            webbrowser.open(url)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
