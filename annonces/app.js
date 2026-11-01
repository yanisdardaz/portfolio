/* ============================================================
   VITRINE — Plateforme de petites annonces
   Annonces · Coordonnées · Paiement direct · VIP · Notes
   ============================================================ */
(() => {
  "use strict";

  const CFG = window.VITRINE_CONFIG;
  const STORE_KEY = "vitrine_ads_v1";
  const OWNER_KEY = "vitrine_owner_v1";
  const PENDING_KEY = "vitrine_pending_vip";
  const DAY = 86400000;

  const CATEGORIES = [
    { id: "vehicules", name: "Véhicules", icon: "🚗", colors: ["#0ea5e9", "#1e3a8a"] },
    { id: "immobilier", name: "Immobilier", icon: "🏠", colors: ["#10b981", "#065f46"] },
    { id: "tech", name: "High-tech", icon: "💻", colors: ["#6366f1", "#312e81"] },
    { id: "maison", name: "Maison", icon: "🛋️", colors: ["#f97316", "#7c2d12"] },
    { id: "mode", name: "Mode", icon: "👟", colors: ["#ec4899", "#831843"] },
    { id: "services", name: "Services", icon: "🛠️", colors: ["#14b8a6", "#134e4a"] },
    { id: "emploi", name: "Emploi", icon: "💼", colors: ["#8b5cf6", "#4c1d95"] },
    { id: "loisirs", name: "Loisirs", icon: "🎮", colors: ["#ef4444", "#7f1d1d"] },
  ];
  const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];

  /* ---------------- Utils ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const money = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: CFG.currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const isVip = (ad) => ad.vipUntil && ad.vipUntil > Date.now();
  const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const safeUrl = (u) => { try { const x = new URL(u); return ["http:", "https:"].includes(x.protocol) ? x.href : ""; } catch { return ""; } };

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "à l'instant";
    const m = Math.floor(s / 60); if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60); if (h < 24) return `il y a ${h} h`;
    const d = Math.floor(h / 24); if (d < 30) return `il y a ${d} j`;
    return new Date(ts).toLocaleDateString("fr-FR");
  }
  function timeLeft(ts) {
    const ms = ts - Date.now();
    if (ms <= 0) return "expiré";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h >= 24 ? `${Math.floor(h / 24)} j ${h % 24} h` : `${h} h ${String(m).padStart(2, "0")} min`;
  }
  function avg(ad) {
    if (!ad.reviews?.length) return 0;
    return ad.reviews.reduce((a, r) => a + r.stars, 0) / ad.reviews.length;
  }
  function stars(v) {
    const r = Math.round(v);
    return `<span class="stars" aria-label="${v.toFixed(1)} sur 5">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= r ? "on" : ""}">★</span>`).join("")}</span>`;
  }
  function ratingHtml(ad) {
    const n = ad.reviews?.length || 0;
    if (!n) return `<span class="rating">${stars(0)} <span>Nouveau</span></span>`;
    return `<span class="rating">${stars(avg(ad))} <b>${avg(ad).toFixed(1)}</b> (${n})</span>`;
  }

  /* Placeholder visuel (SVG) par catégorie */
  function placeholder(catId, variant = 0) {
    const c = catById(catId);
    const angle = [135, 45, 200][variant % 3];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${c.colors[0]}"/><stop offset="1" stop-color="${c.colors[1]}"/></linearGradient></defs>
      <rect width="800" height="600" fill="url(#g)"/>
      <circle cx="${650 - variant * 120}" cy="${110 + variant * 60}" r="170" fill="white" opacity=".08"/>
      <circle cx="${120 + variant * 90}" cy="520" r="210" fill="white" opacity=".06"/>
      <text x="400" y="345" font-size="190" text-anchor="middle" dominant-baseline="middle">${c.icon}</text></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  const cover = (ad) => ad.images?.[0] || placeholder(ad.category);

  /* ---------------- Store ---------------- */
  const owner = (() => {
    let o = null;
    try { o = localStorage.getItem(OWNER_KEY); } catch {}
    if (!o) { o = uid(); try { localStorage.setItem(OWNER_KEY, o); } catch {} }
    return o;
  })();

  let ads = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return seed();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(ads)); return true; }
    catch { toast("Stockage plein : retire quelques photos.", "err"); return false; }
  }
  const getAd = (id) => ads.find((a) => a.id === id);
  const mine = () => ads.filter((a) => a.owner === owner);

  function seed() {
    const now = Date.now();
    const R = (name, s, c, d) => ({ name, stars: s, comment: c, date: now - d * DAY });
    const base = [
      { title: "Peugeot 208 GT Line 2021 — 32 000 km", category: "vehicules", price: 15900, city: "Paris", vip: 20,
        description: "Première main, carnet d'entretien complet, jamais accidentée.\nBoîte auto, CarPlay, caméra de recul, toit panoramique.\nContrôle technique OK.",
        seller: { name: "Karim B.", phone: "06 12 34 56 78", email: "karim.b@example.com" },
        reviews: [R("Sofiane", 5, "Vendeur sérieux, voiture conforme à l'annonce.", 3), R("Léa", 5, "Très réactif, je recommande.", 9), R("Marc", 4, "Bonne transaction.", 20)] },
      { title: "iPhone 15 Pro 256 Go Titane naturel", category: "tech", price: 899, city: "Lyon", vip: 9,
        description: "Acheté en janvier, sous garantie Apple jusqu'en 2027. Batterie 96 %.\nVendu avec boîte, câble et coque MagSafe.",
        seller: { name: "Inès M.", phone: "07 22 33 44 55", email: "ines.m@example.com" },
        reviews: [R("Thomas", 5, "Impeccable, comme neuf !", 2), R("Nadia", 5, "Envoi rapide et soigné.", 6)] },
      { title: "T2 lumineux 45 m² — balcon, proche métro", category: "immobilier", price: 1150, city: "Marseille",
        description: "Location — 1 150 €/mois charges comprises.\nCuisine équipée, parquet, double vitrage. 3e étage avec ascenseur.\nDisponible le 1er du mois.",
        seller: { name: "Agence Sud Habitat", phone: "04 91 00 11 22", email: "contact@example.com" },
        reviews: [R("Julie", 4, "Visite bien organisée.", 12)] },
      { title: "Canapé d'angle convertible gris — très bon état", category: "maison", price: 320, city: "Créteil",
        description: "Canapé 5 places, tissu déhoussable, coffre de rangement. Non-fumeur, pas d'animaux. À récupérer sur place.",
        seller: { name: "Yasmine A.", phone: "06 98 76 54 32", email: "yasmine.a@example.com" },
        reviews: [R("Hugo", 5, "Super état, vendeuse adorable.", 4), R("Amine", 4, "RAS, merci.", 15)] },
      { title: "Nike Air Max 90 — pointure 43, neuves", category: "mode", price: 95, city: "Bordeaux",
        description: "Jamais portées, avec boîte et ticket. Coloris blanc / gris infrarouge.",
        seller: { name: "Dylan R.", phone: "06 55 44 33 22", email: "dylan.r@example.com" }, reviews: [] },
      { title: "Plombier / Chauffagiste — intervention 7j/7", category: "services", price: 60, city: "Vitry-sur-Seine",
        description: "Dépannage fuite, chauffe-eau, clim, débouchage. Devis gratuit. Prix indiqué : déplacement.\nArtisan certifié, 10 ans d'expérience.",
        seller: { name: "Rachid Services", phone: "06 01 02 03 04", email: "rachid.services@example.com" },
        reviews: [R("Claire", 5, "Intervention rapide un dimanche !", 1), R("Omar", 5, "Pro et honnête.", 8), R("Sarah", 4, "Bon travail.", 30)] },
      { title: "PS5 Slim + 2 manettes + 3 jeux", category: "loisirs", price: 420, city: "Lille",
        description: "Console en parfait état, jeux : EA FC 25, Spider-Man 2, GTA V.",
        seller: { name: "Nassim K.", phone: "07 11 22 33 44", email: "nassim.k@example.com" },
        reviews: [R("Kevin", 3, "Correct, un peu de retard au rdv.", 5)] },
      { title: "Développeur web freelance — sites vitrines", category: "emploi", price: 450, city: "Télétravail",
        description: "Création de sites modernes et responsives, à partir de 450 €. Livraison en 7 jours, hébergement inclus la 1re année.",
        seller: { name: "Studio Pixel", phone: "06 77 88 99 00", email: "hello@example.com" },
        reviews: [R("Mehdi", 5, "Site livré en avance, top.", 10)] },
      { title: "MacBook Air M2 13\" 8/256 Go — minuit", category: "tech", price: 780, city: "Toulouse",
        description: "Utilisé pour les études, aucune rayure, 112 cycles de batterie. Chargeur d'origine fourni.",
        seller: { name: "Camille D.", phone: "06 44 55 66 77", email: "camille.d@example.com" }, reviews: [R("Paul", 5, "Parfait.", 2)] },
      { title: "Vélo électrique Decathlon E-ST 500", category: "vehicules", price: 650, city: "Nantes",
        description: "Autonomie 50 km, batterie récente. Révisé il y a un mois. Antivol offert.",
        seller: { name: "Élodie F.", phone: "06 33 22 11 00", email: "elodie.f@example.com" }, reviews: [] },
    ];
    return base.map((b, i) => ({
      id: "seed" + i, owner: "seed", ...b, images: [], payLink: "",
      createdAt: now - (i * 7 + 2) * 3600000, views: 40 + ((i * 37) % 300),
      vipUntil: b.vip ? now + b.vip * 3600000 : 0, vip: undefined,
    }));
  }

  /* ---------------- UI helpers ---------------- */
  function toast(msg, type = "") {
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.textContent = msg;
    $("#toast-root").appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function modal(title, body, onMount) {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${title}</h3><button class="modal-close" aria-label="Fermer">✕</button></div>
      <div class="modal-body">${body}</div></div></div>`;
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $(".modal-close", root).onclick = close;
    $(".modal-backdrop", root).onclick = (e) => { if (e.target === e.currentTarget) close(); };
    onMount?.($(".modal", root), close);
    return close;
  }

  function confirmBox(msg, onYes) {
    modal("Confirmation", `<p style="margin-bottom:18px">${esc(msg)}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-ghost" id="c-no">Annuler</button><button class="btn btn-danger" id="c-yes">Supprimer</button></div>`,
      (m, close) => { $("#c-no", m).onclick = close; $("#c-yes", m).onclick = () => { close(); onYes(); }; });
  }

  /* ---------------- Paiement (Stripe ou démo) ---------------- */
  function luhn(num) {
    let sum = 0, dbl = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = +num[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return num.length >= 13 && sum % 10 === 0;
  }

  function checkout({ title, amount, lines = [], onSuccess }) {
    const body = `
      <div class="demo-note">🔒 <b>Mode démo</b> — aucun débit réel. Carte test : <b>4242 4242 4242 4242</b>, date future, CVC au choix.</div>
      ${lines.map(([l, v]) => `<div class="summary-line"><span class="muted">${esc(l)}</span><span>${esc(v)}</span></div>`).join("")}
      <div class="summary-line summary-total"><span>Total</span><span>${money(amount)}</span></div>
      <form id="pay-form" style="margin-top:18px" novalidate>
        <div class="field"><label>E-mail</label><input type="email" name="email" placeholder="toi@exemple.com" required></div>
        <div class="field"><label>Carte bancaire</label>
          <div class="card-input">
            <input name="num" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" maxlength="19">
            <input name="exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM / AA" maxlength="7">
            <input name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" maxlength="4">
          </div></div>
        <div class="field"><label>Nom sur la carte</label><input name="holder" placeholder="Prénom Nom" required></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Payer ${money(amount)}</button>
        <div class="stripe-badge">🔒 Démo : aucune donnée bancaire n'est envoyée ni enregistrée</div>
      </form>`;
    modal(esc(title), body, (m, close) => {
      const f = $("#pay-form", m);
      f.num.addEventListener("input", () => { f.num.value = f.num.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim(); });
      f.exp.addEventListener("input", () => { const v = f.exp.value.replace(/\D/g, "").slice(0, 4); f.exp.value = v.length > 2 ? v.slice(0, 2) + " / " + v.slice(2) : v; });
      f.cvc.addEventListener("input", () => { f.cvc.value = f.cvc.value.replace(/\D/g, "").slice(0, 4); });
      f.onsubmit = (e) => {
        e.preventDefault();
        const num = f.num.value.replace(/\s/g, "");
        const [mm, yy] = f.exp.value.split(" / ").map(Number);
        const expOk = mm >= 1 && mm <= 12 && yy && new Date(2000 + yy, mm) > new Date();
        if (!/^\S+@\S+\.\S+$/.test(f.email.value)) return toast("E-mail invalide", "err");
        if (!luhn(num)) return toast("Numéro de carte invalide", "err");
        if (!expOk) return toast("Date d'expiration invalide", "err");
        if (f.cvc.value.length < 3) return toast("CVC invalide", "err");
        if (!f.holder.value.trim()) return toast("Nom requis", "err");
        const btn = $("button[type=submit]", f);
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> Traitement…`;
        setTimeout(() => {
          $(".modal-body", m).innerHTML = `<div class="success-anim"><div class="check-circle">✓</div>
            <h3>Paiement confirmé</h3><p class="muted" style="margin:6px 0 18px">${money(amount)} — reçu envoyé à ${esc(f.email.value)}</p>
            <button class="btn btn-primary btn-block" id="done">Continuer</button></div>`;
          $("#done", m).onclick = () => { close(); onSuccess?.(); };
        }, 1400);
      };
    });
  }

  function buyVip(adId, planId) {
    const ad = getAd(adId), plan = CFG.vipPlans.find((p) => p.id === planId);
    if (!ad || !plan) return toast("Choisis une annonce et une offre", "err");
    if (plan.stripeLink) {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify({ adId, planId, at: Date.now() })); } catch {}
      const u = new URL(plan.stripeLink);
      u.searchParams.set("client_reference_id", adId);
      location.href = u.href;
      return;
    }
    checkout({
      title: "Passer en VIP ♛", amount: plan.price,
      lines: [["Annonce", ad.title.slice(0, 32) + (ad.title.length > 32 ? "…" : "")], ["Offre", plan.label]],
      onSuccess: () => { applyVip(adId, plan.days); location.hash = "#annonce-" + adId; },
    });
  }
  function applyVip(adId, days) {
    const ad = getAd(adId);
    if (!ad) return;
    ad.vipUntil = Math.max(Date.now(), ad.vipUntil || 0) + days * DAY;
    save();
    toast(`♛ Annonce VIP pendant ${days} jour${days > 1 ? "s" : ""} !`, "ok");
  }

  /* ---------------- Cards ---------------- */
  function card(ad) {
    const c = catById(ad.category), vip = isVip(ad);
    return `<article class="card ${vip ? "vip" : ""}" data-id="${esc(ad.id)}" tabindex="0">
      <div class="card-media">
        <img src="${esc(cover(ad))}" alt="" loading="lazy">
        <div class="card-badges">${vip ? `<span class="pill pill-vip">♛ VIP</span>` : ""}<span class="pill pill-cat">${c.icon} ${esc(c.name)}</span></div>
      </div>
      <div class="card-body">
        <div class="card-price">${money(ad.price)}</div>
        <div class="card-title">${esc(ad.title)}</div>
        ${ratingHtml(ad)}
        <div class="card-meta"><span>📍 ${esc(ad.city)}</span><span>${timeAgo(ad.createdAt)}</span></div>
      </div></article>`;
  }
  function bindCards(root) {
    $$(".card[data-id]", root).forEach((el) => {
      const go = () => (location.hash = "#annonce-" + el.dataset.id);
      el.onclick = go;
      el.onkeydown = (e) => { if (e.key === "Enter") go(); };
    });
  }

  /* ---------------- Pages ---------------- */
  const state = { q: "", cat: "", city: "", sort: "recent", maxPrice: "" };

  function pageHome() {
    const vipAds = ads.filter(isVip);
    const cities = [...new Set(ads.map((a) => a.city))].sort();
    app.innerHTML = `
      <section class="hero">
        <h1>Achetez, vendez, <span>brillez.</span></h1>
        <p>Des milliers d'annonces près de chez vous. Contactez le vendeur ou payez directement en toute sécurité.</p>
        <div class="hero-stats">
          <div><b>${ads.length}</b><span>annonces en ligne</span></div>
          <div><b>${vipAds.length}</b><span>annonces VIP</span></div>
          <div><b>${ads.reduce((n, a) => n + (a.reviews?.length || 0), 0)}</b><span>avis vérifiés</span></div>
        </div>
        <form class="searchbar" id="search">
          <input name="q" placeholder="Que recherchez-vous ?" value="${esc(state.q)}">
          <select name="city"><option value="">Toutes les villes</option>${cities.map((c) => `<option ${c === state.city ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
          <input name="maxPrice" type="number" min="0" placeholder="Prix max (€)" value="${esc(state.maxPrice)}">
          <button class="btn btn-primary">Rechercher</button>
        </form>
      </section>
      <div class="cats">
        <button class="cat ${!state.cat ? "active" : ""}" data-cat="">✨ Tout</button>
        ${CATEGORIES.map((c) => `<button class="cat ${state.cat === c.id ? "active" : ""}" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join("")}
      </div>
      <div id="vip-section"></div>
      <div class="toolbar">
        <h2 id="count"></h2>
        <select id="sort">
          <option value="recent">Plus récentes</option>
          <option value="price-asc">Prix croissant</option>
          <option value="price-desc">Prix décroissant</option>
          <option value="rating">Mieux notées</option>
        </select>
      </div>
      <div id="results"></div>`;
    $("#sort").value = state.sort;

    const render = () => {
      const q = state.q.toLowerCase().trim();
      let list = ads.filter((a) =>
        (!state.cat || a.category === state.cat) &&
        (!state.city || a.city === state.city) &&
        (!state.maxPrice || a.price <= +state.maxPrice) &&
        (!q || (a.title + " " + a.description + " " + a.city).toLowerCase().includes(q)));
      const sorters = {
        recent: (a, b) => b.createdAt - a.createdAt,
        "price-asc": (a, b) => a.price - b.price,
        "price-desc": (a, b) => b.price - a.price,
        rating: (a, b) => avg(b) - avg(a) || b.reviews.length - a.reviews.length,
      };
      // Les VIP passent toujours au-dessus de tout le monde
      list.sort((a, b) => (isVip(b) - isVip(a)) || sorters[state.sort](a, b));

      const vipHere = list.filter(isVip);
      $("#vip-section").innerHTML = vipHere.length ? `
        <div class="section-title"><span class="pill pill-vip">♛ VIP</span> À la une aujourd'hui
          <a href="#vip" class="muted small" style="margin-left:auto;font-weight:500">Mettre mon annonce ici →</a></div>` : "";
      $("#count").textContent = `${list.length} annonce${list.length > 1 ? "s" : ""}`;
      $("#results").innerHTML = list.length
        ? `<div class="grid">${list.map(card).join("")}</div>`
        : `<div class="empty"><div class="icon">🔍</div><h3>Aucune annonce trouvée</h3><p class="muted">Essaie d'élargir ta recherche.</p>
           <a href="#publier" class="btn btn-primary">Déposer la première</a></div>`;
      bindCards($("#results"));
    };

    $("#search").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      Object.assign(state, { q: f.q.value, city: f.city.value, maxPrice: f.maxPrice.value });
      render();
      $("#count").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    $("#search").q.oninput = (e) => { state.q = e.target.value; render(); };
    $$(".cat").forEach((b) => (b.onclick = () => {
      state.cat = b.dataset.cat;
      $$(".cat").forEach((x) => x.classList.toggle("active", x === b));
      render();
    }));
    $("#sort").onchange = (e) => { state.sort = e.target.value; render(); };
    render();
  }

  function pageDetail(id) {
    const ad = getAd(id);
    if (!ad) return notFound();
    let seen = false; try { seen = !!sessionStorage.getItem("v_" + id); sessionStorage.setItem("v_" + id, 1); } catch {}
    if (!seen) { ad.views = (ad.views || 0) + 1; save(); }
    const c = catById(ad.category), vip = isVip(ad), a = avg(ad), n = ad.reviews.length;
    const imgs = ad.images.length ? ad.images : [placeholder(ad.category, 0), placeholder(ad.category, 1), placeholder(ad.category, 2)];
    const isMine = ad.owner === owner;
    const dist = [5, 4, 3, 2, 1].map((s) => ad.reviews.filter((r) => r.stars === s).length);
    const pay = safeUrl(ad.payLink);

    app.innerHTML = `
      <div class="breadcrumb"><a href="#">Annonces</a> › <a href="#" data-cat="${c.id}">${esc(c.name)}</a> › ${esc(ad.title.slice(0, 40))}</div>
      <div class="detail">
        <div>
          <div class="gallery-main">
            <img id="main-img" src="${esc(imgs[0])}" alt="${esc(ad.title)}">
            <div class="card-badges">${vip ? `<span class="pill pill-vip">♛ VIP</span>` : ""}</div>
          </div>
          ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) => `<img src="${esc(src)}" data-i="${i}" class="${i ? "" : "active"}" alt="">`).join("")}</div>` : ""}

          <h1>${esc(ad.title)}</h1>
          <div class="price-big">${money(ad.price)}</div>
          <div class="meta-row">
            <span>📍 ${esc(ad.city)}</span><span>${c.icon} ${esc(c.name)}</span>
            <span>🕒 ${timeAgo(ad.createdAt)}</span><span>👁 ${ad.views} vue${ad.views > 1 ? "s" : ""}</span>
            ${vip ? `<span class="pill pill-vip">♛ VIP encore ${timeLeft(ad.vipUntil)}</span>` : ""}
          </div>
          <div class="panel"><h3 style="margin-bottom:10px">Description</h3><p class="desc">${esc(ad.description)}</p></div>

          <div class="panel" style="margin-top:20px" id="reviews">
            <h3 style="margin-bottom:16px">Avis & notes</h3>
            <div class="reviews-head">
              <div><div class="big-score">${n ? a.toFixed(1) : "—"}</div>${stars(a)}<div class="muted small">${n} avis</div></div>
              <div class="bars">${dist.map((d, i) => `<div class="bar"><span>${5 - i} ★</span><div class="bar-track"><div class="bar-fill" style="width:${n ? (d / n) * 100 : 0}%"></div></div><span>${d}</span></div>`).join("")}</div>
            </div>
            ${isMine ? `<p class="muted small" style="margin-bottom:12px">Tu ne peux pas noter ta propre annonce.</p>` : `
            <form id="review-form" style="margin-bottom:10px">
              <div class="field"><label>Ta note</label>
                <div class="star-input">${[5, 4, 3, 2, 1].map((s) => `<input type="radio" id="s${s}" name="stars" value="${s}"><label for="s${s}" title="${s} étoile${s > 1 ? "s" : ""}">★</label>`).join("")}</div>
              </div>
              <div class="row-2">
                <div class="field"><label>Ton prénom</label><input name="name" maxlength="40" required placeholder="Ex : Sarah"></div>
                <div class="field"><label>Commentaire</label><input name="comment" maxlength="300" placeholder="Ton expérience avec ce vendeur"></div>
              </div>
              <button class="btn btn-ghost">Publier mon avis</button>
            </form>`}
            ${ad.reviews.slice().sort((x, y) => y.date - x.date).map((r) => `
              <div class="review"><div class="review-top"><div style="display:flex;gap:10px;align-items:center">
                <div class="avatar" style="width:34px;height:34px;font-size:.8rem">${esc(initials(r.name))}</div>
                <div><b>${esc(r.name)}</b><div>${stars(r.stars)}</div></div></div>
                <span class="muted small">${timeAgo(r.date)}</span></div>
                ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</div>`).join("") || `<p class="muted">Aucun avis pour l'instant. Sois le premier !</p>`}
          </div>
        </div>

        <aside class="side">
          <div class="panel">
            <div class="seller">
              <div class="avatar">${esc(initials(ad.seller.name))}</div>
              <div><b>${esc(ad.seller.name)}</b>${ratingHtml(ad)}</div>
            </div>
            <div class="contact-box">
              <button class="btn btn-primary btn-block btn-lg" id="show-contact">📞 Voir les coordonnées</button>
              <div id="contact" class="contact-box hidden">
                ${ad.seller.phone ? `<a class="contact-line" href="tel:${esc(ad.seller.phone.replace(/\s/g, ""))}">📞 ${esc(ad.seller.phone)}</a>` : ""}
                ${ad.seller.email ? `<a class="contact-line" href="mailto:${esc(ad.seller.email)}?subject=${encodeURIComponent("Annonce : " + ad.title)}">✉️ ${esc(ad.seller.email)}</a>` : ""}
                ${ad.seller.phone ? `<a class="contact-line" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(ad.seller.phone))}?text=${encodeURIComponent("Bonjour, votre annonce « " + ad.title + " » est-elle toujours disponible ?")}">💬 WhatsApp</a>` : ""}
              </div>
              ${pay ? `<a class="btn btn-success btn-block btn-lg" id="pay" href="${esc(pay)}" target="_blank" rel="noopener">💳 Payer ${money(ad.price)}</a>` : `<button class="btn btn-success btn-block btn-lg" id="pay">💳 Payer ${money(ad.price)}</button>`}
            </div>
            <div class="secure">🛡️ ${pay ? "Paiement via le lien sécurisé du vendeur." : "Paiement sécurisé. Ne payez jamais par mandat cash."}</div>
          </div>
          ${isMine ? `
          <div class="panel vip-promo">
            <h4>♛ ${vip ? "Ton annonce est VIP" : "Booste ton annonce"}</h4>
            <p class="muted small" style="margin-bottom:12px">${vip ? `Encore ${timeLeft(ad.vipUntil)} en tête des résultats. Prolonge pour rester au-dessus.` : "Passe au-dessus de toutes les annonces dès 2,99 €/jour."}</p>
            <a href="#vip-${esc(ad.id)}" class="btn btn-gold btn-block">${vip ? "Prolonger le VIP" : "Passer en VIP"}</a>
          </div>
          <button class="btn btn-danger btn-block" id="del">Supprimer l'annonce</button>` : `
          <div class="panel"><h4 style="margin-bottom:6px">Conseils de sécurité</h4>
            <p class="muted small">Rencontrez le vendeur dans un lieu public, vérifiez l'article avant de payer et privilégiez le paiement sécurisé.</p></div>`}
        </aside>
      </div>`;

    $$(".thumbs img").forEach((t) => (t.onclick = () => {
      $("#main-img").src = t.src;
      $$(".thumbs img").forEach((x) => x.classList.toggle("active", x === t));
    }));
    $(".breadcrumb [data-cat]").onclick = () => { state.cat = c.id; };
    $("#show-contact").onclick = (e) => { e.currentTarget.classList.add("hidden"); $("#contact").classList.remove("hidden"); };
    $("#pay").onclick = () => {
      if (pay) return;
      checkout({ title: "Payer le vendeur", amount: ad.price, lines: [["Article", ad.title.slice(0, 34)], ["Vendeur", ad.seller.name]],
        onSuccess: () => toast("Le vendeur a été notifié de ton paiement ✓", "ok") });
    };
    const rf = $("#review-form");
    if (rf) rf.onsubmit = (e) => {
      e.preventDefault();
      const s = +(rf.querySelector("input[name=stars]:checked")?.value || 0);
      if (!s) return toast("Choisis une note de 1 à 5 étoiles", "err");
      if (!rf.name.value.trim()) return toast("Indique ton prénom", "err");
      ad.reviews.push({ name: rf.name.value.trim(), stars: s, comment: rf.comment.value.trim(), date: Date.now() });
      save();
      toast("Merci pour ton avis ⭐", "ok");
      pageDetail(id);
      $("#reviews").scrollIntoView({ behavior: "smooth" });
    };
    const del = $("#del");
    if (del) del.onclick = () => {
      confirmBox("Supprimer définitivement cette annonce ?", () => {
        ads = ads.filter((x) => x.id !== id); save();
        toast("Annonce supprimée"); location.hash = "#mes-annonces";
      });
    };
  }
  const waNumber = (p) => { const d = p.replace(/\D/g, ""); return d.startsWith("0") ? "33" + d.slice(1) : d; };

  function pagePost() {
    let images = [];
    app.innerHTML = `
      <div class="page-head"><h1>Déposer une annonce</h1><p class="muted">Gratuit, en ligne en 1 minute.</p></div>
      <form id="post" class="form-layout" novalidate>
        <div>
          <div class="panel form-section">
            <h3><span class="num">1</span> Ton annonce</h3>
            <div class="field"><label>Titre</label><input name="title" maxlength="80" required placeholder="Ex : iPhone 14 128 Go très bon état"></div>
            <div class="row-2">
              <div class="field"><label>Catégorie</label><select name="category" required>${CATEGORIES.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("")}</select></div>
              <div class="field"><label>Prix (€)</label><input name="price" type="number" min="0" step="0.01" required placeholder="0"></div>
            </div>
            <div class="field"><label>Ville</label><input name="city" maxlength="40" required placeholder="Ex : Paris"></div>
            <div class="field"><label>Description</label><textarea name="description" maxlength="3000" required placeholder="État, caractéristiques, raison de la vente…"></textarea></div>
          </div>
          <div class="panel form-section">
            <h3><span class="num">2</span> Photos <span class="muted small" style="font-weight:400">(jusqu'à 6)</span></h3>
            <label class="dropzone" id="drop"><input type="file" id="files" accept="image/*" multiple hidden>
              <div style="font-size:2rem">📷</div><b>Ajoute des photos</b><div class="muted small">Glisse-dépose ou clique ici</div></label>
            <div class="previews" id="previews"></div>
          </div>
          <div class="panel form-section">
            <h3><span class="num">3</span> Tes coordonnées</h3>
            <div class="field"><label>Nom affiché</label><input name="sname" maxlength="40" required placeholder="Ex : Yanis D."></div>
            <div class="row-2">
              <div class="field"><label>Téléphone</label><input name="phone" type="tel" maxlength="20" placeholder="06 12 34 56 78"></div>
              <div class="field"><label>E-mail</label><input name="email" type="email" maxlength="80" placeholder="toi@exemple.com"></div>
            </div>
            <div class="field"><label>Lien de paiement <span class="opt">(optionnel)</span></label>
              <input name="payLink" type="url" placeholder="https://paypal.me/tonpseudo ou lien Stripe / Lydia">
              <span class="hint">Les acheteurs pourront te payer directement via ce lien.</span></div>
          </div>
        </div>
        <aside class="side">
          <div class="panel">
            <h3 style="margin-bottom:12px">Aperçu</h3>
            <div id="preview-card"></div>
          </div>
          <label class="check vip-promo"><input type="checkbox" name="wantVip">
            <div><b>♛ Mettre en VIP</b><div class="muted small">Ton annonce au-dessus de toutes les autres, dès ${money(CFG.vipPlans[0].price)}/jour.</div></div></label>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Publier l'annonce</button>
        </aside>
      </form>`;

    const f = $("#post");
    const draft = () => ({
      id: "preview", title: f.title.value || "Titre de ton annonce", category: f.category.value,
      price: +f.price.value || 0, city: f.city.value || "Ville", createdAt: Date.now(), images, reviews: [],
      vipUntil: f.wantVip.checked ? Date.now() + DAY : 0,
    });
    const refresh = () => { $("#preview-card").innerHTML = card(draft()); };
    f.addEventListener("input", refresh);
    refresh();

    const renderPreviews = () => {
      $("#previews").innerHTML = images.map((src, i) => `<div class="preview"><img src="${src}" alt=""><button type="button" data-i="${i}" aria-label="Retirer">✕</button></div>`).join("");
      $$("#previews button").forEach((b) => (b.onclick = () => { images.splice(+b.dataset.i, 1); renderPreviews(); refresh(); }));
    };
    const addFiles = async (files) => {
      for (const file of [...files].filter((x) => x.type.startsWith("image/"))) {
        if (images.length >= 6) { toast("6 photos maximum", "err"); break; }
        try { images.push(await compress(file)); } catch { toast("Image illisible", "err"); }
      }
      renderPreviews(); refresh();
    };
    $("#files").onchange = (e) => addFiles(e.target.files);
    const drop = $("#drop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
    drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

    f.onsubmit = (e) => {
      e.preventDefault();
      const v = (n) => f[n].value.trim();
      if (v("title").length < 4) return toast("Titre trop court", "err");
      if (f.price.value === "" || +f.price.value < 0) return toast("Indique un prix", "err");
      if (!v("city")) return toast("Indique une ville", "err");
      if (v("description").length < 10) return toast("Ajoute une description (10 caractères min.)", "err");
      if (!v("sname")) return toast("Indique ton nom", "err");
      if (!v("phone") && !v("email")) return toast("Ajoute au moins un téléphone ou un e-mail", "err");
      if (v("email") && !/^\S+@\S+\.\S+$/.test(v("email"))) return toast("E-mail invalide", "err");
      if (v("payLink") && !safeUrl(v("payLink"))) return toast("Lien de paiement invalide (https://…)", "err");
      const ad = {
        id: uid(), owner, title: v("title"), category: f.category.value, price: Math.round(+f.price.value * 100) / 100,
        city: v("city"), description: v("description"), images,
        seller: { name: v("sname"), phone: v("phone"), email: v("email") }, payLink: v("payLink"),
        createdAt: Date.now(), views: 0, vipUntil: 0, reviews: [],
      };
      ads.unshift(ad);
      if (!save()) { ads.shift(); return; }
      toast("Annonce publiée 🎉", "ok");
      location.hash = f.wantVip.checked ? "#vip-" + ad.id : "#annonce-" + ad.id;
    };
  }

  function compress(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1000, scale = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }

  function pageVip(preselect) {
    const my = mine();
    let selAd = preselect && getAd(preselect)?.owner === owner ? preselect : my[0]?.id;
    let selPlan = (CFG.vipPlans.find((p) => p.popular) || CFG.vipPlans[0]).id;
    app.innerHTML = `
      <section class="vip-hero">
        <span class="pill" style="background:rgba(59,35,0,.12)">♛ OFFRE VIP</span>
        <h1 style="margin-top:12px">Passe au-dessus de tout le monde.</h1>
        <p>Ton annonce s'affiche en tête de toutes les recherches, avec un badge doré et une bordure premium. Jusqu'à <b>10× plus de vues</b>.</p>
      </section>
      <div class="form-layout">
        <div>
          <div class="panel form-section">
            <h3><span class="num">1</span> Choisis ta durée</h3>
            <div class="plans">${CFG.vipPlans.map((p) => `
              <div class="plan ${p.id === selPlan ? "selected" : ""}" data-plan="${p.id}" tabindex="0">
                ${p.popular ? `<span class="pill pill-vip tag">Populaire</span>` : ""}
                <h3>${esc(p.label)}</h3>
                <div class="amount">${money(p.price)}</div>
                <div class="muted small">soit ${money(Math.round((p.price / p.days) * 100) / 100)} / jour</div>
                <ul><li>En tête des résultats</li><li>Badge ♛ VIP doré</li><li>Section « À la une »</li>${p.days >= 3 ? "<li>Statistiques de vues</li>" : ""}</ul>
              </div>`).join("")}</div>
          </div>
          <div class="panel form-section">
            <h3><span class="num">2</span> Choisis l'annonce à booster</h3>
            ${my.length ? `<div class="ad-picker">${my.map((a) => `
              <div class="ad-pick ${a.id === selAd ? "selected" : ""}" data-ad="${esc(a.id)}">
                <img src="${esc(cover(a))}" alt="">
                <div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.title)}</b>
                <span class="muted small">${money(a.price)} · ${esc(a.city)}</span></div>
                ${isVip(a) ? `<span class="pill pill-vip">VIP ${timeLeft(a.vipUntil)}</span>` : `<span class="pill pill-gray">Standard</span>`}
              </div>`).join("")}</div>`
            : `<div class="empty" style="padding:30px"><p class="muted">Tu n'as pas encore d'annonce.</p><a href="#publier" class="btn btn-primary">Déposer une annonce</a></div>`}
          </div>
        </div>
        <aside class="side">
          <div class="panel">
            <h3 style="margin-bottom:12px">Récapitulatif</h3>
            <div id="recap"></div>
            <button class="btn btn-gold btn-block btn-lg" id="buy" style="margin-top:16px" ${my.length ? "" : "disabled"}>♛ Payer et activer</button>
            <div class="stripe-badge">🔒 Activation immédiate après paiement</div>
          </div>
          <div class="panel"><h4 style="margin-bottom:6px">Comment ça marche ?</h4>
            <p class="muted small">Le VIP est activé immédiatement après le paiement. Si ton annonce est déjà VIP, la durée s'ajoute au temps restant.</p></div>
        </aside>
      </div>`;

    const recap = () => {
      const p = CFG.vipPlans.find((x) => x.id === selPlan), a = getAd(selAd);
      const end = new Date(Math.max(Date.now(), a?.vipUntil || 0) + p.days * DAY);
      $("#recap").innerHTML = `
        <div class="summary-line"><span class="muted">Offre</span><span>${esc(p.label)}</span></div>
        <div class="summary-line"><span class="muted">Annonce</span><span style="max-width:180px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a ? esc(a.title) : "—"}</span></div>
        <div class="summary-line"><span class="muted">VIP jusqu'au</span><span>${end.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div>
        <div class="summary-line summary-total"><span>Total</span><span>${money(p.price)}</span></div>`;
    };
    $$(".plan").forEach((el) => {
      const pick = () => { selPlan = el.dataset.plan; $$(".plan").forEach((x) => x.classList.toggle("selected", x === el)); recap(); };
      el.onclick = pick; el.onkeydown = (e) => { if (e.key === "Enter") pick(); };
    });
    $$(".ad-pick").forEach((el) => (el.onclick = () => { selAd = el.dataset.ad; $$(".ad-pick").forEach((x) => x.classList.toggle("selected", x === el)); recap(); }));
    $("#buy").onclick = () => buyVip(selAd, selPlan);
    recap();
  }

  function pageVipOk() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PENDING_KEY)); localStorage.removeItem(PENDING_KEY); } catch {}
    const plan = p && CFG.vipPlans.find((x) => x.id === p.planId);
    if (plan && getAd(p.adId) && Date.now() - p.at < DAY) {
      applyVip(p.adId, plan.days);
      location.replace("#annonce-" + p.adId);
    } else {
      location.replace("#mes-annonces");
    }
  }

  function pageMine() {
    const my = mine();
    const views = my.reduce((n, a) => n + (a.views || 0), 0);
    app.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;align-items:end;gap:12px;flex-wrap:wrap">
        <div><h1>Mes annonces</h1><p class="muted">Gère tes annonces et booste-les en VIP.</p></div>
        <a href="#publier" class="btn btn-primary">+ Nouvelle annonce</a>
      </div>
      <div class="stat-grid">
        <div class="stat"><span class="muted small">Annonces</span><b>${my.length}</b></div>
        <div class="stat"><span class="muted small">VIP actives</span><b>${my.filter(isVip).length}</b></div>
        <div class="stat"><span class="muted small">Vues totales</span><b>${views}</b></div>
      </div>
      ${my.length ? `<div class="mine-list">${my.map((a) => `
        <div class="mine-item">
          <a href="#annonce-${esc(a.id)}"><img src="${esc(cover(a))}" alt=""></a>
          <div style="min-width:0">
            <a href="#annonce-${esc(a.id)}"><b>${esc(a.title)}</b></a>
            <div class="muted small">${money(a.price)} · ${esc(a.city)} · ${timeAgo(a.createdAt)} · 👁 ${a.views || 0}</div>
            <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${isVip(a) ? `<span class="pill pill-vip">♛ VIP · ${timeLeft(a.vipUntil)}</span>` : `<span class="pill pill-gray">Standard</span>`}
              ${ratingHtml(a)}
            </div>
          </div>
          <div class="actions">
            <a href="#vip-${esc(a.id)}" class="btn btn-gold">♛ ${isVip(a) ? "Prolonger" : "Booster"}</a>
            <button class="btn btn-danger" data-del="${esc(a.id)}">Supprimer</button>
          </div>
        </div>`).join("")}</div>`
      : `<div class="empty"><div class="icon">📦</div><h3>Aucune annonce pour l'instant</h3><p class="muted">Dépose ta première annonce gratuitement.</p>
         <a href="#publier" class="btn btn-primary">Déposer une annonce</a></div>`}`;
    $$("[data-del]").forEach((b) => (b.onclick = () => {
      confirmBox("Supprimer cette annonce ?", () => {
        ads = ads.filter((x) => x.id !== b.dataset.del); save(); toast("Annonce supprimée"); pageMine();
      });
    }));
  }

  function notFound() {
    app.innerHTML = `<div class="empty" style="margin-top:40px"><div class="icon">🧭</div><h3>Page introuvable</h3>
      <p class="muted">Cette annonce n'existe plus ou a été supprimée.</p><a href="#" class="btn btn-primary">Retour aux annonces</a></div>`;
  }

  /* ---------------- Router ---------------- */
  const app = $("#app");
  function route() {
    $("#modal-root").innerHTML = "";
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    let page = h, arg = "";
    if (h.startsWith("annonce-")) { page = "annonce"; arg = h.slice(8); }
    else if (h.startsWith("vip-") && h !== "vip-ok") { page = "vip"; arg = h.slice(4); }
    if (page === "accueil") page = "";
    const navKey = { "": "home", annonce: "home", publier: "post", vip: "vip", "mes-annonces": "mine" }[page] ?? "";
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === navKey));
    window.scrollTo(0, 0);
    switch (page) {
      case "": case undefined: return pageHome();
      case "annonce": return pageDetail(arg);
      case "publier": return pagePost();
      case "vip": return pageVip(arg);
      case "vip-ok": return pageVipOk();
      case "mes-annonces": return pageMine();
      default: return notFound();
    }
  }
  window.addEventListener("hashchange", route);
  $("#year").textContent = new Date().getFullYear();
  try { if (!localStorage.getItem(STORE_KEY)) save(); } catch {}
  route();
})();
