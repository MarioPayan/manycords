#!/usr/bin/env python3
"""Generate anatomy.svg: what the reader's parts are, and which channels get saved.

Top half: the reader cut down to the parts worth naming, numbered, with a legend.
Bottom half: the capture set. Collections pick channels; what is saved is the union
of all of them, a thread follows its parent channel, the starting "All" collection
saves every server channel, and direct messages are never saved (background.js:
`allowed()` and the guild check before it).

Colours from viewer.html's dark theme, words from the English locale, servers and
channels from the browser-test fixture (test/e2e/viewer-shim.js). The one invented
item is the second collection, "Jam night", needed to show a union of two.
"""
import pathlib
import sys

sys.dont_write_bytecode = True       # no tools/__pycache__ left in the checkout
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from source import C, CHANNELS, CLUB, MONO, lane_index, svg_text, t, width, write  # noqa: E402

W, H = 1000, 940
out = []
T = out.append


def rect(x, y, w, h, fill, rx=0, stroke=None, opacity=None, dash=None):
    s = f' stroke="{stroke}"' if stroke else ""
    o = f' fill-opacity="{opacity}"' if opacity is not None else ""
    d = f' stroke-dasharray="{dash}"' if dash else ""
    T(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}"{o}{s}{d}/>')


def tile(x, y, size, initials, font):
    rect(x, y, size, size, C["ink"], rx=5 if size >= 18 else 4)
    T(svg_text(x + size / 2, y + size / 2 + font * 0.36, initials, font, C["bg"], weight="bold", anchor="middle"))


def badge(x, y, n):
    T(f'<circle cx="{x}" cy="{y}" r="9" fill="{C["signal"]}"/>')
    T(svg_text(x, y + 4, str(n), 11, C["bg"], MONO, weight="bold", anchor="middle"))


def section(y, label):
    T(svg_text(28, y, label, 10, C["faint"], MONO))
    T(f'<line x1="{28 + width(label, 10, MONO) + 12}" y1="{y - 3.5}" x2="{W - 28}" y2="{y - 3.5}" stroke="{C["line"]}"/>')


def chan(cid):
    return f'#{CHANNELS[cid]["name"]}'


rect(0, 0, W, H, C["bg"], rx=10)
T(svg_text(28, 40, f'{t("appName")}: what you are looking at, and what gets saved', 13, C["faint"], MONO))
T(f'<line x1="28" y1="52" x2="{W - 28}" y2="52" stroke="{C["line"]}"/>')

# ═══ the reader, cut down ═══════════════════════════════════════════════════════
section(84, "THE READER")
MX, MY, MW, MH = 28, 100, 560, 360
SW = 190
rect(MX + .5, MY + .5, MW, MH, C["bg"], rx=10, stroke=C["line"])
T(f'<path d="M{MX + 10} {MY + .5}H{MX + SW}V{MY + MH + .5}H{MX + 10}a10 10 0 0 1-10-10V{MY + 10}a10 10 0 0 1 10-10z" fill="{C["side"]}"/>')
T(f'<line x1="{MX + SW}" y1="{MY}" x2="{MX + SW}" y2="{MY + MH}" stroke="{C["line"]}"/>')

sx = MX + 12
T(svg_text(sx, MY + 28, t("collections").upper(), 10, C["faint"], MONO))
for i, (emoji, name, n, on) in enumerate((("\U0001f310", t("allCollection"), 8, False), (CLUB["emoji"], CLUB["name"], 7, True))):
    y = MY + 38 + i * 32
    if on:
        rect(MX + 6.5, y + .5, SW - 13, 29, C["surface"], rx=7, stroke=C["line"])
    T(svg_text(sx + 9, y + 20, emoji, 14, anchor="middle", fit=False))
    T(svg_text(sx + 24, y + 20, name, 13, weight="600"))
    T(svg_text(MX + SW - 14, y + 19.5, str(n), 11, C["unread"], MONO, anchor="end"))
badge(sx + width(t("collections").upper(), 10, MONO) + 16, MY + 24.5, 1)

T(svg_text(sx, MY + 124, t("sourcesIn", CLUB["name"]).upper(), 10, C["faint"], MONO))
for i, (ini, name, n) in enumerate((("GC", "Game Club", 6), ("ID", "Indie Devs", 1))):
    y = MY + 134 + i * 30
    tile(sx, y + 6, 18, ini, 7)
    T(svg_text(sx + 26, y + 19.5, name, 13, C["soft"]))
    T(svg_text(MX + SW - 14, y + 19.5, str(n), 11, C["faint"], MONO, anchor="end"))
