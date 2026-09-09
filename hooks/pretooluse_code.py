"""
PreToolUse hook for Edit/Write tools.
Blocks or warns on prohibited code patterns in file content.

PORTABLE / REPO-AGNOSTIC. This hook is meant to be copied into any repo. It only
enforces things that are true in essentially any React + Supabase/Postgres-style
project, and it degrades gracefully everywhere else (a repo with no frontend, no
SQL, or a different stack simply never triggers the checks that don't apply).

Two small config lists below (FRONTEND_SRC_MARKER, BACKEND_SRC_MARKERS) let you
tune what counts as "frontend" vs "backend server" code for this repo. The
defaults work for the common `src/` layout. Add your own repo-specific checks in
the clearly-marked section at the bottom of main().
"""
import sys
import json
import re


# A path containing this substring is treated as FRONTEND source (browser code):
# used to gate the frontend-only checks (no service_role, no getUser(), etc.).
FRONTEND_SRC_MARKER = "/src/"

# Paths containing any of these substrings are treated as BACKEND SERVER source:
# used to gate the "a swallowed error must be reported" guard to server code
# (webhooks, crons, routes, jobs). Adapt to your repo's server directory names.
BACKEND_SRC_MARKERS = ("/server/", "server/src/", "/api/", "/backend/", "/functions/")


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")

    # For Edit: check new_string. For Write: check content.
    content = tool_input.get("new_string", "") or tool_input.get("content", "")

    if not content:
        sys.exit(0)

    # Normalize path separators for consistent matching
    normalized_path = file_path.replace("\\", "/")
    is_frontend_src = FRONTEND_SRC_MARKER in normalized_path
    is_backend_src = any(p in normalized_path for p in BACKEND_SRC_MARKERS)
    is_sql = normalized_path.endswith(".sql")

    # --- HARD SECURITY: server secrets must never appear in frontend code ---
    # (Supabase-specific names; harmless in a repo that doesn't use Supabase.)
    if is_frontend_src:
        if re.search(r"service_role", content) and not re.search(r"//.*service_role|/\*.*service_role", content):
            deny("service_role must never appear in frontend code. Server secrets belong on the server, never in browser-shipped code.")
        if re.search(r"supabaseAdmin", content) and not re.search(r"//.*supabaseAdmin", content):
            deny("An admin/service DB client must never be in frontend code. Use the regular client with RLS.")

    # --- QUALITY / PERFORMANCE DENIES (see the page-performance skill) ---

    # Over-fetching every column.
    if re.search(r"\.select\(\s*['\"]?\*['\"]?\s*\)", content):
        deny("Never use .select('*'). Select only the columns you need: .select('id, name, status').")

    # Animating every CSS property (layout jank).
    if re.search(r"transition-all|transition:\s*all\b", content):
        deny("Never use 'transition-all'. It transitions every property including layout, causing jank. Name exact props: transition-[top,height] or transition: opacity 0.2s ease.")

    # A network round-trip for auth on every call (Supabase-specific; benign elsewhere).
    if is_frontend_src and re.search(r"\.auth\.getUser\s*\(", content):
        deny("Don't call auth.getUser() in frontend code - it makes a network request every time. Read the current user from your cached session context instead.")

    # Forced synchronous layout in the render/hot path.
    if is_frontend_src and "getComputedStyle(" in content:
        deny("Don't use getComputedStyle() in frontend code - it forces a synchronous layout recalculation. Cache the value in a ref instead. See the page-performance skill.")

    # --- SECURITY: SECURITY DEFINER function without a REVOKE EXECUTE lockdown ---
    #
    # Postgres grants EXECUTE on every new public-schema function to PUBLIC by
    # default. For SECURITY DEFINER that means anyone with the anon API key can
    # RPC-call it bypassing RLS - a cross-tenant IDOR pattern. This rejects any
    # SQL file that defines a public SECDEF function without also REVOKE'ing
    # EXECUTE on it in the same file.
    #
    # See the `security-rls-permissions` skill -> "SECURITY DEFINER Function ACLs".
    if is_sql:
        create_pattern = re.compile(
            r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"
            r"(?:public\s*\.\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\("
            r"(.*?)"  # arg list + RETURNS + AS body (non-greedy through the body)
            r"SECURITY\s+DEFINER",
            re.IGNORECASE | re.DOTALL,
        )
        missing = []
        for match in create_pattern.finditer(content):
            fn_name = match.group(1)
            revoke_pattern = re.compile(
                r"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\s*\.\s*)?"
                + re.escape(fn_name)
                + r"\s*\(",
                re.IGNORECASE,
            )
            if not revoke_pattern.search(content):
                missing.append(fn_name)

        if missing:
            names = ", ".join(missing)
            deny(
                f"SECURITY DEFINER function(s) without REVOKE EXECUTE: {names}\n\n"
                f"Postgres grants EXECUTE on every new public-schema function to PUBLIC by default.\n"
                f"For SECURITY DEFINER that means ANY user with the anon API key can RPC-call it,\n"
                f"bypassing RLS - a cross-tenant IDOR vector.\n\n"
                f"Required in the same migration file, immediately after each CREATE FUNCTION:\n\n"
                f"  REVOKE EXECUTE ON FUNCTION public.{missing[0]}(<args>) FROM PUBLIC;\n"
                f"  REVOKE EXECUTE ON FUNCTION public.{missing[0]}(<args>) FROM anon;\n"
                f"  REVOKE EXECUTE ON FUNCTION public.{missing[0]}(<args>) FROM authenticated;\n"
                f"  GRANT  EXECUTE ON FUNCTION public.{missing[0]}(<args>) TO service_role;\n"
                f"  -- ...and GRANT to authenticated only if it's a client-callable RPC.\n\n"
                f"See the `security-rls-permissions` skill -> \"SECURITY DEFINER Function ACLs\"\n"
                f"for the three lockdown patterns (trigger-only / client-RPC / admin-only)."
            )

    # --- SILENT-FAILURE GUARD (backend): a swallowed error must be reported ---
    #
    # A catch block in a backend path (webhook / cron / route / job) that LOGS an
    # error (console.error/warn) but never surfaces it to an alert system is a
    # silent production failure: nobody learns something fixable broke until a
    # customer complains. This is the error-alert-system skill, made mechanical.
    #
    # ASK (not deny): some catches ARE benign. The author confirms which: wire the
    # report call, or mark the catch benign with a `// benign-catch:` comment.
    if is_backend_src:
        offenders = _find_silent_catch_blocks(content)
        if offenders:
            snippet = offenders[0]
            ask(
                "SILENT FAILURE GUARD - a catch block here logs an error but never reports it to your alert system.\n\n"
                "In a backend webhook / cron / route / job path, a caught error that only console.error/warn's\n"
                "is INVISIBLE to the team: no alert fires, so you only find out it broke when a customer emails.\n"
                "(See the `error-alert-system` skill.)\n\n"
                f"The catch block in question logs:\n    {snippet}\n\n"
                "Decide which this is, then proceed:\n"
                "  - ACTIONABLE (a single occurrence is a real bug you'd investigate): report it to your\n"
                "    alert system (e.g. report(err, { type: '...', metadata: { source: '<module>.<fn>' } })).\n"
                "  - BENIGN-BUT-TRACK (an expected skip you want frequency on): report it at info/silent tier.\n"
                "  - TRULY BENIGN (opt-out, idempotency hit, by-design branch you'd NEVER investigate):\n"
                "    keep the console log and add a `// benign-catch: <one-line why>` comment on the catch.\n\n"
                "Add one of the above, then re-apply."
            )

    # --- SILENT-FAILURE GUARD (Postgres): a swallowed EXCEPTION must be surfaced ---
    #
    # SQL that adds an `EXCEPTION WHEN OTHERS` handler which swallows the error
    # (no RAISE, no error-logging call) is the DB equivalent of a silent catch: a
    # JS reporter can NEVER see it. A trigger/function that catches its own
    # exception and returns a graceful fallback pages no one.
    db_silent_swallow_note = ""
    if is_sql and _has_silent_when_others(content):
        db_silent_swallow_note = (
            "\n\n--- DB-SIDE SILENT FAILURE ---\n"
            "This SQL adds an `EXCEPTION WHEN OTHERS` handler that swallows the error (no RAISE, no\n"
            "error-logging call). That's a silent DB failure - a JS-side reporter cannot see it, so the\n"
            "team is never paged; the user just gets a broken result.\n"
            "Decide which this is:\n"
            "  - REAL failure (a bug you'd want to fix): log it from inside the handler before the return,\n"
            "    via whatever DB-side error-logging helper this repo has (see the `error-alert-system` skill).\n"
            "  - BY-DESIGN (user-input validation, an expected branch you'd NEVER investigate): leave it, and\n"
            "    add a `-- benign-catch: <why>` comment on the EXCEPTION line so the next reader knows."
        )

    # Warn on CREATE OR REPLACE / DROP FUNCTION in SQL (replacing a live function).
    if is_sql and re.search(r"(CREATE\s+OR\s+REPLACE|DROP)\s+FUNCTION", content, re.IGNORECASE):
        ask(
            "Replacing/dropping a live function. Before you do:\n"
            "1. Pull the LIVE body NOW (pg_get_functiondef(oid) FROM pg_proc WHERE proname='<fn>'). Migration files lie; only the live DB is truth.\n"
            "2. DIFF your new body against that live body PROGRAMMATICALLY (not by eye). It MUST be byte-for-byte identical EXCEPT the exact lines you intend to change. One extra changed line means you reordered/dropped something - fix it before shipping.\n"
            "3. RETURNS TABLE / OUT params: a new column must sit at the SAME positional index in BOTH the signature AND the final SELECT (SQL maps columns by position, not name). Changing the return type needs DROP+CREATE in one transaction (CREATE OR REPLACE cannot change return type).\n"
            "4. After applying, re-pull and smoke-test (SELECT ... LIMIT 1) so a type/position mismatch can't ship silently."
            + db_silent_swallow_note
        )

    # SQL that isn't a function def but still adds a silent WHEN OTHERS.
    if db_silent_swallow_note and not re.search(r"(CREATE\s+OR\s+REPLACE|DROP)\s+FUNCTION", content, re.IGNORECASE):
        ask("DB-side error handling check." + db_silent_swallow_note)

    # ------------------------------------------------------------------------
    # ADD YOUR REPO-SPECIFIC CHECKS HERE.
    # This is where the copied-from-elsewhere version enforced things tied to one
    # app (a theme-token system, an outbound-comms audit log, an identity-by-id
    # rule, a payment-attempt wrapper, i18n key existence, etc.). Those were
    # removed because they reference tables/functions/files that don't exist in a
    # fresh repo. When THIS repo grows an invariant worth enforcing mechanically,
    # add a `deny(...)` or `ask(...)` block here, and note it in the relevant skill.
    # ------------------------------------------------------------------------

    sys.exit(0)


