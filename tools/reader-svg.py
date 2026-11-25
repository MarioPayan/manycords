#!/usr/bin/env python3
"""Generate reader.svg: the ManyCords reader, drawn as a schematic of viewer.html.

Not a screenshot: a redrawing at the reader's real geometry (the sidebar column, the
head, the lane gutter and spacing that viewer.html and viewer.js lay out at 1280 px),
in its dark-theme colours, with every visible word taken from the English locale.
The content is the fictional fixture the browser tests load (test/e2e/viewer-shim.js),
opened on its "Game Club" collection exactly as the reader orders it: unread messages
newest first, one coloured lane per channel, the thread branching off its parent, and
the reply arc between two loaded messages.
"""
import datetime
import sys

sys.dont_write_bytecode = True       # no tools/__pycache__ left in the checkout
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from source import C, CHANNELS, CLUB, MESSAGES, MONO, css_px, lane_index, svg_text, t, width, write  # noqa: E402

W, H = 1280, 920
SIDE = int(css_px(".app", "grid-template-columns").split("px")[0])   # 272
NOW = datetime.datetime(2026, 1, 15, 14, 58)                        # a fixed, fictional "now"
out = []
T = out.append


def hm(minutes):
    return (NOW - datetime.timedelta(minutes=minutes)).strftime("%I:%M %p")


def rect(x, y, w, h, fill, rx=0, stroke=None, opacity=None):
    s = f' stroke="{stroke}"' if stroke else ""
    o = f' fill-opacity="{opacity}"' if opacity is not None else ""
    T(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}"{o}{s}/>')


def fav(x, y, size, initials, font):
    """A server tile; without an icon the reader shows its initials (ink tile, bg text)."""
    rect(x, y, size, size, C["ink"], rx=6 if size >= 20 else 4)
    T(svg_text(x + size / 2, y + size / 2 + font * 0.36, initials, font, C["bg"], weight="bold", anchor="middle"))


def initials(name):
    return "".join(w[0] for w in name.split()).upper()[:2]


# ── which messages the collection shows, as viewer.js decides ───────────────────
def base(cid):
    return CHANNELS[cid]["parent"] if CHANNELS[cid]["type"] in (10, 11, 12) else cid


in_club = [m for m in MESSAGES if m["channel"] in CLUB["ids"] or base(m["channel"]) in CLUB["ids"]]
unread = [m for m in in_club if m["minutes"] < CLUB["read_minutes"]]
shown = sorted(unread, key=lambda m: m["minutes"])          # top mode: newest first
earlier = len(in_club) - len(unread)
by_id = {m["id"]: m for m in MESSAGES}

# lanes: channels with messages, plus a thread's parent, in viewer.js order
lanes = sorted({m["channel"] for m in shown} | {CHANNELS[m["channel"]]["parent"] for m in shown
                                                 if CHANNELS[m["channel"]]["type"] == 11},
               key=lambda c: (base(c) if CHANNELS[c]["type"] == 11 else c, CHANNELS[c]["type"] == 11, c))
