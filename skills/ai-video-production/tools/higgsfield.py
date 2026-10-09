"""Higgsfield API runner for the launch video: the cost line, the submit, the receipt, the poll, the download.

  python higgsfield.py submit <slug> <payload.json> <name> [--cap 3.00]
  python higgsfield.py wait <name> [<name> ...] [--minutes 20]
  python higgsfield.py spent

Rules it keeps (from the video-gen-cost-gate skill):
  - the cost line is printed before the call, from the venue's own free estimate or its published formula;
  - a call above --cap, or one that would take the day's total above DAY_CAP, is refused;
  - the receipt is written the moment the venue accepts the job, not when the file arrives;
  - failed, nsfw and canceled requests are not charged by this venue and are logged as refunds;
  - no key is ever printed or written.
"""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

DAY_CAP = float(os.environ.get("VIDEO_DAY_CAP", "100"))
RASTER = {"480p": (854, 480), "720p": (1280, 720), "1080p": (1920, 1080)}
ASPECT = {"16:9": (16, 9), "9:16": (9, 16), "1:1": (1, 1), "4:3": (4, 3), "3:4": (3, 4), "21:9": (21, 9)}


def seedance_cost(payload, slug):
    res = payload.get("resolution", "720p")
    w, h = RASTER[res]
    ar = payload.get("aspect_ratio", "16:9")
    if ar in ASPECT and ar != "16:9":
        a, b = ASPECT[ar]
        area = w * h
        h2 = int(round(math.sqrt(area * b / a) / 16) * 16)
        w2 = int(round(h2 * a / b / 16) * 16)
        w, h = w2, h2
    dur = int(payload.get("duration", 5))
    rate = 0.0234 if res == "1080p" else 0.0214
    if payload.get("video_urls"):
        rate *= 0.6
    tokens = math.ceil(h * w * (dur * 24 + 1) / 1024)  # the +1 frame is the ceiling the kit measured
    return round(tokens / 1000 * rate, 4), "list price, computed from the venue's formula (%dx%d, %d s, +1 frame)" % (w, h, dur)


def estimate(slug, payload):
    if slug.startswith("bytedance/seedance"):
        return seedance_cost(payload, slug)
    code, body, _ = vid.curl("POST", vid.HF + "/estimate/" + slug, vid.hf_headers(), payload, timeout=40)
    try:
        j = json.loads(body)
    except Exception:
        return None, "no estimate (%s)" % code
    if j.get("type") == "estimate":
        return float(j["usd"]), "the venue's estimate for this account"
    desc = j.get("pricing_description", "")
    if "per generated second" in desc:
        res = payload.get("resolution", "1080p")
        per = {"480p": 0.05, "720p": 0.10, "1080p": 0.20}.get(res)
        if per:
            return round(per * int(payload.get("duration", 5)), 4), "list price per second from the venue's description"
    return None, desc[:160] or "no number given"


def spent_today():
    total = 0.0
    if os.path.exists(vid.LEDGER):
        for ln in open(vid.LEDGER, encoding="utf-8"):
            try:
                e = json.loads(ln)
            except Exception:
                continue
            if e.get("venue") == "higgsfield":
                total += float(e.get("usd", 0) or 0)
    return round(total, 4)


def submit(slug, payload_path, name, cap):
    payload = payload_path if isinstance(payload_path, dict) else json.load(open(payload_path, encoding="utf-8"))
    rpath = os.path.join(vid.RECEIPTS, name + ".json")
    if os.path.exists(rpath):
        print("REFUSED: a receipt named %s already exists; use a new name" % name)
        return 2
    usd, basis = estimate(slug, payload)
    before = spent_today()
    print("COST LINE  %s  %s  ->  %s  (%s). Spent so far on this venue: $%.2f of the $%.0f cap." % (name, slug, ("$%.3f" % usd) if usd is not None else "unknown", basis, before, DAY_CAP))
    guess = usd if usd is not None else (0.25 if "/image" in slug or "soul" in slug else cap)
    if guess > cap:
        print("REFUSED: above the per-call cap of $%.2f" % cap)
        return 2
    if before + guess > DAY_CAP:
        print("REFUSED: would pass the cap of $%.0f" % DAY_CAP)
        return 2
    code, body, err = vid.curl("POST", vid.HF + "/" + slug, vid.hf_headers(), payload, timeout=90)
    try:
        j = json.loads(body)
    except Exception:
        j = {"raw": body[:400]}
    rec = {"name": name, "venue": "higgsfield", "slug": slug, "payload": payload, "submitted_at": vid.now(), "http": code, "response": j, "estimate_usd": usd, "estimate_basis": basis}
    if code not in ("200", "201", "202") or not j.get("request_id"):
        rec["state"] = "not accepted"
        vid.save_json(os.path.join(vid.RECEIPTS, "refused-" + name + "-" + str(int(time.time())) + ".json"), rec)
        print("NOT ACCEPTED (%s): %s" % (code, json.dumps(j)[:400]))
        return 1
    rec["state"] = "accepted"
    vid.save_json(rpath, rec)
    vid.log({"venue": "higgsfield", "name": name, "slug": slug, "request_id": j["request_id"], "usd": guess, "kind": "spend at acceptance (estimate)"})
    print("ACCEPTED  %s  request %s  status %s" % (name, j["request_id"], j.get("status")))
    return 0