def _extract_brace_body(text, open_brace_idx):
    """Given the index of a '{', return (body_str, index_after_closing_brace),
    matching nested braces. Returns (None, -1) if unbalanced (truncated edit)."""
    depth = 0
    i = open_brace_idx
    n = len(text)
    while i < n:
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[open_brace_idx + 1:i], i + 1
        i += 1
    return None, -1


def _find_silent_catch_blocks(content):
    """Return short snippets for catch blocks that LOG an error
    (console.error/console.warn) but do NOT report it and are NOT explicitly
    marked benign. Covers both `catch (e) { ... }` and `.catch((e) => { ... })`.

    Conservative to avoid false-positive noise:
      - Only flags blocks that actually console.error/warn (a real error path).
      - A block containing a report call (reportError / report(...)) is cleared.
      - A `// benign-catch:` marker anywhere in the block clears it.
      - Brace-less arrow catches (`.catch(() => {})`, `.catch(noop)`) never match.
    """
    offenders = []

    # Pattern 1: try/catch - `catch` optionally followed by `(...)`, then `{`.
    for m in re.finditer(r"\bcatch\b\s*(?:\([^)]*\))?\s*\{", content):
        brace_idx = content.rindex("{", m.start(), m.end())
        body, _ = _extract_brace_body(content, brace_idx)
        _classify_catch_body(body, offenders)

    # Pattern 2: promise `.catch(<handler>)` where the handler has a brace body.
    for m in re.finditer(r"\.catch\s*\(", content):
        rest = content[m.end(): m.end() + 300]
        body_brace_rel = -1
        arrow = re.search(r"=>\s*\{", rest)
        if arrow:
            body_brace_rel = rest.index("{", arrow.start())
        else:
            fn = re.search(r"\bfunction\b[^{]*\{", rest)
            if fn:
                body_brace_rel = rest.index("{", fn.start())
        if body_brace_rel == -1:
            continue  # brace-less handler - nothing to log inside
        brace_idx = m.end() + body_brace_rel
        body, _ = _extract_brace_body(content, brace_idx)
        _classify_catch_body(body, offenders)

    return offenders


