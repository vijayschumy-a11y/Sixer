/* Sixer — data store (localStorage). No backend, no OTP. */
(function () {
  const KEY = 'sixer.db.v1';
  const APP = (window.Sixer = window.Sixer || {});

  const blank = () => ({
    version: 1,
    players: [],   // {id,name,photo,role,batHand,bowlStyle,createdAt}
    teams: [],     // {id,name,players:[pid],createdAt}
    tournaments: [], // {id,name,date,format,teamIds:[],rules:{},fixtures:[],status}
    sessions: [],  // {id,name,date,note}
    matches: [],   // see scoring.js for shape
    settings: {
      appName: 'Sixer',
      defaults: {
        format: 'box',
        oversPerInnings: 6,
        playersPerSide: 8,
        lastManStanding: true,
        lastManEvenOnly: false,
        reBowlWide: true,
        reBowlNoBall: true,
        wideRuns: 1,
        noBallRuns: 1,
        noBallFreeHit: false,
        singleBatsman: false,
      },
    },
  });

  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const parsed = JSON.parse(raw);
      const base = blank();
      return Object.assign(base, parsed, {
        settings: Object.assign(base.settings, parsed.settings || {}, {
          defaults: Object.assign(base.settings.defaults, (parsed.settings || {}).defaults || {}),
        }),
      });
    } catch (e) {
      console.warn('DB load failed, starting fresh', e);
      return blank();
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      APP.toast && APP.toast('Storage full — export & clear old data', 'err');
      console.error(e);
    }
  }

  const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  /* ---------- Players ---------- */
  const Players = {
    all: () => db.players.slice().sort((a, b) => a.name.localeCompare(b.name)),
    get: (id) => db.players.find((p) => p.id === id),
    add(data) {
      const p = Object.assign(
        { id: uid('pl'), name: '', photo: '', role: 'allrounder', batHand: 'right', bowlStyle: 'right-arm', createdAt: Date.now() },
        data
      );
      db.players.push(p);
      persist();
      return p;
    },
    update(id, data) {
      const p = Players.get(id);
      if (p) { Object.assign(p, data); persist(); }
      return p;
    },
    remove(id) {
      db.players = db.players.filter((p) => p.id !== id);
      persist();
    },
  };

  /* ---------- Teams (saved squads) ---------- */
  const Teams = {
    all: () => db.teams.slice().sort((a, b) => a.name.localeCompare(b.name)),
    get: (id) => db.teams.find((t) => t.id === id),
    add(data) {
      const t = Object.assign({ id: uid('tm'), name: '', players: [], createdAt: Date.now() }, data);
      db.teams.push(t); persist(); return t;
    },
    update(id, data) { const t = Teams.get(id); if (t) { Object.assign(t, data); persist(); } return t; },
    remove(id) { db.teams = db.teams.filter((t) => t.id !== id); persist(); },
  };

  /* ---------- Tournaments ---------- */
  const Tournaments = {
    all: () => db.tournaments.slice().sort((a, b) => b.date - a.date),
    get: (id) => db.tournaments.find((t) => t.id === id),
    add(data) {
      const t = Object.assign({
        id: uid('tr'), name: '', date: Date.now(), format: 'league_playoffs',
        teamIds: [], rules: {}, fixtures: [], status: 'league',
      }, data);
      db.tournaments.push(t); persist(); return t;
    },
    update(id, data) { const t = Tournaments.get(id); if (t) { Object.assign(t, data); persist(); } return t; },
    save(t) { const i = db.tournaments.findIndex((x) => x.id === t.id); if (i >= 0) db.tournaments[i] = t; else db.tournaments.push(t); persist(); return t; },
    remove(id) {
      db.tournaments = db.tournaments.filter((t) => t.id !== id);
      db.matches = db.matches.filter((m) => m.tournamentId !== id);
      persist();
    },
    matches: (id) => db.matches.filter((m) => m.tournamentId === id),
  };

  /* ---------- Sessions (weekly) ---------- */
  const Sessions = {
    all: () => db.sessions.slice().sort((a, b) => b.date - a.date),
    get: (id) => db.sessions.find((s) => s.id === id),
    add(data) {
      const s = Object.assign({ id: uid('se'), name: '', date: data.date || Date.now(), note: '' }, data);
      db.sessions.push(s);
      persist();
      return s;
    },
    update(id, data) { const s = Sessions.get(id); if (s) { Object.assign(s, data); persist(); } return s; },
    remove(id) {
      db.sessions = db.sessions.filter((s) => s.id !== id);
      db.matches = db.matches.filter((m) => m.sessionId !== id);
      persist();
    },
    matches: (id) => db.matches.filter((m) => m.sessionId === id),
  };

  /* ---------- Matches ---------- */
  const Matches = {
    all: () => db.matches.slice().sort((a, b) => b.date - a.date),
    get: (id) => db.matches.find((m) => m.id === id),
    save(match) {
      const i = db.matches.findIndex((m) => m.id === match.id);
      if (i >= 0) db.matches[i] = match; else db.matches.push(match);
      persist();
      return match;
    },
    remove(id) { db.matches = db.matches.filter((m) => m.id !== id); persist(); },
    live: () => db.matches.filter((m) => m.status === 'live').sort((a, b) => b.date - a.date),
  };

  /* ---------- Settings / backup ---------- */
  const Settings = {
    get: () => db.settings,
    update(data) { Object.assign(db.settings, data); persist(); return db.settings; },
    updateDefaults(data) { Object.assign(db.settings.defaults, data); persist(); return db.settings.defaults; },
  };

  function exportJSON() { return JSON.stringify(db, null, 2); }
  function importJSON(str) {
    const data = JSON.parse(str);
    if (!data || !Array.isArray(data.players)) throw new Error('Not a Sixer backup');
    db = Object.assign(blank(), data);
    persist();
  }
  function wipe() { db = blank(); persist(); }

  APP.uid = uid;
  APP.store = { Players, Teams, Tournaments, Sessions, Matches, Settings, exportJSON, importJSON, wipe, raw: () => db };
})();
