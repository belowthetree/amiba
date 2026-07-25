#!/usr/bin/env python3
# ============================================================
# 变形虫 (Amiba) — Android 自适应图标前景生成器
#
# 问题：tauri icon 生成的前景图是满幅的，Android 启动器会套
# 圆形/圆角方形遮罩（108dp 画布只有中心 ~66dp 保证可见），
# 导致图标被放大裁切。本脚本把 src-tauri/icons/icon.png 缩小
# 到画布 60%（安全区内）居中，重新生成各密度前景图。
#
# 用法（仓库根目录或 src-tauri 下均可）：
#   python src-tauri/scripts/gen_android_icons.py
#
# 注意：`tauri android init` 会重置 gen/android，重置后需重新运行本脚本。
# ============================================================
from pathlib import Path

from PIL import Image

# 各密度的自适应图标画布边长（px）= 108dp * 密度倍率
DENSITIES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

# 图案占画布比例：安全区为直径 66dp 的圆（61%），取 60% 留余量
ARTWORK_SCALE = 0.60

ROOT = Path(__file__).resolve().parents[1]  # src-tauri/
SRC = ROOT / "icons" / "icon.png"
RES = ROOT / "gen" / "android" / "app" / "src" / "main" / "res"


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    for folder, canvas_size in DENSITIES.items():
        out_dir = RES / folder
        if not out_dir.is_dir():
            print(f"[icon] 跳过（目录不存在）: {out_dir}")
            continue
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
        art_size = round(canvas_size * ARTWORK_SCALE)
        art = src.resize((art_size, art_size), Image.LANCZOS)
        offset = (canvas_size - art_size) // 2
        canvas.paste(art, (offset, offset), art)
        out = out_dir / "ic_launcher_foreground.png"
        canvas.save(out)
        print(f"[icon] 生成 {out} ({canvas_size}px, 图案 {art_size}px)")
    print("[icon] 完成")


if __name__ == "__main__":
    main()
