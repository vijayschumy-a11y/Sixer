/* Sixer — live match sync over Firebase Realtime Database.
   Many phones watch one room; any phone can claim the scorer role mid-match. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});

  const CLIENT_KEY = 'sixer.clientId';
  let clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) { clientId = 'c_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(CLIENT_KEY, clientId); }

  let fb = null, database = null, inited = false, initFailed = false;
  const state = {
    code: null, scorer: null, presence: {}, refs: [],
    heartbeat: null, connRef: null, connCb: null, meRef: null,
    onMatch: null, onScorer: null, onPresence: null, onRequest: null,
  };

  function configured() {
    const c = window.SIXER_FIREBASE;
    return !!(c && c.databaseURL && c.apiKey && c.projectId);
  }
  function available() { return configured() && typeof firebase !== 'undefined'; }

  function init() {
    if (inited) return !initFailed;
    inited = true;
    if (!available()) { initFailed = true; return false; }
    try {
      fb = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(window.SIXER_FIREBASE);
      database = firebase.database();
      return true;
    } catch (e) { console.warn('Firebase init failed', e); initFailed = true; return false; }
  }

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1
  function genCode() { let s = ''; for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }

  /* Build a name map + team names so viewers (who lack local players) can render. */
  // Fields viewers don't need — stripping them keeps each publish tiny (no lag).
  const OMIT = { undoStack: 1 };
  function payloadFor(match) {
    const names = {};
    match.teams.forEach((t) => t.players.forEach((pid) => {
      names[pid] = (APP.syncNames && APP.syncNames[pid]) || (APP.store.Players.get(pid) || {}).name || 'Player';
    }));
    const clean = JSON.parse(JSON.stringify(match, (k, v) => (OMIT[k] ? undefined : v)));
    return { match: clean, names, updatedAt: Date.now() };
  }

  function amScorer() { return !!(state.scorer && state.scorer.id === clientId); }

  /* Create a room for a match, become the scorer, publish. Returns code (or null). */
  function createRoom(match, scorerName) {
    if (!init()) return Promise.resolve(null);
    const code = genCode();
    const ref = database.ref('rooms/' + code);
    return ref.child('data').set(payloadFor(match))
      .then(() => ref.child('scorer').set({ id: clientId, name: scorerName || 'Scorer', ts: Date.now() }))
      .then(() => code)
      .catch((e) => { console.warn('createRoom failed', e); return null; });
  }

  /* Subscribe to a room. cbs = { onMatch, onScorer, onPresence, onRequest }. */
  function join(code, cbs) {
    if (!init()) return false;
    leave();
    cbs = cbs || {};
    state.code = code;
    state.onMatch = cbs.onMatch; state.onScorer = cbs.onScorer;
    state.onPresence = cbs.onPresence; state.onRequest = cbs.onRequest;
    const base = 'rooms/' + code;
    const dataRef = database.ref(base + '/data');
    const scorerRef = database.ref(base + '/scorer');
    const presRef = database.ref(base + '/presence');
    const reqRef = database.ref(base + '/request');
    const dataCb = dataRef.on('value', (s) => { const v = s.val(); if (v && state.onMatch) state.onMatch(v); });
    const scorerCb = scorerRef.on('value', (s) => { state.scorer = s.val(); if (state.onScorer) state.onScorer(state.scorer); });
    const presCb = presRef.on('value', (s) => { state.presence = s.val() || {}; if (state.onPresence) state.onPresence(presenceCount(), state.presence); });
    const reqCb = reqRef.on('value', (s) => { if (state.onRequest) state.onRequest(s.val()); });
    state.refs = [[dataRef, dataCb], [scorerRef, scorerCb], [presRef, presCb], [reqRef, reqCb]];
    registerPresence(code);
    return true;
  }

  /* Presence: mark this device connected; auto-remove on disconnect; heartbeat. */
  function registerPresence(code) {
    const meRef = database.ref('rooms/' + code + '/presence/' + clientId);
    state.meRef = meRef;
    const connRef = database.ref('.info/connected');
    state.connRef = connRef;
    state.connCb = connRef.on('value', (s) => {
      if (s.val() === true) { meRef.onDisconnect().remove(); meRef.set(Date.now()); }
    });
    state.heartbeat = setInterval(() => { try { meRef.set(Date.now()); } catch (e) {} }, 25000);
  }

  function presenceCount() { return Object.keys(state.presence || {}).length; }
  function viewerCount() { return Math.max(0, presenceCount() - 1); } // everyone except the one scorer
  function isPresent(id) { return !!(id && state.presence && state.presence[id]); }

  function leave() {
    state.refs.forEach(([ref, cb]) => { try { ref.off('value', cb); } catch (e) {} });
    if (state.heartbeat) clearInterval(state.heartbeat);
    if (state.connRef && state.connCb) { try { state.connRef.off('value', state.connCb); } catch (e) {} }
    if (state.meRef) { try { state.meRef.remove(); } catch (e) {} }
    state.refs = []; state.heartbeat = null; state.connRef = null; state.connCb = null; state.meRef = null;
    state.code = null; state.scorer = null; state.presence = {};
    state.onMatch = state.onScorer = state.onPresence = state.onRequest = null;
  }

  /* ----- Request-to-score handshake ----- */
  function requestScorer(name) {
    if (!database || !state.code) return Promise.resolve(false);
    return database.ref('rooms/' + state.code + '/request').set({ id: clientId, name: name || 'Scorer', ts: Date.now() }).then(() => true).catch(() => false);
  }
  function cancelRequest() {
    if (!database || !state.code) return Promise.resolve();
    return database.ref('rooms/' + state.code + '/request').remove().catch(() => {});
  }
  function approveRequest() {
    if (!database || !state.code) return Promise.resolve(false);
    const base = 'rooms/' + state.code;
    return database.ref(base + '/request').once('value').then((s) => {
      const req = s.val(); if (!req) return false;
      return database.ref(base + '/scorer').set({ id: req.id, name: req.name, ts: Date.now() })
        .then(() => database.ref(base + '/request').remove()).then(() => true);
    }).catch(() => false);
  }
  function declineRequest() {
    if (!database || !state.code) return Promise.resolve();
    return database.ref('rooms/' + state.code + '/request').remove().catch(() => {});
  }

  /* ---------- Whole-database cloud backup/restore ---------- */
  function cloudBackup(code, jsonStr) {
    if (!init()) return Promise.resolve(false);
    return database.ref('backups/' + code).set({ data: jsonStr, ts: Date.now() }).then(() => true).catch((e) => { console.warn('backup failed', e); return false; });
  }
  function cloudRestore(code) {
    if (!init()) return Promise.resolve(null);
    return database.ref('backups/' + code).once('value').then((s) => { const v = s.val(); return v && v.data ? v : null; }).catch(() => null);
  }

  /* One-shot read of a room's current state (for the Home rejoin banner). */
  function peekRoom(code) {
    if (!init()) return Promise.resolve(null);
    const base = 'rooms/' + code;
    return Promise.all([
      database.ref(base + '/data').once('value'),
      database.ref(base + '/scorer').once('value'),
    ]).then(([d, s]) => {
      const data = d.val();
      if (!data || !data.match) return { code, exists: false };
      const m = data.match;
      const title = (m.teams && m.teams.length) ? m.teams.map((t) => t.name).join(' vs ') : 'Live match';
      const inn = m.innings && m.innings.length ? m.innings[m.innings.length - 1] : null;
      const score = inn ? (inn.runs + '/' + inn.wickets) : '';
      return { code, exists: true, status: m.status, title, score, scorer: (s.val() || {}).name || '' };
    }).catch(() => ({ code, exists: false }));
  }

  /* Push the latest match state (only meaningful when you are the scorer). */
  function publish(match) {
    if (!database || !state.code) return;
    database.ref('rooms/' + state.code + '/data').set(payloadFor(match)).catch(() => {});
  }

  /* Take the pen mid-match. */
  function claimScorer(name) {
    if (!database || !state.code) return Promise.resolve(false);
    return database.ref('rooms/' + state.code + '/scorer').set({ id: clientId, name: name || 'Scorer', ts: Date.now() })
      .then(() => true).catch(() => false);
  }

  APP.sync = {
    configured, available, init, createRoom, join, leave, publish, claimScorer,
    requestScorer, cancelRequest, approveRequest, declineRequest, peekRoom,
    cloudBackup, cloudRestore,
    presenceCount, viewerCount, isPresent,
    amScorer, clientId: () => clientId,
    currentScorer: () => state.scorer,
    activeCode: () => state.code,
  };
})();
