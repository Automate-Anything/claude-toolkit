"""fal.ai queue runner for the launch video, with the same rules as higgsfield.py: a cost line before, a receipt at acceptance,
a poll, a download, no key printed. Payloads reference images by public URL (Higgsfield's stills are public URLs in
their receipts; fal's own outputs likewise), so nothing needs uploading.

  python fal.py submit <endpoint> <payload.json> <name> [--cap 3.00]
  python fal.py batch <jobs.json> [--cap 3.00]
  python fal.py wait <name> [<name> ...] [--minutes 20] [--out <dir>]
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

DAY_CAP = float(os.environ.get("VIDEO_DAY_CAP", "100"))
RECEIPTS = os.path.join(vid.WORK, "receipts", "fal")
os.makedirs(RECEIPTS, exist_ok=True)


def price(endpoint):
    code, body, _ = vid.curl("GET", "https://api.fal.ai/v1/models/pricing?endpoint_id=" + endpoint, vid.fal_headers(), timeout=40)
    try:
        p = json.loads(body)["prices"][0]
        return float(p["unit_price"]), p["unit"]
    except Exception:
        return None, body[:80]


def guess(endpoint, payload):
    up, unit = price(endpoint)
    if up is None:
        return None, "no price read"
    if unit in ("seconds", "second"):
        d = payload.get("duration") or payload.get("_seconds") or 8
        return up * float(d), "%s per second x %s s" % (up, d)
    if unit in ("minutes", "minute"):
        d = payload.get("_seconds") or 8
        return up * float(d) / 60, "%s per minute x %s s" % (up, d)
    if unit in ("units", "unit", "images", "image"):
        return up, "%s per unit" % up
    if unit == "megapixels":
        return None, "per megapixel"
    return None, unit


def spent_today():
    t = 0.0
    if os.path.exists(vid.LEDGER):
        for line in open(vid.LEDGER, encoding="utf-8"):
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("venue") == "fal":
                t += float(r.get("usd", 0))
    return t


def submit(endpoint, payload, name, cap):
    if isinstance(payload, str):
        payload = json.load(open(payload, encoding="utf-8"))
    clean = {k: v for k, v in payload.items() if not k.startswith("_")}
    usd, basis = guess(endpoint, payload)
    before = spent_today()
    print("COST LINE  %s  %s  ->  %s  (%s). Spent so far on fal: $%.2f of the $%.0f cap." % (name, endpoint, ("$%.3f" % usd) if usd is not None else "unknown", basis, before, DAY_CAP))
    g = usd if usd is not None else 1.0
    if g > cap:
        print("REFUSED: above the per-call cap of $%.2f" % cap)
        return 2
    if before + g > DAY_CAP:
        print("REFUSED: would pass the cap of $%.0f" % DAY_CAP)
        return 2
    code, body, _ = vid.curl("POST", "https://queue.fal.run/" + endpoint, vid.fal_headers(), body=clean, timeout=60)
    try:
        j = json.loads(body)
    except Exception:
        j = {}
    if str(code) not in ("200", "201") or "request_id" not in j:
        print("FAILED to submit %s: %s %s" % (name, code, body[:200]))
        return 1
    rec = {"name": name, "endpoint": endpoint, "request_id": j["request_id"], "status_url": j.get("status_url"), "response_url": j.get("response_url"), "payload": clean, "usd": usd, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    vid.save_json(os.path.join(RECEIPTS, name + ".json"), rec)
    vid.log({"venue": "fal", "name": name, "endpoint": endpoint, "usd": round(usd or 0, 4), "kind": "accepted"})
    print("ACCEPTED  %s  request %s" % (name, j["request_id"]))
    return 0


def wait(names, minutes, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    pending = {n: json.load(open(os.path.join(RECEIPTS, n + ".json"), encoding="utf-8")) for n in names}
    t0 = time.time()
    while pending and time.time() - t0 < minutes * 60:
        for n in list(pending):
            rec = pending[n]
            code, body, _ = vid.curl("GET", rec["status_url"], vid.fal_headers(), timeout=40)
            try:
                st = json.loads(body).get("status", "?")
            except Exception:
                st = "?"
            if st == "COMPLETED":
                code, body, _ = vid.curl("GET", rec["response_url"], vid.fal_headers(), timeout=60)
                try:
                    res = json.loads(body)
                except Exception:
                    res = {"raw": body[:300]}
                urls = []
                if isinstance(res, dict) and "detail" in res:
                    print("%s -> REFUSED by the endpoint: %s" % (n, json.dumps(res["detail"])[:240]))
                    vid.log({"venue": "fal", "name": n, "usd": -float(rec.get("usd") or 0), "kind": "refund refused"})
                    rec["result"] = res
                    vid.save_json(os.path.join(RECEIPTS, n + ".json"), rec)
                    del pending[n]
                    continue
                _find(res, urls)
                rec["result"] = res
                rec["files"] = [{"url": u} for u in urls]
                vid.save_json(os.path.join(RECEIPTS, n + ".json"), rec)
                if urls:
                    ext = ".mp4" if ".mp4" in urls[0] else (".png" if ".png" in urls[0] else (".jpg" if ".jpg" in urls[0] or ".jpeg" in urls[0] else ".bin"))
                    dst = os.path.join(out_dir, n + ext)
                    vid.curl("GET", urls[0], [], timeout=300, out_file=dst)
                    print("%s -> completed %s" % (n, os.path.relpath(dst, vid.WORK)))
                else:
                    print("%s -> completed, no file url: %s" % (n, json.dumps(res)[:200]))
                del pending[n]
            elif st in ("FAILED", "CANCELLED", "ERROR"):
                print("%s -> %s %s" % (n, st, body[:200]))
                vid.log({"venue": "fal", "name": n, "usd": -float(rec.get("usd") or 0), "kind": "refund " + st})
                del pending[n]
        if pending:
            time.sleep(8)
    for n in pending:
        print("%s -> still running after %d minutes" % (n, minutes))
    return 1 if pending else 0


def upload(path):
    """Put a local file in fal's storage and return its public URL (initiate, then PUT the bytes)."""
    import mimetypes
    ct = mimetypes.guess_type(path)[0] or "application/octet-stream"
    code, body, _ = vid.curl("POST", "https://rest.alpha.fal.ai/storage/upload/initiate", vid.fal_headers(), body={"content_type": ct, "file_name": os.path.basename(path)}, timeout=40)
    j = json.loads(body)
    import subprocess
    r = subprocess.run(["curl", "-sS", "-m", "300", "-X", "PUT", j["upload_url"], "-H", "Content-Type: " + ct, "--data-binary", "@" + path, "-o", os.devnull, "-w", "%{http_code}"], capture_output=True, text=True)
    if r.stdout.strip() not in ("200", "201", "204"):
        raise SystemExit("upload failed %s %s" % (r.stdout.strip(), r.stderr[:200]))
    print(j["file_url"])
    return j["file_url"]


