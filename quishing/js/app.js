/* QR Sentinel — interface web */
(function () {
    "use strict";

    var A = window.QuishingAnalyzer;
    var config = window.QUISHING_CONFIG || {};
    var state = { rules: null, api: null, stream: null, scanTimer: null, busy: false };

    var $ = function (id) { return document.getElementById(id); };

    var VERDICTS = {
        sur: {
            title: "Sûr",
            icon: "✓",
            advice: "Aucun signal d'alerte détecté. Reste prudent quand même : vérifie l'adresse avant de saisir des informations personnelles ou bancaires."
        },
        suspect: {
            title: "Suspect",
            icon: "!",
            advice: "Plusieurs éléments sont inhabituels. Ne saisis aucune information personnelle : tape plutôt toi-même l'adresse du site officiel."
        },
        dangereux: {
            title: "Dangereux",
            icon: "✕",
            advice: "N'ouvre pas ce lien. Si tu as déjà saisi des informations, change ton mot de passe et préviens ta banque."
        }
    };

    var TYPE_LABELS = {
        url: "Lien internet",
        wifi: "Connexion Wi-Fi",
        sms: "Envoi de SMS",
        tel: "Appel téléphonique",
        email: "E-mail",
        vcard: "Fiche de contact",
        geo: "Position GPS",
        crypto: "Paiement en cryptomonnaie",
        text: "Texte"
    };

    // ------------------------------------------------------------ démarrage

    function init() {
        bindTabs();
        bindImageInput();
        bindCamera();
        $("text-form").addEventListener("submit", function (e) {
            e.preventDefault();
            var v = $("text-input").value.trim();
            if (v) run(v);
        });
        document.querySelectorAll("[data-example]").forEach(function (b) {
            b.addEventListener("click", function () { run(b.getAttribute("data-example")); });
        });
        $("again-btn").addEventListener("click", reset);
        $("copy-btn").addEventListener("click", copyContent);

        loadRules().catch(function () {
            showError("Impossible de charger les règles d'analyse. Recharge la page.");
        });
        detectApi();
    }

    function loadRules() {
        return fetch("data/rules.json", { cache: "no-cache" })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (rules) { state.rules = rules; return rules; });
    }

    function timeoutFetch(url, options, ms) {
        var ctrl = typeof AbortController === "function" ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
        var opts = Object.assign({}, options || {});
        if (ctrl) opts.signal = ctrl.signal;
        return fetch(url, opts).finally(function () { clearTimeout(timer); });
    }

    function detectApi() {
        var candidates = [];
        if (config.apiUrl) candidates.push(String(config.apiUrl).replace(/\/+$/, "") + "/");
        candidates.push(""); // même origine (serveur qui héberge aussi la page)
        var tryNext = function (i) {
            if (i >= candidates.length) return setMode(null);
            var base = candidates[i];
            timeoutFetch(base + "api/health", {}, 5000)
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (data && data.ok) setMode(base); else tryNext(i + 1);
                })
                .catch(function () { tryNext(i + 1); });
        };
        tryNext(0);
    }

    function setMode(base) {
        state.api = base;
        var badge = $("mode-badge");
        if (base !== null) {
            badge.textContent = "Analyse complète";
            badge.className = "mode-badge full";
            badge.title = "Les redirections, l'âge du domaine et les listes noires sont vérifiés par le serveur.";
        } else {
            badge.textContent = "Analyse locale";
            badge.className = "mode-badge local";
            badge.title = "Serveur d'analyse indisponible : les redirections ne sont pas suivies.";
        }
    }

    // ----------------------------------------------------------------- onglets

    function bindTabs() {
        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.addEventListener("click", function () { selectTab(tab.getAttribute("data-tab")); });
        });
    }

    function selectTab(name) {
        document.querySelectorAll(".tab").forEach(function (t) {
            var on = t.getAttribute("data-tab") === name;
            t.classList.toggle("active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".panel").forEach(function (p) {
            p.hidden = p.getAttribute("data-panel") !== name;
        });
        if (name !== "camera") stopCamera();
        if (name === "text") $("text-input").focus();
    }

    // ------------------------------------------------------------------ images

    function bindImageInput() {
        var input = $("file-input");
        var zone = $("dropzone");
        input.addEventListener("change", function () {
            if (input.files && input.files[0]) decodeFile(input.files[0]);
            input.value = "";
        });
        ["dragenter", "dragover"].forEach(function (ev) {
            zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("drag"); });
        });
        ["dragleave", "drop"].forEach(function (ev) {
            zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("drag"); });
        });
        zone.addEventListener("drop", function (e) {
            var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) decodeFile(f);
        });
        document.addEventListener("paste", function (e) {
            var items = (e.clipboardData && e.clipboardData.items) || [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].type.indexOf("image/") === 0) {
                    e.preventDefault();
                    decodeFile(items[i].getAsFile());
                    return;
                }
            }
        });
    }

    function loadImage(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image illisible")); };
            img.src = url;
        });
    }

    function decodeFromSource(source, width, height) {
        var sizes = [1600, 1000, 600, 350];
        var canvas = document.createElement("canvas");
        var ctx = canvas.getContext("2d", { willReadFrequently: true });
        for (var i = 0; i < sizes.length; i++) {
            var scale = Math.min(1, sizes[i] / Math.max(width, height));
            if (i > 0 && scale === 1) continue;
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
            var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            var code = window.jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
            if (code && code.data) return code.data;
        }
        return null;
    }

    function decodeFile(file) {
        if (!file || file.type.indexOf("image/") !== 0) {
            return showError("Ce fichier n'est pas une image.");
        }
        showLoading("Lecture du QR code…", "Décodage de l'image sur ton appareil");
        loadImage(file).then(function (img) {
            var text = decodeFromSource(img, img.naturalWidth, img.naturalHeight);
            if (text === null) {
                showError("Aucun QR code trouvé sur cette image. Essaie une photo plus nette, bien cadrée et sans reflet.");
            } else {
                run(text);
            }
        }).catch(function () {
            showError("Impossible de lire cette image.");
        });
    }

    // ------------------------------------------------------------------ caméra

    function bindCamera() {
        $("camera-btn").addEventListener("click", function () {
            if (state.stream) stopCamera(); else startCamera();
        });
    }

    function startCamera() {
        var msg = $("camera-msg");
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            msg.textContent = "La caméra n'est pas disponible sur ce navigateur. Utilise l'onglet Image.";
            return;
        }
        msg.textContent = "Ouverture de la caméra…";
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
            .then(function (stream) {
                state.stream = stream;
                var video = $("video");
                video.srcObject = stream;
                return video.play();
            })
            .then(function () {
                $("camera-btn").textContent = "Arrêter la caméra";
                msg.textContent = "Place le QR code dans le cadre";
                scanLoop();
            })
            .catch(function (err) {
                stopCamera();
                msg.textContent = err && err.name === "NotAllowedError"
                    ? "Accès à la caméra refusé. Autorise-le dans les réglages du navigateur."
                    : "Impossible d'ouvrir la caméra.";
            });
    }

    function scanLoop() {
        var video = $("video");
        state.scanTimer = setInterval(function () {
            if (!state.stream || video.readyState < 2 || state.busy) return;
            var text = decodeFromSource(video, video.videoWidth, video.videoHeight);
            if (text !== null) {
                if (navigator.vibrate) navigator.vibrate(80);
                stopCamera();
                run(text);
            }
        }, 250);
    }

    function stopCamera() {
        if (state.scanTimer) clearInterval(state.scanTimer);
        state.scanTimer = null;
        if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); });
        state.stream = null;
        var btn = $("camera-btn");
        if (btn) btn.textContent = "Démarrer la caméra";
    }

    // ----------------------------------------------------------------- analyse

    function run(raw) {
        if (state.busy) return;
        state.busy = true;
        showLoading("Analyse en cours…", state.api !== null ? "Le serveur suit les redirections à ta place" : "Analyse du lien");
        var ready = state.rules ? Promise.resolve(state.rules) : loadRules();
        ready.then(function () {
            return state.api !== null ? analyzeRemote(raw).catch(function () { return analyzeLocal(raw, true); }) : analyzeLocal(raw, false);
        }).then(function (report) {
            render(raw, report);
        }).catch(function () {
            showError("L'analyse a échoué. Réessaie dans un instant.");
        }).finally(function () {
            state.busy = false;
        });
    }

    function analyzeRemote(raw) {
        return timeoutFetch(state.api + "api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload: raw.slice(0, 4096) })
        }, 40000).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
    }

    function rdapLookup(domain) {
        // L'âge du domaine peut être vérifié directement depuis le navigateur.
        $("loading-step").textContent = "Vérification de l'âge du domaine";
        return timeoutFetch("https://rdap.org/domain/" + encodeURIComponent(domain), {
            headers: { Accept: "application/rdap+json, application/json" },
            referrerPolicy: "no-referrer"
        }, 7000).then(function (r) {
            return r.ok ? r.json() : null;
        }).then(function (data) {
            if (!data) return null;
            var created = null;
            (data.events || []).forEach(function (ev) {
                if (!created && /^registr/i.test(ev.eventAction || "")) created = ev.eventDate;
            });
            var registrar = null;
            (data.entities || []).forEach(function (en) {
                if (!registrar && (en.roles || []).indexOf("registrar") !== -1) {
                    var v = (en.vcardArray && en.vcardArray[1]) || [];
                    v.forEach(function (item) { if (item[0] === "fn") registrar = item[3]; });
                    registrar = registrar || en.handle || null;
                }
            });
            var age = created ? Math.floor((Date.now() - Date.parse(created)) / 86400000) : null;
            return { domain: domain, created: created, age_days: isNaN(age) ? null : age, registrar: registrar, status: created ? "ok" : "date inconnue" };
        }).catch(function () { return null; });
    }

    function analyzeLocal(raw, serverFailed) {
        var rules = state.rules;
        var first = A.analyze(raw, rules, {});
        var network = { followed: false, serverFailed: !!serverFailed };
        var info = first.info || {};
        var canAge = first.payload.type === "url" && info.domain && !info.isIP && !info.freeHosting &&
            /^https?:/i.test(first.target || "");
        if (!canAge) {
            first.network = network;
            first.mode = "local";
            return Promise.resolve(first);
        }
        return rdapLookup(info.domain).then(function (rdap) {
            var report = A.analyze(raw, rules, {
                ageChecked: true,
                domainAgeDays: rdap && typeof rdap.age_days === "number" ? rdap.age_days : null
            });
            network.domain = rdap;
            report.network = network;
            report.mode = "local";
            return report;
        });
    }

    // ------------------------------------------------------------- affichage

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === "class") node.className = attrs[k]; else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function (c) {
            node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        });
        return node;
    }

    function render(raw, report) {
        hide("loading"); hide("error"); hide("input-card");
        var v = VERDICTS[report.verdict] || VERDICTS.suspect;

        var card = $("verdict");
        card.className = "card verdict " + report.verdict;
        card.querySelector(".verdict-icon").textContent = v.icon;
        $("verdict-title").textContent = v.title;
        var advice = v.advice;
        if (report.verdict === "sur" && report.payload.type === "url" && report.mode === "local") {
            advice += " Les redirections n'ont pas pu être suivies : la destination finale n'est pas vérifiée.";
        }
        $("verdict-advice").textContent = advice;
        $("score-value").textContent = String(report.score);
        $("score-fill").style.width = report.score + "%";
        $("score-fill").style.backgroundSize = (report.score ? (10000 / report.score) : 100) + "% 100%";

        // Le contenu est affiché comme du texte, jamais comme un lien cliquable.
        $("content-raw").textContent = raw;
        var typeLabel = TYPE_LABELS[report.payload.type] || "Contenu";
        $("content-type").textContent = "Type : " + typeLabel + (report.payload.data && report.payload.data.implicitScheme ? " (sans http:// ni https://)" : "");

        var net = report.network || {};
        var finalUrl = net.final_url && net.final_url !== net.start_url ? net.final_url : null;
        $("final-dest").hidden = !finalUrl;
        $("final-url").textContent = finalUrl || "";

        renderReasons(report.reasons);
        renderChain(report, net);
        renderChecks(report, net);

        show("result");
        $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function renderReasons(reasons) {
        var list = $("reasons");
        list.textContent = "";
        var sorted = reasons.slice().sort(function (a, b) { return b.points - a.points; });
        if (!sorted.length) {
            list.appendChild(el("li", { class: "empty" }, ["Aucun signal particulier."]));
            return;
        }
        var symbols = { danger: "!", warn: "!", good: "✓", info: "i" };
        sorted.forEach(function (r) {
            var pts = r.points > 0 ? "+" + r.points : r.points < 0 ? String(r.points) : "";
            list.appendChild(el("li", { class: r.level }, [
                el("span", { class: "dot", "aria-hidden": "true" }, [symbols[r.level] || "i"]),
                el("span", {}, [r.message]),
                el("span", { class: "pts" }, [pts])
            ]));
        });
    }

    function renderChain(report, net) {
        var list = $("chain");
        list.textContent = "";
        var card = $("chain-card");
        if (report.payload.type !== "url") { card.hidden = true; return; }
        card.hidden = false;
        if (!net.followed) {
            list.appendChild(el("li", {}, [
                el("code", {}, [report.target || report.payload.url]),
                el("span", { class: "hop-meta" }, [net.serverFailed
                    ? "Le serveur d'analyse n'a pas répondu : redirections non suivies."
                    : "Redirections non suivies en analyse locale."])
            ]));
            return;
        }
        (net.redirects || []).forEach(function (h) {
            var meta = [];
            if (h.status) meta.push("HTTP " + h.status);
            if (h.ip) meta.push(h.ip);
            var metaNode = el("span", { class: "hop-meta" }, [meta.join(" · ") || "non chargé"]);
            if (h.kind && h.kind !== "http") metaNode.appendChild(el("span", { class: "tag" }, [h.kind]));
            list.appendChild(el("li", {}, [el("code", {}, [h.url]), metaNode]));
        });
    }

    function renderChecks(report, net) {
        var dl = $("checks");
        dl.textContent = "";
        var add = function (label, value, cls) {
            dl.appendChild(el("dt", {}, [label]));
            dl.appendChild(el("dd", cls ? { class: cls } : {}, [value]));
        };
        var info = report.info || {};
        add("Mode", report.mode === "serveur" ? "Analyse complète" : "Analyse locale");
        if (report.payload.type !== "url") {
            add("Type", TYPE_LABELS[report.payload.type] || "Contenu");
            return;
        }
        if (info.isIP) add("Domaine", "aucun (adresse IP " + info.host + ")", "bad");
        else if (info.domain) add("Domaine", info.domain);

        var d = net.domain;
        if (d && d.created) {
            var date = new Date(d.created);
            var days = d.age_days;
            add("Créé le", date.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }) +
                (typeof days === "number" ? " (" + humanAge(days) + ")" : ""), typeof days === "number" && days < 180 ? "bad" : "ok");
        } else if (info.freeHosting) {
            add("Âge", "non applicable (hébergeur " + info.freeHosting + ")");
        } else if (!info.isIP) {
            add("Âge", "inconnu");
        }
        if (d && d.registrar) add("Registrar", d.registrar);
        if (net.title) add("Titre de la page", net.title);

        if (net.reputation && net.reputation.length) {
            net.reputation.forEach(function (s) {
                var cls = s.status === "listé" ? "bad" : s.status === "non listé" ? "ok" : "";
                add(s.source, s.status, cls);
            });
        } else {
            add("Listes noires", report.mode === "serveur" ? "aucune source configurée" : "non vérifiées (mode local)");
        }
    }

    function humanAge(days) {
        if (days < 1) return "aujourd'hui";
        if (days < 60) return days + " jour" + (days > 1 ? "s" : "");
        if (days < 730) return Math.floor(days / 30) + " mois";
        return Math.floor(days / 365) + " ans";
    }

    function copyContent() {
        var text = $("content-raw").textContent;
        var done = function () {
            $("copy-btn").textContent = "Copié";
            setTimeout(function () { $("copy-btn").textContent = "Copier"; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () {});
        }
    }

    // ------------------------------------------------------------------ états

    function show(id) { $(id).hidden = false; }
    function hide(id) { $(id).hidden = true; }

    function showLoading(title, step) {
        hide("error"); hide("result");
        $("loading-title").textContent = title;
        $("loading-step").textContent = step;
        show("loading");
    }

    function showError(message) {
        state.busy = false;
        hide("loading");
        $("error").textContent = message;
        show("error");
        show("input-card");
    }

    function reset() {
        hide("result"); hide("error"); hide("loading");
        show("input-card");
        $("text-input").value = "";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
