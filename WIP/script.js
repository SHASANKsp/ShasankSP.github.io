// ============================================================
//  Portfolio interactions
// ============================================================

// ---- Theme toggle (guarded so a missing button never breaks the page) ----
(function () {
    const themeToggle = document.getElementById('theme-toggle');
    const root = document.documentElement;

    const savedTheme = localStorage.getItem('theme') || 'dark';
    root.setAttribute('data-theme', savedTheme);

    const setIcon = (theme) => {
        if (!themeToggle) return;
        const icon = themeToggle.querySelector('i');
        if (icon) icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    };
    setIcon(savedTheme);

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            setIcon(next);
        });
    }
})();

// ---- Scroll-reveal for sections + hero ----
document.addEventListener('DOMContentLoaded', () => {
    const revealTargets = document.querySelectorAll('.section, .hero-inner');

    if (!('IntersectionObserver' in window)) {
        revealTargets.forEach(el => el.classList.add('animate'));
        return;
    }

    const revealObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate');
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });

    revealTargets.forEach(el => revealObserver.observe(el));

    // ---- Active nav link highlighting ----
    const navLinks = Array.from(document.querySelectorAll('.nav-links a'));
    const sections = navLinks
        .map(link => document.querySelector(link.getAttribute('href')))
        .filter(Boolean);

    if (sections.length) {
        const navObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('id');
                    navLinks.forEach(link =>
                        link.classList.toggle('active', link.getAttribute('href') === '#' + id)
                    );
                }
            });
        }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

        sections.forEach(sec => navObserver.observe(sec));
    }
});

