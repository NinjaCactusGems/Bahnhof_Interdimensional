"use strict";

const H = 3600e3;
const PORTAL = ["#3fa9ff", "#b45cff", "#5dff8a", "#ff9a3c", "#3ff3ff", "#d86bff"];
const $ = (s, el = document) => el.querySelector(s);

/* ---------- Nixie clock ---------- */

function tube(chars) {
  const el = document.createElement("span");
  el.className = "tube";
  const cath = {};
  for (const c of chars) {
    const k = document.createElement("span");
    k.className = "cath";
    k.textContent = c;
    el.append(k);
    cath[c] = k;
  }
  let cur = null;
  return {
    el,
    set(c) {
      if (c === cur) return;
      cath[cur]?.classList.remove("on");
      cath[c]?.classList.add("on");
      cur = c;
    },
  };
}

const bulbs = (cls) => {
  const el = document.createElement("span");
  el.className = "tube sep " + cls;
  el.innerHTML = "<i></i><i></i>";
  return el;
};

function clock(el) {
  const digits = () => tube("0123456789");
  const sign = tube("−");
  const hours = document.createElement("span");
  hours.className = "group";
  let hTubes = [];
  const rest = [digits(), digits(), digits(), digits(), digits(), digits(), digits()];
  el.append(sign.el, hours, bulbs("colon"), rest[0].el, rest[1].el, bulbs("colon"),
    rest[2].el, rest[3].el, bulbs("point"), rest[4].el, rest[5].el, rest[6].el);

  return (ms) => {
    sign.set(ms < 0 ? "−" : null);
    const a = Math.abs(Math.trunc(ms));
    const h = String(Math.floor(a / H)).padStart(2, "0");
    while (hTubes.length < h.length) { const t = digits(); hours.prepend(t.el); hTubes.unshift(t); }
    while (hTubes.length > h.length) hTubes.shift().el.remove();
    hTubes.forEach((t, i) => t.set(h[i]));
    const tail = String(Math.floor(a / 60e3) % 60).padStart(2, "0") +
      String(Math.floor(a / 1e3) % 60).padStart(2, "0") +
      String(a % 1e3).padStart(3, "0");
    rest.forEach((t, i) => t.set(tail[i]));
  };
}

/* ---------- Glitches ----------
   Displayed = real remaining + offset(t). Every episode is a keyframe list
   [fraction, offsetMs] that starts and ends at 0, so the clock always lands
   back on true time. Keyframes with near-equal fractions act as jumps. */

const rand = (a, b) => a + Math.random() * (b - a);
const MAX_EP = 8000;
const QUIET_ZONE = 20e3; // no glitching this close to a counter's zero

function episode(now, remaining) {
  const D = rand(2000, MAX_EP);
  const kind = Math.floor(Math.random() * 3);
  let k;
  if (kind === 0) {
    // rückwärts: runs backwards (display +1/ms => offset +2/ms), then races to catch up
    const a = rand(0.45, 0.75);
    k = [[0, 0], [a, 2 * a * D], [1, 0]];
  } else if (kind === 1) {
    // tempo: much faster, then crawling (but never backwards) until back in sync
    const a = rand(0.15, 0.4);
    k = [[0, 0], [a, -0.9 * (1 - a) * D * rand(0.6, 1)], [1, 0]];
  } else {
    // sprung: leaps far ahead, maybe further, then snaps back.
    // Capped below the remaining time so a countdown doesn't flip sign mid-glitch.
    const cap = remaining > 0 ? remaining * 0.85 : Infinity;
    const far = () => -Math.min(cap, rand(5 * 60e3, 30 * H) * Math.random() ** 2 + 60e3);
    const x1 = far(), x2 = Math.random() < 0.5 ? far() : x1;
    k = [[0, 0], [0.001, x1], [0.4, x1], [0.401, x2], [0.75, x2], [0.751, 0], [1, 0]];
  }
  return { start: now, end: now + D, k };
}

function offsetAt(ep, now) {
  const p = (now - ep.start) / (ep.end - ep.start);
  const k = ep.k;
  for (let i = 1; i < k.length; i++) {
    if (p <= k[i][0]) {
      const [p0, v0] = k[i - 1], [p1, v1] = k[i];
      return v0 + ((p - p0) / (p1 - p0)) * (v1 - v0);
    }
  }
  return 0;
}

