"""Read input schemas and prices from the venues' own catalogs. Free calls only."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

FAL = [
    "openai/gpt-image-2.5/sunburst/text-to-image",
    "openai/gpt-image-2.5/sunburst/edit",
    "fal-ai/nano-banana-pro/edit",
    "google/gemini-omni-flash/v1.1/image-to-video",
]
for ep in FAL:
    code, body, _ = vid.curl("GET", "https://api.fal.ai/v1/models/pricing?endpoint_id=" + ep, vid.fal_headers(), timeout=40)
    price = body[:200]
    try:
        p = json.loads(body)["prices"][0]
        price = "%s per %s" % (p["unit_price"], p["unit"])
    except Exception:
        pass
    code, body, _ = vid.curl("GET", "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=" + ep, [], timeout=40)
    print("fal", ep, "|", price)
    try:
        j = json.loads(body)
        schemas = j["components"]["schemas"]
        inp = next(v for k, v in schemas.items() if k.lower().endswith("input"))
        req = set(inp.get("required", []))
        for name, spec in inp.get("properties", {}).items():
            t = spec.get("type") or ("anyOf" if "anyOf" in spec else "")
            extra = spec.get("enum") or spec.get("default")
            if "anyOf" in spec:
                extra = [a.get("enum") or a.get("$ref", a.get("type")) for a in spec["anyOf"]]
            print("   %-22s %-8s %s %s" % (name, t, "REQUIRED" if name in req else "", json.dumps(extra)[:170] if extra is not None else ""))
    except Exception as ex:
        print("   schema not read:", type(ex).__name__, code, body[:120])

print()
HF = [
    ("bytedance/seedance-2.5/image-to-video", {"image_url": "https://example.com/a.png", "prompt": "x", "duration": 5, "resolution": "480p"}),
    ("bytedance/seedance-2.5/reference-to-video", {"image_urls": ["https://example.com/a.png"], "prompt": "x", "duration": 6, "resolution": "720p", "aspect_ratio": "16:9"}),
    ("kling-video/v3.0/pro/image-to-video", {"image_url": "https://example.com/a.png", "prompt": "x", "duration": 5, "sound": "on"}),
    ("kling-video/v3.0/std/image-to-video", {"image_url": "https://example.com/a.png", "prompt": "x", "duration": 5, "sound": "on"}),
    ("minimax/h3/image-to-video", {"image_url": "https://example.com/a.png", "prompt": "x", "duration": 5}),
    ("alibaba/wan-3.0/image-to-video", {"image_url": "https://example.com/a.png", "prompt": "x", "duration": 5, "resolution": "720p"}),
    ("marketing-studio/image/sunburst", {"prompt": "x"}),
    ("higgsfield-ai/soul/v2/standard", {"prompt": "x"}),
]
for ep, payload in HF:
    code, body, _ = vid.curl("POST", vid.HF + "/estimate/" + ep, vid.hf_headers(), payload, timeout=40)
    print("HF estimate", ep, "->", code, body[:520])