gap = min(16, 90 / len(lanes))
lane_x = {c: SIDE + 14 + 10 + i * gap for i, c in enumerate(lanes)}
gut = -(-(28 + len(lanes) * gap) // 1)
X = SIDE + 14 + gut                                           # left edge of feed content
colour = {c: C[f"l{lane_index(c)}"] for c in lanes}

# ── frame and sidebar ───────────────────────────────────────────────────────────
rect(0, 0, W, H, C["bg"], rx=10)
T(f'<path d="M10 0H{SIDE}V{H}H10A10 10 0 0 1 0 {H-10}V10A10 10 0 0 1 10 0z" fill="{C["side"]}"/>')
T(f'<line x1="{SIDE - .5}" y1="0" x2="{SIDE - .5}" y2="{H}" stroke="{C["line"]}"/>')

rect(18, 17, 26, 26, C["ink"], rx=8)
T(f'<g transform="translate(23.5 22.5) scale(0.625)" fill="none" stroke="{C["bg"]}" stroke-width="2.6" '
  f'stroke-linecap="round"><path d="M5 19a1 1 0 1 0 0-.01"/><path d="M4 11a9 9 0 0 1 9 9"/>'
  f'<path d="M4 4a16 16 0 0 1 16 16"/></g>')
T(svg_text(54, 36, t("appName"), 16, weight="bold"))
for dx in (-7, 0, 7):
    T(f'<circle cx="{243 + dx}" cy="31" r="1.6" fill="{C["faint"]}"/>')


def group(y, label, plus=False):
    T(svg_text(18, y, label.upper(), 11, C["faint"], MONO))
    if plus:
        T(svg_text(242, y + 1, "+", 13, C["faint"], MONO, anchor="middle"))


def count_of(ms):
    return len(ms) or ""


all_unread = [m for m in MESSAGES if m["minutes"] < CLUB["read_minutes"]]
group(93, t("collections"), plus=True)
for y, emoji, name, n, on in ((108, "\U0001f310", t("allCollection"), len(all_unread), False),
                              (148, CLUB["emoji"], CLUB["name"], len(unread), True)):
    if on:
        rect(10.5, y + .5, 250, 37, C["surface"], rx=8, stroke=C["line"])
    T(svg_text(29, y + 25, emoji, 16, anchor="middle", fit=False))
    T(svg_text(50, y + 24, name, 15, C["ink"], weight="600" if on or n else "normal"))
    T(svg_text(253, y + 23, str(n), 12, C["unread"], MONO, anchor="end"))

group(211, t("sourcesIn", CLUB["name"]))
guilds = sorted({m["guild"] for m in unread}, key=lambda g: next(c["guild_name"] for c in CHANNELS.values() if c["guild"] == g))
for i, g in enumerate(guilds):
    y = 221 + i * 39
    name = next(c["guild_name"] for c in CHANNELS.values() if c["guild"] == g)
    fav(18, y + 8.5, 20, initials(name), 8)
    T(svg_text(48, y + 24, name, 15, C["soft"]))
    T(svg_text(253, y + 23, str(sum(m["guild"] == g for m in unread)), 12, C["faint"], MONO, anchor="end"))

# capture status, panel open: the strip's dot is green, last signal seconds ago
SY = H - 126
rect(0, SY, SIDE, 126, C["sunk"])
T(f'<path d="M0 {H-10}V{SY}H{SIDE}V{H}H10A10 10 0 0 1 0 {H-10}z" fill="{C["sunk"]}"/>')
T(f'<line x1="0" y1="{SY + .5}" x2="{SIDE}" y2="{SY + .5}" stroke="{C["line"]}"/>')
T(f'<circle cx="22" cy="{SY + 22}" r="4" fill="{C["ok"]}"/>')
T(svg_text(34, SY + 27, t("listening"), 13, weight="600"))
T(svg_text(253, SY + 27, t("secondsAgo", 4), 12, C["faint"], MONO, anchor="end"))
bar_w = (253 - 18 - 23 * 2) / 24
for i in range(24):
    bx = 18 + i * (bar_w + 2)
    if i == 15:                    # the fixture's coverage gap, 9 h to 8.5 h ago
        rect(bx, SY + 42, bar_w, 22, C["unread"], rx=1)
    elif i == 23:                  # this hour: the fixture's messages were captured now
        rect(bx, SY + 42, bar_w, 22, C["ok"], rx=1, opacity=.7)
    else:
        rect(bx, SY + 62, bar_w, 2, C["line"], rx=1)
T(svg_text(18, SY + 83, t("dayAgo"), 11, C["faint"], MONO))
T(svg_text(135.5, SY + 83, t("coverageGaps"), 11, C["faint"], MONO, anchor="middle"))
T(svg_text(253, SY + 83, t("now"), 11, C["faint"], MONO, anchor="end"))
T(f'<circle cx="22" cy="{H - 17}" r="4" fill="{C["ok"]}"/>')
# the strip's chevron (viewer.js draws it pointing up and turns it over while the panel is open)
T(f'<path d="M241 {H-20}l5 5 5-5" fill="none" stroke="{C["faint"]}" stroke-width="1.8" '
  f'stroke-linecap="round" stroke-linejoin="round"/>')

# ── head ────────────────────────────────────────────────────────────────────────
T(svg_text(315, 54, CLUB["emoji"], 26, anchor="middle", fit=False))
title_w = width(CLUB["name"], 28, weight="800")
T(svg_text(342, 54, CLUB["name"], 28, weight="800"))
T(svg_text(342 + title_w + 26, 48, "✎", 15, C["faint"], anchor="middle", fit=False))
rect(990.5, 26.5, 219, 33, C["surface"], rx=10, stroke=C["line"])
T(svg_text(1001, 48, t("searchIn", CLUB["name"]), 14, C["faint"]))
T(svg_text(1237, 48, "☀", 15, C["faint"], anchor="middle", fit=False))

sources = len({CHANNELS[c]["guild"] for c in CLUB["ids"]})
pill = t("newCountMany", len(unread))
pw = width(pill, 12, MONO) + 18
rect(300, 77, pw, 22, C["unread"], rx=11, opacity=.12)
T(svg_text(309, 92, pill, 12, C["unread"], MONO))
meta = f'{t("channelCountMany", len(CLUB["ids"]))} · {t("sourceCountMany", sources)}'
mx = 300 + pw + 8
T(svg_text(mx, 93, meta, 13, C["soft"]))
cx = mx + width(meta, 13) + 8
cw = width(t("onlyMine"), 13, weight="600") + 33
rect(cx + .5, 75.5, cw, 25, C["surface"], rx=12.5, stroke=C["line"])
rect(cx + 11, 82, 3, 12, C["signal"], rx=1.5)
T(svg_text(cx + 20, 93, t("onlyMine"), 13, C["soft"], weight="600"))
T(svg_text(1246, 93, t("markRead"), 13, C["signal"], weight="bold", anchor="end"))
T(f'<line x1="{SIDE}" y1="116.5" x2="{W}" y2="116.5" stroke="{C["line"]}"/>')

# ── feed ────────────────────────────────────────────────────────────────────────
y = 151
T(svg_text(X, y + 9, t("today").upper(), 11, C["faint"], MONO))
T(f'<line x1="{X + width(t("today"), 11, MONO) + 10}" y1="{y + 5.5}" x2="1252" y2="{y + 5.5}" stroke="{C["line"]}"/>')
y += 11
labels, entries, after_entry = {}, {}, False
for m in shown:
    ch = m["channel"]
    if ch not in labels:
        y += 14
        thread = CHANNELS[ch]["type"] == 11
        title = f'{t("threadPrefix") if thread else ""}#{CHANNELS[ch]["name"]}'
        n = sum(x["channel"] == ch for x in shown)
        g = CHANNELS[ch]["guild_name"]
        meta = f'{g}{" · #" + CHANNELS[CHANNELS[ch]["parent"]]["name"] if thread else ""} · ' \
               f'{t("messageCountOne" if n == 1 else "messageCountMany", n)}'
        bw = 10 + 20 + 8 + width(title, 12, weight="600") + 10
        rect(X, y + 3, bw, 26, colour[ch], rx=8, opacity=.11)
        fav(X + 10, y + 6, 20, initials(g), 8)
        T(svg_text(X + 38, y + 20.5, title, 12, colour[ch], weight="600"))
        T(svg_text(X + bw + 8, y + 20, meta, 11, C["faint"], MONO))
        labels[ch] = y + 17
        y += 34
    y0 = y
    entries[m["id"]] = y0 + 17
    reply = by_id.get(m.get("reply_to"))
    top = y0 + 8
    if reply:
        q = f'↳ '
        T(svg_text(X + 44, top + 13, q, 12, C["faint"], fit=False))
        T(svg_text(X + 57, top + 13, reply["who"], 12, C["soft"], weight="600"))
        T(svg_text(X + 63 + width(reply["who"], 12, weight="600"), top + 13, reply["content"], 12, C["faint"]))
        top += 19
    T(f'<circle cx="{X + 16}" cy="{y0 + 25}" r="16" fill="{C["ink"]}"/>')
    T(svg_text(X + 16, y0 + 29.5, initials(m["who"]), 13, C["bg"], weight="bold", anchor="middle"))
    hx = X + 44
    T(svg_text(hx, top + 14, m["who"], 13, weight="600"))
    hx += width(m["who"], 13, weight="600") + 10.5
    T(f'<circle cx="{hx}" cy="{top + 9.5}" r="3.5" fill="{C["unread"]}"/>')   # unread
    hx += 3.5 + 8
    T(svg_text(hx, top + 14, hm(m["minutes"]), 12, C["faint"], MONO))
    hx += width(hm(m["minutes"]), 12, MONO) + 8
    fav(hx, top + 3, 14, initials(CHANNELS[m["channel"]]["guild_name"]), 6)
    where = f'#{CHANNELS[m["channel"]]["name"]}'
    T(svg_text(hx + 19, top + 14, where, 12, C["soft"]))
    if m.get("edited"):
        T(svg_text(hx + 27 + width(where, 12), top + 14, t("edited"), 12, C["faint"]))
    body = m["content"]
    tx = X + 44
    if "@everyone" in body:
        head_txt, _ = body.split("@everyone", 1)
        T(svg_text(tx, top + 36, head_txt, 15))
        T(svg_text(tx + width(head_txt, 15), top + 36, "@everyone", 15, C["signal"], weight="600"))
    else:
        T(svg_text(tx, top + 36, body, 15))
    y = top + 42 + 8
    if m.get("file"):
        name = m["file"]
        fw = 12 + 26 + 10 + max(width(name, 13), width(t("notAnalyzed"), 11, MONO)) + 12
        rect(tx + .5, y - 1.5, fw, 51, C["surface"], rx=10, stroke=C["line"])
        rect(tx + 12, y + 9, 26, 30, C["sunk"], rx=4)
        T(svg_text(tx + 25, y + 27, name.rsplit(".", 1)[-1].upper()[:4], 8, C["soft"], MONO, weight="600", anchor="middle"))
        T(svg_text(tx + 48, y + 20, name, 13))
        T(svg_text(tx + 48, y + 36, t("notAnalyzed"), 11, C["faint"], MONO))
        y += 57

# earlier read messages, then the end cap
if earlier:
    y += 4
    T(svg_text(X + 6, y + 19, t("earlierRead", earlier), 13, C["signal"], weight="bold"))
    y += 28
y += 28
T(f'<circle cx="{X + 11}" cy="{y + 11}" r="11" fill="{C["ok"]}" fill-opacity=".15"/>')
T(svg_text(X + 11, y + 15.5, "✓", 13, C["ok"], anchor="middle", fit=False))
T(svg_text(X + 32, y + 16, t("feedEndTop"), 13, C["faint"]))
if y + 30 > H:
    raise SystemExit(f"feed overflows the frame: ends at {y + 30}, frame is {H}")

# ── lanes: drawn last so they sit beside the feed, as the reader's own SVG does ──
g = []
for cid in lanes:
    members = [m for m in shown if m["channel"] == cid]
    x = lane_x[cid]
    if not members:                      # a parent with only a thread under it: a branch stub
        ys = [labels[c] for c in labels if CHANNELS[c]["parent"] == cid]
        lo, hi = min(ys), max(ys)
        g.append(f'<path d="M{SIDE + 17} {lo - 24} Q{x} {lo - 24} {x} {lo - 12} L{x} {hi - 12}" stroke="{colour[cid]}"/>')
        continue
    start, end = labels[cid], entries[members[-1]["id"]]
    parent = CHANNELS[cid]["parent"] if CHANNELS[cid]["type"] == 11 else None
    origin = lane_x[parent] if parent else SIDE + 17
    g.append(f'<path d="M{origin} {start - 12} Q{x} {start - 12} {x} {start + 6} L{x} {end}" stroke="{colour[cid]}"/>')
    for m in members:
        e = entries[m["id"]]
        g.append(f'<path d="M{x} {e} L{SIDE + 14 + gut - 5} {e}" stroke="{colour[cid]}" opacity=".3"/>')
for m in shown:                          # reply arcs between two loaded messages
    r = by_id.get(m.get("reply_to"))
    if r and r["id"] in entries:
        a, b = lane_x[r["channel"]], lane_x[m["channel"]]
        f, to = entries[r["id"]], entries[m["id"]]
        g.append(f'<path d="M{a} {f} C{max(a, b) + 12} {f} {max(a, b) + 12} {to} {b} {to}" stroke="{C["soft"]}" '
                 f'opacity=".35" stroke-width="1" stroke-dasharray="2 3"/>')
T(f'<g fill="none" stroke-width="2.5" stroke-linecap="round">{"".join(g)}</g>')
for m in shown:
    T(f'<circle cx="{lane_x[m["channel"]]}" cy="{entries[m["id"]]}" r="4" fill="{colour[m["channel"]]}" '
      f'stroke="{C["bg"]}" stroke-width="3"/>')

T(f'<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="10" fill="none" stroke="{C["line"]}"/>')

write("reader.svg", W, H,
      f'The ManyCords reader in its dark theme, showing a collection called {CLUB["name"]} with '
      f'{len(unread)} new messages from two fictional servers. The sidebar lists the collections and the '
      f'sources in this one and, at the bottom, a green capture status with a 24-hour coverage chart. '
      f'The feed shows the newest messages first, each channel on its own coloured lane, with a thread '
      f'branching off its parent channel and a dashed arc joining a reply to the message it answers.',
      out)