// Keep 1 counter glitching at all times, occasionally 2–3 (≈1.2 on average).
function scheduleGlitches(counters, now, dt) {
  for (const c of counters) if (c.ep && now >= c.ep.end) { c.ep = null; c.el.classList.remove("glitch"); }
  const active = counters.filter((c) => c.ep).length;
  if (active >= 3 || (active > 0 && Math.random() > dt * 0.00004)) return;
  const pool = counters.filter((c) => !c.ep && Math.abs(c.remaining) > QUIET_ZONE + MAX_EP);
  if (!pool.length) return;
  const c = pool[Math.floor(Math.random() * pool.length)];
  c.ep = episode(now, c.remaining);
  c.el.classList.add("glitch");
}

/* ---------- Timetable ---------- */

function trackState(t, now) {
  const open = Date.parse(t.open), close = Date.parse(t.close);
  if (now < open) return { target: open, cls: open - now > H ? "green" : "orange" };
  if (now < close) return { target: close, cls: "red" };
  return { target: close, cls: "green" }; // closed: counts on into negative
}

let data = null;
let counters = [];
const final = {
  el: $("#final-clock"),
  set: clock($("#final-clock")),
  state: () => ({ target: Date.parse(data.final.at), cls: "amber" }),
};

function render() {
  $("#final-name").textContent = data.final.name;

  const list = $("#tracks");
  list.textContent = "";
  const rows = data.tracks.map((t, i) => {
    const row = document.createElement("article");
    row.className = "row";
    row.style.setProperty("--portal", PORTAL[i]);
    row.innerHTML = `
      <div class="plaque">Gleis ${i + 1}</div>
      <div class="clock"></div>`;
    list.append(row);
    const el = $(".clock", row);
    return { el, row, set: clock(el), state: (now) => trackState(t, now) };
  });
  counters = [final, ...rows];
  // pipes follow the clocks: redraw when anything resizes or fonts settle
  pipeWatch.disconnect();
  pipeWatch.observe(document.body);
  counters.forEach((c) => pipeWatch.observe(c.el));
  document.fonts.ready.then(queuePipes);
}

/* ---------- Pipes ----------
   Laid out from the clocks' real positions: a trunk down each outer side
   and one down the middle, a branch into every clock, a few runs leaving
   the screen, with flanges, wall brackets and valve wheels. */

const pipesSvg = $("#pipes");
const PIPE = [["#120a04", 1], ["#4a2f17", 0.82], ["#7a5229", 0.52], ["#b88a52", 0.16]]; // edge -> highlight

const pipe = (pts, w) => {
  const d = "M" + pts.map((p) => p.join(" ")).join("L");
  return PIPE.map(([c, k]) => `<path d="${d}" stroke="${c}" stroke-width="${w * k}"/>`).join("");
};
const bolt = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#pp-bolt)"/>`;
// collar across the pipe; vertical=true for a pipe running up/down
const flange = (x, y, w, vertical) => {
  const a = w * 1.55, b = w * 0.42;
  const [rw, rh] = vertical ? [a, b] : [b, a];
  return `<rect x="${x - rw / 2}" y="${y - rh / 2}" width="${rw}" height="${rh}" rx="${w * 0.08}" fill="url(#pp-brass)" stroke="#140b04"/>`;
};
const tee = (x, y, w) =>
  `<rect x="${x - w * 0.8}" y="${y - w * 0.8}" width="${w * 1.6}" height="${w * 1.6}" rx="${w * 0.25}" fill="url(#pp-brass)" stroke="#140b04"/>` +
  bolt(x, y, w * 0.18);
const bracket = (x, y, w) =>
  `<rect x="${x - w * 1.25}" y="${y - w * 0.22}" width="${w * 2.5}" height="${w * 0.44}" fill="#24211f" stroke="#000"/>` +
  bolt(x - w * 1.02, y, w * 0.13) + bolt(x + w * 1.02, y, w * 0.13);
