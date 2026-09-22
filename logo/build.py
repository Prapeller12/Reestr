#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор логотипа «папка с документами» в стиле дизайн-системы Реестра
(docs/design/design-system.md): три тона — серая задняя стенка, белый лист,
тёмный карман; единственное цветное пятно — красная строка на листе.

Вся геометрия описана числами на сетке 512x512 — правки делаются
изменением констант в блоке GEOMETRY, а не перерисовкой руками.

Запуск:  python build.py
Результат: dist/*.svg, dist/png/*.png, dist/favicon.ico, dist/preview.html
PNG рисует cairosvg, а если его нет — headless-браузер (Edge/Chrome/Comet).
"""

import math
import os
import shutil
import subprocess
import sys
import tempfile

# ---------------------------------------------------------------- ПАЛИТРА
# Значения — токены дизайн-системы (src/blocks/page/page.css).

PALETTE = {
    "front":  "#1d2029",   # карман (--color-dark)
    "back":   "#878c99",   # задняя стенка (--color-neutral-700): светлее кармана,
                           # иначе папка сливается в одно пятно
    "sheet":  "#ffffff",   # лист
    "accent": "#e5402b",   # верхняя строка (--color-accent) — единственный цвет
    "bar":    "#d3d6de",   # вторая строка (--color-neutral-400)
}

PALETTE_MONO = {           # одна краска: печать, гравировка, ч/б документы
    "front":  "#1d2029",
    "back":   "#1d2029",
    "sheet":  "#ffffff",
    "accent": "#1d2029",
    "bar":    "#1d2029",
}

PALETTE_INVERSE = {        # выворотка: тёмный интерфейс, тёмный фон
    "front":  "#e8eaef",
    "back":   "#878c99",
    "sheet":  "#ffffff",
    "accent": "#e5402b",
    "bar":    "#bcc0ca",
}

# -------------------------------------------------------------- ГЕОМЕТРИЯ

CANVAS = 512

G = {
    # задняя стенка с язычком; знак вписан в x 56…456, y 84…428 (центр 256)
    "back_x0":      72,
    "back_x1":      440,
    "tab_top":      84,    # верх язычка
    "tab_x1":       208,   # конец горизонтали язычка
    "tab_shoulder": 256,   # конец скоса
    "back_top":     124,   # верх основной части
    "back_bottom":  348,   # низ (прячется за карманом)
    "back_radius":  24,

    # лист: один, крупный, с большим скруглением
    "sheet_x0":     136,
    "sheet_w":      240,
    "sheet_top":    168,
    "sheet_bottom": 356,   # уходит за карман
    "sheet_radius": 24,

    # строки на листе: верхняя — акцентная, вторая — нейтральная и длиннее
    "bar_x":        168,
    "bar_h":        22,
    "bar_gap":      24,
    "bar_top":      204,
    "bar_w_accent": 140,
    "bar_w_second": 176,

    # карман (передняя стенка)
    "front_x0":     56,
    "front_x1":     456,
    "front_top":    292,
    "front_bottom": 428,
    "front_radius": 48,

    # белый просвет между карманом и листом в одноцветной версии
    "mono_gap":     16,
}


# ------------------------------------------------- ПОСТРОЕНИЕ КОНТУРОВ

def rounded_polygon(points, radius):
    """Замкнутый многоугольник со скруглением углов.

    Радиус автоматически ужимается, если соседняя сторона короче — поэтому
    короткие рёбра (скос язычка) не ломаются.
    """
    n = len(points)
    cmds = []

    def dist(a, b):
        return math.hypot(b[0] - a[0], b[1] - a[1])

    def lerp(a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    for i in range(n):
        prev = points[(i - 1) % n]
        cur = points[i]
        nxt = points[(i + 1) % n]

        r = min(radius, dist(prev, cur) / 2, dist(cur, nxt) / 2)
        t_in = r / dist(prev, cur) if dist(prev, cur) else 0
        t_out = r / dist(cur, nxt) if dist(cur, nxt) else 0

        p_in = lerp(cur, prev, t_in)
        p_out = lerp(cur, nxt, t_out)

        if i == 0:
            cmds.append(f"M {p_in[0]:.2f} {p_in[1]:.2f}")
        else:
            cmds.append(f"L {p_in[0]:.2f} {p_in[1]:.2f}")
        cmds.append(f"Q {cur[0]:.2f} {cur[1]:.2f} {p_out[0]:.2f} {p_out[1]:.2f}")

    cmds.append("Z")
    return " ".join(cmds)


def back_panel_path():
    return rounded_polygon([
        (G["back_x0"], G["tab_top"]),
        (G["tab_x1"], G["tab_top"]),
        (G["tab_shoulder"], G["back_top"]),
        (G["back_x1"], G["back_top"]),
        (G["back_x1"], G["back_bottom"]),
        (G["back_x0"], G["back_bottom"]),
    ], G["back_radius"])


def front_panel_path():
    return rounded_polygon([
        (G["front_x0"], G["front_top"]),
        (G["front_x1"], G["front_top"]),
        (G["front_x1"], G["front_bottom"]),
        (G["front_x0"], G["front_bottom"]),
    ], G["front_radius"])


# ----------------------------------------------------------- СБОРКА SVG

def icon_bounds():
    """Габарит знака без полей — нужен мелким версиям, чтобы не терять
    размер на воздух."""
    x0 = min(G["front_x0"], G["back_x0"])
    x1 = max(G["front_x1"], G["back_x1"])
    return x0, G["tab_top"], x1 - x0, G["front_bottom"] - G["tab_top"]


def build_svg(palette, bars=2, tight=False, title="Логотип"):
    """bars: 2 — акцентная + нейтральная строка, 1 — только акцентная, 0 — чистый лист."""
    p = palette
    vx, vy, vw, vh = icon_bounds() if tight else (0, 0, CANVAS, CANVAS)
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx} {vy} {vw} {vh}" '
        f'width="{vw}" height="{vh}" role="img" aria-label="{title}">',
        f"  <title>{title}</title>",
        f'  <path fill="{p["back"]}" d="{back_panel_path()}"/>',
    ]

    mono = p["front"] == p["back"]

    # лист
    out.append(
        f'  <rect fill="{p["sheet"]}" x="{G["sheet_x0"]}" y="{G["sheet_top"]}" '
        f'width="{G["sheet_w"]}" height="{G["sheet_bottom"] - G["sheet_top"]}" '
        f'rx="{G["sheet_radius"]}"/>'
    )

    # строки
    widths = [(p["accent"], G["bar_w_accent"]), (p["bar"], G["bar_w_second"])][:bars]
    y = G["bar_top"]
    for fill, w in widths:
        out.append(
            f'  <rect fill="{fill}" x="{G["bar_x"]}" y="{y}" width="{w}" '
            f'height="{G["bar_h"]}" rx="{G["bar_h"] / 2:.0f}"/>'
        )
        y += G["bar_h"] + G["bar_gap"]

    # карман; в одноцветной версии отделяется от листа белым просветом
    if mono:
        out.append(
            f'  <path fill="none" stroke="{p["sheet"]}" stroke-width="{G["mono_gap"]}" '
            f'stroke-linejoin="round" d="{front_panel_path()}"/>'
        )
    out.append(f'  <path fill="{p["front"]}" d="{front_panel_path()}"/>')

    out.append("</svg>")
    return "\n".join(out) + "\n"


# ------------------------------------------------------------- РАСТР

def _browser():
    """Первый найденный headless-браузер: им рисуем PNG, если нет cairosvg."""
    candidates = [
        os.environ.get("LOGO_BROWSER"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Perplexity\Comet\Application\Comet.exe",
        shutil.which("chromium"), shutil.which("google-chrome"),
    ]
    return next((c for c in candidates if c and os.path.exists(c)), None)


def rasterize(svg_text, size, out_path):
    """SVG → PNG с прозрачным фоном. cairosvg, иначе headless-браузер."""
    try:
        import cairosvg
        cairosvg.svg2png(bytestring=svg_text.encode("utf-8"), write_to=out_path,
                         output_width=size, output_height=size, background_color=None)
        return True
    except ImportError:
        pass

    exe = _browser()
    if not exe:
        return False
    with tempfile.TemporaryDirectory() as tmp:
        svg_path = os.path.join(tmp, "logo.svg")
        # размеры в самом файле: браузер снимает окно size×size без полей
        head, rest = svg_text.split(">", 1)
        head = head.replace('width="', 'data-w="').replace('height="', 'data-h="')
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(f'{head} width="{size}" height="{size}">{rest}')
        subprocess.run(
            [exe, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             f"--user-data-dir={os.path.join(tmp, 'profile')}",
             "--default-background-color=00000000",
             f"--window-size={size},{size}", f"--screenshot={out_path}",
             "file:///" + svg_path.replace("\\", "/")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120,
        )
    return os.path.exists(out_path)


def ico_frames(png_dir):
    """Кадры .ico: до 32px — знак без строк, 64 — одна строка, дальше полный знак.

    Windows берёт из .ico кадр своего размера, поэтому мелкие рисуем упрощёнными,
    иначе строки на листе превращаются в грязь.
    """
    plan = [("logo-mark", 16), ("logo-mark", 24), ("logo-mark", 32), ("logo-mark", 48),
            ("logo-compact", 64), ("logo-compact", 128), ("logo", 256)]
    return [os.path.join(png_dir, f"{name}-{size}.png") for name, size in plan]


def write_ico(png_paths, out_path):
    """Собрать .ico из готовых PNG (каждый кадр — свой файл).

    Pillow при сохранении ICO масштабирует одну картинку на все размеры, поэтому
    контейнер пишем сами: заголовок + записи каталога + PNG-кадры как есть.
    """
    import struct
    from PIL import Image

    frames = []
    for p in png_paths:
        with open(p, "rb") as f:
            data = f.read()
        with Image.open(p) as im:
            w, h = im.size
        frames.append((w, h, data))

    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = len(header) + 16 * len(frames)
    entries, blobs = [], []
    for w, h, data in frames:
        entries.append(struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(data), offset))
        blobs.append(data)
        offset += len(data)
    with open(out_path, "wb") as f:
        f.write(header + b"".join(entries) + b"".join(blobs))


# ------------------------------------------------------------- ЭКСПОРТ

def build_jsx():
    """React-компонент из той же геометрии: цвета и размер — через props."""
    token_palette = {k: f"@@{k}@@" for k in PALETTE}
    svg = build_svg(token_palette, bars=2, title="Логотип")
    body = "\n".join(
        line for line in svg.splitlines()
        if not line.startswith("<svg") and not line.startswith("</svg")
        and "<title>" not in line
    )
    body = body.replace("stroke-width", "strokeWidth").replace("stroke-linejoin", "strokeLinejoin")
    for k in PALETTE:
        body = body.replace(f'"@@{k}@@"', "{c." + k + "}")
    defaults = ",\n".join(f'  {k}: "{v}"' for k, v in PALETTE.items())
    return f'''// Сгенерировано build.py — править геометрию там, не здесь.
const DEFAULT_COLORS = {{
{defaults}
}};

export default function Logo({{ size = 512, colors, title = "Логотип", ...rest }}) {{
  const c = {{ ...DEFAULT_COLORS, ...colors }};
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 {CANVAS} {CANVAS}"
      width={{size}}
      height={{size}}
      role="img"
      aria-label={{title}}
      {{...rest}}
    >
{body}
    </svg>
  );
}}
'''


def build_preview():
    cards = "".join(
        f'<figure class="card"><img src="{name}.svg" alt="{name}">'
        f'<figcaption>{name}.svg</figcaption></figure>'
        for name in ("logo", "logo-compact", "logo-mark", "logo-mono")
    )
    small = "".join(
        f'<figure class="px"><img src="png/logo-mark-{s}.png" width="{s}" height="{s}" alt="">'
        f'<figcaption>{s}px</figcaption></figure>' for s in (48, 32, 24, 16)
    )
    return f'''<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Логотип — контрольная страница</title>
<style>
  body {{ font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 40px;
         background: #f3f4f7; color: rgba(12,16,28,.9); }}
  h2 {{ font-size: 12px; text-transform: uppercase; letter-spacing: 1.25px;
        color: rgba(12,16,28,.56); margin: 32px 0 16px; font-weight: 700; }}
  .row {{ display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end;
          background: #fff; border-radius: 24px; padding: 24px; }}
  .card {{ margin: 0; text-align: center; }}
  .card img {{ width: 160px; height: 160px; display: block; }}
  figcaption {{ margin-top: 8px; font-size: 13px; color: rgba(12,16,28,.56); }}
  .px {{ margin: 0; text-align: center; }}
  .px img {{ display: block; margin: 0 auto 8px; image-rendering: pixelated; }}
  .dark {{ background: #1d2029; }}
  .dark figcaption {{ color: rgba(255,255,255,.56); }}
  .gray img {{ filter: grayscale(1); }}
</style></head><body>
<h2>Основные версии</h2>
<div class="row">{cards}</div>
<h2>Мелкие размеры (реальный пиксель)</h2>
<div class="row">{small}</div>
<h2>Выворотка на тёмном</h2>
<div class="row dark">
  <figure class="card"><img src="logo-inverse.svg" alt="">
  <figcaption>logo-inverse.svg</figcaption></figure>
</div>
<h2>Оттенки серого</h2>
<div class="row gray">
  <figure class="card"><img src="logo.svg" alt="">
  <figcaption>logo.svg в ч/б</figcaption></figure>
</div>
</body></html>
'''


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    dist = os.path.join(root, "dist")
    png_dir = os.path.join(dist, "png")
    os.makedirs(png_dir, exist_ok=True)

    variants = {
        "logo":         build_svg(PALETTE, bars=2, title="Логотип — папка с документами"),
        "logo-compact": build_svg(PALETTE, bars=1, title="Логотип, компактная версия"),
        "logo-mark":    build_svg(PALETTE, bars=0, tight=True, title="Знак для мелких размеров"),
        "logo-mono":    build_svg(PALETTE_MONO, bars=1, title="Логотип, одноцветная версия"),
        "logo-inverse": build_svg(PALETTE_INVERSE, bars=2, title="Логотип, выворотка"),
    }

    for name, svg in variants.items():
        with open(os.path.join(dist, f"{name}.svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        print(f"  svg  {name}.svg")

    # основной знак дублируем в корень папки — им пользуются README и приложение
    with open(os.path.join(root, "logo.svg"), "w", encoding="utf-8") as f:
        f.write(variants["logo"])

    with open(os.path.join(dist, "preview.html"), "w", encoding="utf-8") as f:
        f.write(build_preview())
    print("  html preview.html")

    with open(os.path.join(dist, "Logo.jsx"), "w", encoding="utf-8") as f:
        f.write(build_jsx())
    print("  jsx  Logo.jsx")

    # растр: крупные размеры с полного знака, мелкие — с упрощённых
    plan = [
        ("logo",         [1024, 512, 256, 192]),
        ("logo-compact", [128, 96, 64]),
        ("logo-mark",    [48, 32, 24, 16]),
        ("logo-mono",    [512]),
        ("logo-inverse", [512]),
    ]
    ok = True
    for name, sizes in plan:
        for s in sizes:
            if not rasterize(variants[name], s, os.path.join(png_dir, f"{name}-{s}.png")):
                ok = False
        print(f"  png  {name}: {', '.join(str(s) for s in sizes)}")
    if not ok:
        print("\nPNG не собраны: нет ни cairosvg, ни браузера.")
        print("pip install cairosvg  —  или задайте путь: set LOGO_BROWSER=...\\msedge.exe")
        return

    # favicon.ico — у каждого размера своя картинка (мелкие — с упрощённого знака)
    try:
        write_ico(ico_frames(png_dir), os.path.join(dist, "favicon.ico"))
        print("  ico  favicon.ico (16, 24, 32, 48, 64, 128, 256)")
    except Exception as e:  # noqa: BLE001 — favicon не должен ронять сборку
        print(f"  ico  пропущен: {e}")

    # комплект одним файлом — чтобы отдать дизайнеру или приложить к релизу
    import zipfile
    kit = os.path.join(root, "logo-kit.zip")
    with zipfile.ZipFile(kit, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(dist):
            for f in sorted(files):
                full = os.path.join(folder, f)
                z.write(full, os.path.relpath(full, dist))
    print("  zip  logo-kit.zip")


if __name__ == "__main__":
    print("Сборка логотипа:")
    main()
    print("Готово: dist/")