badge(sx + width(t("sourcesIn", CLUB["name"]).upper(), 10, MONO) + 16, MY + 120.5, 2)

rect(MX + .5, MY + MH - 34, SW - .5, 34.5, C["sunk"])
T(f'<line x1="{MX}" y1="{MY + MH - 34}" x2="{MX + SW}" y2="{MY + MH - 34}" stroke="{C["line"]}"/>')
T(f'<circle cx="{MX + 18}" cy="{MY + MH - 17}" r="4" fill="{C["ok"]}"/>')
T(f'<circle cx="{MX + 18}" cy="{MY + MH - 17}" r="8" fill="none" stroke="{C["ok"]}" stroke-opacity=".35"/>')
badge(MX + 44, MY + MH - 17, 3)

# head
hx = MX + SW + 20
T(svg_text(hx + 10, MY + 36, CLUB["emoji"], 18, anchor="middle", fit=False))
T(svg_text(hx + 26, MY + 37, CLUB["name"], 20, weight="800"))
pill = t("newCountMany", 7)
pw = width(pill, 11, MONO) + 14
rect(hx, MY + 52, pw, 20, C["unread"], rx=10, opacity=.12)
T(svg_text(hx + 7, MY + 66, pill, 11, C["unread"], MONO))
cx = hx + pw + 8
cw = width(t("onlyMine"), 12, weight="600") + 28
rect(cx + .5, MY + 50.5, cw, 23, C["surface"], rx=11.5, stroke=C["line"])
rect(cx + 9, MY + 56, 3, 11, C["signal"], rx=1.5)
T(svg_text(cx + 17, MY + 66, t("onlyMine"), 12, C["soft"], weight="600"))
badge(cx + cw + 14, MY + 62, 4)
T(svg_text(MX + MW - 14, MY + 66, t("markRead"), 12, C["signal"], weight="bold", anchor="end"))
badge(MX + MW - 14 - width(t("markRead"), 12, weight="bold") - 16, MY + 62, 5)
T(f'<line x1="{MX + SW}" y1="{MY + 86.5}" x2="{MX + MW}" y2="{MY + 86.5}" stroke="{C["line"]}"/>')

# river: #general and the thread under #builds, three messages
lanes = {"gen": hx + 30, "bld": hx + 6, "th1": hx + 18}
col = {c: C[f"l{lane_index(c)}"] for c in lanes}
ex = hx + 54


def label(y, cid, title, meta):
    bw = 8 + 16 + 6 + width(title, 11, weight="600") + 8
    rect(ex, y, bw, 22, col[cid], rx=7, opacity=.11)
    tile(ex + 7, y + 4, 14, "GC" if CHANNELS[cid]["guild"] == "g1" else "ID", 5.5)
    T(svg_text(ex + 28, y + 15, title, 11, col[cid], weight="600"))
    T(svg_text(ex + bw + 6, y + 15, meta, 10, C["faint"], MONO))
    return y + 11


def entry(y, who, time, where, text, cid, quote=None):
    top = y
    if quote:
        T(svg_text(ex + 34, top + 10, "↳", 11, C["faint"], fit=False))
        T(svg_text(ex + 46, top + 10, quote[0], 11, C["soft"], weight="600"))
        T(svg_text(ex + 52 + width(quote[0], 11, weight="600"), top + 10, quote[1], 11, C["faint"]))
        top += 16
    T(f'<circle cx="{ex + 13}" cy="{top + 14}" r="13" fill="{C["ink"]}"/>')
    T(svg_text(ex + 13, top + 18, who[0], 11, C["bg"], weight="bold", anchor="middle"))
    x = ex + 34
    T(svg_text(x, top + 12, who, 12, weight="600"))
    x += width(who, 12, weight="600") + 9
    T(f'<circle cx="{x}" cy="{top + 8}" r="3" fill="{C["unread"]}"/>')
    dot = (x, top + 8)
    x += 10
    T(svg_text(x, top + 12, time, 11, C["faint"], MONO))
    x += width(time, 11, MONO) + 7
    tile(x, top + 2, 12, "GC" if CHANNELS[cid]["guild"] == "g1" else "ID", 5)
    T(svg_text(x + 16, top + 12, where, 11, C["soft"]))
    where_end = x + 16 + width(where, 11)
    T(svg_text(ex + 34, top + 31, text, 13))
    return top + 14, dot, where_end, top + 40