const valve = (x, y, w) => {
  const r = w * 1.5;
  const spokes = [0, 60, 120].map((a) => {
    const c = Math.cos((a * Math.PI) / 180) * r, s = Math.sin((a * Math.PI) / 180) * r;
    return `<line x1="${x - c}" y1="${y - s}" x2="${x + c}" y2="${y + s}"/>`;
  }).join("");
  return `<g stroke="#5c1f12" stroke-width="${w * 0.22}" stroke-linecap="round" fill="none">
    <circle cx="${x}" cy="${y}" r="${r}"/>${spokes}</g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="rgba(255,190,150,.25)" stroke-width="${w * 0.06}"/>
    <circle cx="${x}" cy="${y}" r="${w * 0.35}" fill="url(#pp-brass)" stroke="#140b04"/>`;
};

function drawPipes() {
  const W = document.documentElement.clientWidth, H = document.documentElement.scrollHeight;
  const sx0 = scrollX, sy0 = scrollY;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left + sx0, r: r.right + sx0, t: r.top + sy0, b: r.bottom + sy0, h: r.height }; };
  const board = rect($(".board"));
  const cs = counters.map((c) => rect(c.el)); // [final, 1..6]
  if (cs.length < 7) return;
  const w = Math.max(7, cs[1].h * 0.15), wt = Math.max(9, cs[1].h * 0.21);
  const y = (r) => r.t + r.h * 0.42;
  const cx = board.l + (board.r - board.l) / 2;
  const twoCols = cs[1].r < cx && cs[4].l > cx;

  let pipes = "", fit = "";
  for (const side of ["l", "r"]) {
    // clocks that connect to this side's trunk
    const mine = cs.map((r, i) => [r, i]).filter(([r, i]) => i === 0 || !twoCols || (side === "l" ? r.r < cx : r.l > cx));
    const edge = side === "l" ? Math.min(...mine.map(([r]) => r.l)) : Math.max(...mine.map(([r]) => r.r));
    const room = side === "l" ? edge - board.l : board.r - edge;
    if (room < wt * 2.2) continue;
    const x = side === "l" ? board.l + room * 0.45 : board.r - room * 0.45;
    pipes += pipe([[x, -40], [x, H + 40]], wt);
    const ys = [];
    for (const [r, i] of mine) {
      const yy = y(r), end = side === "l" ? r.l : r.r;
      // some branches run straight through the trunk and off the screen
      const off = (side === "l" ? [0, 2] : [0, 6]).includes(i);
      pipes += pipe([[off ? (side === "l" ? -40 : W + 40) : x, yy], [end, yy]], w);
      fit += tee(x, yy, wt) + flange(end + (side === "l" ? -w * 0.3 : w * 0.3), yy, w, false);
      ys.push(yy);
    }
    for (let by = H * 0.08; by < H; by += H * 0.17) {
      if (ys.every((yy) => Math.abs(yy - by) > wt * 2.5)) fit += bracket(x, by, wt);
    }
    if (side === "l" && ys.length > 2) fit += valve(x, (ys[1] + ys[2]) / 2, wt);
  }

  if (twoCols) {
    // middle trunk from the final clock down off the screen, feeding rows 1 and 2
    const top = cs[0].b;
    pipes += pipe([[cx, top], [cx, H + 40]], w);
    fit += flange(cx, top + w * 0.3, w, true);
    for (const [a, b] of [[1, 4], [2, 5]]) {
      const ya = y(cs[a]), yb = y(cs[b]);
      pipes += pipe([[cs[a].r, ya], [cx, ya]], w) + pipe([[cx, yb], [cs[b].l, yb]], w);
      fit += flange(cs[a].r + w * 0.3, ya, w, false) + flange(cs[b].l - w * 0.3, yb, w, false) + tee(cx, ya, w);
    }
    fit += valve(cx, (top + y(cs[1])) / 2, w * 0.9);
  }

  pipesSvg.setAttribute("width", W);
  pipesSvg.setAttribute("height", H);
  pipesSvg.innerHTML = `
    <defs>
      <linearGradient id="pp-brass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#a27a44"/><stop offset=".45" stop-color="#5c4020"/><stop offset="1" stop-color="#2a1a0a"/>
      </linearGradient>
      <radialGradient id="pp-bolt" cx=".35" cy=".35"><stop offset="0" stop-color="#b8b0a4"/><stop offset=".5" stop-color="#4c4640"/><stop offset="1" stop-color="#151311"/></radialGradient>
      <filter id="pp-shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="3" dy="5" stdDeviation="3" flood-opacity=".75"/></filter>
    </defs>
    <g filter="url(#pp-shadow)" fill="none" stroke-linejoin="round">${pipes}${fit}</g>`;
}

