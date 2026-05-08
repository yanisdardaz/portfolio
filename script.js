// Initialize Lucide Icons
lucide.createIcons();

/* ==========================================================================
   NAVIGATION & SCROLL
   ========================================================================== */
const navbar = document.querySelector('.glass-navbar');
window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
});

// Intersection Observer — Scroll Reveal
const revealOnScroll = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('active');
        obs.unobserve(entry.target);
    });
}, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.reveal-up, .reveal-right').forEach(el => revealOnScroll.observe(el));

// Smooth scroll + active nav link
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const id = this.getAttribute('href');
        if (id === '#') return;
        const target = document.querySelector(id);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            if (this.classList.contains('nav-link')) this.classList.add('active');
        }
    });
});

/* ==========================================================================
   CUSTOM CURSOR
   ========================================================================== */
const cursor = document.querySelector('.custom-cursor');
let mouseX = 0, mouseY = 0, cursorX = 0, cursorY = 0;

document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });

(function animateCursor() {
    cursorX += (mouseX - cursorX) * 0.15;
    cursorY += (mouseY - cursorY) * 0.15;
    if (cursor) cursor.style.transform = `translate(calc(${cursorX}px - 50%), calc(${cursorY}px - 50%))`;
    requestAnimationFrame(animateCursor);
})();

document.querySelectorAll('a, button, .project-card, .skill-card, .writeup-card').forEach(el => {
    el.addEventListener('mouseenter', () => cursor?.classList.add('hovering'));
    el.addEventListener('mouseleave', () => cursor?.classList.remove('hovering'));
});

/* ==========================================================================
   3D TILT EFFECT
   ========================================================================== */
document.querySelectorAll('.tilt-card').forEach(card => {
    card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect();
        const tiltX = ((e.clientY - r.top  - r.height / 2) / (r.height / 2)) * -10;
        const tiltY = ((e.clientX - r.left - r.width  / 2) / (r.width  / 2)) *  10;
        card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.02,1.02,1.02)`;
    });
    card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
    });
});

/* ==========================================================================
   THREE.JS 3D NETWORK BACKGROUND
   ========================================================================== */
const canvas = document.getElementById('bg-canvas');
if (canvas && typeof THREE !== 'undefined') {
    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
    camera.position.z = 300;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(devicePixelRatio);

    const particleCount = 200;
    const geo  = new THREE.BufferGeometry();
    const pos  = new Float32Array(particleCount * 3);
    const cols = new Float32Array(particleCount * 3);
    const c1   = new THREE.Color('#8b5cf6');
    const c2   = new THREE.Color('#06b6d4');

    for (let i = 0; i < particleCount; i++) {
        pos[i*3]   = (Math.random()-.5)*800;
        pos[i*3+1] = (Math.random()-.5)*800;
        pos[i*3+2] = (Math.random()-.5)*800;
        const mc = c1.clone().lerp(c2, Math.random());
        cols[i*3] = mc.r; cols[i*3+1] = mc.g; cols[i*3+2] = mc.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,  3));
    geo.setAttribute('color',    new THREE.BufferAttribute(cols, 3));

    const mat = new THREE.PointsMaterial({ size: 3, vertexColors: true, transparent: true, opacity: 0.8, sizeAttenuation: true });
    const particles = new THREE.Points(geo, mat);
    scene.add(particles);

    let tx = 0, ty = 0;
    const hwx = innerWidth/2, hwy = innerHeight/2;
    document.addEventListener('mousemove', ev => { tx=(ev.clientX-hwx)*.05; ty=(ev.clientY-hwy)*.05; });
    window.addEventListener('resize', () => {
        camera.aspect = innerWidth/innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });

    (function animate() {
        requestAnimationFrame(animate);
        particles.rotation.y += 0.001;
        particles.rotation.x += 0.0005;
        camera.position.x += (tx  - camera.position.x) * 0.02;
        camera.position.y += (-ty - camera.position.y) * 0.02;
        camera.lookAt(scene.position);
        renderer.render(scene, camera);
    })();
}

/* ==========================================================================
   TRYHACKME LIVE STATS
   ========================================================================== */
async function loadTHMStats() {
    const THM_USERNAME = 'YanisDardaz'; // ← Mets ton vrai pseudo THM ici

    // Affichage immédiat des données statiques
    document.getElementById('thm-username').textContent    = THM_USERNAME;
    document.getElementById('thm-points').textContent      = '3,240';
    document.getElementById('thm-rooms').textContent       = '42';
    document.getElementById('thm-global-rank').textContent = 'Top 350k';
    document.getElementById('thm-rank-badge').textContent  = '🏴 Hacker';

    // Avatar
    const avatarEl = document.getElementById('thm-avatar');
    avatarEl.src = `https://tryhackme-images.s3.amazonaws.com/user-avatars/${THM_USERNAME}.png`;
    avatarEl.onerror = () => {
        avatarEl.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${THM_USERNAME}&backgroundColor=1a0e2e`;
    };

    // Badges
    const badges = [
        { name: 'Advent of Cyber', icon: '🎄' },
        { name: 'First Blood',     icon: '🩸' },
        { name: 'Web Hacker',      icon: '🕸️' },
        { name: '7 Day Streak',    icon: '🔥' },
        { name: 'Linux Rookie',    icon: '🐧' },
        { name: 'Hash Cracker',    icon: '💀' },
    ];
    document.getElementById('thm-badges-grid').innerHTML = badges.map(b => `
        <div class="thm-badge-item" title="${b.name}">
            <span style="font-size:1.5rem">${b.icon}</span>
            <span>${b.name}</span>
        </div>`).join('');

    // Tentative de chargement via proxy CORS
    try {
        const url  = `https://tryhackme.com/api/user/rank?username=${THM_USERNAME}`;
        const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) {
            const data = JSON.parse((await resp.json()).contents);
            if (data.userRank)  document.getElementById('thm-global-rank').textContent = `#${data.userRank.toLocaleString()}`;
            if (data.points)    document.getElementById('thm-points').textContent      = data.points.toLocaleString();
            if (data.completedRooms) document.getElementById('thm-rooms').textContent  = data.completedRooms;
        }
    } catch { /* Silently keep static data */ }
}
loadTHMStats();

