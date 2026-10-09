import contextlib
import importlib.util
import io
import json
import unittest
import urllib.error
import urllib.parse

spec = importlib.util.spec_from_file_location("diagnostic", __file__.replace("test-", ""))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ZONE_ID = "a" * 32
ACCOUNT_ID = "b" * 32
CHILD_ID = "c" * 32
SECRET = "do-not-print-this-token-or-rule-key"


class Response:
    status = 200

    def __init__(self, result, info=None):
        self.body = json.dumps({"success": True, "result": result,
                               **({"result_info": info} if info else {})}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, size):
        return self.body[:size]


class Transport:
    def __init__(self, denied_suffix=None):
        self.requests = []
        self.denied_suffix = denied_suffix

    def __call__(self, request, timeout):
        self.requests.append(request)
        url = urllib.parse.urlsplit(request.full_url)
        assert request.method == "GET"
        assert url.scheme == "https" and url.netloc == "api.cloudflare.com"
        assert request.get_header("Authorization") == "Bearer " + SECRET
        path = url.path.removeprefix("/client/v4")
        if self.denied_suffix and path.endswith(self.denied_suffix):
            raise urllib.error.HTTPError(request.full_url, 403, SECRET, {},
                                         io.BytesIO(json.dumps({"errors": [{"code": 10000, "message": SECRET}]}).encode()))
        if path == "/zones":
            return Response([{"name": "ayin.stream", "status": "active", "id": ZONE_ID,
                              "account": {"id": ACCOUNT_ID}}])
        if path.endswith("/domains/custom"):
            return Response({"domains": [{"domain": module.HOST, "enabled": True,
                                          "status": {"ownership": "active", "ssl": "active"}}]})
        if path.endswith("/domains/managed"):
            return Response({"domain": "private-value-not-to-log.r2.dev", "enabled": False})
        if path.endswith("/dns_records"):
            return Response([{"name": module.HOST, "type": "CNAME", "proxied": True, "content": SECRET}])
        if path.endswith("/workers/routes"):
            return Response([{"pattern": "https://*.ayin.stream/channels/*", "script": SECRET},
                             {"pattern": "https://media.ayin.stream/public/*"},
                             {"pattern": "https://unrelated.example/*", "script": "other"}])
        if path.endswith("/workers/domains"):
            return Response([])
        if path.endswith("/access/apps"):
            return Response([{"domain": "*.ayin.stream/channels", "name": SECRET},
                             {"domain": "unrelated.example", "name": SECRET}])
        if path.endswith("/entrypoint"):
            return Response({"rules": [{"enabled": True, "action": "execute",
                                        "expression": "http.host eq \"media.ayin.stream\"",
                                        "action_parameters": {"id": CHILD_ID}}]})
        if path.endswith("/rulesets/" + CHILD_ID):
            return Response({"rules": [{"enabled": True, "action": "block",
                                        "expression": "not is_timed_hmac_valid_v0(\"" + SECRET + "\")"}]})
        raise AssertionError("Unexpected endpoint")


class Tests(unittest.TestCase):
    def test_scoped_get_inventory_never_leaks_credentials_or_claims_privacy(self):
        transport = Transport()
        diagnostic = module.Diagnostic(SECRET, transport)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            report = diagnostic.run()
        text = json.dumps(report) + stdout.getvalue()
        self.assertNotIn(SECRET, text)
        self.assertNotIn(ZONE_ID, text)
        self.assertNotIn(ACCOUNT_ID, text)
        self.assertNotIn("private-value-not-to-log", text)
        self.assertTrue(report["configuration_reads_complete"])
        self.assertFalse(report["privacy_verified"])
        self.assertTrue(report["app_canary_must_remain_held"])
        self.assertTrue(report["r2_custom_domains"]["media_domain_public_enabled"])
        self.assertFalse(report["r2_managed_domain_public_enabled"])
        self.assertEqual(report["worker_route_candidates"], {"script_route_count": 1, "no_script_route_count": 1})
        self.assertEqual(report["accounts_access_app_candidate_count"], 1)
        self.assertEqual(report["zones_custom_waf_inventory"]["hmac_expression_candidate_count"], 1)
        self.assertEqual(report["zones_custom_waf_inventory"]["enabled_rule_count"], 2)
        self.assertTrue(all(r.method == "GET" for r in transport.requests))
        self.assertTrue(all("/r2/buckets/" not in r.full_url or "/domains/" in r.full_url for r in transport.requests))

    def test_permission_denial_is_unknown_and_other_reads_continue(self):
        diagnostic = module.Diagnostic(SECRET, Transport("/workers/routes"))
        report = diagnostic.run()
        self.assertFalse(report["configuration_reads_complete"])
        self.assertNotIn("worker_route_candidates", report)
        self.assertIn("zones_custom_waf_inventory", report)
        denial = next(r for r in report["reads"] if r["result"] == "permission_denied")
        self.assertEqual(denial["endpoint"], "/zones/{zone_id}/workers/routes")
        self.assertEqual(denial["http_status"], 403)
        self.assertEqual(denial["provider_error_codes"], [10000])
        self.assertNotIn(SECRET, json.dumps(report))

    def test_paginated_results_are_not_truncated(self):
        seen = []

        def paged(request, timeout):
            page = int(urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)["page"][0])
            seen.append(page)
            return Response([{"page": page}], {"page": page, "total_pages": 2})

        result = module.Diagnostic(SECRET, paged).listing("/zones", "/zones")
        self.assertEqual(result, [{"page": 1}, {"page": 2}])
        self.assertEqual(seen, [1, 2])

    def test_redirect_is_not_followed(self):
        handler = module.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, SECRET, {}, "https://other.example"))

    def test_body_limit_fails_closed(self):
        response = Response({})
        response.body = b"x" * (module.MAX_BODY + 1)
        diagnostic = module.Diagnostic(SECRET, lambda request, timeout: response)
        self.assertIsNone(diagnostic.get("/zones", "/zones"))
        self.assertEqual(diagnostic.report["reads"][0]["result"], "response_limit")


if __name__ == "__main__":
    unittest.main()