y0 = MY + 100
gl = label(y0, "gen", chan("gen"), f'Game Club · {t("messageCountMany", 2)}')
e1, dot1, where1, y = entry(y0 + 26, "Mo", "01:58 PM", chan("gen"), "Does it include a weapon?", "gen", ("Kira", "The rerun lasts seven days."))
tl = label(y + 10, "th1", f'{t("threadPrefix")}#{CHANNELS["th1"]["name"]}', f'Indie Devs · #{CHANNELS["bld"]["name"]}')
e2, dot2, where2, y = entry(y + 36, "Luna", "01:56 PM", f'#{CHANNELS["th1"]["name"]}', "Also on Linux.", "th1")
e3, dot3, where3, y = entry(y + 22, "Kira", "01:55 PM", chan("gen"), "The rerun lasts seven days.", "gen")
mock_end = y

lx, sx0 = lanes, MX + SW + 6
paths = [
    f'M{sx0} {gl - 12} Q{lx["gen"]} {gl - 12} {lx["gen"]} {gl + 6} L{lx["gen"]} {e3}',
    f'M{sx0} {tl - 24} Q{lx["bld"]} {tl - 24} {lx["bld"]} {tl - 12}',
    f'M{lx["bld"]} {tl - 12} Q{lx["th1"]} {tl - 12} {lx["th1"]} {tl + 6} L{lx["th1"]} {e2}',
]
T(f'<path d="{paths[0]}" fill="none" stroke="{col["gen"]}" stroke-width="2.5" stroke-linecap="round"/>')
T(f'<path d="{paths[1]}" fill="none" stroke="{col["bld"]}" stroke-width="2.5" stroke-linecap="round"/>')
T(f'<path d="{paths[2]}" fill="none" stroke="{col["th1"]}" stroke-width="2.5" stroke-linecap="round"/>')
T(f'<path d="M{lx["gen"]} {e3} C{lx["gen"] + 10} {e3} {lx["gen"] + 10} {e1} {lx["gen"]} {e1}" fill="none" '
  f'stroke="{C["soft"]}" stroke-opacity=".35" stroke-dasharray="2 3"/>')
for cid, e in (("gen", e1), ("th1", e2), ("gen", e3)):
    T(f'<path d="M{lx[cid]} {e} H{ex - 4}" stroke="{col[cid]}" stroke-opacity=".3" stroke-width="2.5"/>')
    T(f'<circle cx="{lx[cid]}" cy="{e}" r="3.5" fill="{col[cid]}" stroke="{C["bg"]}" stroke-width="2.5"/>')
badge(hx + 6, e2 + 30, 6)
badge(ex + 46 + width("Kira", 11, weight="600") + width("The rerun lasts seven days.", 11) + 24, e1 - 20, 7)
badge(dot3[0], dot3[1] - 17, 8)
badge(where3 + 14, e3 - 2, 9)

# legend
LX = 620
items = [
    ("Collections", "Your reading lists of channels,", "from any server. The number is unread."),
    ("Sources", "The servers in this collection.", "Click one to see only its messages."),
    ("Capture status", f'Green: {t("listening").lower()}.', f'Yellow: {t("unstable").lower()}. Red: {t("noSignal").lower()}.'),
    (t("onlyMine"), "Mentions of you, replies to you", "and your keywords."),
    (t("markRead"), "Here only.", "Nothing changes in Discord."),
    ("Lanes", "One colour per channel; a thread", "branches off its parent channel."),
    ("Reply", "Quotes the original; click to jump.", "The dashed arc links the pair."),
    ("Unread", "Clears once its bottom edge has", "stayed on screen for a second."),
    ("Where", "Server and channel; opens the", "message in Discord."),
]
for i, (name, a, b) in enumerate(items):
    y = MY + 6 + i * 40
    badge(LX + 9, y + 4, i + 1)
    T(svg_text(LX + 26, y + 8, name, 12.5, weight="bold"))
    T(svg_text(LX + 26 + width(name, 12.5, weight="bold") + 8, y + 8, a, 12, C["soft"]))
    T(svg_text(LX + 26, y + 25, b, 12, C["soft"]))
    right = max(LX + 34 + width(name, 12.5, weight="bold") + width(a, 12), LX + 26 + width(b, 12))
    if right > W - 28:
        raise SystemExit(f"legend item {i + 1} runs past the edge: {right:.0f} > {W - 28}")

# ═══ the capture set ════════════════════════════════════════════════════════════
section(500, "WHAT GETS SAVED")
T(svg_text(28, 528, "Collections choose the channels. What is saved is every channel in any collection.", 13, C["soft"]))

