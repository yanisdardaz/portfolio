/*
 * QR Sentinel — moteur d'analyse (navigateur + Node.js).
 *
 * Fonctions pures, sans réseau : elles prennent le contenu brut d'un QR code
 * et un "contexte" optionnel (redirections suivies, âge du domaine, listes de
 * blocage…) et renvoient un score de risque, la liste des raisons et un
 * verdict : "sur", "suspect" ou "dangereux".
 *
 * La même logique existe en Python (backend/quishing/analyzer.py). Les deux
 * versions sont vérifiées avec les mêmes cas de test (tests/cases.json).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.QuishingAnalyzer = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DANGEROUS_SCHEMES = ["javascript", "data", "vbscript", "file", "blob"];

  // ------------------------------------------------------------------ utils

  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (_, key) {
      return vars && vars[key] !== undefined ? String(vars[key]) : "";
    });
  }

  function trimTrailingDot(host) {
    return host.replace(/\.+$/, "");
  }

  function isIPv4(host) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return false;
    for (var i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
    return true;
  }

  function isIPHost(host) {
    if (!host) return false;
    if (host.charAt(0) === "[" || host.indexOf(":") !== -1) return true; // IPv6
    if (isIPv4(host)) return true;
    // Formes numériques "décimales" ou hexadécimales (http://3232235777/)
    if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return true;
    return false;
  }

  function endsWithDomain(host, domain) {
    return host === domain || host.slice(-(domain.length + 1)) === "." + domain;
  }

  function matchSuffixList(host, list) {
    for (var i = 0; i < list.length; i++) {
      if (endsWithDomain(host, list[i])) return list[i];
    }
    return null;
  }

  /**
   * Domaine "enregistrable" approximatif (sans liste publique complète) :
   * deux derniers labels, trois si le suffixe est composé (co.uk, gouv.fr…)
   * ou si c'est une plateforme d'hébergement gratuit (xxx.github.io).
   */
  function registrableDomain(host, rules) {
    host = trimTrailingDot(String(host || "").toLowerCase());
    if (!host || isIPHost(host)) return host;
    var labels = host.split(".");
    if (labels.length <= 2) return host;
    var suffixes = rules.multi_part_suffixes.concat(rules.free_hosting);
    var best = null;
    for (var i = 0; i < suffixes.length; i++) {
      var s = suffixes[i];
      if (endsWithDomain(host, s) && host !== s) {
        if (!best || s.length > best.length) best = s;
      }
    }
    var take = best ? best.split(".").length + 1 : 2;
    return labels.slice(-take).join(".");
  }

  function hostTokens(host) {
    return host.split(/[.\-]+/).filter(Boolean);
  }

  function keywordInHost(keyword, host) {
    var k = keyword.replace(/-/g, "");
    var tokens = hostTokens(host);
    if (k.length < 5) return tokens.indexOf(k) !== -1;
    if (k.length === 5) {
      for (var i = 0; i < tokens.length; i++) if (tokens[i].indexOf(k) === 0) return true;
      return false;
    }
    return host.replace(/[.\-]/g, "").indexOf(k) !== -1;
  }

  function isOfficialFor(host, domains) {
    for (var i = 0; i < domains.length; i++) {
      if (endsWithDomain(host, domains[i])) return true;
    }
    return false;
  }

  // -------------------------------------------------------------- payloads

  function parseWifi(raw) {
    // WIFI:T:WPA;S:MonReseau;P:motdepasse;H:false;;
    var body = raw.slice(5);
    var fields = {};
    var re = /([A-Z]+):((?:\\.|[^;])*);/g;
    var m;
    while ((m = re.exec(body))) {
      fields[m[1]] = m[2].replace(/\\(.)/g, "$1");
    }
    var auth = (fields.T || "").toUpperCase();
    return {
      ssid: fields.S || "",
      security: auth || "nopass",
      open: !auth || auth === "NOPASS",
      hidden: /^true$/i.test(fields.H || "")
    };
  }

  function cleanNumber(n) {
    return String(n || "").replace(/[\s.\-()]/g, "");
  }

  /**
   * Identifie le type de contenu d'un QR code.
   * Renvoie { type, raw, url?, data }.
   */
  function parsePayload(raw) {
    var text = String(raw == null ? "" : raw).replace(/^﻿/, "").trim();
    var lower = text.toLowerCase();

    if (/^wifi:/i.test(text)) return { type: "wifi", raw: text, data: parseWifi(text) };

    var sms = /^(?:smsto|sms|mmsto):([^:?]*)(?:[:?](?:body=)?([\s\S]*))?$/i.exec(text);
    if (sms) return { type: "sms", raw: text, data: { number: cleanNumber(sms[1]), body: sms[2] || "" } };

    if (/^tel:/i.test(text)) return { type: "tel", raw: text, data: { number: cleanNumber(text.slice(4)) } };

    if (/^mailto:/i.test(text)) {
      return { type: "email", raw: text, data: { address: text.slice(7).split("?")[0] } };
    }
    var matmsg = /^MATMSG:TO:([^;]*);/i.exec(text);
    if (matmsg) return { type: "email", raw: text, data: { address: matmsg[1] } };

    if (/^begin:vcard/i.test(text) || /^mecard:/i.test(text)) return { type: "vcard", raw: text, data: {} };
    if (/^geo:/i.test(text)) return { type: "geo", raw: text, data: { coords: text.slice(4) } };

    var crypto = /^(bitcoin|ethereum|litecoin|bitcoincash|dogecoin|monero|tron|solana|usdt):/i.exec(text);
    if (crypto) return { type: "crypto", raw: text, data: { currency: crypto[1].toLowerCase() } };

    var scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(text);
    if (scheme && DANGEROUS_SCHEMES.indexOf(scheme[1].toLowerCase()) !== -1) {
      return { type: "url", raw: text, url: text, data: { scheme: scheme[1].toLowerCase() } };
    }

    if (/^https?:\/\//i.test(text)) return { type: "url", raw: text, url: text.split(/\s/)[0], data: {} };

    // "www.exemple.com/..." ou "exemple.com/chemin" sans protocole
    if (/^(?:www\.)?[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}(?::\d+)?(?:[\/?#]\S*)?$/i.test(text) && !/\s/.test(text)) {
      return { type: "url", raw: text, url: "http://" + text, data: { implicitScheme: true } };
    }

    // Texte contenant un lien
    var embedded = /https?:\/\/[^\s"'<>]+/i.exec(text);
    if (embedded) return { type: "url", raw: text, url: embedded[0], data: { embedded: true } };

    if (lower.length === 0) return { type: "text", raw: text, data: { empty: true } };
    return { type: "text", raw: text, data: {} };
  }

  // ------------------------------------------------------------------ URLs

  function splitUrl(url) {
    // Découpage indépendant de l'objet URL, pour garder le même résultat
    // qu'en Python (urllib.parse.urlsplit).
    var m = /^([a-z][a-z0-9+.\-]*):\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(url);
    if (!m) return null;
    var authority = m[2];
    var at = authority.lastIndexOf("@");
    var userinfo = at !== -1 ? authority.slice(0, at) : "";
    var hostport = at !== -1 ? authority.slice(at + 1) : authority;
    var host = hostport;
    var port = "";
    if (hostport.charAt(0) === "[") {
      var end = hostport.indexOf("]");
      host = hostport.slice(0, end + 1);
      port = hostport.slice(end + 2);
    } else if (hostport.lastIndexOf(":") !== -1) {
      host = hostport.slice(0, hostport.lastIndexOf(":"));
      port = hostport.slice(hostport.lastIndexOf(":") + 1);
    }
    return {
      scheme: m[1].toLowerCase(),
      userinfo: userinfo,
      host: host,
      port: port,
      path: m[3] || "",
      query: m[4] || ""
    };
  }

  function toAsciiHost(host) {
    host = trimTrailingDot(host.toLowerCase());
    if (host.charAt(0) === "[" || /^[\x00-\x7f]*$/.test(host)) return host;
    try {
      return new URL("http://" + host + "/").hostname;
    } catch (e) {
      return host;
    }
  }

  function reason(rules, id, vars, pointsOverride) {
    var points = pointsOverride !== undefined ? pointsOverride : rules.weights[id];
    return {
      id: id,
      points: points,
      level: points >= 30 ? "danger" : points > 0 ? "warn" : points < 0 ? "good" : "info",
      message: fmt(rules.messages[id], vars || {})
    };
  }

  /** Analyse statique d'une URL (aucune requête réseau). */
  function analyzeUrl(url, rules, opts) {
    opts = opts || {};
    var reasons = [];
    var info = { url: url, host: "", domain: "", scheme: "" };
    var schemeMatch = /^([a-z][a-z0-9+.\-]*):/i.exec(url);
    var scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "";
    info.scheme = scheme;

    if (DANGEROUS_SCHEMES.indexOf(scheme) !== -1) {
      reasons.push(reason(rules, "dangerous_scheme", { scheme: scheme }));
      return { reasons: reasons, info: info, forceDangerous: true };
    }

    var parts = splitUrl(url);
    if (!parts) return { reasons: reasons, info: info };

    var host = toAsciiHost(parts.host);
    var domain = registrableDomain(host, rules);
    info.host = host;
    info.domain = domain;

    if (parts.scheme === "http") reasons.push(reason(rules, "no_https"));

    if (parts.userinfo) reasons.push(reason(rules, "userinfo", { host: host }));

    var ip = isIPHost(host);
    info.isIP = ip;
    if (ip) reasons.push(reason(rules, "ip_host", { host: host }));

    if (!ip && host.split(".").some(function (l) { return l.indexOf("xn--") === 0; })) {
      reasons.push(reason(rules, "punycode", { host: host }));
    }

    if (parts.port && !/^(80|443)$/.test(parts.port)) {
      reasons.push(reason(rules, "nonstandard_port", { port: parts.port }));
    }

    var official = false;
    if (!ip) {
      var shortener = matchSuffixList(host, rules.shorteners);
      info.shortener = shortener;
      if (shortener) {
        reasons.push(reason(rules, opts.resolvedShortener ? "shortener_resolved" : "shortener", { host: host }));
      }

      var platform = matchSuffixList(host, rules.free_hosting);
      info.freeHosting = platform;
      if (platform) reasons.push(reason(rules, "free_hosting", { platform: platform }));

      var tld = host.split(".").pop();
      var tld2 = host.split(".").slice(-2).join(".");
      if (rules.suspicious_tlds.indexOf(tld2) !== -1) {
        reasons.push(reason(rules, "suspicious_tld", { tld: tld2 }));
      } else if (rules.suspicious_tlds.indexOf(tld) !== -1) {
        reasons.push(reason(rules, "suspicious_tld", { tld: tld }));
      }

      // Domaines officiels / usurpation de marque
      var officialSuffix = matchSuffixList(host, rules.official_suffixes);
      var impersonated = null;
      for (var i = 0; i < rules.brands.length; i++) {
        var brand = rules.brands[i];
        if (isOfficialFor(host, brand.domains)) {
          official = true;
          continue;
        }
        if (platform && host === platform) continue;
        for (var k = 0; k < brand.keywords.length; k++) {
          if (keywordInHost(brand.keywords[k], host)) {
            impersonated = impersonated || brand;
            break;
          }
        }
      }
      if (officialSuffix) official = true;

      if (impersonated && !official) {
        reasons.push(reason(rules, "brand_impersonation", {
          brand: impersonated.name,
          official: impersonated.domains[0]
        }));
      } else if (!officialSuffix && hostTokens(host).some(function (t) { return t === "gouv" || t === "gouvfr" || t === "gov"; })) {
        reasons.push(reason(rules, "gov_impersonation"));
      }

      if (official && !platform) reasons.push(reason(rules, "official_domain", { domain: domain }));
      info.official = official && !platform;

      var sub = host.split(".").length - domain.split(".").length;
      if (sub >= rules.limits.subdomain_labels) reasons.push(reason(rules, "many_subdomains", { host: host }));

      var hyphens = (domain.replace(/(^|\.)xn--/g, "$1").match(/-/g) || []).length;
      if (hyphens >= rules.limits.hyphens) reasons.push(reason(rules, "many_hyphens", { host: domain }));
    }

    // Mots-clés de phishing (dans le domaine et le chemin)
    if (!official) {
      var haystack = (host + " " + parts.path + " " + parts.query).toLowerCase();
      var tokens = haystack.split(/[^a-z0-9]+/).filter(Boolean);
      var found = [];
      for (var w = 0; w < rules.phishing_keywords.length && found.length < rules.limits.phishing_keyword_max; w++) {
        var kw = rules.phishing_keywords[w];
        var hit = kw.indexOf("-") !== -1 ? haystack.indexOf(kw) !== -1 : tokens.indexOf(kw) !== -1;
        if (hit) found.push(kw);
      }
      found.forEach(function (word) { reasons.push(reason(rules, "phishing_keyword", { word: word })); });
    }

    if (url.length > rules.limits.long_url_chars) reasons.push(reason(rules, "long_url", { length: url.length }));

    // Fichier à télécharger d'après l'extension
    var ext = (/\.([a-z0-9]{1,5})$/i.exec(parts.path) || [])[1];
    if (ext && rules.download_extensions.indexOf(ext.toLowerCase()) !== -1) {
      info.downloadByExtension = ext.toLowerCase();
    }

    return { reasons: reasons, info: info, official: info.official };
  }

  // ------------------------------------------------------------- contexte

  function contextReasons(ctx, staticResult, rules) {
    var reasons = [];
    var info = staticResult.info;
    var L = rules.limits;

    if (ctx.blocklisted && ctx.blocklisted.length) {
      reasons.push(reason(rules, "blocklisted", { sources: ctx.blocklisted.join(", ") }));
    }

    if (typeof ctx.domainAgeDays === "number" && !info.isIP && !info.freeHosting) {
      var d = Math.max(0, Math.floor(ctx.domainAgeDays));
      if (d < L.age_very_new_days) reasons.push(reason(rules, "age_very_new", { days: d }));
      else if (d < L.age_new_days) reasons.push(reason(rules, "age_new", { days: d }));
      else if (d >= L.age_old_days) reasons.push(reason(rules, "age_old", { years: Math.floor(d / 365) }));
    } else if (ctx.domainAgeDays === null && ctx.ageChecked && !info.isIP && !info.freeHosting) {
      reasons.push(reason(rules, "age_unknown"));
    }

    if (typeof ctx.hops === "number" && ctx.hops > L.redirect_hops) {
      reasons.push(reason(rules, "many_redirects", { hops: ctx.hops }));
    }
    if (ctx.crossDomain && !ctx.fromShortener) {
      reasons.push(reason(rules, "cross_domain_redirect", { from: ctx.crossDomain.from, to: ctx.crossDomain.to }));
    }
    if (ctx.htmlRedirect) reasons.push(reason(rules, "html_redirect", { kind: ctx.htmlRedirect }));
    if (ctx.tlsError) reasons.push(reason(rules, "tls_error", { detail: ctx.tlsError }));
    if (ctx.unreachable) reasons.push(reason(rules, "unreachable", { detail: ctx.unreachable }));

    var download = ctx.download || info.downloadByExtension;
    if (download) reasons.push(reason(rules, "file_download", { file: download }));

    if (ctx.passwordForm && !info.official) {
      var young = typeof ctx.domainAgeDays !== "number" || ctx.domainAgeDays < L.age_new_days;
      if (young || info.freeHosting || info.isIP) reasons.push(reason(rules, "password_form"));
    }
    return reasons;
  }

  function payloadReasons(payload, rules) {
    var d = payload.data;
    switch (payload.type) {
      case "wifi":
        return [d.open ? reason(rules, "wifi_open", { ssid: d.ssid }) : reason(rules, "wifi_payload", { ssid: d.ssid })];
      case "sms": {
        var out = [reason(rules, "sms_payload", { number: d.number || "(inconnu)" })];
        var digits = d.number.replace(/^\+/, "");
        if (/^\d{4,6}$/.test(digits)) out.push(reason(rules, "sms_shortcode", { number: d.number }));
        else if (isPremium(d.number, rules)) out.push(reason(rules, "tel_premium", { number: d.number }));
        return out;
      }
      case "tel": {
        var r = [reason(rules, "tel_payload", { number: d.number })];
        if (isPremium(d.number, rules)) r.push(reason(rules, "tel_premium", { number: d.number }));
        return r;
      }
      case "email": return [reason(rules, "email_payload", { address: d.address })];
      case "crypto": return [reason(rules, "crypto_payment", { currency: d.currency })];
      case "vcard": return [reason(rules, "vcard_payload")];
      case "geo": return [reason(rules, "geo_payload")];
      default: return [reason(rules, "text_payload")];
    }
  }

  function isPremium(number, rules) {
    var n = cleanNumber(number);
    return rules.premium_phone_prefixes.some(function (p) { return n.indexOf(p) === 0; });
  }

  function verdictFor(score, force, rules) {
    if (force || score >= rules.thresholds.dangerous) return "dangereux";
    if (score >= rules.thresholds.suspect) return "suspect";
    return "sur";
  }

  /**
   * Analyse complète.
   * @param {string} raw  contenu brut du QR code
   * @param {object} rules  contenu de data/rules.json
   * @param {object} [ctx]  résultats réseau : { finalUrl, hops, crossDomain,
   *   fromShortener, htmlRedirect, tlsError, unreachable, blocklisted[],
   *   download, passwordForm, domainAgeDays, ageChecked, resolved }
   */
  function analyze(raw, rules, ctx) {
    ctx = ctx || {};
    var payload = parsePayload(raw);
    var reasons;
    var force = false;
    var target = null;
    var info = {};

    if (payload.type === "url") {
      target = ctx.finalUrl || payload.url;
      var st = analyzeUrl(target, rules, { resolvedShortener: !!ctx.resolved });
      // Si la destination finale diffère, on signale aussi un raccourcisseur au départ
      if (ctx.finalUrl && ctx.finalUrl !== payload.url) {
        var first = analyzeUrl(payload.url, rules, { resolvedShortener: true });
        first.reasons.forEach(function (r) {
          if (r.id === "shortener_resolved" || r.id === "dangerous_scheme") st.reasons.unshift(r);
        });
        if (first.forceDangerous) st.forceDangerous = true;
      }
      reasons = st.reasons.concat(contextReasons(ctx, st, rules));
      force = !!st.forceDangerous;
      info = st.info;
    } else {
      reasons = payloadReasons(payload, rules);
    }

    if (ctx.blocklisted && ctx.blocklisted.length) force = true;

    var score = reasons.reduce(function (s, r) { return s + r.points; }, 0);
    score = Math.max(0, Math.min(100, score));
    if (force) score = 100;

    return {
      verdict: verdictFor(score, force, rules),
      score: score,
      reasons: reasons,
      payload: payload,
      target: target,
      info: info
    };
  }

  return {
    analyze: analyze,
    analyzeUrl: analyzeUrl,
    parsePayload: parsePayload,
    registrableDomain: registrableDomain,
    isIPHost: isIPHost,
    keywordInHost: keywordInHost,
    verdictFor: verdictFor,
    _fmt: fmt
  };
});
