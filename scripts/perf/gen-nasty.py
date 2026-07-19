# Deterministic nasty-input fixtures for parser
# equivalence checks. Every edge the constraints review flagged.
import json, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".test-data", "nasty")
os.makedirs(OUT, exist_ok=True)

def rec(i, ts="2026-01-05T10:00:00.000Z", typ="assistant", text="hello world"):
    return json.dumps({
        "type": typ, "uuid": f"u{i}", "timestamp": ts, "isSidechain": False,
        "message": {"model": "claude-opus-4-8", "content": [{"type": "text", "text": text}],
                    "usage": {"input_tokens": 10, "output_tokens": 5}},
    })

# 1. multibyte at the 1MiB chunk boundary: pad line 1 so a 4-byte emoji
#    straddles byte 1<<20; then 2- and 3-byte chars near the next boundary.
CHUNK = 1 << 20
base = {"type": "assistant", "uuid": "mb1", "timestamp": "2026-01-05T10:00:00.000Z",
        "message": {"model": "m", "content": [{"type": "text", "text": ""}]}}
prefix = json.dumps(base, ensure_ascii=False)
pad_len = CHUNK - (len(prefix.encode()) - len('""') + len('"')) - 2  # emoji bytes start 2 bytes before boundary
base["message"]["content"][0]["text"] = "x" * pad_len + "\U0001F600" + "tail"
line1 = json.dumps(base, ensure_ascii=False)
lines = [line1]
filler = rec(2, text="é" * 300000 + "€" * 100000)  # 2-byte and 3-byte chars en masse
lines.append(filler)
lines.append(rec(3))
open(os.path.join(OUT, "multibyte-boundary.jsonl"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

# 2. blank/whitespace lines incl. NBSP + CRLF endings
rows = [rec(1), "", "   ", "\t", " ", rec(2, typ="user"), rec(3)]
open(os.path.join(OUT, "blank-lines.jsonl"), "w", encoding="utf-8").write("\n".join(rows) + "\n")
open(os.path.join(OUT, "crlf.jsonl"), "w", encoding="utf-8").write("\r\n".join(rows) + "\r\n")

# 3. malformed lines: garbage, truncated JSON, bare 42, bare null (bare null
#    currently aborts the whole claude parse via the outer catch — pin that).
open(os.path.join(OUT, "malformed-mixed.jsonl"), "w").write(
    "\n".join([rec(1), "garbage not json", '{"type":"assist', "42", rec(2)]) + "\n")
open(os.path.join(OUT, "malformed-barenull.jsonl"), "w").write(
    "\n".join([rec(1), "null", rec(2)]) + "\n")

# 4. huge single line (2.5MiB), with and without trailing newline
huge = rec(1, text="y" * (2_500_000))
open(os.path.join(OUT, "huge-line-nl.jsonl"), "w").write(huge + "\n" + rec(2) + "\n")
open(os.path.join(OUT, "huge-line-nonl.jsonl"), "w").write(huge + "\n" + rec(2))

# 5. timestamp zoo: offsets, no-millis, epoch s/ms, zero, negative, garbage,
#    boundary dates (leap day valid + invalid), seconds=60, expanded year
zoo = [
    "2026-01-05T10:00:00.000Z", "2026-01-05T10:00:00Z", "2026-01-05T12:00:00.000+02:00",
    "2026-01-05T03:00:00.000-05:00", "2026-01-05", "2026-02-29T00:00:00.000Z",
    "2027-02-29T00:00:00.000Z", "2026-13-01T00:00:00.000Z", "2026-00-10T00:00:00.000Z",
    "2026-01-32T00:00:00.000Z", "2026-01-05T24:00:00.000Z", "2026-01-05T10:00:60.000Z",
    "2026-01-05T10:60:00.000Z", "+202606-01-05T10:00:00.000Z", "2026-01-05T10:00:00.999Z",
    "garbage", "", "0000-01-01T00:00:00.000Z", "1969-12-31T23:59:59.000Z",
]
rows = [rec(i, ts=t) for i, t in enumerate(zoo)]
rows += [json.dumps({"type": "assistant", "uuid": "n1", "timestamp": 1767607200}),      # epoch seconds
         json.dumps({"type": "assistant", "uuid": "n2", "timestamp": 1767607200000}),   # epoch ms
         json.dumps({"type": "assistant", "uuid": "n3", "timestamp": 0}),
         json.dumps({"type": "assistant", "uuid": "n4", "timestamp": -5}),
         json.dumps({"type": "assistant", "uuid": "n5", "timestamp": None})]
open(os.path.join(OUT, "timestamp-zoo.jsonl"), "w").write("\n".join(rows) + "\n")

# 6. judge marker on the SECOND user message (expect whole-session null today)
open(os.path.join(OUT, "judge-second-user.jsonl"), "w").write("\n".join([
    json.dumps({"type": "user", "uuid": "j1", "timestamp": "2026-01-05T10:00:00.000Z",
                "message": {"content": "first normal message"}}),
    json.dumps({"type": "user", "uuid": "j2", "timestamp": "2026-01-05T10:00:01.000Z",
                "message": {"content": "You are grading whether an AI coding-agent session succeeded"}}),
]) + "\n")

print("wrote", len(os.listdir(OUT)), "nasty fixtures to", OUT)