def find_urls(o, acc):
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, str) and v.startswith("http") and k in ("url", "video", "image", "video_url", "image_url"):
                acc.append(v)
            else:
                find_urls(v, acc)
    elif isinstance(o, list):
        for v in o:
            find_urls(v, acc)
    return acc


def wait(names, minutes, out_dir):
    pending = {}
    for n in names:
        rpath = os.path.join(vid.RECEIPTS, n + ".json")
        rec = json.load(open(rpath, encoding="utf-8"))
        if rec.get("state") in ("completed", "failed", "nsfw", "canceled"):
            print("%s already %s" % (n, rec["state"]))
            continue
        pending[n] = (rpath, rec)
    deadline = time.time() + minutes * 60
    while pending and time.time() < deadline:
        for n in list(pending):
            rpath, rec = pending[n]
            resp = rec["response"]
            url = resp.get("status_url") or (vid.HF + "/requests/%s/status" % resp["request_id"])
            code, body, _ = vid.curl("GET", url, vid.hf_headers(), timeout=40)
            try:
                j = json.loads(body)
            except Exception:
                continue
            st = j.get("status")
            if st in ("completed", "failed", "nsfw", "canceled"):
                rec["state"] = st
                rec["finished_at"] = vid.now()
                rec["result"] = j
                files = []
                if st == "completed":
                    for i, u in enumerate(dict.fromkeys(find_urls(j, []))):
                        ext = os.path.splitext(u.split("?")[0])[1] or ".bin"
                        dest = os.path.join(out_dir, "%s%s%s" % (n, "" if i == 0 else "-%d" % i, ext))
                        os.makedirs(out_dir, exist_ok=True)
                        c2, _, _ = vid.curl("GET", u, [], timeout=300, out_file=dest)
                        if os.path.exists(dest) and os.path.getsize(dest) > 0:
                            files.append({"path": os.path.relpath(dest, vid.WORK), "bytes": os.path.getsize(dest), "sha256": vid.sha256(dest), "url": u})
                    rec["files"] = files
                else:
                    vid.log({"venue": "higgsfield", "name": n, "usd": -float(rec.get("estimate_usd") or 0), "kind": "refund: %s is not charged" % st})
                vid.save_json(rpath, rec)
                print("%s -> %s %s" % (n, st, ", ".join(f["path"] for f in files) if files else json.dumps(j)[:300]))
                del pending[n]
        if pending:
            time.sleep(10)
    for n in pending:
        print("%s still running after %d minutes" % (n, minutes))
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "submit":
        cap = float(a[a.index("--cap") + 1]) if "--cap" in a else 3.0
        sys.exit(submit(a[1], a[2], a[3], cap))
    if a and a[0] == "wait":
        mins = int(a[a.index("--minutes") + 1]) if "--minutes" in a else 20
        out = a[a.index("--out") + 1] if "--out" in a else os.path.join(vid.WORK, "prove", "takes")
        names = [x for i, x in enumerate(a[1:], 1) if not x.startswith("--") and a[i - 1] not in ("--minutes", "--out")]
        sys.exit(wait(names, mins, out))
    if a and a[0] == "batch":
        cap = float(a[a.index("--cap") + 1]) if "--cap" in a else 3.0
        jobs = json.load(open(a[1], encoding="utf-8"))
        bad = 0
        for job in jobs:
            rc = submit(job["slug"], job["payload"], job["name"], cap)
            bad += 1 if rc else 0
            time.sleep(0.4)
        sys.exit(1 if bad else 0)
    if a and a[0] == "spent":
        print("Higgsfield, by our own ledger of estimates: $%.2f (the venue has no balance call)" % spent_today())
        sys.exit(0)
    print(__doc__)