def _classify_catch_body(body, offenders):
    """Append a snippet to `offenders` if this catch body is a silent failure."""
    if not body:
        return
    lower = body.lower()
    logs_error = ("console.error" in lower) or ("console.warn" in lower)
    if not logs_error:
        return
    # Cleared if it reports the error through any report()/reportError() call.
    if "reporterror" in lower or re.search(r"\breport\s*\(", lower):
        return
    if "benign-catch" in lower:
        return
    snippet = ""
    for line in body.splitlines():
        s = line.strip()
        if "console.error" in s or "console.warn" in s:
            snippet = s[:140]
            break
    offenders.append(snippet or "(console log without an error report)")


def _has_silent_when_others(sql):
    """True if the SQL adds an `EXCEPTION WHEN OTHERS` handler that swallows the
    error silently - i.e. its handler region does NOT re-raise (RAISE), does NOT
    call a *log*/*error* logging helper, and is NOT marked `benign-catch`.

    Conservative: the handler region is approximated as the text from `WHEN
    OTHERS` to the next `END;`. A false positive just shows an ask the author
    dismisses; the thing to avoid is a false negative, so we over-include.
    """
    for m in re.finditer(r"EXCEPTION\s+WHEN\s+OTHERS\s+THEN\b", sql, re.IGNORECASE):
        rest = sql[m.end():]
        end_m = re.search(r"\bEND\s*;", rest, re.IGNORECASE)
        region = rest[: end_m.start()] if end_m else rest
        lower = region.lower()
        # Already surfaced: any log_*_error / *_log_error style helper call.
        if re.search(r"log[_a-z]*error|error[_a-z]*log", lower):
            continue
        if "benign-catch" in lower:
            continue
        if re.search(r"\braise\b", region, re.IGNORECASE):
            continue  # re-raises - not silent
        return True
    return False


def block(reason):
    """Hard block - exit 2, stderr message."""
    print(f"BLOCKED: {reason}", file=sys.stderr)
    sys.exit(2)


def deny(reason):
    """Deny via JSON - Claude sees the reason and should fix the code."""
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(result))
    sys.exit(0)


def ask(reason):
    """Surface a warning to the AGENT, then allow the call - never prompt the human.

    Instead of a Yes/No popup (which would still appear even under
    bypassPermissions mode), ALLOW the tool call and inject the warning as
    additionalContext. The agent reads it, confirms everything is good, and
    proceeds. Hard denies (deny()/block()) are unaffected; only these soft
    double-check nudges avoid interrupting the human.
    """
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "additionalContext": reason,
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
