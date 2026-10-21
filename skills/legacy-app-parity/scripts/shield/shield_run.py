#!/usr/bin/env python3
"""
shield_run.py - start the parity shield proxy. Normally started by shieldctl.py.

Builds mitmproxy's DumpMaster in-process with the Shield addon object, so there
is no script loading and no hot reload (mitmdump -s fails open if the script
breaks). Every option that could let traffic skip the addon is forced, then
checked; any mismatch or startup error exits non-zero before a single request
is served.

Usage (inside the shield venv, Python 3.12+):
  python shield_run.py --config shield.json --run-id RUN --home ~/.parity-shield
"""
import argparse
import asyncio
import json
import logging
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from mitmproxy import options  # noqa: E402
from mitmproxy.tools.dump import DumpMaster  # noqa: E402

import shield_addon  # noqa: E402
import shield_core  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--home", default=os.path.expanduser("~/.parity-shield"))
    a = ap.parse_args()

    try:
        with open(a.config, encoding="utf-8") as f:
            cfg = shield_core.validate_config(json.load(f))
    except Exception as e:  # noqa: BLE001
        print("shield: refusing to start, config problem: %s" % e, file=sys.stderr)
        return 2

    home = os.path.expanduser(a.home)
    os.makedirs(home, mode=0o700, exist_ok=True)
    log_path = os.path.join(home, "proxy.log")
    fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.close(fd)
    logging.basicConfig(filename=log_path, level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    async def run() -> int:
        opts = options.Options(listen_host="127.0.0.1", listen_port=int(cfg.get("proxy_port", 8899)),
                               confdir=os.path.join(home, "mitmproxy"), mode=["regular"])
        master = DumpMaster(opts, with_termlog=False, with_dumper=False)
        updates = dict(rawtcp=False, http3=False, ssl_insecure=False, connection_strategy="lazy", anticomp=True,
                       upstream_cert=False, stream_large_bodies=None, ignore_hosts=[], allow_hosts=[], tcp_hosts=[],
                       udp_hosts=[], scripts=[], client_replay=[], server_replay=[], map_local=[], map_remote=[],
                       modify_body=[], modify_headers=[], save_stream_file=None, hardump="")
        if cfg.get("upstream_ca"):
            updates["ssl_verify_upstream_trusted_ca"] = os.path.expanduser(cfg["upstream_ca"])
        master.options.update(**updates)
        shield = shield_addon.Shield(cfg, a.run_id, home)
        master.addons.add(shield)
        problems = shield_addon.check_options(master.options)
        if problems or shield.fatal:
            print("shield: refusing to start: %s" % ("; ".join(problems) or shield.fatal), file=sys.stderr)
            return 3
        print("shield: running on 127.0.0.1:%s run %s" % (cfg.get("proxy_port", 8899), a.run_id), flush=True)
        await master.run()
        return 0

    try:
        return asyncio.run(run())
    except Exception as e:  # noqa: BLE001
        print("shield: stopped on error %s" % type(e).__name__, file=sys.stderr)
        return 4


if __name__ == "__main__":
    sys.exit(main())
