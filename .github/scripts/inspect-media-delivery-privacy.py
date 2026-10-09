#!/usr/bin/env python3
"""GET-only AYIN configuration inventory. Never an object/authorization probe.

Only the existing AYIN_CLOUDFLARE_API_TOKEN is used. Provider bodies, IDs,
expressions, credentials and Worker source never enter the report or disk.
Candidate counts are deliberately NOT proof that delivery is authorized.
"""
import fnmatch
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.cloudflare.com/client/v4"
ZONE = "ayin.stream"
HOST = "media.ayin.stream"
BUCKET = "ayin-production-media"
MAX_BODY = 2 * 1024 * 1024
MAX_PAGES = 10
MAX_RULESETS = 20


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Diagnostic:
    def __init__(self, token, transport=None):
        self.token = token
        self.transport = transport or urllib.request.build_opener(NoRedirect()).open
        self.deadline = time.monotonic() + 240
        self.report = {
            "schema_version": 1,
            "target": HOST,
            "bucket": BUCKET,
            "configuration_reads_complete": True,
            "object_requests_performed": False,
            "mutations_performed": False,
            "privacy_verified": False,
            "app_canary_must_remain_held": True,
            "reads": [],
        }

    def fail(self, endpoint, reason, status=None, codes=None):
        row = {"method": "GET", "endpoint": endpoint, "result": reason}
        if status is not None:
            row["http_status"] = status
        if codes:
            row["provider_error_codes"] = codes
        self.report["reads"].append(row)
        self.report["configuration_reads_complete"] = False

    def get(self, path, endpoint, query=None):
        # Paths are generated only below from fixed routes and validated IDs.
        if not path.startswith("/") or "?" in path or "#" in path or ".." in path:
            self.fail(endpoint, "invalid_request_path")
            return None
        if time.monotonic() >= self.deadline:
            self.fail(endpoint, "diagnostic_deadline")
            return None
        url = API + path + ("?" + urllib.parse.urlencode(query) if query else "")
        request = urllib.request.Request(
            url, method="GET", headers={
                "Authorization": "Bearer " + self.token,
                "Accept": "application/json",
                "User-Agent": "AYIN-read-only-media-privacy-inventory/1",
            },
        )
        try:
            with self.transport(request, timeout=15) as response:
                raw = response.read(MAX_BODY + 1)
                status = response.status
            if len(raw) > MAX_BODY:
                self.fail(endpoint, "response_limit", status)
                return None
            payload = json.loads(raw)
            if status != 200 or payload.get("success") is not True:
                self.fail(endpoint, "provider_failure", status, error_codes(payload))
                return None
            self.report["reads"].append({"method": "GET", "endpoint": endpoint,
                                         "result": "read", "http_status": status})
            return payload
        except urllib.error.HTTPError as error:
            # Never print exception text, headers, the response or a redirect URL.
            codes = []
            try:
                raw = error.read(MAX_BODY + 1)
                if len(raw) <= MAX_BODY:
                    codes = error_codes(json.loads(raw))
            except Exception:
                pass
            self.fail(endpoint, "permission_denied" if error.code in (401, 403)
                      else "not_found" if error.code == 404 else "http_failure",
                      error.code, codes)
        except Exception:
            self.fail(endpoint, "unavailable_or_invalid_response")
        return None

    def listing(self, path, endpoint, query=None):
        result = []
        for page in range(1, MAX_PAGES + 1):
            payload = self.get(path, endpoint, {**(query or {}), "page": page, "per_page": 100})
            if payload is None:
                return None
            rows = payload.get("result")
            if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                self.fail(endpoint, "invalid_list")
                return None
            result.extend(rows)
            info = payload.get("result_info") or {}
            pages = info.get("total_pages")
            if isinstance(pages, int) and pages >= page:
                if pages == page:
                    return result
            elif not info and len(rows) < 100:
                return result
            elif isinstance(info.get("total_count"), int) and len(result) >= info["total_count"]:
                return result
            elif len(rows) < 100 and pages is None:
                return result
        self.fail(endpoint, "pagination_limit")
        return None

    def ruleset_inventory(self, scope, identity):
        endpoint = "/" + scope + "/{" + scope[:-1] + "_id}/rulesets/phases/http_request_firewall_custom/entrypoint"
        base = "/" + scope + "/" + identity + "/rulesets"
        payload = self.get(base + "/phases/http_request_firewall_custom/entrypoint", endpoint)
        if payload is None:
            return None
        todo = [payload.get("result")]
        seen = set()
        rules = []
        while todo:
            current = todo.pop()
            if not isinstance(current, dict) or not isinstance(current.get("rules"), list):
                self.fail(endpoint, "invalid_ruleset")
                return None
            for rule in current["rules"]:
                if not isinstance(rule, dict):
                    self.fail(endpoint, "invalid_rule")
                    return None
                if rule.get("enabled", True) is not True:
                    continue
                rules.append(rule)
                if rule.get("action") != "execute":
                    continue
                child = (rule.get("action_parameters") or {}).get("id")
                if not valid_id(child):
                    self.fail(endpoint, "invalid_referenced_ruleset_id")
                    return None
                if child in seen:
                    continue
                if len(seen) >= MAX_RULESETS:
                    self.fail(endpoint, "ruleset_limit")
                    return None
                seen.add(child)
                child_endpoint = "/" + scope + "/{" + scope[:-1] + "_id}/rulesets/{ruleset_id}"
                fetched = self.get(base + "/" + child, child_endpoint)
                if fetched is None:
                    return None
                todo.append(fetched.get("result"))
        return rule_counts(rules)

    def run(self):
        zones = self.listing("/zones", "/zones?name=ayin.stream&status=active",
                             {"name": ZONE, "status": "active"})
        matches = [row for row in zones or [] if row.get("name") == ZONE and row.get("status") == "active"]
        if len(matches) != 1:
            self.fail("/zones?name=ayin.stream&status=active", "scope_not_uniquely_verified")
            return self.report
        zone_id = matches[0].get("id")
        account_id = (matches[0].get("account") or {}).get("id")
        if not valid_id(zone_id) or not valid_id(account_id):
            self.fail("/zones?name=ayin.stream&status=active", "invalid_scope_ids")
            return self.report
        self.report["ayin_scope_verified"] = True
        bucket_path = "/accounts/" + account_id + "/r2/buckets/" + BUCKET + "/domains/"
        bucket_endpoint = "/accounts/{account_id}/r2/buckets/ayin-production-media/domains/"
        custom = self.get(bucket_path + "custom", bucket_endpoint + "custom")
        if custom is not None:
            domains = (custom.get("result") or {}).get("domains")
            if isinstance(domains, list) and all(
                isinstance(d, dict) and isinstance(d.get("domain"), str)
                and isinstance(d.get("enabled"), bool) for d in domains
            ):
                target = [d for d in domains if d.get("domain") == HOST]
                self.report["r2_custom_domains"] = {
                    "media_domain_count": len(target),
                    "media_domain_public_enabled": any(d.get("enabled") is True for d in target),
                    "media_domain_ownership_active": any((d.get("status") or {}).get("ownership") == "active" for d in target),
                    "media_domain_ssl_active": any((d.get("status") or {}).get("ssl") == "active" for d in target),
                    "other_enabled_domain_count": sum(d.get("enabled") is True and d.get("domain") != HOST for d in domains),
                }
            else:
                self.fail(bucket_endpoint + "custom", "invalid_custom_domains")
        managed = self.get(bucket_path + "managed", bucket_endpoint + "managed")
        if managed is not None:
            enabled = (managed.get("result") or {}).get("enabled")
            if isinstance(enabled, bool):
                self.report["r2_managed_domain_public_enabled"] = enabled
            else:
                self.fail(bucket_endpoint + "managed", "invalid_enabled_value")
        dns = self.listing("/zones/" + zone_id + "/dns_records", "/zones/{zone_id}/dns_records?name=media.ayin.stream",
                           {"name": HOST})
        if dns is not None:
            target_dns = [d for d in dns if d.get("name") == HOST]
            self.report["media_dns"] = {
                "record_count": len(target_dns),
                "proxied_record_count": sum(d.get("proxied") is True for d in target_dns),
                "cname_record_count": sum(d.get("type") == "CNAME" for d in target_dns),
                "a_or_aaaa_record_count": sum(d.get("type") in ("A", "AAAA") for d in target_dns),
                "origin_target_disclosed": False,
            }
        routes = self.listing("/zones/" + zone_id + "/workers/routes", "/zones/{zone_id}/workers/routes")
        if routes is not None:
            matching = [r for r in routes if host_candidate(r.get("pattern"))]
            self.report["worker_route_candidates"] = {
                "script_route_count": sum(bool(r.get("script")) for r in matching),
                "no_script_route_count": sum(not r.get("script") for r in matching),
            }
        domains = self.listing("/accounts/" + account_id + "/workers/domains", "/accounts/{account_id}/workers/domains",
                               {"hostname": HOST, "zone_id": zone_id})
        if domains is not None:
            self.report["worker_custom_domain_candidate_count"] = sum(d.get("hostname") == HOST for d in domains)
        for scope, identity in (("accounts", account_id), ("zones", zone_id)):
            apps = self.listing("/" + scope + "/" + identity + "/access/apps",
                                "/" + scope + "/{" + scope[:-1] + "_id}/access/apps")
            if apps is not None:
                self.report[scope + "_access_app_candidate_count"] = sum(access_candidate(a) for a in apps)
            self.report[scope + "_custom_waf_inventory"] = self.ruleset_inventory(scope, identity)
        self.report["candidate_inventory_is_not_authorization_proof"] = True
        return self.report


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{32}", value) is not None


