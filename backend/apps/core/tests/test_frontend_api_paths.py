"""
Every literal API path the frontend calls exists in the backend, with an HTTP method it accepts.

Context: a store's log showed the frontend calling `/auth/users/` (about 60 times) and `/branches/`
(real routes: `/core/users/`, `/core/branches/`), and the defects page posting to `/write-off/` and
`/discount-sale/` (real: `/resolve-write-off/`, `/resolve-discount-sale/`). The calls failed with 404
and nobody noticed, because the screens swallow the error.

The check reads `frontend/src` as text: `api.get("/x/")`, `api.post(`/x/${id}/y/`)`, and so on. Paths with
template parts are resolved with a placeholder id. Calls whose path is built at run time cannot be checked
and are listed in DYNAMIC_PATHS with the reason.
"""
import re
from pathlib import Path

import pytest
from django.urls import Resolver404, resolve

FRONTEND_SRC = Path(__file__).resolve().parents[4] / "frontend" / "src"

CALL = re.compile(
    r"""\bapi\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^()]*?>)?\s*\(\s*(`[^`]*`|"[^"\n]*"|'[^'\n]*')"""
)
UUID = "00000000-0000-0000-0000-000000000000"

# (method, path as written) -> why it cannot be checked.
DYNAMIC_PATHS = {
    ("POST", "/inventory/transfers/${transferId}/${endpoint}/"):
        "the action is chosen at run time: dispatch, receive or cancel (StockTransferViewSet)",
}


def _literal_paths():
    for file in sorted(FRONTEND_SRC.rglob("*.ts*")):
        if "__tests__" in file.parts or file.name.endswith((".test.ts", ".test.tsx")):
            continue
        source = file.read_text(encoding="utf8")
        for match in CALL.finditer(source):
            literal = match.group(2)[1:-1]
            if not literal.startswith("/"):
                continue
            line = source.count("\n", 0, match.start()) + 1
            yield match.group(1).upper(), literal, f"{file.relative_to(FRONTEND_SRC)}:{line}"


def _candidates(literal):
    """URLs to try: the query string and an unfinished trailing `${ ... ? ... : ...}` are dropped."""
    path = literal.split("?")[0]
    if "${" in path and "}" not in path[path.rfind("${"):]:
        path = path[:path.rfind("${")]                      # a ternary cut at its nested backtick
    path = re.sub(r"\$\{[^}]*\}", "{id}", path)
    for placeholder in (UUID, "1"):                         # uuid or integer primary keys
        url = "/api/v1" + path.replace("{id}", placeholder)
        yield url if url.endswith("/") else url + "/"


def _accepted_methods(match):
    func = match.func
    if hasattr(func, "actions"):                            # ViewSet route: {"get": "list", "post": "create"}
        return {m.upper() for m in func.actions}
    view_class = getattr(func, "view_class", None)
    if view_class is not None:                              # APIView
        return {m.upper() for m in view_class.http_method_names if hasattr(view_class, m)}
    return None


def _check(method, literal):
    """None when the call matches a backend route that accepts the method, else the reason."""
    resolved = None
    for url in _candidates(literal):
        try:
            resolved = resolve(url)
            break
        except Resolver404:
            continue
    if resolved is None:
        return "no such route"
    accepted = _accepted_methods(resolved)
    if accepted is not None and method not in accepted:
        return f"route {resolved.route} accepts {sorted(accepted)}, not {method}"
    return None


@pytest.mark.skipif(not FRONTEND_SRC.is_dir(), reason="frontend sources are not next to the backend")
def test_every_frontend_api_call_matches_a_backend_route():
    problems, checked = [], 0
    for method, literal, where in _literal_paths():
        if (method, literal) in DYNAMIC_PATHS:
            continue
        checked += 1
        reason = _check(method, literal)
        if reason:
            problems.append(f"{method} {literal}  ({where}): {reason}")

    assert checked > 250, f"only {checked} calls found: the scan pattern no longer matches the code"
    assert not problems, "frontend calls without a matching backend route:\n" + "\n".join(problems)


def test_the_check_rejects_the_paths_that_broke_in_production():
    assert _check("GET", "/auth/users/?page_size=100") == "no such route"
    assert _check("GET", "/branches/") == "no such route"
    assert _check("POST", "/inventory/defects/${id}/write-off/") == "no such route"
    assert _check("POST", "/inventory/defects/${id}/discount-sale/") == "no such route"


def test_the_check_accepts_the_corrected_paths_and_rejects_a_wrong_method():
    assert _check("GET", "/core/users/?page_size=100") is None
    assert _check("GET", "/core/branches/") is None
    assert _check("POST", "/inventory/defects/${id}/resolve-write-off/") is None
    assert _check("POST", "/inventory/defects/${id}/resolve-discount-sale/") is None
    assert "accepts" in _check("DELETE", "/core/time/")