RX = 440                                  # channel pills
rows, y = {}, 560
servers = [("Game Club", ["anu", "gen", "mem", "new1"]), ("Indie Devs", ["bld", "th1", "eve"]), ("Archive", ["archive"])]
for server, ids in servers:
    T(svg_text(RX, y + 14, server.upper(), 10, C["faint"], MONO))
    y += 22
    for cid in ids:
        rows[cid] = y + 13
        y += 28
    y += 6
T(svg_text(RX, y + 14, "DIRECT MESSAGES", 10, C["faint"], MONO))
rows["dm"] = y + 22 + 13

game = {"name": CLUB["name"], "emoji": CLUB["emoji"], "ids": CLUB["ids"], "c": C["l4"]}
jam = {"name": "Jam night", "emoji": "\U0001f3ae", "ids": ["eve"], "c": C["l2"]}
saved = set(game["ids"]) | set(jam["ids"])
inherited = {c for c in CHANNELS if CHANNELS[c]["type"] == 11 and CHANNELS[c]["parent"] in saved}

cards = [(game, 600), (jam, 720)]
for coll, cy in cards:
    n = len(coll["ids"])
    rect(28.5, cy + .5, 300, 58, C["surface"], rx=12, stroke=coll["c"])
    T(svg_text(50, cy + 27, coll["emoji"], 16, anchor="middle", fit=False))
    T(svg_text(68, cy + 26, coll["name"], 14, weight="bold"))
    T(svg_text(68, cy + 45, t("channelCountOne" if n == 1 else "channelCountMany", n), 11, C["faint"], MONO))
    for cid in coll["ids"]:
        ty = rows[cid]
        T(f'<path d="M329 {cy + 29} C385 {cy + 29} {RX - 56} {ty} {RX - 2} {ty}" fill="none" stroke="{coll["c"]}" '
          f'stroke-width="1.6" stroke-opacity=".8"/>')
rect(28.5, 800.5, 300, 58, "none", rx=12, stroke=C["faint"], dash="4 4")
T(svg_text(50, 827, "\U0001f310", 16, anchor="middle", fit=False))
T(svg_text(68, 826, f'{t("allCollection")}, deleted', 14, C["soft"], weight="bold"))
T(svg_text(68, 845, "While it exists, every server channel is saved", 11, C["faint"]))

for cid, ty in rows.items():
    if cid == "dm":
        name, state, colour = "a DM with a friend", "never saved", C["unread"]
    else:
        thread = CHANNELS[cid]["type"] == 11
        name = f'{t("threadPrefix")}#{CHANNELS[cid]["name"]}' if thread else chan(cid)
        if cid in saved:
            state, colour = "saved", C["ok"]
        elif cid in inherited:
            state, colour = f'saved, follows #{CHANNELS[CHANNELS[cid]["parent"]]["name"]}', C["ok"]
        else:
            state, colour = "not saved", C["faint"]
    on = state.startswith("saved")
    px = RX + (22 if cid in inherited else 0)
    pw = width(name, 13) + 24
    if on:
        rect(px, ty - 12, pw, 24, C["ink"], rx=12)
    else:
        rect(px + .5, ty - 11.5, pw, 23, C["bg"], rx=12, stroke=C["line"], dash="3 3" if cid == "dm" else None)
    T(svg_text(px + 12, ty + 4.5, name, 13, C["bg"] if on else C["soft"]))
    if cid in inherited:
        T(f'<path d="M{RX + 10} {ty - 16} V{ty} H{px - 3}" fill="none" stroke="{C["faint"]}" stroke-dasharray="2 3"/>')
    T(f'<circle cx="{RX + 270}" cy="{ty}" r="4" fill="{colour}"/>')
    T(svg_text(RX + 282, ty + 4, state, 12, colour, MONO))

if rows["dm"] + 24 > H or mock_end > MY + MH:
    raise SystemExit("anatomy.svg: content runs past its frame")

write("anatomy.svg", W, H,
      "The reader, annotated: (1) collections, your reading lists, with unread counts; (2) the sources in the "
      "open collection; (3) the capture status dot; (4) Only mine; (5) Mark as read, which changes nothing in "
      "Discord; (6) one coloured lane per channel, with a thread branching off its parent; (7) a reply quote; "
      "(8) the unread dot; (9) where a message came from. Below, what gets saved: two collections pick "
      "#announcements, #general, #builds and #events, so those are saved, along with the thread under #builds; "
      "#memes, #new-channel and #archive are not; a direct message is never saved; and the starting All "
      "collection, which saves every server channel, has been deleted.", out)