def error_codes(payload):
    if not isinstance(payload, dict):
        return []
    return [e["code"] for e in payload.get("errors", [])
            if isinstance(e, dict) and type(e.get("code")) is int][:10]


def host_candidate(value):
    if not isinstance(value, str):
        return False
    value = re.sub(r"^https?://", "", value, flags=re.I)
    host = value.split("/", 1)[0].lower()
    # A hostname match only identifies a possible route. Path precedence,
    # no-script exclusions and policy behavior still require review.
    return fnmatch.fnmatchcase(HOST, host)


def access_candidate(app):
    domains = [app.get("domain"), *(app.get("self_hosted_domains") or [])]
    domains += [d.get("uri") for d in app.get("destinations", []) if isinstance(d, dict)]
    return any(host_candidate(domain) for domain in domains)


def rule_counts(rules):
    expressions = [str(r.get("expression", "")).lower() for r in rules]
    # Syntactic hints only. Do not print expressions: HMAC keys may be embedded.
    return {
        "enabled_rule_count": len(rules),
        "explicit_media_host_reference_count": sum(HOST in e for e in expressions),
        "hmac_expression_candidate_count": sum("is_timed_hmac_valid_v0" in e for e in expressions),
        "blocking_rule_count": sum(r.get("action") == "block" for r in rules),
        "execute_rule_count": sum(r.get("action") == "execute" for r in rules),
        "effective_media_coverage_verified": False,
    }


def main():
    token = os.environ.get("AYIN_CLOUDFLARE_API_TOKEN")
    if not token:
        print(json.dumps({"schema_version": 1, "blocked": "existing_AYIN_CLOUDFLARE_API_TOKEN_missing",
                          "privacy_verified": False, "app_canary_must_remain_held": True}))
        return 2
    diagnostic = Diagnostic(token)
    try:
        report = diagnostic.run()
    except Exception:
        diagnostic.fail("local_diagnostic", "invalid_configuration_response")
        report = diagnostic.report
    print(json.dumps(report, sort_keys=True, indent=2))
    return 0 if report["configuration_reads_complete"] else 2


if __name__ == "__main__":
    sys.exit(main())