def _find(o, acc):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "url" and isinstance(v, str) and v.startswith("http"):
                acc.append(v)
            else:
                _find(v, acc)
    elif isinstance(o, list):
        for v in o:
            _find(v, acc)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "submit":
        cap = float(a[a.index("--cap") + 1]) if "--cap" in a else 3.0
        sys.exit(submit(a[1], a[2], a[3], cap))
    if a and a[0] == "batch":
        cap = float(a[a.index("--cap") + 1]) if "--cap" in a else 3.0
        bad = 0
        for job in json.load(open(a[1], encoding="utf-8")):
            bad += 1 if submit(job["endpoint"], job["payload"], job["name"], cap) else 0
            time.sleep(0.3)
        sys.exit(1 if bad else 0)
    if a and a[0] == "upload":
        sys.exit(0 if upload(a[1]) else 1)
    if a and a[0] == "wait":
        mins = int(a[a.index("--minutes") + 1]) if "--minutes" in a else 20
        out = a[a.index("--out") + 1] if "--out" in a else os.path.join(vid.WORK, "prove", "takes")
        names = [x for i, x in enumerate(a[1:], 1) if not x.startswith("--") and a[i - 1] not in ("--minutes", "--out")]
        sys.exit(wait(names, mins, out))
    print(__doc__)
