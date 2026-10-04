# Channel art for The Hidden Logic of Things (profile 800x800, banner 2560x1440).
# Needs Pillow and the OFL fonts SpaceGrotesk.ttf / Inter.ttf (Google Fonts) next to this file.

import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BG = (21, 19, 15)
CHAR = (37, 34, 28)
LINE = (58, 53, 44)
CREAM = (243, 234, 216)
AMBER = (242, 173, 69)
TEAL = (78, 179, 165)
SS = 3  # supersampling


def font(path, size, weight="Bold"):
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def radial_bg(w, h, center, inner=(36, 32, 25), outer=BG, radius=None):
    img = Image.new("RGB", (w, h), outer)
    radius = radius or max(w, h) * 0.7
    grad = Image.radial_gradient("L").resize((int(radius * 2), int(radius * 2)))
    glow = Image.new("RGB", grad.size, inner)
    base = Image.new("RGB", grad.size, outer)
    patch = Image.composite(base, glow, grad)
    img.paste(patch, (int(center[0] - radius), int(center[1] - radius)))
    return img


# ---------------------------------------------------------------- profile
def profile(path):
    W = 800 * SS
    img = radial_bg(W, W, (W / 2, W / 2), inner=(44, 39, 30), radius=W * 0.62)
    d = ImageDraw.Draw(img)
    cx, cy = W * 0.45, W * 0.45
    R = W * 0.27
    ring = W * 0.045
    # handle (behind the ring)
    a = math.radians(45)
    x0, y0 = cx + (R + ring * 0.2) * math.cos(a), cy + (R + ring * 0.2) * math.sin(a)
    x1, y1 = cx + (R + W * 0.2) * math.cos(a), cy + (R + W * 0.2) * math.sin(a)
    d.line([(x0, y0), (x1, y1)], fill=AMBER, width=int(W * 0.075))
    d.ellipse([x1 - W * 0.0375, y1 - W * 0.0375, x1 + W * 0.0375, y1 + W * 0.0375], fill=AMBER)
    # lens
    d.ellipse([cx - R - ring, cy - R - ring, cx + R + ring, cy + R + ring], fill=AMBER)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(30, 27, 22))
    # the ordinary object inside: a gear
    teeth, ro, ri = 10, R * 0.66, R * 0.50
    pts = []
    for k in range(teeth * 2):
        base = math.radians(k * 180 / teeth + 9)
        r_ = ro if k % 2 == 0 else ri
        for off in (-0.5, 0.5):
            ang = base + off * math.radians(180 / teeth) * 0.78
            pts.append((cx + r_ * math.cos(ang), cy + r_ * math.sin(ang)))
    d.polygon(pts, fill=CREAM)
    d.ellipse([cx - ri * 1.02, cy - ri * 1.02, cx + ri * 1.02, cy + ri * 1.02], fill=CREAM)
    hole = R * 0.2
    d.ellipse([cx - hole, cy - hole, cx + hole, cy + hole], fill=(30, 27, 22))
    # one highlighted detail: a teal callout tick on the lens rim
    t = math.radians(-135)
    px, py = cx + (R + ring / 2) * math.cos(t), cy + (R + ring / 2) * math.sin(t)
    d.ellipse([px - W * 0.03, py - W * 0.03, px + W * 0.03, py + W * 0.03], fill=TEAL, outline=BG, width=int(W * 0.01))
    img = img.resize((800, 800), Image.LANCZOS)
    img.save(path, quality=95)


# ---------------------------------------------------------------- banner
def qr(d, x, y, size, color):
    m = size / 7
    for (ox, oy) in ((0, 0), (size * 2.2, 0), (0, size * 2.2)):
        d.rectangle([x + ox, y + oy, x + ox + size, y + oy + size], outline=color, width=int(m))
        d.rectangle([x + ox + m * 2, y + oy + m * 2, x + ox + size - m * 2, y + oy + size - m * 2], fill=color)
    for i in range(9):
        for j in range(9):
            if (i * 7 + j * 3) % 5 in (0, 2) and not (i < 3 and j < 3) and not (i > 5 and j < 3) and not (i < 3 and j > 5):
                cx_, cy_ = x + size * 1.2 + i * m * 1.4, y + size * 1.2 + j * m * 1.4
                if cx_ < x + size * 3.2 and cy_ < y + size * 3.2:
                    d.rectangle([cx_, cy_, cx_ + m, cy_ + m], fill=color)


def barcode(d, x, y, h, color):
    widths = [2, 1, 2, 3, 1, 1, 4, 2, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2]
    u = 7 * SS
    cur = x
    for i, wv in enumerate(widths):
        guard = i in (0, 1, 11, 12, 22, 23)
        if i % 2 == 0:
            d.rectangle([cur, y, cur + wv * u, y + h + (h * 0.12 if guard else 0)], fill=color)
        cur += wv * u + u
    return cur


