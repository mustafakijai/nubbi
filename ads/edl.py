# Shared edit decision list: source (seconds from raw.mkv start) -> output timeline
SRC = 'rec_good1'
FPS = 30
DUR = 38.0
# (src_a, src_b, out_a, out_b, group, vertical_zoom, horizontal_zoom)
SEGS = [
    (1.90, 4.60, 0.0, 3.0, 0, 1.15, 1.45),   # hook: Nubbi drops out of the notch
    (6.40, 12.60, 3.0, 6.0, 1, 1.00, 1.00),  # Claude Code session -> panel
    (12.65, 16.90, 6.0, 10.0, 2, 1.00, 1.22), # permission Allow
    (21.90, 25.40, 10.0, 13.5, 3, 1.00, 1.00),  # drag PDF -> upload -> ready
    (25.40, 27.70, 13.5, 15.0, 3, 1.00, 1.15),  # typing the question (sped up)
    (27.70, 30.80, 15.0, 18.0, 3, 1.00, 1.30),  # real answer
    (31.50, 35.30, 18.0, 21.5, 4, 1.00, 1.30),  # provider picker
    (37.60, 40.75, 21.5, 25.0, 5, 1.00, 1.05),  # email
    (45.20, 48.85, 25.0, 28.0, 6, 1.00, 1.25),  # multiple sessions
    (48.85, 52.00, 28.0, 31.0, 7, 1.00, 1.35),  # colours
    (53.00, 54.60, 31.0, 32.5, 8, 1.22, 1.40),  # poke
    (54.60, 57.60, 32.5, 34.0, 8, 1.22, 1.40),  # dizzy (sped up)
    (59.20, 63.20, 34.0, 38.0, 9, 1.00, 1.00),  # end card
]
CAPS = {  # group -> lines: (text, size factor, highlighted words)
    0: [("Meet Nubbi 👋", 1.25, ["Nubbi"]), ("your AI buddy that", 0.86, []), ("lives in your notch", 0.86, ["notch"])],
    1: [("Watches your", 1.0, []), ("Claude Code sessions", 1.0, ["Claude", "Code"])],
    2: [("Approve in one click", 1.0, ["one", "click"]), ("Allow / Deny / Always", 0.72, [])],
    3: [("Drop any file.", 1.0, []), ("Ask anything.", 1.0, ["Ask", "anything."])],
    4: [("100% free AI built in", 1.0, ["100%", "free"]), ("— or bring Claude", 0.8, ["Claude"])],
    5: [("Send answers", 1.0, []), ("by email", 1.0, ["email"])],
    6: [("Multiple sessions,", 1.0, []), ("one glance", 1.0, ["one", "glance"])],
    7: [("Make it yours", 1.1, ["yours"])],
    8: [("Just don't poke it", 1.0, []), ("too much 😵", 1.0, ["too", "much"])],
}
GROUP_SPAN = {}
for s in SEGS:
    g = s[4]; a, b = GROUP_SPAN.get(g, (s[2], s[3])); GROUP_SPAN[g] = (min(a, s[2]), max(b, s[3]))

def seg_at(t):
    for i, s in enumerate(SEGS):
        if s[2] <= t < s[3]: return i
    return len(SEGS) - 1

def src_time(t):
    s = SEGS[seg_at(t)]
    return s[0] + (t - s[2]) / (s[3] - s[2]) * (s[1] - s[0])

def out_time(src):
    """map a source time to the output timeline (None if cut)"""
    for s in SEGS:
        if s[0] <= src < s[1]: return s[2] + (src - s[0]) / (s[1] - s[0]) * (s[3] - s[2])
    return None

def cut_times():
    out = []
    for i, s in enumerate(SEGS):
        if i and abs(SEGS[i - 1][1] - s[0]) > 0.05: out.append(s[2])
    return out

CAPS_H = {
    0: [("Meet Nubbi 👋", 1.15, ["Nubbi"]), ("your AI buddy that lives in your notch", 0.7, ["notch"])],
    1: [("Watches your Claude Code sessions", 1.0, ["Claude", "Code"])],
    2: [("Approve in one click", 1.0, ["one", "click"]), ("Allow / Deny / Always", 0.62, [])],
    3: [("Drop any file. Ask anything.", 1.0, ["Ask", "anything."])],
    4: [("100% free AI built in", 1.0, ["100%", "free"]), ("— or bring Claude", 0.62, ["Claude"])],
    5: [("Send answers by email", 1.0, ["email"])],
    6: [("Multiple sessions, one glance", 1.0, ["one", "glance"])],
    7: [("Make it yours", 1.0, ["yours"])],
    8: [("Just don't poke it too much 😵", 1.0, ["too", "much"])],
}