// ============================================================
//  Hero: interactive biomedical knowledge graph
//  Real entity nodes + relationships, gentle drift, cursor
//  reaction, and a periodic GraphRAG-style traversal pulse.
// ============================================================
(function () {
    const canvas = document.getElementById('graph-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- theme-aware colors (re-read when the theme toggles) ----
    let C = {};
    function readColors() {
        const s = getComputedStyle(document.documentElement);
        const g = (v, f) => (s.getPropertyValue(v).trim() || f);
        C.accent  = g('--accent', '#35d0e6');
        C.accent2 = g('--accent-2', '#7c92ff');
        C.node    = g('--muted', '#8a97a6');
        C.faint   = g('--faint', '#5a6675');
        C.text    = g('--text', '#e6edf3');
        C.edge    = g('--border', '#1d2836');
    }
    readColors();
    new MutationObserver(readColors).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme']
    });

    // ---- graph definition (biomedical entities + relationships) ----
    const hubDefs = [
        'GENE', 'DISEASE', 'DRUG', 'PROTEIN', 'ANTIBODY',
        'VARIANT', 'PATHWAY', 'TRIAL', 'BIOMARKER', 'PATIENT'
    ];
    const relDefs = [
        ['GENE', 'DISEASE', 'ASSOCIATED_WITH'],
        ['GENE', 'PROTEIN', 'ENCODES'],
        ['VARIANT', 'GENE', 'MAPS_TO'],
        ['DRUG', 'PROTEIN', 'TARGETS'],
        ['ANTIBODY', 'PROTEIN', 'BINDS'],
        ['PATHWAY', 'GENE', 'INVOLVES'],
        ['DISEASE', 'PATIENT', 'DIAGNOSED_IN'],
        ['DRUG', 'TRIAL', 'TESTED_IN'],
        ['TRIAL', 'PATIENT', 'ENROLLS'],
        ['BIOMARKER', 'DISEASE', 'INDICATES'],
        ['BIOMARKER', 'PATIENT', 'MEASURED_IN'],
        ['DRUG', 'DISEASE', 'TREATS'],
        ['PROTEIN', 'PATHWAY', 'PARTICIPATES']
    ];

    let W = 0, H = 0, DPR = 1;
    let nodes = [], edges = [], byId = {}, adj = {};
    const mouse = { x: -1e4, y: -1e4, active: false };

    function build() {
        nodes = []; edges = []; byId = {}; adj = {};
        // hub nodes — biased toward the right so text stays clear on the left
        hubDefs.forEach((id, i) => {
            const n = {
                id, label: id, hub: true,
                r: 4.5 + Math.random() * 2,
                x: W * (0.5 + Math.random() * 0.46),
                y: H * (0.12 + Math.random() * 0.76),
                vx: (Math.random() - 0.5) * 0.18,
                vy: (Math.random() - 0.5) * 0.18,
                accent: i % 4 === 0 ? 'a2' : (i % 3 === 0 ? 'a' : 'n')
            };
            nodes.push(n); byId[id] = n; adj[id] = [];
        });
        relDefs.forEach(([a, b, rel]) => {
            edges.push({ a: byId[a], b: byId[b], rel });
            adj[a].push(b); adj[b].push(a);
        });
        // satellite nodes (unlabeled) hung off random hubs — adds texture
        const sats = 16;
        for (let i = 0; i < sats; i++) {
            const hub = hubDefs[(Math.random() * hubDefs.length) | 0];
            const h = byId[hub];
            const id = 's' + i;
            const n = {
                id, label: '', hub: false,
                r: 1.6 + Math.random() * 1.6,
                x: h.x + (Math.random() - 0.5) * W * 0.14,
                y: h.y + (Math.random() - 0.5) * H * 0.22,
                vx: (Math.random() - 0.5) * 0.16,
                vy: (Math.random() - 0.5) * 0.16,
                accent: 'n'
            };
            nodes.push(n); byId[id] = n; adj[id] = [hub]; adj[hub].push(id);
            edges.push({ a: h, b: n, rel: '' });
        }
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = rect.width; H = rect.height;
        canvas.width = W * DPR; canvas.height = H * DPR;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        if (!nodes.length) build();
        else { // keep graph in-bounds after resize
            nodes.forEach(n => { n.x = Math.min(Math.max(n.x, 8), W - 8); n.y = Math.min(Math.max(n.y, 8), H - 8); });
        }
    }

    function hex(h, a) {
        h = h.replace('#', '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${a})`;
    }
    const colorOf = (n) => n.accent === 'a2' ? C.accent2 : (n.accent === 'a' ? C.accent : C.node);

    // ---- traversal pulse (GraphRAG-style hop across the graph) ----
    let pulse = null;
    function startPulse() {
        const start = hubDefs[(Math.random() * hubDefs.length) | 0];
        const path = [start];
        let cur = start;
        for (let i = 0; i < 4 + (Math.random() * 3 | 0); i++) {
            const opts = adj[cur].filter(x => x !== path[path.length - 2] && byId[x].hub);
            if (!opts.length) break;
            cur = opts[(Math.random() * opts.length) | 0];
            path.push(cur);
        }
        pulse = (path.length > 1) ? { path, seg: 0, t: 0 } : null;
    }
    let pulseTimer = 0;

    function step() {
        nodes.forEach(n => {
            // organic drift
            n.vx += (Math.random() - 0.5) * 0.01;
            n.vy += (Math.random() - 0.5) * 0.01;
            const sp = Math.hypot(n.vx, n.vy), max = 0.32;
            if (sp > max) { n.vx *= max / sp; n.vy *= max / sp; }
            // cursor repulsion
            if (mouse.active) {
                const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
                const R = 130;
                if (d2 < R * R) {
                    const d = Math.sqrt(d2) || 1, f = (1 - d / R) * 0.9;
                    n.vx += (dx / d) * f; n.vy += (dy / d) * f;
                }
            }
            n.x += n.vx; n.y += n.vy;
            // soft bounds — keep the graph in the right zone so it never sits on the copy
            const lb = W < 760 ? 8 : W * 0.4;
            if (n.x < lb) { n.x = lb; n.vx = Math.abs(n.vx); }
            if (n.x > W - 8) { n.x = W - 8; n.vx *= -1; }
            if (n.y < 8) { n.y = 8; n.vy *= -1; }
            if (n.y > H - 8) { n.y = H - 8; n.vy *= -1; }
            n.vx *= 0.99; n.vy *= 0.99;
        });

        // pulse progression
        pulseTimer--;
        if (!pulse && pulseTimer <= 0) { startPulse(); pulseTimer = 150 + Math.random() * 120; }
        if (pulse) {
            pulse.t += 0.028;
            if (pulse.t >= 1) { pulse.t = 0; pulse.seg++; if (pulse.seg >= pulse.path.length - 1) pulse = null; }
        }
    }

    function edgeActive(e) {
        if (!mouse.active) return false;
        const nearN = (n) => (n.x - mouse.x) ** 2 + (n.y - mouse.y) ** 2 < 120 * 120;
        return nearN(e.a) || nearN(e.b);
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);

        // edges
        edges.forEach(e => {
            const act = edgeActive(e);
            ctx.strokeStyle = act ? hex(C.accent, 0.5) : hex(C.edge, e.rel ? 0.85 : 0.5);
            ctx.lineWidth = act ? 1.2 : 0.7;
            ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
            // relationship label only when the edge is active (rewards exploration)
            if (act && e.rel) {
                ctx.save();
                ctx.font = '9px "JetBrains Mono", monospace';
                ctx.fillStyle = hex(C.accent, 0.85);
                ctx.textAlign = 'center';
                ctx.fillText(e.rel, (e.a.x + e.b.x) / 2, (e.a.y + e.b.y) / 2 - 4);
                ctx.restore();
            }
        });

        // pulse trail + travelling packet
        if (pulse) {
            for (let i = 0; i < pulse.seg; i++) {
                const a = byId[pulse.path[i]], b = byId[pulse.path[i + 1]];
                ctx.strokeStyle = hex(C.accent, 0.32);
                ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
            const a = byId[pulse.path[pulse.seg]], b = byId[pulse.path[pulse.seg + 1]];
            if (a && b) {
                const px = a.x + (b.x - a.x) * pulse.t, py = a.y + (b.y - a.y) * pulse.t;
                ctx.strokeStyle = hex(C.accent, 0.6); ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(px, py); ctx.stroke();
                ctx.fillStyle = C.accent;
                ctx.shadowColor = C.accent; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 7); ctx.fill();
                ctx.shadowBlur = 0;
            }
        }

        // nodes
        nodes.forEach(n => {
            const near = mouse.active && ((n.x - mouse.x) ** 2 + (n.y - mouse.y) ** 2 < 120 * 120);
            const col = colorOf(n);
            if (n.hub) { ctx.shadowColor = col; ctx.shadowBlur = near ? 16 : 8; }
            ctx.fillStyle = n.hub ? col : hex(col, 0.6);
            ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (near ? 1.35 : 1), 0, 7); ctx.fill();
            ctx.shadowBlur = 0;
            if (n.hub) {
                ctx.font = '10px "JetBrains Mono", monospace';
                ctx.fillStyle = near ? C.text : hex(C.faint, 0.9);
                ctx.textAlign = 'left';
                ctx.fillText(n.label, n.x + n.r + 5, n.y + 3);
            }
        });
    }

    let raf = null, running = false;
    function loop() { step(); draw(); raf = requestAnimationFrame(loop); }
    function start() { if (!running) { running = true; loop(); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

    // ---- wire up ----
    resize();
    window.addEventListener('resize', resize);

    const toLocal = (cx, cy) => {
        const r = canvas.getBoundingClientRect();
        mouse.x = cx - r.left; mouse.y = cy - r.top; mouse.active = true;
    };
    window.addEventListener('mousemove', e => toLocal(e.clientX, e.clientY));
    window.addEventListener('mouseout', () => { mouse.active = false; });
    window.addEventListener('touchmove', e => {
        if (e.touches[0]) toLocal(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());

    if (reduced) { draw(); }   // static frame, no animation
    else { start(); }
})();

// ============================================================
//  Experience map — a STATIC, hover-to-explore graph of
//  domains, projects, and the threads between them.
//  (Deliberately different from the hero: no drift; you
//   inspect it rather than watch it.)
// ============================================================
(function () {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const captionEl = document.getElementById('map-caption');

    // ---- graph data: read from the #map-data block in index.html ----
    // (edit the graph there, not here). Built-in defaults are a fallback
    // only used if that block is missing or contains invalid JSON.
    const DEFAULTS = {
        clusters: [
            { id: 'kg',    label: 'Knowledge Graphs',     short: 'KG',       color: '#35d0e6', detail: 'Neo4j · GraphRAG · temporal KGs' },
            { id: 'ab',    label: 'Antibody Engineering', short: 'Antibody', color: '#2dd4bf', detail: 'Sequence design · developability' },
            { id: 'omics', label: 'Multi-Omics',          short: 'Omics',    color: '#58b3ff', detail: 'RNA-seq · proteomics · integration' },
            { id: 'ml',    label: 'ML & Predictive',      short: 'ML',       color: '#8b93ff', detail: 'Applied ML · SHAP · GNNs' },
            { id: 'gen',   label: 'Genomics / GWAS',      short: 'Genomics', color: '#9db4d8', detail: 'WGS · association · Cromwell' },
            { id: 'ai',    label: 'GenAI / LLM',          short: 'GenAI',    color: '#c084fc', detail: 'RAG · agents · fine-tuning' }
        ],
        leaves: [], links: [['kg', 'ai'], ['omics', 'ml'], ['gen', 'omics'], ['ab', 'ml'], ['gen', 'kg']]
    };

    let DATA = DEFAULTS;
    try {
        const raw = document.getElementById('map-data');
        if (raw) {
            const parsed = JSON.parse(raw.textContent);
            if (parsed && parsed.clusters && parsed.clusters.length) DATA = parsed;
        }
    } catch (e) { /* keep defaults on any parse error */ }

    const clusters = DATA.clusters;
    const leafDefs = (DATA.leaves || []).map(l => [l.cluster, l.label, l.detail]);
    const crossLinks = DATA.links || [];

    let W = 0, H = 0, DPR = 1;
    let nodes = [], byId = {}, neigh = {};
    let hover = null;

    let T = {};
    function readTheme() {
        const s = getComputedStyle(document.documentElement);
        T.text  = (s.getPropertyValue('--text').trim() || '#e6edf3');
        T.faint = (s.getPropertyValue('--faint').trim() || '#5a6675');
        T.muted = (s.getPropertyValue('--muted').trim() || '#8a97a6');
        T.edge  = (s.getPropertyValue('--border').trim() || '#1d2836');
    }
    readTheme();
    new MutationObserver(() => { readTheme(); draw(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    function rgba(h, a) {
        h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
        return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
    }

    function layout() {
        nodes = []; byId = {}; neigh = {};
        const cx = W / 2, cy = H / 2;
        // Elliptical layout so the graph fills the card on any aspect ratio.
        const Rx = W * 0.34, Ry = H * 0.32;     // hub ellipse radii
        const Rlx = W * 0.12, Rly = H * 0.13;   // leaf offset radii
        const start = -Math.PI / 3;             // offset so no hub sits dead-top/bottom

        clusters.forEach((cl, i) => {
            const ang = start + i * (Math.PI * 2 / clusters.length);
            const hx = cx + Math.cos(ang) * Rx, hy = cy + Math.sin(ang) * Ry;
            const n = { id: cl.id, label: cl.label, short: cl.short, detail: cl.detail, color: cl.color, hub: true, x: hx, y: hy, ang };
            nodes.push(n); byId[cl.id] = n; neigh[cl.id] = [];
        });
        crossLinks.forEach(([a, b]) => { neigh[a].push(b); neigh[b].push(a); });

        const perCluster = {};
        leafDefs.forEach(([c]) => perCluster[c] = (perCluster[c] || 0) + 1);
        const idx = {};
        leafDefs.forEach(([c, label, detail], k) => {
            const hub = byId[c];
            const count = perCluster[c];
            idx[c] = (idx[c] || 0);
            const spread = Math.PI * 0.3;
            const t = count === 1 ? 0 : (idx[c] / (count - 1) - 0.5);
            const a = hub.ang + t * spread;           // fan out along outward direction
            const lx = hub.x + Math.cos(a) * Rlx, ly = hub.y + Math.sin(a) * Rly;
            const id = 'L' + k;
            const n = { id, label, detail, color: hub.color, hub: false, parent: c, x: lx, y: ly, ang: a };
            nodes.push(n); byId[id] = n; neigh[id] = [c]; neigh[c].push(id);
            idx[c]++;
        });

        // de-conflict leaf labels: within each cluster, force a minimum
        // vertical gap so two labels can never land on the same line.
        clusters.forEach(cl => {
            const hub = byId[cl.id];
            const right = Math.cos(hub.ang) >= -0.15;
            const leaves = nodes.filter(n => !n.hub && n.parent === cl.id).sort((a, b) => a.y - b.y);
            const gap = 14;
            leaves.forEach((n, i) => {
                let ly = n.y;
                if (i > 0 && ly < leaves[i - 1]._ly + gap) ly = leaves[i - 1]._ly + gap;
                n._ly = ly; n._right = right;
            });
        });
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = rect.width; H = rect.height;
        canvas.width = W * DPR; canvas.height = H * DPR;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        layout(); draw();
    }

    function activeSet() {
        if (!hover) return null;
        const s = new Set([hover.id]);
        (neigh[hover.id] || []).forEach(id => s.add(id));
        return s;
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        const act = activeSet();

        // edges: hub↔leaf
        nodes.forEach(n => {
            if (n.hub) return;
            const h = byId[n.parent];
            const on = act && act.has(n.id) && act.has(h.id);
            ctx.strokeStyle = on ? rgba(n.color, 0.7) : (act ? rgba(T.edge, 0.35) : rgba(T.edge, 0.9));
            ctx.lineWidth = on ? 1.4 : 0.7;
            ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(n.x, n.y); ctx.stroke();
        });
        // edges: hub↔hub cross-links
        crossLinks.forEach(([a, b]) => {
            const A = byId[a], B = byId[b];
            const on = act && act.has(a) && act.has(b);
            ctx.strokeStyle = on ? rgba(A.color, 0.6) : (act ? rgba(T.edge, 0.3) : rgba(T.edge, 0.7));
            ctx.lineWidth = on ? 1.4 : 0.9;
            ctx.setLineDash(on ? [] : [3, 4]);
            ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
            ctx.setLineDash([]);
        });

        // nodes
        const showLeafLabels = W >= 720;   // declutter on narrow screens
        nodes.forEach(n => {
            const dim = act && !act.has(n.id);
            const r = n.hub ? 6 : 3.4;
            if (!dim) { ctx.shadowColor = n.color; ctx.shadowBlur = n.hub ? 14 : 8; }
            ctx.fillStyle = dim ? rgba(n.color, 0.28) : n.color;
            ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
            ctx.shadowBlur = 0;

            // label visibility: hubs always; leaves only when there's room or active
            const activeLeaf = act && act.has(n.id);
            if (!n.hub && !showLeafLabels && !activeLeaf) return;

            ctx.font = n.hub ? '600 11px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace';
            ctx.fillStyle = dim ? rgba(T.faint, 0.5) : (n.hub ? T.text : rgba(T.muted, 0.95));
            const small = W < 520;
            const labelText = (n.hub && small && n.short) ? n.short : n.label;
            if (n.hub && small) ctx.font = '600 10px "JetBrains Mono", monospace';
            const tw = ctx.measureText(labelText).width;

            if (n.hub) {
                ctx.textAlign = 'center';
                let ly = n.y - 12;
                if (ly < 14) ly = n.y + 18;            // flip below if near top
                let lx = Math.min(Math.max(n.x, tw / 2 + 4), W - tw / 2 - 4); // keep in-bounds
                ctx.fillText(labelText, lx, ly);
            } else {
                let right = n._right;
                if (right && n.x + 6 + tw > W - 4) right = false;   // flip if it would clip right
                if (!right && n.x - 6 - tw < 4) right = true;       // flip if it would clip left
                ctx.textAlign = right ? 'left' : 'right';
                let ly = Math.min(Math.max(n._ly, 12), H - 4);
                const lx0edge = right ? n.x + 6 : n.x - 6;
                // faint leader when the label was nudged away from its dot
                if (Math.abs(ly - n.y) > 6) {
                    ctx.strokeStyle = rgba(n.color, dim ? 0.12 : 0.3);
                    ctx.lineWidth = 0.6;
                    ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(lx0edge, ly - 3); ctx.stroke();
                }
                ctx.fillText(n.label, lx0edge, ly);
                const lx0 = right ? lx0edge : lx0edge - tw;
            }
        });
    }

    function pick(mx, my) {
        let best = null, bd = 18 * 18;
        nodes.forEach(n => {
            const d = (n.x - mx) ** 2 + (n.y - my) ** 2;
            const rr = (n.hub ? 22 : 15) ** 2;
            if (d < rr && d < bd) { bd = d; best = n; }
        });
        return best;
    }

    canvas.addEventListener('pointermove', e => {
        const r = canvas.getBoundingClientRect();
        const n = pick(e.clientX - r.left, e.clientY - r.top);
        if (n !== hover) {
            hover = n; draw();
            if (captionEl) captionEl.innerHTML = n ? `<b>${n.label}</b> — ${n.detail}` : '';
        }
    });
    canvas.addEventListener('pointerleave', () => {
        hover = null; draw();
        if (captionEl) captionEl.innerHTML = '';
    });

    resize();
    window.addEventListener('resize', resize);
})();