def rivet(d, cx, cy, r, color, accent):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=int(r * 0.12))
    d.ellipse([cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55], outline=color, width=int(r * 0.08))
    d.ellipse([cx - r * 0.18, cy - r * 0.18, cx + r * 0.18, cy + r * 0.18], fill=accent)


def cart(d, x, y, s, color):
    w = int(s * 0.045)
    d.line([(x, y), (x + s * 0.18, y), (x + s * 0.32, y + s * 0.62), (x + s * 0.95, y + s * 0.62)], fill=color, width=w, joint="curve")
    d.line([(x + s * 0.24, y + s * 0.2), (x + s * 1.05, y + s * 0.2), (x + s * 0.95, y + s * 0.5), (x + s * 0.3, y + s * 0.5)], fill=color, width=w, joint="curve")
    for k in range(1, 5):
        xx = x + s * (0.28 + k * 0.15)
        d.line([(xx, y + s * 0.2), (xx - s * 0.02, y + s * 0.5)], fill=color, width=int(w * 0.6))
    for cxw in (x + s * 0.42, x + s * 0.88):
        d.ellipse([cxw - s * 0.07, y + s * 0.72, cxw + s * 0.07, y + s * 0.86], outline=color, width=w)


def callout(d, cx, cy, r, color, width):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)


def banner(path):
    W, H = 2560 * SS, 1440 * SS
    img = radial_bg(W, H, (W / 2, H / 2), inner=(40, 36, 28), radius=W * 0.55)
    d = ImageDraw.Draw(img)
    # faint blueprint grid
    step = 64 * SS
    for gx in range(0, W, step):
        d.line([(gx, 0), (gx, H)], fill=(27, 25, 20), width=SS)
    for gy in range(0, H, step):
        d.line([(0, gy), (W, gy)], fill=(27, 25, 20), width=SS)
    band_top, band_bot = 508 * SS, 932 * SS
    mid = (band_top + band_bot) / 2
    # objects outside the mobile-safe area (visible on desktop/TV)
    qr(d, 120 * SS, mid - 150 * SS, 90 * SS, LINE)
    callout(d, 165 * SS, mid - 105 * SS, 86 * SS, AMBER, 6 * SS)
    rivet(d, 400 * SS, mid + 95 * SS, 62 * SS, LINE, AMBER)
    end = barcode(d, 2140 * SS, mid - 175 * SS, 150 * SS, LINE)
    callout(d, 2152 * SS, mid - 10 * SS, 34 * SS, TEAL, 5 * SS)
    cart(d, 2200 * SS, mid + 55 * SS, 230 * SS, LINE)
    # TV-only decoration above/below the band
    rivet(d, 760 * SS, 300 * SS, 48 * SS, (45, 41, 34), (90, 70, 40))
    qr(d, 1820 * SS, 1130 * SS, 60 * SS, (45, 41, 34))
    # wordmark in the safe area
    eyebrow = font(INTER, 30 * SS, "SemiBold")
    title = font(GROTESK, 110 * SS, "Bold")
    sub = font(INTER, 36 * SS, "Medium")
    cx = W / 2
    e_text = "EVERY ORDINARY THING HAS A REASON"
    spaced = " ".join(e_text)  # letter-spacing
    d.text((cx, mid - 150 * SS), spaced.replace("   ", "     "), font=eyebrow, fill=AMBER, anchor="mm")
    d.text((cx, mid - 20 * SS), "The Hidden Logic of Things", font=title, fill=CREAM, anchor="mm")
    # underline accent under "Logic"
    bbox_full = d.textbbox((cx, mid - 20 * SS), "The Hidden Logic of Things", font=title, anchor="mm")
    pre = d.textlength("The Hidden ", font=title)
    logic = d.textlength("Logic", font=title)
    ux = bbox_full[0] + pre
    d.rounded_rectangle([ux, bbox_full[3] + 14 * SS, ux + logic, bbox_full[3] + 26 * SS], radius=6 * SS, fill=AMBER)
    d.text((cx, mid + 125 * SS), "The real, documented reasons behind everyday design", font=sub, fill=(200, 192, 176), anchor="mm")
    img = img.resize((2560, 1440), Image.LANCZOS)
    img.save(path, quality=95)
    return img


GROTESK = "SpaceGrotesk.ttf"
INTER = "Inter.ttf"

if __name__ == "__main__":
    profile("profile.png")
    b = banner("banner.png")
    # previews: desktop band and mobile safe area
    b.crop((0, 508, 2560, 932)).save("preview-desktop.png")
    b.crop((507, 508, 2053, 932)).save("preview-mobile.png")
    p = Image.open("profile.png")
    mask = Image.new("L", p.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 800, 800], fill=255)
    circ = Image.new("RGB", p.size, (255, 255, 255))
    circ.paste(p, (0, 0), mask)
    circ.resize((200, 200), Image.LANCZOS).save("preview-profile-small.png")
    print("ok")
