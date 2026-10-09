"""Check that the video keys in .env work, using only calls that cost nothing.

Prints status codes and short, non-secret summaries. Never prints a key.
Higgsfield's API refuses Python's own HTTP client (Cloudflare), so curl is used.
"""
import io, json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))


def env():
    out = {}
    for ln in io.open(os.path.join(ROOT, ".env"), encoding="utf-8", errors="replace").read().splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", ln)
        if m:
            v = m.group(2).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[m.group(1)] = v
    return out


def curl(method, url, headers, body=None):
    cmd = ["curl", "-sS", "-m", "40", "-X", method, url, "-w", "\n%{http_code}"]
    for h in headers:
        cmd += ["-H", h]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = r.stdout
    code = text.rsplit("\n", 1)[-1] if "\n" in text else "?"
    return code, text.rsplit("\n", 1)[0] if "\n" in text else text


E = env()
hf = E.get("HF_CREDENTIALS", "")
fal = E.get("FAL_KEY", "")
print("keys present:", "HF_CREDENTIALS" if hf else "NO Higgsfield key", "|", "FAL_KEY" if fal else "NO fal key")

if hf:
    auth = ["Authorization: Key " + hf, "Accept: application/json"]
    code, body = curl("GET", "https://api.higgsfield.ai/models", auth)
    print("Higgsfield GET /models ->", code)
    try:
        j = json.loads(body)
        items = j.get("items", j if isinstance(j, list) else [])
        slugs = [i.get("slug", "") for i in items if isinstance(i, dict)]
        print("  models listed:", j.get("total", len(slugs)))
        for fam in ("seedance-2.5", "kling", "minimax", "wan", "omni", "veo", "gpt-image", "nano-banana", "topaz", "sync", "elevenlabs"):
            hit = [s for s in slugs if fam in s.lower()]
            print("  %-12s %d  %s" % (fam, len(hit), ", ".join(hit[:9])))
    except Exception as ex:
        print("  could not read the list:", type(ex).__name__, body[:160].replace(hf, "<key>"))
    # a free price estimate for one 5 second 720p take, where the API offers one
    for ep, payload in (
        ("bytedance/seedance-2.5/text-to-video", {"prompt": "test", "duration": 5, "resolution": "720p", "aspect_ratio": "16:9"}),
        ("bytedance/seedance-2.5/text-to-video", {"prompt": "test", "duration": 5, "resolution": "480p", "aspect_ratio": "16:9"}),
    ):
        code, body = curl("POST", "https://api.higgsfield.ai/estimate/" + ep, auth, payload)
        print("Higgsfield POST /estimate (%s, %s) -> %s %s" % (ep.split("/")[1], payload["resolution"], code, body[:300].replace(hf, "<key>")))
    code, body = curl("GET", "https://api.higgsfield.ai/models", ["Accept: application/json"])
    print("Higgsfield without a key ->", code, "(401 here and 200 above means the key is what let us in)")

if fal:
    auth = ["Authorization: Key " + fal, "Accept: application/json"]
    code, body = curl("GET", "https://queue.fal.run/fal-ai/flux/schnell/requests/00000000-0000-0000-0000-000000000000/status", auth)
    print("fal status of a request that does not exist ->", code, body[:120].replace(fal, "<key>"))
    code, body = curl("GET", "https://queue.fal.run/fal-ai/flux/schnell/requests/00000000-0000-0000-0000-000000000000/status", ["Authorization: Key 00000000-0000-0000-0000-000000000000:bad", "Accept: application/json"])
    print("fal with a wrong key ->", code, body[:120], "(a different answer than the line above means the real key is accepted)")
