"""What the README images are allowed to draw, read from the extension's own files.

The generators never type a colour, a label or a sample message themselves. Colours
come from the dark theme in viewer.html, every visible word from the English locale,
and the conversation from the fixture the browser tests load into the real reader
(test/e2e/viewer-shim.js: fictional servers, people and messages). If any of those
moves, the lookups below fail loudly instead of drawing a reader that no longer exists.
"""
import json
import pathlib
import re
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMAGES = ROOT / "docs" / "images"
HTML = (ROOT / "viewer.html").read_text()

SANS = "Geist, 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif"
MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"


def _tokens(selector):
    block = re.search(re.escape(selector) + r"\s*\{(.*?)\}", HTML, re.S)
    if not block:
        raise SystemExit(f"viewer.html: no {selector} block")
    return dict(re.findall(r"--([\w-]+):\s*([^;]+);", block.group(1)))


DARK = _tokens(':root[data-theme="dark"]')


def css_px(selector, prop):
    """One pixel value from a rule in viewer.html, e.g. the sidebar column width."""
    rule = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", HTML)
    value = rule and re.search(re.escape(prop) + r":\s*([^;]+);", rule.group(1))
    if not value:
        raise SystemExit(f"viewer.html: no {prop} in {selector}")
    return value.group(1)


C = {name: DARK[name] for name in (
    "bg", "side", "surface", "sunk", "ink", "soft", "faint", "line",
    "signal", "unread", "ok", "warn", "l0", "l1", "l2", "l3", "l4", "l5")}

_LOCALE = json.loads((ROOT / "_locales" / "en" / "messages.json").read_text())


def t(key, *subs):
    """The English string the reader shows for `key`, with its placeholders filled."""
    if key not in _LOCALE:
        raise SystemExit(f"locale drift: no key {key!r} in _locales/en/messages.json")
    entry = _LOCALE[key]
    text = entry["message"]
    for name, spec in entry.get("placeholders", {}).items():
        index = int(spec["content"][1:]) - 1
        text = re.sub(r"\$" + name + r"\$", str(subs[index]), text, flags=re.I)
    return text


def lane_index(channel_id, count=6):
    """threads.js laneIndex: the stable lane colour of a channel."""
    h = 7
    for ch in str(channel_id):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % count


def _check_lane_index():
    src = (ROOT / "threads.js").read_text()
    want = "(hash * 31 + char.charCodeAt(0)) >>> 0, 7) % count"
    if want not in src:
        raise SystemExit("threads.js laneIndex changed: update lane_index() in tools/source.py")


_check_lane_index()

# ── the e2e fixture: the same fictional servers and messages the browser tests use ──
_SHIM = (ROOT / "test" / "e2e" / "viewer-shim.js").read_text()

CHANNELS = {
    cid: {"name": name, "type": int(kind), "parent": None if parent == "null" else parent.strip("'"),
          "guild": guild, "guild_name": guild_name}
    for cid, name, kind, parent, guild, guild_name in re.findall(
        r"channel\('(\w+)', '([^']+)', (\d+), (null|'\w+'), \d+, '(\w+)', '([^']+)'\)", _SHIM)
}

MESSAGES = []
for i, (cid, guild, who, minutes, content, extra) in enumerate(re.findall(
        r"message\('(\w+)', '(\w+)', '(\w+)', (\d+), '((?:[^'\\]|\\.)*)'(?:, (\{[^\n]*\}))?\)", _SHIM)):
    m = {"id": f"m{i}", "channel": cid, "guild": guild, "who": who, "minutes": int(minutes),
         "content": content.replace("\\'", "'")}
    if extra:
        if (r := re.search(r"reply_to: '(\w+)'", extra)):
            m["reply_to"] = r.group(1)
        if (r := re.search(r"filename: '([^']+)'", extra)):
            m["file"] = r.group(1)
        if "edited_timestamp" in extra:
            m["edited"] = True
    MESSAGES.append(m)

_club = re.search(r"\{ id: 'club', name: '([^']+)', emoji: '([^']+)', all: false, ids: \[([^\]]*)\]", _SHIM)
_read = re.search(r"id: 'club'.*?readAt: now - (\d+) \* 60e3", _SHIM)
if not (CHANNELS and len(MESSAGES) >= 15 and _club and _read):
    raise SystemExit("viewer-shim.js fixture changed shape: update tools/source.py")
CLUB = {"name": _club.group(1), "emoji": _club.group(2),
        "ids": re.findall(r"'(\w+)'", _club.group(3)), "read_minutes": int(_read.group(1))}


# Helvetica advance widths (per 1000 em) for printable ASCII. Every sans string gets
# this width as its textLength, so no viewer font can push one label into the next.
_HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
         556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
         1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
         667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
         333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
         556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]


def width(s, size, family=SANS, weight="normal"):
    if family == MONO:
        return len(s) * size * 0.6
    em = sum(_HELV[ord(ch) - 32] if 32 <= ord(ch) < 127 else 600 for ch in s) / 1000
    bold = 1.06 if str(weight) in ("bold", "600", "700", "800") else 1.0
    return em * size * bold


def svg_text(x, y, s, size=14, fill=None, family=SANS, weight="normal", anchor="start", extra="", fit=True):
    """A text run whose drawn width is fixed to width(), whatever font the viewer has."""
    length = f' textLength="{width(s, size, family, weight):.1f}" lengthAdjust="spacingAndGlyphs"' if fit and s.strip() else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" '
            f'font-weight="{weight}" text-anchor="{anchor}" fill="{fill or C["ink"]}"{length} '
            f'xml:space="preserve"{extra}>{escape(s)}</text>')


def write(name, width, height, label, body):
    IMAGES.mkdir(parents=True, exist_ok=True)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
           f'viewBox="0 0 {width} {height}" role="img" aria-label="{escape(label, {chr(34): "&quot;"})}">'
           + "".join(body) + "</svg>\n")
    (IMAGES / name).write_text(svg)
    print(f"wrote {IMAGES / name}  {width}x{height}")
