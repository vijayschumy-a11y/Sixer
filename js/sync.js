/* Sixer — live match sync over Firebase Realtime Database.
   Many phones watch one room; any phone can claim the scorer role mid-match. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});

  const CLIENT_KEY = 'sixer.clientId';
  let clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) { clientId = 'c_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(CLIENT_KEY, clientId); }

  let fb = null, database = null, inited = false, initFailed = false;
  const state = { code: null, scorer: null, refs: [], onMatch: null, onScorer: null };

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
  function payloadFor(match) {
    const names = {};
    match.teams.forEach((t) => t.players.forEach((pid) => {
      names[pid] = (APP.syncNames && APP.syncNames[pid]) || (APP.store.Players.get(pid) || {}).name || 'Player';
    }));
    return { match: JSON.parse(JSON.stringify(match)), names, updatedAt: Date.now() };
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

  /* Subscribe to a room. onMatch(payload) / onScorer(scorerObj) fire on every change. */
  function join(code, onMatch, onScorer) {
    if (!init()) return false;
    leave();
    state.code = code; state.onMatch = onMatch; state.onScorer = onScorer;
    const dataRef = database.ref('rooms/' + code + '/data');
    const scorerRef = database.ref('rooms/' + code + '/scorer');
    const dataCb = dataRef.on('value', (s) => { const v = s.val(); if (v && onMatch) onMatch(v); });
    const scorerCb = scorerRef.on('value', (s) => { state.scorer = s.val(); if (onScorer) onScorer(state.scorer); });
    state.refs = [[dataRef, dataCb], [scorerRef, scorerCb]];
    return true;
  }

  function leave() {
    state.refs.forEach(([ref, cb]) => { try { ref.off('value', cb); } catch (e) {} });
    state.refs = []; state.code = null; state.scorer = null; state.onMatch = null; state.onScorer = null;
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
    amScorer, clientId: () => clientId,
    currentScorer: () => state.scorer,
    activeCode: () => state.code,
  };
})();