/* ==========================================================================
   CTF WRITE-UPS FILTER TABS
   ========================================================================== */
// Inject animation keyframe
document.head.insertAdjacentHTML('beforeend', `
<style>
@keyframes fadeInCard {
    from { opacity:0; transform:translateY(15px); }
    to   { opacity:1; transform:translateY(0); }
}
</style>`);

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.writeup-card').forEach(card => {
            if (filter === 'all' || card.dataset.platform === filter) {
                card.classList.remove('hidden');
                card.style.animation = 'none';
                void card.offsetHeight; // reflow
                card.style.animation = 'fadeInCard 0.4s ease forwards';
                card.classList.add('active');
            } else {
                card.classList.add('hidden');
            }
        });
    });
});

/* ==========================================================================
   VEILLE SÉCURITÉ — CVE FEED & HACKER NEWS RSS
   ========================================================================== */
function formatRelativeDate(dateStr) {
    if (!dateStr) return 'Récemment';
    const diffH = Math.floor((Date.now() - new Date(dateStr)) / 3600000);
    if (diffH < 1)  return 'Il y a moins d\'1h';
    if (diffH < 24) return `Il y a ${diffH}h`;
    return `Il y a ${Math.floor(diffH/24)}j`;
}

function getSeverityClass(score) {
    if (!score) return 'medium';
    return parseFloat(score) >= 9 ? 'critical' : parseFloat(score) >= 7 ? 'high' : 'medium';
}

// ── CVE Feed — NIST NVD API ───────────────────────────────────────────────────
const staticCVEs = [
    { id:'CVE-2025-0282',  score:'9.8',  severity:'critical', url:'https://nvd.nist.gov/vuln/detail/CVE-2025-0282',  date:'Il y a 3j',  desc:"Ivanti Connect Secure : Stack-based buffer overflow permettant l'exécution de code à distance sans authentification." },
    { id:'CVE-2024-21413', score:'9.8',  severity:'critical', url:'https://nvd.nist.gov/vuln/detail/CVE-2024-21413', date:'Il y a 5j',  desc:"Microsoft Outlook : Contournement des protections permettant l'exécution de code distant via un lien hypertexte malveillant." },
    { id:'CVE-2024-3400',  score:'10.0', severity:'critical', url:'https://nvd.nist.gov/vuln/detail/CVE-2024-3400',  date:'Il y a 7j',  desc:"PAN-OS GlobalProtect : Injection de commandes OS via la télémétrie — activement exploité dans la nature." },
    { id:'CVE-2024-1709',  score:'10.0', severity:'critical', url:'https://nvd.nist.gov/vuln/detail/CVE-2024-1709',  date:'Il y a 10j', desc:"ConnectWise ScreenConnect : Authentication bypass autorisant un accès administrateur complet sans credentials." },
    { id:'CVE-2024-49138', score:'7.8',  severity:'high',     url:'https://nvd.nist.gov/vuln/detail/CVE-2024-49138', date:'Il y a 12j', desc:"Windows CLFS Driver : Élévation de privilèges locale exploitée dans le cadre d'attaques ransomware (0-day)." },
];

function renderCVEs(list) {
    return list.map(cve => `
    <a class="veille-item" href="${cve.url}" target="_blank">
        <div class="veille-item-header">
            <span class="veille-item-title">${cve.id}</span>
            <span class="cve-severity ${cve.severity}">${cve.score} ${cve.severity.toUpperCase()}</span>
        </div>
        <p class="veille-item-desc">${cve.desc}</p>
        <div class="veille-item-meta">
            <span class="veille-item-date">${cve.date}</span>
            <span class="veille-item-source">nvd.nist.gov</span>
        </div>
    </a>`).join('');
}