let pipesQueued = false;
function queuePipes() {
  if (pipesQueued) return;
  pipesQueued = true;
  requestAnimationFrame(() => { pipesQueued = false; drawPipes(); });
}
const pipeWatch = new ResizeObserver(queuePipes);

/* ---------- Steam ----------
   Billowing puffs drifting up over the whole page, plus the odd burst of a
   locomotive venting. Each puff is a slowly turning sprite of multi-octave
   value noise under a soft falloff, so it reads as wisps, not blobs. */

function steamSprite() {
  const S = 192, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S);
  const oct = [3, 6, 12, 24].map((n) => ({ n, v: Float32Array.from({ length: (n + 1) ** 2 }, Math.random) }));
  const ease = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let f = 0, amp = 0.53;
      for (const { n, v } of oct) {
        const fx = (x / S) * n, fy = (y / S) * n, ix = fx | 0, iy = fy | 0;
        const tx = ease(fx - ix), ty = ease(fy - iy), i = iy * (n + 1) + ix;
        const a = v[i] + (v[i + 1] - v[i]) * tx, b = v[i + n + 1] + (v[i + n + 2] - v[i + n + 1]) * tx;
        f += (a + (b - a) * ty) * amp;
        amp *= 0.5;
      }
      const fall = Math.max(0, 1 - Math.hypot((2 * x) / S - 1, (2 * y) / S - 1));
      const alpha = Math.min(1, Math.max(0, (f - 0.3 - (1 - fall) * 0.45) * 2.4)) * fall;
      const k = (y * S + x) * 4, shade = 165 + 85 * f; // crests catch more light
      img.data[k] = shade + 10;
      img.data[k + 1] = shade + 5;
      img.data[k + 2] = shade;
      img.data[k + 3] = alpha * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
const SPRITES = Array.from({ length: 6 }, steamSprite);

const RES = 1 / 1.5; // canvas pixels per CSS pixel
const sc = $("#steam"), sx = sc.getContext("2d");
const fitSteam = () => { sc.width = innerWidth * RES; sc.height = innerHeight * RES; };
fitSteam();
addEventListener("resize", fitSteam);

const puffs = [];
function addPuff(x, y, fast) {
  puffs.push({
    x, y, r: rand(45, 130), age: 0, life: rand(8e3, 18e3), a: rand(0.22, fast ? 0.75 : 0.5),
    img: SPRITES[Math.floor(Math.random() * SPRITES.length)],
    rot: rand(0, 6.3), vr: rand(-0.00015, 0.00015),
    vx: rand(-0.008, 0.008) + (fast ? rand(-0.04, 0.04) : 0),
    vy: -rand(0.012, 0.035) - (fast ? rand(0.04, 0.08) : 0),
  });
}
for (let i = 0; i < 80; i++) { addPuff(Math.random() * sc.width, Math.random() * sc.height * 1.2, false); puffs[i].age = Math.random() * puffs[i].life; }
let nextBurst = 3e3;

function steam(dt) {
  dt = Math.min(dt, 100);
  const w = sc.width, h = sc.height;
  if (puffs.length < 80) addPuff(rand(-0.1, 1.1) * w, h + 60, false);
  if ((nextBurst -= dt) < 0) {
    const x = rand(0, w), y = rand(h * 0.4, h);
    for (let i = 0; i < 16; i++) addPuff(x + rand(-40, 40), y + rand(-25, 25), true);
    nextBurst = rand(5e3, 14e3);
  }
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.clearRect(0, 0, w, h);
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.age += dt;
    if (p.age > p.life) { puffs.splice(i, 1); continue; }
    p.x += p.vx * dt + Math.sin((p.age + i * 999) / 1800) * 0.06;
    p.y += p.vy * dt;
    p.r += dt * 0.006;
    p.rot += p.vr * dt;
    // quick to appear, slow to dissolve
    sx.globalAlpha = p.a * Math.min(1, p.age / (p.life * 0.15)) * (1 - p.age / p.life);
    sx.setTransform(1, 0, 0, 1, p.x, p.y);
    sx.rotate(p.rot);
    sx.drawImage(p.img, -p.r, -p.r, p.r * 2, p.r * 2);
  }
}

