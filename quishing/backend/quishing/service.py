"""Analyse complète d'un QR code : réseau + règles → rapport JSON."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

from . import analyzer as A
from .fetcher import SafeFetcher
from .rdap import RdapClient
from .reputation import OpenPhishFeed, ReputationChecker, SafeBrowsing, URLhaus

MAX_PAYLOAD = 4096


class Analyzer:
    def __init__(self, fetcher: SafeFetcher | None = None, rdap: RdapClient | None = None,
                 reputation: ReputationChecker | None = None, rules: dict | None = None):
        self.rules = rules or A.load_rules()
        self.fetcher = fetcher or SafeFetcher()
        self.rdap = rdap or RdapClient()
        self.reputation = reputation or ReputationChecker([])
        self._pool = ThreadPoolExecutor(max_workers=4)

    @classmethod
    def from_env(cls) -> "Analyzer":
        rules = A.load_rules()
        sources = []
        if os.environ.get("OPENPHISH", "1") != "0":
            sources.append(OpenPhishFeed(shared_hosts=set(rules["free_hosting"]) | set(rules["shorteners"])))
        sources.append(URLhaus(os.environ.get("URLHAUS_AUTH_KEY")))
        sources.append(SafeBrowsing(os.environ.get("GSB_API_KEY")))
        allow_private = os.environ.get("QUISHING_ALLOW_PRIVATE") == "1"
        return cls(fetcher=SafeFetcher(allow_private=allow_private), rdap=RdapClient(),
                   reputation=ReputationChecker(sources), rules=rules)

    def analyze(self, raw: str) -> dict:
        raw = str(raw)[:MAX_PAYLOAD]
        payload = A.parse_payload(raw)
        network: dict = {"followed": False}

        if payload["type"] != "url" or not payload["url"].lower().startswith(("http://", "https://")):
            report = A.analyze(raw, self.rules, {})
            report["network"] = network
            report["mode"] = "serveur"
            return report

        start = payload["url"]
        fetch = self.fetcher.follow(start)
        final = fetch.final_url or start
        rules = self.rules

        start_host = A.to_ascii_host(A.split_url(start)["host"]) if A.split_url(start) else ""
        final_parts = A.split_url(final)
        final_host = A.to_ascii_host(final_parts["host"]) if final_parts else ""
        start_domain = A.registrable_domain(start_host, rules)
        final_domain = A.registrable_domain(final_host, rules)

        # Âge du domaine final (et réputation de toutes les étapes) en parallèle
        need_age = (final_parts is not None and final_host and not A.is_ip_host(final_host)
                    and not A.match_suffix_list(final_host, rules["free_hosting"]))
        age_future = self._pool.submit(self.rdap.lookup, final_domain) if need_age else None
        hop_urls = [h.url for h in fetch.hops] or [start]
        rep = self.reputation.check(hop_urls)
        rdap = age_future.result() if age_future else None

        shortener_hosts = [
            A.to_ascii_host(A.split_url(h.url)["host"]) for h in fetch.hops[:-1] if A.split_url(h.url)
        ]
        from_shortener = any(A.match_suffix_list(h, rules["shorteners"]) for h in shortener_hosts + [start_host])

        ctx: dict = {
            "resolved": final != start,
            "hops": max(0, len(fetch.hops) - 1),
            "fromShortener": from_shortener,
            "htmlRedirect": fetch.html_redirect,
            "tlsError": fetch.tls_error,
            "unreachable": fetch.unreachable,
            "download": fetch.download,
            "passwordForm": fetch.password_form,
            "blocklisted": rep["listed"],
        }
        if final != start:
            ctx["finalUrl"] = final
        if start_domain and final_domain and start_domain != final_domain:
            ctx["crossDomain"] = {"from": start_domain, "to": final_domain}
        if need_age:
            ctx["ageChecked"] = True
            ctx["domainAgeDays"] = rdap.get("age_days") if rdap else None

        report = A.analyze(raw, rules, ctx)
        network.update({
            "followed": True,
            "start_url": start,
            "final_url": final,
            "redirects": fetch.to_dict()["hops"],
            "error": fetch.error,
            "blocked": fetch.blocked,
            "title": fetch.title,
            "domain": rdap,
            "reputation": rep["sources"],
        })
        report["network"] = network
        report["mode"] = "serveur"
        return report