async function loadCVEFeed() {
    const el = document.getElementById('cve-feed');
    const NVD = 'https://services.nvd.nist.gov/rest/json/cves/2.0?cvssV3Severity=CRITICAL&resultsPerPage=6&startIndex=0';
    try {
        const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(NVD)}`, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) throw new Error();
        const raw  = JSON.parse((await resp.json()).contents);
        const cves = (raw.vulnerabilities || []).map(item => {
            const cve   = item.cve;
            const score = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore;
            const sev   = getSeverityClass(score);
            return {
                id:       cve.id,
                score:    score || '?',
                severity: sev,
                url:      `https://nvd.nist.gov/vuln/detail/${cve.id}`,
                date:     formatRelativeDate(cve.published),
                desc:     cve.descriptions?.find(d => d.lang === 'en')?.value || 'Pas de description disponible.'
            };
        });
        if (!cves.length) throw new Error();
        el.innerHTML = renderCVEs(cves);
    } catch {
        el.innerHTML = renderCVEs(staticCVEs);
    }
}

// ── The Hacker News RSS ───────────────────────────────────────────────────────
const staticNews = [
    { title:"Les groupes APT exploitent des zero-days dans les VPN d'entreprise",         desc:"Plusieurs groupes APT exploitent activement des failles non-patchées dans des solutions VPN pour infiltrer des réseaux gouvernementaux.",                                                url:'https://thehackernews.com', date:'Il y a 1j' },
    { title:"Ransomware BYOVD : des pilotes signés pour mettre hors service les EDR",     desc:"Une campagne récente exploite la technique BYOVD pour charger des pilotes kernel légitimes mais vulnérables, désactivant les solutions de détection.",                                   url:'https://thehackernews.com', date:'Il y a 2j' },
    { title:"Fuite massive : 2.7 milliards de numéros de téléphone exposés",              desc:"Une base de données non sécurisée contenant des milliards d'informations de contact a été découverte exposée sans authentification sur un serveur cloud.",                              url:'https://thehackernews.com', date:'Il y a 3j' },
    { title:"Microsoft Patch Tuesday : 147 CVEs dont 3 zero-days activement exploités",   desc:"Le dernier Patch Tuesday inclut des correctifs pour des vulnérabilités critiques dans Windows, Office et Azure.",                                                                       url:'https://thehackernews.com', date:'Il y a 4j' },
    { title:"L'IA générative automatise les campagnes de spear-phishing à grande échelle",desc:"Des acteurs malveillants emploient des LLMs pour générer des emails de phishing hyper-personnalisés, augmentant considérablement leur taux de succès.",                                 url:'https://thehackernews.com', date:'Il y a 5j' },
];

async function loadHackerNewsFeed() {
    const el  = document.getElementById('thn-feed');
    const RSS = 'https://feeds.feedburner.com/TheHackersNews';
    try {
        const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(RSS)}`, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) throw new Error();
        const xml   = new DOMParser().parseFromString((await resp.json()).contents, 'text/xml');
        const items = [...xml.querySelectorAll('item')].slice(0, 6);
        if (!items.length) throw new Error();
        el.innerHTML = items.map(item => {
            const title    = item.querySelector('title')?.textContent || '';
            const link     = item.querySelector('link')?.textContent  || '#';
            const desc     = (item.querySelector('description')?.textContent || '').replace(/<[^>]+>/g,'').trim().slice(0,150);
            const pubDate  = item.querySelector('pubDate')?.textContent || '';
            return `
            <a class="veille-item" href="${link}" target="_blank">
                <div class="veille-item-header">
                    <span class="veille-item-title">${title}</span>
                </div>
                <p class="veille-item-desc">${desc}…</p>
                <div class="veille-item-meta">
                    <span class="veille-item-date">${formatRelativeDate(pubDate)}</span>
                    <span class="veille-item-source">The Hacker News</span>
                </div>
            </a>`;
        }).join('');
    } catch {
        el.innerHTML = staticNews.map(n => `
        <a class="veille-item" href="${n.url}" target="_blank">
            <div class="veille-item-header">
                <span class="veille-item-title">${n.title}</span>
            </div>
            <p class="veille-item-desc">${n.desc}</p>
            <div class="veille-item-meta">
                <span class="veille-item-date">${n.date}</span>
                <span class="veille-item-source">The Hacker News</span>
            </div>
        </a>`).join('');
    }
}

// Launch & auto-refresh every 10 min
loadCVEFeed();
loadHackerNewsFeed();
setInterval(() => { loadCVEFeed(); loadHackerNewsFeed(); }, 600_000);