/* ---------- Neon signs ----------
   The signs burn steadily; every few seconds one stutters (.flicker) or,
   about a third of the time, drops out completely for a while (.outage).
   A random duration stretches each pattern so no two dropouts match. */

function neonSigns(dt) {
  if (Math.random() > dt / 3000) return;
  const signs = [...document.querySelectorAll(".title, .plaque")]
    .filter((el) => !el.classList.contains("flicker") && !el.classList.contains("outage"));
  const el = signs[Math.floor(Math.random() * signs.length)];
  if (!el) return;
  const out = Math.random() < 0.35;
  el.style.animationDuration = (out ? rand(4, 10) : rand(1.2, 4)) + "s";
  el.classList.add(out ? "outage" : "flicker");
  el.addEventListener("animationend", () => el.classList.remove("flicker", "outage"), { once: true });
}

let last = performance.now();
function frame() {
  const now = Date.now();
  const t = performance.now();
  steam(t - last);
  neonSigns(t - last);
  if (data) {
    scheduleGlitches(counters, now, t - last);
    for (const c of counters) {
      const s = c.state(now);
      c.remaining = s.target - now;
      const tgt = c.row ?? c.el;
      if (c.cls !== s.cls) { tgt.classList.remove("st-" + c.cls); tgt.classList.add("st-" + s.cls); c.cls = s.cls; }
      c.set(c.remaining + (c.ep ? offsetAt(c.ep, now) : 0));
    }
  }
  last = t;
  requestAnimationFrame(frame);
}

async function load() {
  try {
    const res = await fetch("/api/schedule", { cache: "no-store" });
    if (!res.ok) return;
    const next = await res.json();
    if (JSON.stringify(next) === JSON.stringify(data)) return;
    data = next;
    render();
  } catch { /* offline: keep showing the last timetable */ }
}

load();
setInterval(load, 60e3);
requestAnimationFrame(frame);

/* ---------- Secret settings (press "t") ---------- */

const dlg = $("#settings");
const form = $("#settings-form");
const msg = $("#settings-msg");

// datetime-local works in local time without an offset.
const toLocal = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
};
const fromLocal = (v) => new Date(v).toISOString();

$("#track-fields").innerHTML = PORTAL.map((c, i) => `
  <fieldset style="--portal:${c}">
    <legend>Gleis ${i + 1}</legend>
    <label>Öffnet <input name="open${i}" type="datetime-local" required></label>
    <label>Schließt <input name="close${i}" type="datetime-local" required></label>
  </fieldset>`).join("");

function openSettings() {
  if (!data) return;
  const f = form.elements;
  f["final-name"].value = data.final.name;
  f["final-at"].value = toLocal(data.final.at);
  data.tracks.forEach((t, i) => {
    f["open" + i].value = toLocal(t.open);
    f["close" + i].value = toLocal(t.close);
  });
  try { f.pw.value = localStorage.getItem("stellwerk-pw") ?? ""; } catch { /* storage blocked */ }
  msg.textContent = "";
  dlg.showModal();
}

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "t" || e.ctrlKey || e.metaKey || e.altKey || dlg.open) return;
  if (e.target.closest?.("input, textarea")) return;
  openSettings();
});

$("#settings-cancel").addEventListener("click", () => dlg.close());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = form.elements;
  const next = {
    final: { name: f["final-name"].value.trim(), at: fromLocal(f["final-at"].value) },
    tracks: data.tracks.map((_, i) => ({
      open: fromLocal(f["open" + i].value),
      close: fromLocal(f["close" + i].value),
    })),
  };
  const bad = next.tracks.findIndex((t) => Date.parse(t.close) <= Date.parse(t.open));
  if (bad >= 0) { msg.textContent = `Gleis ${bad + 1}: Schließzeit muss nach der Öffnungszeit liegen.`; return; }

  msg.textContent = "Wird übermittelt …";
  try {
    const res = await fetch("/api/schedule", {
      method: "PUT",
      headers: { authorization: "Bearer " + f.pw.value, "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) { msg.textContent = await res.text(); return; }
  } catch {
    msg.textContent = "Keine Verbindung zum Stellwerk.";
    return;
  }
  try { localStorage.setItem("stellwerk-pw", f.pw.value); } catch { /* storage blocked */ }
  data = next;
  render();
  dlg.close();
});
