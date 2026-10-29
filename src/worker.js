// Serves the shared timetable. Static files are handled by [assets];
// only paths that aren't assets reach this worker.
const KEY = "schedule";

const iso = (ms) => new Date(ms).toISOString();
const H = 3600e3;

// Seeded on first read, until someone saves a schedule via the secret menu.
function defaults() {
  const now = Date.now();
  return {
    final: { name: "Die Große Konvergenz", at: iso(now + 72 * H) },
    tracks: [0, 1, 2, 3, 4, 5].map((i) => ({
      open: iso(now + (i * 9 + 0.5) * H),
      close: iso(now + (i * 9 + 3) * H),
    })),
  };
}

const isDate = (s) => typeof s === "string" && s.length < 40 && !Number.isNaN(Date.parse(s));
const isText = (s) => typeof s === "string" && s.length <= 60;

function valid(d) {
  return d && d.final && isText(d.final.name) && isDate(d.final.at) &&
    Array.isArray(d.tracks) && d.tracks.length === 6 &&
    d.tracks.every((t) => t && isDate(t.open) && isDate(t.close) &&
      (t.note === undefined || (typeof t.note === "string" && t.note.length <= 140)));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/schedule") return new Response("Nicht gefunden", { status: 404 });

    if (req.method === "GET") {
      let stored = await env.SCHEDULE.get(KEY);
      // Persist the defaults once so they don't slide forward on every request.
      if (!stored) await env.SCHEDULE.put(KEY, (stored = JSON.stringify(defaults())));
      return new Response(stored, {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    if (req.method === "PUT") {
      if (!env.ADMIN_PASSWORD || req.headers.get("authorization") !== `Bearer ${env.ADMIN_PASSWORD}`) {
        return new Response("Falsches Passwort", { status: 401 });
      }
      const body = await req.text();
      let data;
      try { data = JSON.parse(body); } catch { data = null; }
      if (body.length > 4000 || !valid(data)) return new Response("Ungültiger Fahrplan", { status: 400 });
      await env.SCHEDULE.put(KEY, JSON.stringify(data));
      return new Response("ok");
    }

    return new Response("Methode nicht erlaubt", { status: 405 });
  },
};
