"""
Read-only: dump recent Evolution messages for an instance so we can see the EXACT
raw shape of a quoted reply (where the quoted-message id / contextInfo actually
lives), to fix normalizerEvolution.ts precisely instead of guessing.

Reads EVOLUTION_API_URL + EVOLUTION_API_KEY from .env.local.

Usage:
  py scripts/evolution_findmsg.py <instanceName> [remoteJidDigits]
e.g.
  py scripts/evolution_findmsg.py app_<tenant>_channel_<id>
"""
import os
import sys
import json
import urllib.request
import urllib.error


def load_env(key):
    v = os.environ.get(key)
    if v:
        return v
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(key + "="):
                    val = line.split("=", 1)[1].strip()
                    if (val[:1], val[-1:]) in (('"', '"'), ("'", "'")):
                        val = val[1:-1]
                    return val
    except FileNotFoundError:
        pass
    return None


SECRET_HINT = ("pass", "secret", "token", "apikey", "api_key", "mediakey", "enc")


def redact(obj, depth=0):
    if isinstance(obj, dict):
        return {
            k: ("<redacted>" if any(h in k.lower() for h in SECRET_HINT) else redact(v, depth + 1))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact(x, depth + 1) for x in obj[:8]]
    if isinstance(obj, str) and len(obj) > 200:
        return obj[:200] + "...(truncated)"
    return obj


def main():
    base = (load_env("EVOLUTION_API_URL") or "").rstrip("/")
    key = load_env("EVOLUTION_API_KEY")
    if not base or not key:
        print("EVOLUTION_API_URL / EVOLUTION_API_KEY not found in env or .env.local")
        sys.exit(2)
    if len(sys.argv) < 2:
        print("usage: py scripts/evolution_findmsg.py <instanceName> [remoteJidDigits]")
        sys.exit(2)
    instance = sys.argv[1]
    jid_digits = sys.argv[2] if len(sys.argv) > 2 else None

    body = {"page": 1, "offset": 20}
    if jid_digits:
        body["where"] = {"key": {"remoteJid": f"{jid_digits}@s.whatsapp.net"}}

    req = urllib.request.Request(
        f"{base}/chat/findMessages/{instance}",
        data=json.dumps(body).encode("utf-8"),
        headers={"apikey": key, "Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8','replace')[:600]}")
        sys.exit(1)

    # Normalize to a list of message records across Evolution's shapes.
    records = data
    for k in ("messages", "records", "data"):
        if isinstance(records, dict) and k in records:
            records = records[k]
    if isinstance(records, dict) and "records" in records:
        records = records["records"]
    if not isinstance(records, list):
        print("Unexpected shape; top-level dump (redacted):")
        print(json.dumps(redact(data), indent=2)[:3000])
        return

    print(f"{len(records)} message(s). Showing key + message structure (redacted):\n")
    for rec in records[:20]:
        if not isinstance(rec, dict):
            continue
        keyinfo = rec.get("key") or {}
        msg = rec.get("message") or {}
        msg_keys = list(msg.keys()) if isinstance(msg, dict) else msg
        print(f"- id={keyinfo.get('id')} fromMe={keyinfo.get('fromMe')} msgKeys={msg_keys}")

        # Walk the WHOLE record and print the JSON path to any quote-related key,
        # plus the object that holds stanzaId (redacted) so we see the exact shape.
        def walk(node, path):
            if isinstance(node, dict):
                if "stanzaId" in node or "quotedMessage" in node:
                    print(f"    QUOTE @ {path or '<root>'}: keys={list(node.keys())}")
                    print(f"      stanzaId={node.get('stanzaId')!r} participant={node.get('participant')!r}")
                    qm = node.get("quotedMessage")
                    if isinstance(qm, dict):
                        print(f"      quotedMessage keys={list(qm.keys())} conversation={qm.get('conversation')!r}")
                for k, v in node.items():
                    walk(v, f"{path}.{k}" if path else k)
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, f"{path}[{i}]")
        walk(rec, "")


if __name__ == "__main__":
    main()
