/* Sixer — app shell: router + screens. */
(function () {
  const APP = window.Sixer;
  const { $, $$, esc, toast, avatar, pname, sheet, pick, confirm, prompt, statTile, fmtDate, fmtDay, fmtTime, fmtDateTime, toDatetimeLocal, download } = APP.ui;
  const S = APP.store, SC = APP.scoring, ST = APP.stats, TR = APP.tournament, SY = APP.sync;

  // player object, or a lightweight stand-in for viewers who don't hold the squad locally
  const pl = (id) => S.Players.get(id) || { id, name: APP.ui.pname(id), role: '' };

  function deviceName() {
    let n = localStorage.getItem('sixer.deviceName');
    if (!n) { n = 'Scorer'; }
    return n;
  }
  function setDeviceName(n) { if (n) localStorage.setItem('sixer.deviceName', n); }

  const BRAND = S.Settings.get().appName || 'Sixer';

  let route = { name: 'home', params: {} };

  function go(name, params = {}) { route = { name, params }; render(); window.scrollTo(0, 0); }
  APP.go = go;

  function setNav() {
    $$('#bottomnav button').forEach((b) => b.classList.toggle('active', b.dataset.route === route.name));
  }

  function render() {
    setNav();
    const screen = $('#screen');
    const actions = $('#topbar-actions');
    actions.innerHTML = '';
    const fn = SCREENS[route.name] || SCREENS.home;
    fn(screen, route.params, actions);
  }

  /* =========================================================
     HOME / DASHBOARD
  ========================================================= */
  function homeScreen(screen) {
    const live = S.Matches.live();
    const players = S.Players.all();
    const matches = S.Matches.all();
    const recent = matches.filter((m) => m.status === 'complete').slice(0, 4);

    screen.innerHTML = `
      <div class="screen-title"><h2>Welcome 🏏</h2></div>

      ${live.length ? `<div class="card" style="border-color:#5a2020">
        <div class="row spread"><b>Live now</b><span class="badge live">● LIVE</span></div>
        ${live.map((m) => liveCardHTML(m)).join('')}
      </div>` : ''}

      <div id="rejoin-slot"></div>`;
    // (rest appended below)
    screen.innerHTML += `

      <div class="grid cols-2" style="margin-top:12px">
        ${statTile(players.length, 'Players')}
        ${statTile(matches.length, 'Matches')}
      </div>

      <button class="btn primary block" style="margin-top:14px;padding:16px" id="h-new">🏏 Start a new match</button>
      <div class="grid cols-2" style="margin-top:10px">
        <button class="btn" id="h-addp">➕ Add player</button>
        <button class="btn" id="h-watch">👀 Watch live</button>
      </div>
      <button class="btn ghost block" id="h-stats" style="margin-top:10px">📊 Leaderboards</button>

      <div class="screen-title" style="margin-top:22px"><h2 style="font-size:18px">Recent results</h2></div>
      ${recent.length ? recent.map((m) => matchListItem(m)).join('') :
        `<div class="empty"><div class="big">🦗</div>No matches yet. Start your first game!</div>`}

      <div class="divider"></div>
      <button class="btn ghost block small" id="h-settings">⚙️ Settings & backup</button>
    `;
    $('#h-new').onclick = () => chooseGameMode();
    $('#h-addp').onclick = () => go('players', { add: true });
    $('#h-watch').onclick = () => {
      if (!SY.available()) return liveSetupNeeded();
      prompt('Watch a live match', 'Enter the 4-letter match code', '', (v) => watchRoom(v), 'e.g. KPWA');
    };
    $('#h-stats').onclick = () => go('stats');
    $('#h-settings').onclick = () => go('settings');
    $$('#screen [data-match]').forEach((e) => e.onclick = () => {
      const m = S.Matches.get(e.dataset.match);
      go(m.status === 'live' ? 'live' : 'scorecard', { id: m.id });
    });
    loadRejoinBanner();
  }

  /* Check saved rooms against Firebase; show still-live ones for one-tap rejoin. */
  function loadRejoinBanner() {
    const recent = S.Rooms.recent();
    const slot = document.getElementById('rejoin-slot');
    if (!slot || !recent.length || !SY.available()) return;
    const localLive = new Set(S.Matches.live().map((m) => m.roomCode).filter(Boolean));
    Promise.all(recent.map((r) => SY.peekRoom(r.code))).then((results) => {
      results.forEach((x) => { if (x && (!x.exists || x.status === 'complete')) S.Rooms.forget(x.code); });
      const live = results.filter((x) => x && x.exists && x.status === 'live' && !localLive.has(x.code));
      if (route.name !== 'home') return;
      if (!live.length) { slot.innerHTML = ''; return; }
      slot.innerHTML = `<div class="card" style="border-color:#5a2020;margin-top:12px">
        <div class="row spread"><b>Live to watch</b><span class="badge live">● LIVE</span></div>
        ${live.map((x) => `<div class="list-link rejoin" data-code="${esc(x.code)}" style="margin-top:10px">
          <div style="min-width:0"><b>${esc(x.title || 'Live match')}</b>
            <div class="small muted">${x.score ? esc(x.score) + ' · ' : ''}${x.scorer ? esc(x.scorer) + ' scoring · ' : ''}code ${esc(x.code)}</div></div>
          <span class="badge live">Rejoin ▸</span></div>`).join('')}</div>`;
      slot.querySelectorAll('.rejoin').forEach((el) => el.onclick = () => watchRoom(el.dataset.code));
    }).catch(() => {});
  }

  // Ask what kind of game before setup: single, one-day session, or tournament
  function chooseGameMode() {
    const s = sheet('What are you playing?', `<div class="opt-list">
      <button class="opt" data-m="quick"><div style="flex:1"><div>🏏 Quick match</div><div class="small muted">A single game</div></div></button>
      <button class="opt" data-m="day"><div style="flex:1"><div>📅 One-day session</div><div class="small muted">Many matches, same teams, awards of the day</div></div></button>
      <button class="opt" data-m="cup"><div style="flex:1"><div>🏆 Tournament</div><div class="small muted">League table with NRR, semis & final</div></div></button>
    </div>`);
    $$('.opt', s.overlay).forEach((b) => b.onclick = () => {
      const m = b.dataset.m; s.close();
      if (m === 'quick') { draft = null; go('newmatch'); }
      else if (m === 'day') startDaySession();
      else if (m === 'cup') { competeTab = 'cups'; newTournament(); }
    });
  }
  function startDaySession() {
    prompt('One-day session', 'Name', 'Session ' + fmtDate(Date.now()), (v) => {
      const se = S.Sessions.add({ name: v || ('Session ' + fmtDate(Date.now())) });
      go('session', { id: se.id });
    });
  }

  function liveCardHTML(m) {
    const inn = SC.cur(m);
    const bat = SC.teamName(m, inn.battingTeam);
    return `<div class="list-link" data-match="${m.id}" style="margin-top:10px">
      <div><b>${esc(bat)}</b> ${inn.runs}/${inn.wickets}
        <span class="muted small">(${SC.oversText(inn.legalBalls)} ov)</span>
        ${inn.target ? `<div class="small muted">Target ${inn.target} · need ${Math.max(0, inn.target - inn.runs)}</div>` : ''}
      </div><span class="badge live">Resume ▸</span>
    </div>`;
  }

  function matchListItem(m) {
    const a = m.innings[0], b = m.innings[1];
    const sa = a ? `${a.runs}/${a.wickets}` : '—';
    const sb = b ? `${b.runs}/${b.wickets}` : '';
    return `<div class="list-link" data-match="${m.id}">
      <div style="min-width:0">
        <div><b>${esc(SC.teamName(m, 0))}</b> vs <b>${esc(SC.teamName(m, 1))}</b></div>
        <div class="small muted">${esc(m.result || 'In progress')} · ${fmtDateTime(m.date)}${m.venue ? ' · 📍 ' + esc(m.venue) : ''}</div>
      </div>
      <span class="badge ${m.status === 'live' ? 'live' : 'done'}">${m.status === 'live' ? 'LIVE' : 'Result'}</span>
    </div>`;
  }

  /* =========================================================
     PLAYERS
  ========================================================= */
  let squadTab = 'players';
  function playersScreen(screen, params, actions) {
    const players = S.Players.all();
    if (params.tab) squadTab = params.tab;
    actions.innerHTML = `<button class="btn sm primary" id="pa-add">➕ Add</button>`;
    if (squadTab === 'teams') return teamsTab(screen, actions);

    screen.innerHTML = `
      <div class="screen-title"><h2>Squad</h2><span class="muted small">${players.length} players</span></div>
      <div class="tabs" style="margin-bottom:12px">
        <button data-sq="players" class="active">👥 Players</button>
        <button data-sq="teams">🛡️ Teams</button>
      </div>
      <label class="field"><input id="pl-search" placeholder="🔍 Search players"></label>
      <div class="plist" id="pl-list">
        ${players.length ? players.map(playerRow).join('') :
          `<div class="empty"><div class="big">👥</div>No players yet. Add your squad — with photos!</div>`}
      </div>`;
    $$('#screen [data-sq]').forEach((b) => b.onclick = () => { squadTab = b.dataset.sq; render(); });
    $('#pa-add').onclick = () => editPlayer(null);
    $('#pl-search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $('#pl-list').innerHTML = players.filter((p) => p.name.toLowerCase().includes(q)).map(playerRow).join('');
      bindRows();
    };
    function bindRows() {
      $$('#pl-list [data-pl]').forEach((el) => el.onclick = () => go('player', { id: el.dataset.pl }));
    }
    bindRows();
    if (params.add) editPlayer(null);
  }

  /* ---- Teams (saved squads) ---- */
  function teamsTab(screen, actions) {
    const teams = S.Teams.all();
    actions.innerHTML = `<button class="btn sm primary" id="tm-add">➕ Team</button>`;
    screen.innerHTML = `
      <div class="screen-title"><h2>Squad</h2><span class="muted small">${teams.length} teams</span></div>
      <div class="tabs" style="margin-bottom:12px">
        <button data-sq="players">👥 Players</button>
        <button data-sq="teams" class="active">🛡️ Teams</button>
      </div>
      <p class="muted small">Save a team once, then just pick it when starting a match or tournament.</p>
      <div class="plist" style="margin-top:10px">
        ${teams.length ? teams.map((t) => `<div class="prow" data-tm="${t.id}" style="align-items:flex-start">
            ${teamLogoHTML(t)}
            <div class="meta"><div class="nm">${esc(t.name)} <span class="muted small">· ${t.players.length}</span></div>
              <div class="sub">${t.players.length ? t.players.map((id) => esc(pname(id))).join(', ') : 'No players yet'}</div></div>
            <span class="muted">›</span></div>`).join('')
          : `<div class="empty"><div class="big">🛡️</div>No teams yet. Create one to run a tournament.</div>`}
      </div>`;
    $$('#screen [data-sq]').forEach((b) => b.onclick = () => { squadTab = b.dataset.sq; render(); });
    $('#tm-add').onclick = () => editTeam(null);
    $$('#screen [data-tm]').forEach((e) => e.onclick = () => editTeam(e.dataset.tm));
  }
  function initialsOf(n) { return (n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
  function teamLogoHTML(team, cls) {
    if (team && team.logo) return `<img class="avatar ${cls || ''}" src="${team.logo}" alt="">`;
    return `<div class="avatar ${cls || ''}">${esc(initialsOf(team && team.name || ''))}</div>`;
  }

  function editTeam(id) {
    const t = id ? S.Teams.get(id) : null;
    const sel = new Set(t ? t.players : []);
    const players = S.Players.all();
    let logo = t ? (t.logo || '') : '';
    const s = sheet(t ? 'Edit team' : 'New team', `
      <div class="center"><div id="tm-logo" style="display:inline-block">${teamLogoHTML({ logo, name: t ? t.name : '' }, 'xl')}</div></div>
      <button class="btn block" id="tm-logo-btn" style="margin-top:10px">🖼️ Team logo</button>
      <label class="field"><span>Team name</span><input id="tm-name" value="${esc(t ? t.name : '')}" placeholder="e.g. Chennai Smashers"></label>
      <div class="small muted" style="margin:6px 0">Tap players to add them to this team</div>
      <div class="plist" id="tm-pool" style="max-height:46vh;overflow:auto">
        ${players.length ? players.map((p) => `<div class="prow" data-p="${p.id}" style="${sel.has(p.id) ? 'border-color:var(--green);background:var(--green-d)' : ''}">
            ${avatar(p)}<div class="meta"><div class="nm">${esc(p.name)}</div>
            <div class="sub">${ROLE_LABEL[p.role] || p.role}</div></div>
            <span class="pill ${sel.has(p.id) ? 'on' : ''}">${sel.has(p.id) ? '✓' : '+'}</span></div>`).join('')
          : '<div class="muted small">Add players first.</div>'}
      </div>
      <div class="small muted center" id="tm-count" style="margin-top:8px">${sel.size} selected</div>
      <button class="btn primary block" id="tm-save" style="margin-top:10px">${t ? 'Save team' : 'Create team'}</button>
      ${t ? `<button class="btn danger block" id="tm-del" style="margin-top:8px">Delete team</button>` : ''}`);
    $$('#tm-pool [data-p]', s.overlay).forEach((row) => row.onclick = () => {
      const pid = row.dataset.p;
      if (sel.has(pid)) { sel.delete(pid); row.style.borderColor = ''; row.style.background = ''; row.querySelector('.pill').className = 'pill'; row.querySelector('.pill').textContent = '+'; }
      else { sel.add(pid); row.style.borderColor = 'var(--green)'; row.style.background = 'var(--green-d)'; row.querySelector('.pill').className = 'pill on'; row.querySelector('.pill').textContent = '✓'; }
      $('#tm-count', s.overlay).textContent = sel.size + ' selected';
    });
    $('#tm-logo-btn', s.overlay).onclick = () => APP.photo.capture((data) => { if (data) { logo = data; $('#tm-logo', s.overlay).innerHTML = teamLogoHTML({ logo, name: $('#tm-name', s.overlay).value }, 'xl'); } });
    $('#tm-save', s.overlay).onclick = () => {
      const name = $('#tm-name', s.overlay).value.trim();
      if (!name) return toast('Enter a team name', 'err');
      if (!sel.size) return toast('Pick at least one player', 'err');
      const data = { name, players: Array.from(sel), logo };
      if (t) S.Teams.update(t.id, data); else S.Teams.add(data);
      s.close(); toast(t ? 'Team saved' : 'Team created'); render();
    };
    if (t) $('#tm-del', s.overlay).onclick = () => confirm('Delete team?', `Remove ${t.name}? Past matches keep their scorecards.`, () => {
      S.Teams.remove(t.id); s.close(); render();
    }, 'Delete', true);
  }

  const ROLE_LABEL = { batsman: 'Batsman', bowler: 'Bowler', allrounder: 'All-rounder', keeper: 'Wicket-keeper' };
  function playerRow(p) {
    return `<div class="prow" data-pl="${p.id}">
      ${avatar(p)}
      <div class="meta"><div class="nm">${p.jersey ? `<span class="jersey">#${esc(p.jersey)}</span> ` : ''}${esc(p.name)}</div>
        <div class="sub">${ROLE_LABEL[p.role] || p.role} · ${p.batHand === 'left' ? 'LHB' : 'RHB'}</div></div>
      <span class="muted">›</span>
    </div>`;
  }

  function editPlayer(id) {
    const p = id ? S.Players.get(id) : null;
    const draft = { photo: p ? p.photo : '', name: p ? p.name : '', role: p ? p.role : 'allrounder',
      batHand: p ? p.batHand : 'right', bowlStyle: p ? p.bowlStyle : 'right-arm', jersey: p ? (p.jersey || '') : '' };
    const s = sheet(p ? 'Edit player' : 'Add player', `
      <div class="center"><div id="ep-ava" style="display:inline-block">${avatar(draft.photo ? draft : null, 'xl')}</div></div>
      <button class="btn block" id="ep-photo" style="margin-top:10px">📸 Take / change photo</button>
      <div class="grid cols-2">
        <label class="field"><span>Name</span><input id="ep-name" value="${esc(draft.name)}" placeholder="Player name"></label>
        <label class="field"><span>Jersey #</span><input id="ep-jersey" type="number" min="0" max="999" value="${esc(draft.jersey)}" placeholder="e.g. 7"></label>
      </div>
      <label class="field"><span>Role</span>
        <select id="ep-role">
          ${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${draft.role === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
      <div class="grid cols-2">
        <label class="field"><span>Batting</span>
          <select id="ep-bat"><option value="right" ${draft.batHand === 'right' ? 'selected' : ''}>Right hand</option>
          <option value="left" ${draft.batHand === 'left' ? 'selected' : ''}>Left hand</option></select></label>
        <label class="field"><span>Bowling</span>
          <select id="ep-bowl">
            ${['right-arm', 'left-arm', 'right-spin', 'left-spin', 'none'].map((b) => `<option value="${b}" ${draft.bowlStyle === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select></label>
      </div>
      <button class="btn primary block" id="ep-save" style="margin-top:12px">${p ? 'Save changes' : 'Add player'}</button>
      ${p ? `<button class="btn danger block" id="ep-del" style="margin-top:8px">Delete player</button>` : ''}
    `);
    function refreshAva() { $('#ep-ava', s.overlay).innerHTML = avatar(draft.photo ? draft : null, 'xl'); }
    $('#ep-photo', s.overlay).onclick = () => APP.photo.capture((data) => { if (data) { draft.photo = data; refreshAva(); } });
    $('#ep-save', s.overlay).onclick = () => {
      const name = $('#ep-name', s.overlay).value.trim();
      if (!name) return toast('Enter a name', 'err');
      const data = { name, photo: draft.photo, role: $('#ep-role', s.overlay).value,
        batHand: $('#ep-bat', s.overlay).value, bowlStyle: $('#ep-bowl', s.overlay).value,
        jersey: ($('#ep-jersey', s.overlay).value || '').trim() };
      if (p) S.Players.update(p.id, data); else S.Players.add(data);
      s.close(); toast(p ? 'Player updated' : 'Player added'); render();
    };
    if (p) $('#ep-del', s.overlay).onclick = () => confirm('Delete player?', `Remove ${p.name}? Their match stats stay in past matches.`, () => {
      S.Players.remove(p.id); s.close(); toast('Deleted'); go('players');
    }, 'Delete', true);
  }

  function badge(emoji, n, label) {
    return `<div class="badge-tile ${n ? '' : 'off'}"><div class="bt-emoji">${emoji}</div><div class="bt-n">${n}</div><div class="bt-l">${esc(label)}</div></div>`;
  }

  function playerProfile(screen, params, actions) {
    const p = S.Players.get(params.id);
    if (!p) return go('players');
    const c = ST.career(p.id);
    const f = ST.fmt(c);
    const ms = ST.milestones(p.id);
    const recent = ST.form(p.id, null, 5);
    actions.innerHTML = `<button class="btn sm" id="pp-edit">Edit</button>`;
    screen.innerHTML = `
      <div class="card center">
        ${avatar(p, 'xl')}
        <h2 style="margin-top:10px">${p.jersey ? `<span class="jersey">#${esc(p.jersey)}</span> ` : ''}${esc(p.name)}</h2>
        <div class="muted small">${ROLE_LABEL[p.role] || p.role} · ${p.batHand === 'left' ? 'Left-hand bat' : 'Right-hand bat'} · ${esc(p.bowlStyle)}</div>
        <div class="row" style="justify-content:center;gap:6px;margin-top:8px">
          <span class="pill">${c.mat} matches</span>
          <span class="pill">${c.runs} runs</span>
          <span class="pill">${c.wkts} wkts</span>
        </div>
      </div>

      <div class="card">
        <h4 style="color:var(--green)">Batting</h4>
        <div class="grid cols-3" style="margin-top:8px">
          ${statTile(c.runs, 'Runs')}${statTile(c.hs + (c.hsNotOut ? '*' : ''), 'Best')}${statTile(f.avg, 'Avg')}
          ${statTile(f.sr, 'SR')}${statTile(c.fours, 'Fours')}${statTile(c.sixes, 'Sixes')}
          ${statTile(c.inns, 'Innings')}${statTile(c.notOut, 'Not out')}${statTile(c.thirties + c.fifties + c.hundreds, '30+')}
        </div>
      </div>

      <div class="card">
        <h4 style="color:var(--green)">Bowling</h4>
        <div class="grid cols-3" style="margin-top:8px">
          ${statTile(c.wkts, 'Wickets')}${statTile(f.best, 'Best')}${statTile(f.econ, 'Econ')}
          ${statTile(f.overs, 'Overs')}${statTile(c.bRuns, 'Runs')}${statTile(f.bowlAvg, 'Avg')}
        </div>
      </div>

      <div class="card">
        <h4 style="color:var(--green)">Fielding</h4>
        <div class="grid cols-3" style="margin-top:8px">
          ${statTile(c.catches, 'Catches')}${statTile(c.runouts, 'Run outs')}${statTile(c.stumpings, 'Stumpings')}
        </div>
      </div>

      <div class="card">
        <h4 style="color:var(--green)">Milestones 🏅</h4>
        <div class="badges" style="margin-top:8px">
          ${badge('💯', ms.hundreds, '100s')}${badge('🏏', ms.fifties, '50s')}${badge('✨', ms.thirties, '30s')}
          ${badge('🎯', ms.fivers, '5-fers')}${badge('🎩', ms.hattricks, 'hat-tricks')}${badge('🦆', ms.ducks, 'ducks')}
          ${badge('4️⃣', ms.fours, 'fours')}${badge('6️⃣', ms.sixes, 'sixes')}
        </div>
      </div>

      ${recent.length ? `<div class="card">
        <h4 style="color:var(--green)">Recent form</h4>
        <div class="form-row" style="margin-top:8px">
          ${recent.map((r) => `<div class="form-chip">
            <div class="fc-runs">${r.runs != null ? r.runs + (r.notOut ? '*' : '') : '–'}</div>
            <div class="fc-sub">${r.wkts ? r.wkts + 'w' : (r.balls ? r.balls + 'b' : '')}</div>
          </div>`).join('')}
        </div>
      </div>` : ''}
    `;
    $('#pp-edit').onclick = () => editPlayer(p.id);
  }

  /* =========================================================
     NEW MATCH SETUP
  ========================================================= */
  let draft = null;
  function newMatchScreen(screen) {
    const d = S.Settings.get().defaults;
    if (!draft) draft = {
      format: d.format, venue: '', date: Date.now(),
      rules: Object.assign({}, d),
      teamNames: ['Team A', 'Team B'],
      teamMeta: [{}, {}], // {teamId, logo} per side, when loaded from a saved team
      assign: {}, // pid -> 0 | 1 | 'j'
      sessionId: null,
      toss: { wonBy: 0, decision: 'bat' },
    };
    if (!draft.teamMeta) draft.teamMeta = [{}, {}];
    const players = S.Players.all();
    const sessions = S.Sessions.all();
    const r = draft.rules;

    screen.innerHTML = `
      <div class="screen-title"><h2>New match</h2></div>

      <div class="card">
        <h4>Format</h4>
        <div class="tabs" style="margin-top:8px">
          <button data-fmt="box" class="${draft.format === 'box' ? 'active' : ''}">📦 Box cricket</button>
          <button data-fmt="ground" class="${draft.format === 'ground' ? 'active' : ''}">🌳 Ground</button>
        </div>
        <div class="grid cols-2" style="margin-top:10px">
          <label class="field"><span>Overs / innings</span><input id="ms-overs" type="number" min="1" max="50" value="${r.oversPerInnings}"></label>
          <label class="field"><span>Players / side (bat)</span><input id="ms-pps" type="number" min="2" max="16" value="${r.playersPerSide}"></label>
        </div>
        <label class="field"><span>Max overs / bowler (0 = no limit)</span><input id="ms-mob" type="number" min="0" max="50" value="${r.maxOversPerBowler || 0}"></label>
        <p class="muted small" style="margin:0">Squads can be bigger than "players/side" — extras are subs you can bring on mid-match.</p>
      </div>

      <div class="card">
        <h4>Rules</h4>
        ${toggleHTML('lastManStanding', '🧍 Last Man Standing', 'Last batter keeps batting alone after the 2nd-last wicket', r.lastManStanding)}
        ${toggleHTML('lastManEvenOnly', 'Last man — even runs only', 'Lone batter scores only on even runs (classic gully rule)', r.lastManEvenOnly)}
        ${toggleHTML('singleBatsman', 'Single batter mode', 'One batter at the crease at a time (no non-striker)', r.singleBatsman)}
        ${toggleHTML('reBowlWide', 'Re-bowl wides', 'Wide is re-bowled (does not use up a ball)', r.reBowlWide)}
        ${toggleHTML('reBowlNoBall', 'Re-bowl no-balls', 'No-ball is re-bowled (does not use up a ball)', r.reBowlNoBall)}
        ${toggleHTML('noBallFreeHit', 'Free hit after no-ball', 'Next legal ball is a free hit', r.noBallFreeHit)}
        <div class="grid cols-2">
          <label class="field"><span>Wide = runs</span><input id="ms-wr" type="number" min="0" max="5" value="${r.wideRuns}"></label>
          <label class="field"><span>No-ball = runs</span><input id="ms-nbr" type="number" min="0" max="5" value="${r.noBallRuns}"></label>
        </div>
      </div>

      <div class="card">
        <h4>Teams & squads</h4>
        <div class="grid cols-2" style="margin-top:8px">
          <label class="field"><span>Team 1</span><input id="ms-t0" value="${esc(draft.teamNames[0])}"></label>
          <label class="field"><span>Team 2</span><input id="ms-t1" value="${esc(draft.teamNames[1])}"></label>
        </div>
        ${S.Teams.all().length ? `<div class="cap-grid" style="margin-top:2px">
          <button class="btn sm" id="ms-load0">📋 Load into Team 1</button>
          <button class="btn sm" id="ms-load1">📋 Load into Team 2</button>
        </div>` : '<div class="muted small">Tip: save teams under Squad → Teams (with logos) to load them here.</div>'}
        <div class="row spread" style="margin:8px 0 8px"><span class="muted small">…or tap players to build a side</span>
          <button class="btn sm" id="ms-quick">➕ Quick add</button></div>
        <div id="ms-counts" class="team-counts"></div>
        <div id="ms-pool" class="plist" style="margin-top:8px">
          ${players.length ? players.map(assignRow).join('') : `<div class="muted small">No players yet — add some first.</div>`}
        </div>
      </div>

      <div class="card">
        <h4>Toss</h4>
        <div class="grid cols-2" style="margin-top:8px">
          <label class="field"><span>Won by</span>
            <select id="ms-toss"><option value="0">${esc(draft.teamNames[0])}</option><option value="1" ${draft.toss.wonBy === 1 ? 'selected' : ''}>${esc(draft.teamNames[1])}</option></select></label>
          <label class="field"><span>Elected to</span>
            <select id="ms-dec"><option value="bat" ${draft.toss.decision === 'bat' ? 'selected' : ''}>Bat</option><option value="bowl" ${draft.toss.decision === 'bowl' ? 'selected' : ''}>Bowl</option></select></label>
        </div>
        <button class="btn sm" id="ms-flip">🎲 Auto flip</button>
      </div>

      <div class="card">
        <h4>Match details</h4>
        <label class="field"><span>Venue</span><input id="ms-venue" value="${esc(draft.venue || '')}" placeholder="e.g. Anna Nagar Box Arena"></label>
        <label class="field"><span>Date & time</span><input id="ms-datetime" type="datetime-local" value="${toDatetimeLocal(draft.date || Date.now())}"></label>
      </div>

      <div class="card">
        <h4>Session (week)</h4>
        <select id="ms-session" style="margin-top:8px">
          <option value="">— No session —</option>
          ${sessions.map((se) => `<option value="${se.id}" ${draft.sessionId === se.id ? 'selected' : ''}>${esc(se.name)} (${fmtDate(se.date)})</option>`).join('')}
          <option value="__new__">＋ New session…</option>
        </select>
      </div>

      <button class="btn primary block" id="ms-start" style="margin-top:14px;padding:16px">Start match ▸</button>
      <div style="height:8px"></div>
    `;

    // bindings
    $$('#screen [data-fmt]').forEach((b) => b.onclick = () => { draft.format = b.dataset.fmt; saveDraftInputs(); render(); });
    $$('#screen [data-tg]').forEach((b) => b.onclick = () => { const k = b.dataset.tg; draft.rules[k] = !draft.rules[k]; saveDraftInputs(); render(); });
    $('#ms-quick').onclick = () => newPlayerSheet((name, photo) => { resolvePlayer(name, photo); saveDraftInputs(); render(); });
    const loadTeamInto = (side) => {
      const teams = S.Teams.all();
      if (!teams.length) return toast('No saved teams — create one in Squad → Teams', 'err');
      pick('Load into Team ' + (side + 1), teams.map((t) => ({ id: t.id, html: `${teamLogoHTML(t)}<div style="flex:1"><div>${esc(t.name)}</div><div class="small muted">${t.players.length} players</div></div>` })), (tid) => {
        const t = S.Teams.get(tid); if (!t) return;
        saveDraftInputs();
        draft.teamNames[side] = t.name;
        draft.teamMeta[side] = { teamId: t.id, logo: t.logo || '' };
        Object.keys(draft.assign).forEach((pid) => { if (draft.assign[pid] === side) delete draft.assign[pid]; });
        t.players.forEach((pid) => { if (draft.assign[pid] !== 'j' && draft.assign[pid] !== (side === 0 ? 1 : 0)) draft.assign[pid] = side; });
        render();
        toast(t.name + ' loaded into Team ' + (side + 1));
      });
    };
    if ($('#ms-load0')) $('#ms-load0').onclick = () => loadTeamInto(0);
    if ($('#ms-load1')) $('#ms-load1').onclick = () => loadTeamInto(1);
    $('#ms-flip').onclick = () => {
      saveDraftInputs();
      const w = Math.floor(Math.random() * 2), d = Math.random() < 0.5 ? 'bat' : 'bowl';
      draft.toss.wonBy = w; draft.toss.decision = d;
      $('#ms-toss').value = String(w); $('#ms-dec').value = d;
      toast(`🪙 ${draft.teamNames[w]} won the toss — chose to ${d}`);
    };
    const segVal = (seg) => (seg === 'j' ? 'j' : parseInt(seg, 10));
    $$('#ms-pool [data-seg]').forEach((pill) => pill.onclick = (e) => {
      e.stopPropagation();
      const row = pill.closest('[data-assign]'); const pid = row.dataset.assign;
      const val = segVal(pill.dataset.seg);
      draft.assign[pid] = (draft.assign[pid] === val) ? undefined : val;
      if (draft.assign[pid] === undefined) delete draft.assign[pid];
      const now = draft.assign[pid];
      row.querySelectorAll('[data-seg]').forEach((s) => s.classList.toggle('on', segVal(s.dataset.seg) === now));
      refreshTeamCounts();
    });
    function refreshTeamCounts() {
      const vals = Object.values(draft.assign);
      const a = vals.filter((v) => v === 0 || v === 'j').length;
      const b = vals.filter((v) => v === 1 || v === 'j').length;
      const j = vals.filter((v) => v === 'j').length;
      const n0 = ($('#ms-t0').value.trim() || 'Team A');
      const n1 = ($('#ms-t1').value.trim() || 'Team B');
      const el = $('#ms-counts');
      if (el) el.innerHTML = `<span class="pill on">${esc(n0)}: ${a}</span>`
        + `<span class="pill on b">${esc(n1)}: ${b}</span>`
        + (j ? `<span class="pill on" style="background:#33260e;border-color:#6a4f15;color:var(--accent)">🃏 ${j} joker${j !== 1 ? 's' : ''}</span>` : '');
    }
    $('#ms-t0').oninput = refreshTeamCounts;
    $('#ms-t1').oninput = refreshTeamCounts;
    refreshTeamCounts();
    $('#ms-session').onchange = (e) => {
      if (e.target.value === '__new__') {
        prompt('New session', 'Session name', 'Week of ' + fmtDate(Date.now()), (v) => {
          if (v) { const se = S.Sessions.add({ name: v }); draft.sessionId = se.id; }
          render();
        });
      } else draft.sessionId = e.target.value || null;
    };
    $('#ms-start').onclick = () => { saveDraftInputs(); startMatch(); };

    function saveDraftInputs() {
      draft.rules.oversPerInnings = clampInt($('#ms-overs').value, 1, 50, 6);
      draft.rules.playersPerSide = clampInt($('#ms-pps').value, 2, 16, 8);
      draft.rules.maxOversPerBowler = clampInt($('#ms-mob').value, 0, 50, 0);
      draft.rules.wideRuns = clampInt($('#ms-wr').value, 0, 5, 1);
      draft.rules.noBallRuns = clampInt($('#ms-nbr').value, 0, 5, 1);
      draft.teamNames[0] = $('#ms-t0').value.trim() || 'Team A';
      draft.teamNames[1] = $('#ms-t1').value.trim() || 'Team B';
      draft.venue = ($('#ms-venue') ? $('#ms-venue').value.trim() : draft.venue) || '';
      const dtv = $('#ms-datetime') ? $('#ms-datetime').value : '';
      draft.date = dtv ? new Date(dtv).getTime() : (draft.date || Date.now());
      draft.toss.wonBy = parseInt($('#ms-toss').value, 10);
      draft.toss.decision = $('#ms-dec').value;
    }
  }

  function clampInt(v, min, max, def) { v = parseInt(v, 10); if (isNaN(v)) return def; return Math.max(min, Math.min(max, v)); }

  function assignRow(p) {
    const a = draft.assign[p.id];
    const seg = (val, lbl, extra) => `<span class="pill seg ${extra || ''} ${a === val ? 'on' : ''}" data-seg="${val}" style="min-width:38px;justify-content:center">${esc(lbl)}</span>`;
    return `<div class="prow" data-assign="${p.id}">
      ${avatar(p)}
      <div class="meta"><div class="nm">${esc(p.name)}</div><div class="sub">${ROLE_LABEL[p.role] || ''}</div></div>
      <div class="row" style="gap:5px">${seg(0, (draft.teamNames[0] || 'A').slice(0, 5))}${seg(1, (draft.teamNames[1] || 'B').slice(0, 5), 'b')}${seg('j', '🃏', 'j')}</div>
    </div>`;
  }

  function toggleHTML(key, label, sub, on) {
    return `<div class="toggle" data-tg="${key}">
      <div><div>${label}</div><small>${sub}</small></div>
      <label class="switch"><input type="checkbox" ${on ? 'checked' : ''} disabled><span class="track"></span><span class="thumb"></span></label>
    </div>`;
  }

  function startMatch() {
    // jokers ('j') play for both teams
    const t0 = Object.keys(draft.assign).filter((p) => draft.assign[p] === 0 || draft.assign[p] === 'j');
    const t1 = Object.keys(draft.assign).filter((p) => draft.assign[p] === 1 || draft.assign[p] === 'j');
    if (t0.length < 1 || t1.length < 1) return toast('Assign at least 1 player to each team', 'err');
    const meta = draft.teamMeta || [{}, {}];
    const cfg = {
      sessionId: draft.sessionId, format: draft.format, venue: draft.venue, date: draft.date,
      rules: Object.assign({}, draft.rules),
      teams: [
        { name: draft.teamNames[0], players: t0, teamId: (meta[0] || {}).teamId, logo: (meta[0] || {}).logo || '' },
        { name: draft.teamNames[1], players: t1, teamId: (meta[1] || {}).teamId, logo: (meta[1] || {}).logo || '' },
      ],
      toss: Object.assign({}, draft.toss),
    };
    const match = SC.newMatch(cfg);
    // don't persist until the first innings actually starts (avoids orphaned "setup" matches)
    draft = null;
    openInningsFlow(match);
  }

  /* Pick openers/bowler then start the innings. */
  function openInningsFlow(match) {
    const battingTeam = match.innings.length === 0 ? SC.battingTeamFirst(match) : (match.innings[0].battingTeam === 0 ? 1 : 0);
    const bowlingTeam = battingTeam === 0 ? 1 : 0;
    const batPlayers = match.teams[battingTeam].players.map(pl);
    const bowlPlayers = match.teams[bowlingTeam].players.map(pl);
    const single = match.rules.singleBatsman;
    let striker = null, nonStriker = null;
    const restart = () => openInningsFlow(match); // re-open with the new player in the list

    pickPlayer('Select striker 🏏', batPlayers, (sid) => {
      striker = sid;
      const next = () => pickPlayer('Opening bowler 🎯', bowlPlayers, (bid) => {
        SC.startInnings(match, { battingTeam, order: match.teams[battingTeam].players.slice(), striker, nonStriker, bowler: bid });
        S.Matches.save(match);
        go('live', { id: match.id });
      }, { onAdd: () => addPlayerToMatch(match, bowlingTeam, restart) });
      if (single) next();
      else pickPlayer('Select non-striker', batPlayers.filter((p) => p.id !== striker), (nid) => { nonStriker = nid; next(); }, { onAdd: () => addPlayerToMatch(match, battingTeam, restart) });
    }, { onAdd: () => addPlayerToMatch(match, battingTeam, restart) });
  }

  // create/reuse a player by name and add them to a match team (used at innings start)
  // Add-a-player sheet with instant camera/photo capture. cb(name, photo)
  function newPlayerSheet(cb) {
    let photo = '';
    const s = sheet('Add a player', `
      <div class="center"><div id="np-ava" style="display:inline-block">${avatar(null, 'xl')}</div></div>
      <button class="btn block" id="np-photo" style="margin-top:10px">📸 Take photo / choose</button>
      <label class="field"><span>Name</span><input id="np-name" placeholder="Player name"></label>
      <button class="btn primary block" id="np-ok">Add player</button>`);
    const nameInp = $('#np-name', s.overlay);
    setTimeout(() => nameInp.focus(), 50);
    $('#np-photo', s.overlay).onclick = () => APP.photo.capture((data) => { if (data) { photo = data; $('#np-ava', s.overlay).innerHTML = avatar({ photo }, 'xl'); } });
    $('#np-ok', s.overlay).onclick = () => { const name = nameInp.value.trim(); if (!name) return toast('Enter a name', 'err'); s.close(); cb(name, photo); };
  }
  // resolve a name+photo to a player id (reuse existing by name, else create)
  function resolvePlayer(name, photo) {
    const existing = S.Players.all().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) { if (photo && !existing.photo) S.Players.update(existing.id, { photo }); return existing.id; }
    return S.Players.add({ name, photo: photo || '' }).id;
  }

  function addPlayerToMatch(match, teamIdx, then) {
    newPlayerSheet((name, photo) => {
      const pid = resolvePlayer(name, photo);
      if (!match.teams[teamIdx].players.includes(pid)) match.teams[teamIdx].players.push(pid);
      APP.syncNames = APP.syncNames || {}; APP.syncNames[pid] = name;
      toast(name + ' added');
      then(pid);
    });
  }

  // opts: boolean (allowNone) for back-compat, or { allowNone, onAdd, sub(p) }
  function pickPlayer(title, players, cb, opts) {
    if (typeof opts === 'boolean') opts = { allowNone: opts };
    opts = opts || {};
    const items = players.map((p) => ({ id: p.id, html: playerOptHTML(p, opts.sub && opts.sub(p)) }));
    if (opts.onAdd) items.push({ id: '__add__', html: '<div style="flex:1;color:var(--green)">➕ Add a new player…</div>' });
    pick(title, items, (id) => { if (id === '__add__') return opts.onAdd(); cb(id); }, { allowNone: opts.allowNone });
  }
  function playerOptHTML(p, subOverride) {
    const sub = subOverride != null ? subOverride : (ROLE_LABEL[p.role] || '');
    return `${avatar(p)}<div style="flex:1"><div>${p.jersey ? `<span class="jersey">#${esc(p.jersey)}</span> ` : ''}${esc(p.name)}</div><div class="small muted">${esc(sub)}</div></div>`;
  }

  /* =========================================================
     LIVE SCORING
  ========================================================= */
  function liveScreen(screen, params, actions) {
    const match = S.Matches.get(params.id);
    if (!match) return go('home');
    if (match.status === 'complete') return go('scorecard', { id: match.id });
    // match created but no innings started yet (e.g. openers weren't picked) — resume that step
    if (match.currentInnings < 0 || !match.innings[match.currentInnings]) return openInningsFlow(match);
    const inn = SC.cur(match);
    const r = match.rules;

    const shared = !!match.roomCode;
    const amScorer = !shared || SY.amScorer();
    const scorerName = shared && SY.currentScorer() ? SY.currentScorer().name : '';
    // save locally + push to viewers when I hold the pen
    const persist = () => { S.Matches.save(match); if (shared && SY.amScorer()) SY.publish(match); };

    actions.innerHTML = amScorer ? `<button class="btn sm undo" id="lv-undo" ${SC.canUndo(match) ? '' : 'disabled'}>↺ Undo</button>` : '';

    const striker = inn.striker ? pl(inn.striker) : null;
    const nonStriker = inn.nonStriker ? pl(inn.nonStriker) : null;
    const bowler = inn.bowler ? pl(inn.bowler) : null;
    const bs = inn.striker ? inn.batStats[inn.striker] : null;
    const ns = inn.nonStriker ? inn.batStats[inn.nonStriker] : null;
    const bw = inn.bowler ? inn.bowlStats[inn.bowler] : null;

    const ballsLeft = r.oversPerInnings * 6 - inn.legalBalls;
    const thisOver = currentOverBalls(inn);
    // projected score (1st innings) & rough win chance (2nd innings)
    const crrNum = inn.legalBalls ? inn.runs / inn.legalBalls * 6 : 0;
    const projected = (!inn.target && inn.legalBalls > 0) ? Math.round(inn.runs + crrNum * ballsLeft) : null;
    let winPct = null;
    if (inn.target && !inn.closed) {
      if (inn.runs >= inn.target) winPct = 100;
      else if (ballsLeft <= 0) winPct = 0;
      else {
        const need = inn.target - inn.runs;
        const wktsLeft = SC.maxWickets(match) - inn.wickets;
        if (wktsLeft <= 0) winPct = 0;
        else {
          const rrr = need / ballsLeft * 6;
          let p = 50 + (8 - rrr) * 7 + (wktsLeft - 2) * 5 - (need / (wktsLeft + 1)) * 0.6;
          winPct = Math.max(2, Math.min(98, Math.round(p)));
        }
      }
    }

    const liveBanner = shared
      ? `<div class="live-banner ${amScorer ? 'me' : ''}">
           <span><span class="dot"></span>LIVE · ${match.roomCode}${amScorer ? ' · you are scoring' : (scorerName ? ' · ' + esc(scorerName) + ' scoring' : '')}</span>
           <span class="row" style="gap:8px">
             <span class="vwrs" title="watching now">👁 <span id="lv-viewers">${SY.viewerCount()}</span></span>
             <button class="btn sm" id="lv-share">Share</button>
           </span>
         </div>`
      : `<button class="btn accent block" id="lv-golive" style="margin-bottom:10px">📡 Go Live — let others watch on their phones</button>`;

    const scoringPad = `
      <div class="pad">
        ${[0, 1, 2, 3].map((n) => runBtn(n)).join('')}
      </div>
      <div class="pad">
        ${runBtn(4, 'four')}${runBtn(5)}${runBtn(6, 'six')}
        <button class="run-btn wkt-btn" id="lv-wkt">OUT</button>
      </div>
      <div class="pad-row">
        <button class="btn sm" data-ex="wide">Wide</button>
        <button class="btn sm" data-ex="noball">No-ball</button>
        <button class="btn sm" data-ex="bye">Bye</button>
        <button class="btn sm" data-ex="legbye">Leg bye</button>
      </div>
      <div class="pad-row">
        <button class="btn sm" id="lv-swap">⇄ Swap</button>
        <button class="btn sm" id="lv-bowler">🎯 Bowler</button>
        <button class="btn sm" id="lv-card">📋 Card</button>
        <button class="btn sm" id="lv-more">⋯ More</button>
      </div>`;

    const watchPanel = `
      <div class="card center" style="margin-top:12px">
        <div style="font-size:15px">👀 You're watching live</div>
        <div class="small muted" style="margin:4px 0 12px">${scorerName ? esc(scorerName) + ' is scoring.' : ''} Updates appear automatically.</div>
        ${pendingReqActive
          ? `<div class="pill on" style="display:block;padding:12px">⏳ Waiting for ${esc(scorerName || 'the scorer')} to approve…</div>
             <button class="btn sm ghost block" id="lv-cancelreq" style="margin-top:8px">Cancel request</button>`
          : `<button class="btn primary block" id="lv-takeover">🖊️ I'm scoring now</button>`}
        <button class="btn sm ghost block" id="lv-card" style="margin-top:8px">📋 Full scorecard</button>
      </div>`;

    screen.innerHTML = `
      ${liveBanner}
      <div class="scoreboard">
        <div class="row spread teams">
          <span>${esc(SC.teamName(match, inn.battingTeam))} batting</span>
          <span>${inn.superOver ? '⚡ Super Over' : (match.currentInnings === 0 ? '1st innings' : '2nd innings')}</span>
        </div>
        <div class="bigscore">${inn.runs}/${inn.wickets} <small>(${SC.oversText(inn.legalBalls)}/${r.oversPerInnings})</small></div>
        <div class="sb-line"><span>CRR ${SC.rr(inn.runs, inn.legalBalls)}</span>
          ${projected != null ? `<span>Proj <b>${projected}</b></span>` : `<span>Extras ${inn.extras.wide + inn.extras.noball + inn.extras.bye + inn.extras.legbye}</span>`}
          ${inn.lastMan ? `<span class="pill red">LAST MAN</span>` : ''}
        </div>
        ${inn.target ? `<div class="target-banner">Target <b>${inn.target}</b> · need <b>${Math.max(0, inn.target - inn.runs)}</b> off <b>${ballsLeft}</b> · RRR ${SC.reqRR(inn.target, inn.runs, ballsLeft)}</div>` : ''}
        ${winPct != null ? `<div class="sb-line" style="margin-top:6px"><span>Win chance (est)</span><span><b>${winPct}%</b> ${esc(SC.teamName(match, inn.battingTeam))}</span></div>` : ''}
      </div>

      <div class="card" style="margin-top:12px">
        <table class="mini-table">
          <tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
          ${batRow(striker, bs, true)}
          ${nonStriker ? batRow(nonStriker, ns, false) : ''}
        </table>
        ${(() => { const cp = inn.partnerships[inn.partnerships.length - 1]; return (cp && !cp.out && nonStriker) ? `<div class="small muted" style="margin-top:6px">Partnership: <b>${cp.runs}</b> (${cp.balls})</div>` : ''; })()}
        <div class="divider" style="margin:10px 0"></div>
        <table class="mini-table">
          <tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
          ${bowler ? bowlRow(bowler, bw) : `<tr><td colspan="6" class="muted">Select a bowler to continue</td></tr>`}
        </table>
        <div style="margin-top:12px">
          <div class="small muted" style="margin-bottom:6px">This over</div>
          <div class="thisover">${thisOver.length ? thisOver.map(ballChip).join('') : '<span class="muted small">—</span>'}</div>
        </div>
      </div>

      ${inn.freeHit && amScorer ? `<div class="target-banner" style="background:#33260e;border-color:#6a4f15;color:var(--accent)">⚡ FREE HIT</div>` : ''}

      ${amScorer ? scoringPad : watchPanel}

      <div class="card" style="margin-top:14px">
        <div class="small muted" style="margin-bottom:6px">Commentary</div>
        <div class="comm">${commentaryHTML(inn)}</div>
      </div>
    `;

    // guards: need bowler / need batsman
    const needBowler = !inn.bowler && !inn.closed;
    // a batting slot is empty — covers the non-striker being run out, not just the striker.
    // In last-man / single-batter mode the non-striker slot is empty by design, so don't ask.
    const pairBatting = !match.rules.singleBatsman && !inn.lastMan;
    const needBatsman = !inn.closed && (!inn.striker || (pairBatting && !inn.nonStriker));

    // always available (viewer + scorer)
    const cardBtn = $('#lv-card'); if (cardBtn) cardBtn.onclick = () => go('scorecard', { id: match.id });
    if ($('#lv-share')) $('#lv-share').onclick = () => shareLiveSheet(match);
    if ($('#lv-golive')) $('#lv-golive').onclick = () => goLive(match);
    if ($('#lv-takeover')) $('#lv-takeover').onclick = () => takeOver(match);
    if ($('#lv-cancelreq')) $('#lv-cancelreq').onclick = () => cancelTakeover();

    if (amScorer) {
      const doUndo = () => { if (SC.undo(match)) { persist(); pendingStrikeAsk = false; toast('Undone'); render(); } };
      if ($('#lv-undo')) $('#lv-undo').onclick = doUndo;
      $$('#screen [data-run]').forEach((b) => b.onclick = () => ball({ runs: parseInt(b.dataset.run, 10) }));
      $$('#screen [data-ex]').forEach((b) => b.onclick = () => extraFlow(b.dataset.ex));
      $('#lv-wkt').onclick = () => wicketFlow();
      $('#lv-swap').onclick = () => { SC.manualSwap(match); persist(); render(); };
      $('#lv-bowler').onclick = () => chooseBowler();
      $('#lv-more').onclick = () => moreMenu();

      if (needBatsman) setTimeout(() => chooseBatsman(), 150);
      else if (needBowler) setTimeout(() => chooseBowler(), 150);
    }

    function ball(input) {
      if (inn.closed) return;
      if (!inn.bowler) { toast('Select a bowler first', 'err'); return chooseBowler(); }
      if (!inn.striker) { toast('Select a batter first', 'err'); return chooseBatsman(); }
      // last man even-only rule
      if (inn.lastMan && r.lastManEvenOnly && !input.extra && input.runs % 2 === 1 && !input.wicket) {
        toast('Odd runs don\'t count for last man', 'err');
        input = Object.assign({}, input, { runs: 0 });
      }
      const res = SC.recordBall(match, input);
      persist();
      handlePost(res);
    }

    function handlePost(res) {
      if (res && res.closed) return inningsEnd();
      render();
    }

    function inningsEnd() {
      const finished = match.status === 'complete';
      if (finished) {
        if (/tied/i.test(match.result)) { // Match tied / Super Over tied → offer (another) Super Over
          const s = sheet('Scores level! 🔥', `<p class="center" style="font-size:16px"><b>${esc(match.result)}</b></p>
            <button class="btn primary block" id="ie-so">⚡ Play a Super Over</button>
            <button class="btn ghost block" id="ie-tied" style="margin-top:8px">Leave it tied</button>`);
          $('#ie-so', s.overlay).onclick = () => { s.close(); superOverFlow(); };
          $('#ie-tied', s.overlay).onclick = () => { s.close(); go('scorecard', { id: match.id }); };
          return;
        }
        const s = sheet('Match complete 🏆', `<p class="center" style="font-size:18px"><b>${esc(match.result)}</b></p>
          <button class="btn primary block" id="ie-card">View scorecard</button>`);
        $('#ie-card', s.overlay).onclick = () => { s.close(); go('scorecard', { id: match.id }); };
        return;
      }
      const lastInn = match.innings[match.currentInnings];
      if (lastInn && lastInn.superOver) { // Super Over 1 done → play the reply
        const s = sheet('Super Over — reply', `<p class="center">${esc(SC.teamName(match, lastInn.battingTeam))} scored <b>${lastInn.runs}/${lastInn.wickets}</b>.<br>Target: <b>${lastInn.runs + 1}</b></p>
          <button class="btn primary block" id="ie-so2">Start reply ▸</button>`);
        $('#ie-so2', s.overlay).onclick = () => { s.close(); superOverFlow(lastInn.runs + 1); };
        return;
      }
      const first = match.innings[0];
      const s = sheet('Innings break', `<p class="center">${esc(SC.teamName(match, first.battingTeam))} scored <b>${first.runs}/${first.wickets}</b>.<br>
        Target: <b>${first.runs + 1}</b></p>
        <button class="btn primary block" id="ie-2nd">Start 2nd innings ▸</button>`);
      $('#ie-2nd', s.overlay).onclick = () => { s.close(); openInningsFlow(match); };
    }

    function superOverFlow(target) {
      const soDone = match.innings.filter((i) => i.superOver).length;
      const battingTeam = (soDone === 0) ? match.innings[1].battingTeam : (match.innings[match.innings.length - 1].battingTeam === 0 ? 1 : 0);
      const bowlingTeam = battingTeam === 0 ? 1 : 0;
      const batPlayers = match.teams[battingTeam].players.map(pl);
      const bowlPlayers = match.teams[bowlingTeam].players.map(pl);
      const single = match.rules.singleBatsman;
      const finish = (sid, nid) => pickPlayer('Super Over — bowler 🎯', bowlPlayers, (bid) => {
        SC.startSuperOver(match, { battingTeam, order: match.teams[battingTeam].players.slice(), striker: sid, nonStriker: nid, bowler: bid, target });
        S.Matches.save(match); go('live', { id: match.id });
      });
      pickPlayer('Super Over — striker 🏏', batPlayers, (sid) => {
        if (single) finish(sid, null);
        else pickPlayer('Super Over — non-striker', batPlayers.filter((p) => p.id !== sid), (nid) => finish(sid, nid));
      });
    }

    function extraFlow(type) {
      if (!inn.bowler) { toast('Select a bowler first', 'err'); return chooseBowler(); }
      if (type === 'wide') {
        runChoice('Wide + byes run', [0, 1, 2, 3, 4], (n) => ball({ extra: 'wide', runs: n }));
      } else if (type === 'noball') {
        runChoice('No-ball + runs off bat', [0, 1, 2, 4, 6], (n) => ball({ extra: 'noball', runs: n }));
      } else if (type === 'bye') {
        runChoice('Byes run', [1, 2, 3, 4], (n) => ball({ extra: 'bye', runs: n }));
      } else if (type === 'legbye') {
        runChoice('Leg byes run', [1, 2, 3, 4], (n) => ball({ extra: 'legbye', runs: n }));
      }
    }
    function runChoice(title, opts, cb) {
      pick(title, opts.map((n) => ({ id: String(n), label: n + ' run' + (n === 1 ? '' : 's') })), (v) => cb(parseInt(v, 10)));
    }

    function wicketFlow() {
      if (!inn.bowler) { toast('Select a bowler first', 'err'); return chooseBowler(); }
      if (!inn.striker) return;
      const types = inn.freeHit
        ? [{ id: 'runout', t: 'Run out' }]
        : [{ id: 'bowled', t: 'Bowled' }, { id: 'caught', t: 'Caught' }, { id: 'lbw', t: 'LBW' },
           { id: 'runout', t: 'Run out' }, { id: 'stumped', t: 'Stumped' }, { id: 'hitwicket', t: 'Hit wicket' }];
      const fielders = match.teams[inn.bowlingTeam].players.map(pl);
      const s = sheet('How out?', `
        <div class="opt-list" id="wk-types">
          ${types.map((t) => `<button class="opt" data-wt="${t.id}">${t.t}</button>`).join('')}
        </div>`);
      $$('#wk-types [data-wt]', s.overlay).forEach((b) => b.onclick = () => {
        const type = b.dataset.wt;
        s.close();
        const needFielder = ['caught', 'runout', 'stumped'].includes(type);
        const proceed = (fielder, who, runs) => ball({ runs: runs || 0, wicket: { type, who: who || 'striker', fielder } });
        if (type === 'runout') {
          runOutSheet(fielders);
        } else if (needFielder) {
          pickPlayer(type === 'stumped' ? 'Keeper' : 'Caught by', fielders, (fid) => proceed(fid, 'striker', 0), true);
        } else {
          proceed(null, 'striker', 0);
        }
      });
    }

    /* One compact sheet: runs completed + who's out + fielder. */
    function runOutSheet(fielders) {
      const nsName = inn.nonStriker ? pname(inn.nonStriker) : null;
      const s = sheet('Run out', `
        <div class="small muted" style="margin-bottom:7px">Runs completed before the run out</div>
        <div class="chips" id="ro-runs">${[0, 1, 2, 3].map((n) => `<button class="chip ${n === 0 ? 'sel' : ''}" data-r="${n}">${n}</button>`).join('')}</div>
        <div class="small muted" style="margin:14px 0 7px">Which batter is out?</div>
        <div class="chips" id="ro-who">
          <button class="chip sel" data-w="striker">${esc(pname(inn.striker))} <span class="muted">· striker</span></button>
          ${nsName ? `<button class="chip" data-w="nonstriker">${esc(nsName)} <span class="muted">· non-striker</span></button>` : ''}
        </div>
        <label class="field" style="margin-top:14px"><span>Fielder (optional)</span>
          <select id="ro-f"><option value="">—</option>${fielders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
        <button class="btn primary block" id="ro-ok" style="margin-top:8px">Confirm run out</button>`);
      let runs = 0, who = 'striker';
      const wire = (sel, key, cb) => $$(sel + ' .chip', s.overlay).forEach((b) => b.onclick = () => {
        $$(sel + ' .chip', s.overlay).forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel'); cb(b.dataset[key]);
      });
      wire('#ro-runs', 'r', (v) => runs = parseInt(v, 10));
      wire('#ro-who', 'w', (v) => who = v);
      $('#ro-ok', s.overlay).onclick = () => {
        const f = $('#ro-f', s.overlay).value || null;
        s.close();
        pendingStrikeAsk = true; // ends are ambiguous after a run out — ask explicitly
        ball({ runs, wicket: { type: 'runout', who, fielder: f } });
      };
    }

    // create/reuse a player by name and add them to a team mid-match, then continue
    function addPlayerInMatch(teamIdx, then) {
      newPlayerSheet((name, photo) => {
        const pid = resolvePlayer(name, photo);
        if (!match.teams[teamIdx].players.includes(pid)) match.teams[teamIdx].players.push(pid);
        if (teamIdx === inn.battingTeam && inn.battingOrder && !inn.battingOrder.includes(pid)) inn.battingOrder.push(pid);
        APP.syncNames = APP.syncNames || {}; APP.syncNames[pid] = name; // so viewers see it immediately
        persist();
        toast(name + ' added');
        then(pid);
      });
    }

    function chooseBatsman() {
      const batTeam = match.teams[inn.battingTeam].players;
      const atCrease = [inn.striker, inn.nonStriker].filter(Boolean);
      const avail = batTeam.map(pl).filter((p) => !atCrease.includes(p.id) && !(inn.batStats[p.id] && inn.batStats[p.id].out));
      const onSelect = (pid) => {
        SC.setNewBatsman(match, pid); persist();
        const finish = () => { if (!inn.bowler) chooseBowler(); else render(); };
        // after a run out the batters may have crossed — let the scorer set the ends
        if (pendingStrikeAsk && inn.striker && inn.nonStriker) {
          pendingStrikeAsk = false;
          pick('Who is on strike now?', [inn.striker, inn.nonStriker].map((id) => ({ id, label: pname(id) })), (sid) => {
            SC.setStriker(match, sid); persist(); finish();
          });
        } else { pendingStrikeAsk = false; finish(); }
      };
      pickPlayer('New batter in', avail, onSelect, {
        onAdd: () => addPlayerInMatch(inn.battingTeam, onSelect),
        sub: retiredSub,
      });
    }

    // subtitle for pickers: mark a previously-retired player who would resume their score
    function retiredSub(p) {
      const b = inn.batStats[p.id];
      if (b && b.retired) return `↩ was retired · resumes on ${b.runs} (${b.balls})`;
      return ROLE_LABEL[p.role] || '';
    }

    function chooseBowler() {
      const bowlTeam = match.teams[inn.bowlingTeam].players;
      // mid-over replacement (e.g. bowler injured): part of an over already bowled and not complete
      const midOver = !!inn.bowler && inn.curOverBowlerBalls > 0 && inn.curOverBowlerBalls < 6;
      const ballsLeft = 6 - (inn.curOverBowlerBalls || 0);
      let avail = bowlTeam.map(pl);
      if (midOver) avail = avail.filter((p) => p.id !== inn.bowler);        // just not the one going off
      else if (inn.prevBowler && avail.length > 1) avail = avail.filter((p) => p.id !== inn.prevBowler);
      const maxO = match.rules.maxOversPerBowler || 0;
      const oversOf = (p) => { const w = inn.bowlStats[p.id]; return w ? Math.floor(w.balls / 6) : 0; };
      if (maxO > 0) {
        const eligible = avail.filter((p) => oversOf(p) < maxO);
        if (eligible.length) avail = eligible; else toast('All bowlers at their over limit');
      }
      const onSelect = (pid) => { SC.setNewBowler(match, pid); persist(); render(); };
      const title = midOver ? `Replace bowler · ${ballsLeft} ball${ballsLeft !== 1 ? 's' : ''} left this over` : 'Bowler for this over';
      pickPlayer(title, avail, onSelect, {
        onAdd: () => addPlayerInMatch(inn.bowlingTeam, onSelect),
        sub: (p) => maxO > 0 ? `${oversOf(p)}/${maxO} overs` : `${oversOf(p)} overs bowled`,
      });
    }

    function changeOvers() {
      prompt('Change total overs', 'Overs per innings', String(match.rules.oversPerInnings), (v) => {
        const n = clampInt(v, 1, 50, match.rules.oversPerInnings);
        match.rules.oversPerInnings = n; persist();
        if (!inn.closed && inn.legalBalls >= n * 6) {
          SC.endInningsManually(match, 'Overs reduced'); persist();
          if (match.status === 'complete') return go('scorecard', { id: match.id });
          return inningsEnd();
        }
        toast('Overs set to ' + n); render();
      }, 'e.g. 8');
    }

    function substituteFlow() {
      const opts = [];
      if (inn.striker) opts.push({ id: 'striker', label: pname(inn.striker) + ' (striker)' });
      if (inn.nonStriker) opts.push({ id: 'nonstriker', label: pname(inn.nonStriker) + ' (non-striker)' });
      if (!opts.length) { toast('No batter at the crease'); return; }
      pick('Who is going off?', opts, (end) => {
        const atCrease = [inn.striker, inn.nonStriker].filter(Boolean);
        const avail = match.teams[inn.battingTeam].players.map(pl).filter((p) => !atCrease.includes(p.id) && !(inn.batStats[p.id] && inn.batStats[p.id].out));
        const doSub = (pid) => { SC.substituteBatter(match, end, pid); persist(); toast('Substitute is in'); render(); };
        pickPlayer('Substitute coming in', avail, doSub, { onAdd: () => addPlayerInMatch(inn.battingTeam, doSub), sub: retiredSub });
      });
    }

    function moreMenu() {
      const s = sheet('Match options', `<div class="opt-list">
        <button class="opt" data-act="sub">🔁 Substitute batter (super sub)</button>
        <button class="opt" data-act="changebowler">🤕 Bowler injured / change bowler</button>
        <button class="opt" data-act="overs">📏 Change total overs</button>
        <button class="opt" data-act="endinn">End innings now</button>
        <button class="opt" data-act="retire">🚪 Retire batter (hurt / out)</button>
        <button class="opt" data-act="rename">Rename teams</button>
        <button class="opt" data-act="card">Full scorecard</button>
        <button class="opt" data-act="abandon" style="color:var(--red)">Abandon / delete match</button>
      </div>`);
      $$('.opt', s.overlay).forEach((b) => b.onclick = () => {
        const act = b.dataset.act; s.close();
        if (act === 'sub') substituteFlow();
        else if (act === 'changebowler') chooseBowler();
        else if (act === 'overs') changeOvers();
        else if (act === 'endinn') confirm('End innings?', 'Close the current innings now?', () => { SC.endInningsManually(match, 'Declared'); persist(); if (match.status === 'complete') go('scorecard', { id: match.id }); else inningsEnd(); });
        else if (act === 'retire') retireFlow();
        else if (act === 'rename') renameTeams(match);
        else if (act === 'card') go('scorecard', { id: match.id });
        else if (act === 'abandon') confirm('Delete match?', 'This removes the match permanently.', () => { S.Matches.remove(match.id); go('home'); }, 'Delete', true);
      });
    }
    function retireFlow() {
      const opts = [];
      if (inn.striker) opts.push({ id: 'striker', label: pname(inn.striker) + ' (striker)' });
      if (inn.nonStriker) opts.push({ id: 'nonstriker', label: pname(inn.nonStriker) + ' (non-striker)' });
      if (!opts.length) { toast('No batter at the crease'); return; }
      pick('Retire which batter?', opts, (end) => {
        const s = sheet('Retire batter', `<div class="opt-list">
          <button class="opt" data-h="hurt">🤕 Retired hurt — can return later</button>
          <button class="opt" data-h="out">🚪 Retired out — done for the match</button></div>`);
        $$('.opt', s.overlay).forEach((b) => b.onclick = () => {
          const hurt = b.dataset.h === 'hurt'; s.close();
          SC.retireBatter(match, end, hurt); persist();
          toast(hurt ? 'Retired hurt' : 'Retired out');
          if (inn.closed) return inningsEnd();
          chooseBatsman();
        });
      });
    }
  }

  /* =========================================================
     LIVE SHARING (Firebase)
  ========================================================= */
  let currentRoom = null;

  function goLive(match) {
    if (!SY.available()) return liveSetupNeeded();
    const start = () => SY.createRoom(match, deviceName()).then((code) => {
      if (!code) return toast('Could not start live — check Firebase setup', 'err');
      match.roomCode = code; S.Matches.save(match);
      enterRoom(code);
      render();
      shareLiveSheet(match);
    });
    if (!localStorage.getItem('sixer.deviceName')) {
      prompt('Your name', 'Shown to viewers as the scorer', '', (v) => { setDeviceName(v || 'Scorer'); start(); }, 'e.g. Vijay');
    } else start();
  }

  // "Team: Player1, Player2, …" for a match side
  function teamLineup(match, idx) {
    const t = match.teams[idx];
    const names = (t.players || []).map((id) => pname(id)).join(', ');
    return `${SC.teamName(match, idx)}: ${names || '—'}`;
  }
  function whatsapp(text) { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); }

  function liveShareText(match, link) {
    return `🏏 *${SC.teamName(match, 0)}* vs *${SC.teamName(match, 1)}*\n`
      + `LIVE now — tap to watch on Sixer:\n${link}\n\n`
      + `${teamLineup(match, 0)}\n${teamLineup(match, 1)}`;
  }

  function shareLiveSheet(match) {
    const code = match.roomCode;
    const link = location.origin + location.pathname + '?watch=' + code;
    const s = sheet('Share live match', `
      <div class="center">
        <div class="small muted">Scan to watch, or share the link / code below.</div>
        <img class="qr" alt="Scan to watch" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(link)}">
        <div style="font-size:34px;font-weight:900;letter-spacing:8px;margin:6px 0 10px;color:var(--accent)">${code}</div>
      </div>
      <button class="btn wa block" id="sh-wa">📲 Share on WhatsApp</button>
      <input id="sh-link" value="${esc(link)}" readonly style="margin-top:10px">
      <div class="cap-grid" style="margin-top:8px">
        <button class="btn" id="sh-share">More…</button>
        <button class="btn" id="sh-copy">Copy link</button>
      </div>`);
    $('#sh-link', s.overlay).onclick = (e) => e.target.select();
    $('#sh-wa', s.overlay).onclick = () => whatsapp(liveShareText(match, link));
    $('#sh-copy', s.overlay).onclick = () => { try { navigator.clipboard.writeText(link); } catch (e) {} toast('Link copied'); };
    $('#sh-share', s.overlay).onclick = () => {
      if (navigator.share) navigator.share({ title: SC.teamName(match, 0) + ' vs ' + SC.teamName(match, 1), text: liveShareText(match, link) }).catch(() => {});
      else { try { navigator.clipboard.writeText(link); } catch (e) {} toast('Link copied'); }
    };
  }

  function takeOver(match) {
    if (!SY.available()) return;
    const scorer = SY.currentScorer();
    // If nobody is actively scoring (scorer's device gone), claim straight away — no one to approve.
    if (!scorer || !SY.isPresent(scorer.id)) {
      SY.claimScorer(deviceName()).then((ok) => { if (ok) { toast('You are scoring now'); render(); } else toast('Could not take over', 'err'); });
      return;
    }
    SY.requestScorer(deviceName()).then((ok) => {
      if (ok) { pendingReqActive = true; toast('Asked ' + scorer.name + ' to approve…'); render(); }
      else toast('Could not send request', 'err');
    });
  }
  function cancelTakeover() { SY.cancelRequest(); pendingReqActive = false; toast('Request cancelled'); render(); }

  function liveSetupNeeded() {
    const s = sheet('Live sharing not set up yet', `<p class="muted small">To let others watch on their phones, add a free Firebase config to <b>js/firebase-config.js</b> (about 3 minutes). Full steps are in that file and in Settings.</p>
      <button class="btn primary block" id="ls-ok">Got it</button>`);
    $('#ls-ok', s.overlay).onclick = () => s.close();
  }

  let pendingReqActive = false; // I tapped "I'm scoring now" and am waiting for approval
  let reqSheet = null, reqShownId = null;
  let lastScorerId = null;      // to detect scorer handovers and toast viewers
  let roomRemembered = false;   // saved this room to recent list once per join

  /* Subscribe to a room. Applies inbound state only when I'm not the scorer. */
  function enterRoom(code) {
    currentRoom = code;
    pendingReqActive = false;
    lastScorerId = null;
    roomRemembered = false;
    SY.join(code, {
      onMatch: (payload) => {
        APP.syncNames = payload.names || {};
        const m = payload.match; if (!m) return;
        // remember this room so it can be rejoined from Home with one tap
        if (m.status === 'live') {
          const title = (m.teams && m.teams.length) ? m.teams.map((t) => t.name).join(' vs ') : 'Live match';
          if (!roomRemembered) { S.Rooms.remember(code, title); roomRemembered = true; }
        } else { S.Rooms.forget(code); }
        if (SY.amScorer()) return; // I'm the source of truth
        const local = S.Matches.get(m.id);
        if (local && !local.remote) { Object.assign(local, m); S.Matches.save(local); }
        else { m.remote = true; m.roomCode = code; S.Matches.save(m); }
        if (route.name === 'watch') { route = { name: 'live', params: { id: m.id } }; render(); }
        else if ((route.name === 'live' || route.name === 'scorecard') && route.params.id === m.id) render();
      },
      onScorer: (scorer) => {
        if (pendingReqActive && SY.amScorer()) { pendingReqActive = false; toast('Approved — you are scoring now'); }
        else if (scorer && scorer.id !== lastScorerId && lastScorerId !== null && scorer.id !== SY.clientId()) {
          toast(scorer.name + ' is now scoring');
        }
        if (scorer) lastScorerId = scorer.id;
        if (route.name === 'live') render();
      },
      onPresence: (count) => { updateViewerBadge(count); },
      onRequest: (req) => { handleScorerRequest(req); },
    });
  }

  function updateViewerBadge(count) {
    const el = document.getElementById('lv-viewers');
    if (el) el.textContent = Math.max(0, count - 1);
  }

  /* Current scorer sees a request and approves/declines. */
  function handleScorerRequest(req) {
    const closeSheet = () => { if (reqSheet) { reqSheet.close(); reqSheet = null; reqShownId = null; } };
    if (!SY.amScorer()) {
      // requester side: if my pending request vanished without me becoming scorer, it was declined
      if (pendingReqActive && !req) { pendingReqActive = false; toast('Request declined'); if (route.name === 'live') render(); }
      closeSheet(); return;
    }
    if (!req || req.id === SY.clientId()) { closeSheet(); return; }
    if (reqShownId === req.id && reqSheet) return; // already prompting for this request
    closeSheet();
    reqShownId = req.id;
    reqSheet = sheet('Hand over scoring?', `<p><b>${esc(req.name)}</b> wants to score this match.</p>
      <div class="cap-grid" style="margin-top:12px">
        <button class="btn primary" id="rq-yes">✓ Approve</button>
        <button class="btn" id="rq-no">Decline</button>
      </div>`);
    $('#rq-yes', reqSheet.overlay).onclick = () => { SY.approveRequest(); closeSheet(); toast('Handed over'); };
    $('#rq-no', reqSheet.overlay).onclick = () => { SY.declineRequest(); closeSheet(); };
  }

  function watchRoom(code) {
    if (!SY.available()) return toast('Live sharing isn\'t set up on this app yet', 'err');
    code = (code || '').trim().toUpperCase();
    if (!code) return;
    APP.syncNames = {};
    go('watch', { code });
    enterRoom(code);
  }

  function watchScreen(screen, params) {
    screen.innerHTML = `<div class="empty"><div class="big">📡</div>Connecting to <b>${esc(params.code || '')}</b>…
      <div class="small muted" style="margin-top:8px">Waiting for the scorer to send the match. Make sure the code is right.</div>
      <button class="btn ghost block" id="w-cancel" style="margin-top:16px">Cancel</button></div>`;
    $('#w-cancel').onclick = () => { SY.leave(); go('home'); };
  }

  function renameTeams(match) {
    const s = sheet('Rename teams', `
      <label class="field"><span>Team 1</span><input id="rn0" value="${esc(match.teams[0].name)}"></label>
      <label class="field"><span>Team 2</span><input id="rn1" value="${esc(match.teams[1].name)}"></label>
      <button class="btn primary block" id="rn-ok">Save</button>`);
    $('#rn-ok', s.overlay).onclick = () => {
      match.teams[0].name = $('#rn0', s.overlay).value.trim() || 'Team A';
      match.teams[1].name = $('#rn1', s.overlay).value.trim() || 'Team B';
      S.Matches.save(match); s.close(); render();
    };
  }

  function jerseyPrefix(pid) { const p = S.Players.get(pid); return p && p.jersey ? `<span class="jersey">#${esc(p.jersey)}</span> ` : ''; }
  function batRow(p, bs, strike) {
    if (!p || !bs) return '';
    const sr = bs.balls ? (bs.runs / bs.balls * 100).toFixed(0) : '0';
    return `<tr><td class="${strike ? 'on-strike' : ''}">${jerseyPrefix(p.id)}${esc(p.name)}</td>
      <td>${bs.runs}</td><td>${bs.balls}</td><td>${bs.fours}</td><td>${bs.sixes}</td><td>${sr}</td></tr>`;
  }
  function bowlRow(p, bw) {
    if (!p || !bw) return '';
    const ov = Math.floor(bw.balls / 6) + '.' + (bw.balls % 6);
    const econ = bw.balls ? (bw.runsConceded / bw.balls * 6).toFixed(1) : '0.0';
    return `<tr><td>${jerseyPrefix(p.id)}${esc(p.name)}</td><td>${ov}</td><td>${bw.maidens}</td><td>${bw.runsConceded}</td><td>${bw.wickets}</td><td>${econ}</td></tr>`;
  }

  // events delivered in the current (incomplete) over — reset each completed over
  function currentOverBalls(inn) {
    let legal = 0; const groups = [];
    inn.timeline.forEach((ev) => {
      groups.push(ev);
      if (ev.legal) { legal++; if (legal % 6 === 0) groups.length = 0; }
    });
    return groups;
  }

  function ballChip(ev) {
    let cls = 'bball', label = '';
    if (ev.wicket) { cls += ' w'; label = 'W'; }
    else if (ev.extraType === 'wide') { cls += ' ex'; label = 'wd'; }
    else if (ev.extraType === 'noball') { cls += ' ex'; label = 'nb'; }
    else if (ev.extraType === 'bye') { cls += ' ex'; label = ev.teamRuns + 'b'; }
    else if (ev.extraType === 'legbye') { cls += ' ex'; label = ev.teamRuns + 'lb'; }
    else if (ev.runsBat === 4) { cls += ' four'; label = '4'; }
    else if (ev.runsBat === 6) { cls += ' six'; label = '6'; }
    else label = String(ev.runsBat);
    return `<span class="${cls}">${label}</span>`;
  }

  function commentaryHTML(inn) {
    const items = inn.timeline.slice(-30).reverse();
    if (!items.length) return '<span class="muted small">No balls yet.</span>';
    return items.map((ev) => {
      const cls = ev.wicket ? 'wkt' : ((ev.runsBat === 4 || ev.runsBat === 6) ? 'bnd' : '');
      const w = ev.wicket ? ` (${pname(ev.wicket.who)})` : '';
      return `<div class="comm-row ${cls}"><b>${ev.over}</b><span>${esc(ev.text)}${w} — ${esc(pname(ev.bowler))} to ${esc(pname(ev.striker))}</span></div>`;
    }).join('');
  }

  function runBtn(n, cls = '') {
    return `<button class="run-btn ${cls}" data-run="${n}">${n}</button>`;
  }

  /* =========================================================
     SCORECARD
  ========================================================= */
  function scorecardScreen(screen, params, actions) {
    const match = S.Matches.get(params.id);
    if (!match) return go('home');
    actions.innerHTML = `<button class="btn sm" id="card-share">Share</button>`;

    const potm = ST.playerOfMatch(match);
    const hasBalls = match.innings.some((i) => i.timeline.length);

    screen.innerHTML = `
      <div class="screen-title"><h2>Scorecard</h2>
        <span class="badge ${match.status === 'live' ? 'live' : 'done'}">${match.status === 'live' ? 'LIVE' : 'Result'}</span></div>
      <div class="card">
        <div class="row spread">
          <div class="row" style="gap:8px">
            ${teamLogoHTML({ logo: match.teams[0].logo, name: SC.teamName(match, 0) })}
            <b>${esc(SC.teamName(match, 0))}</b> <span class="muted">vs</span>
            ${teamLogoHTML({ logo: match.teams[1].logo, name: SC.teamName(match, 1) })}
            <b>${esc(SC.teamName(match, 1))}</b>
          </div>
          <span class="muted small">${fmtDateTime(match.date)}</span>
        </div>
        ${match.venue ? `<div class="muted small" style="margin-top:4px">📍 ${esc(match.venue)}</div>` : ''}
        <div style="margin-top:6px" class="muted small">${match.format === 'box' ? '📦 Box cricket' : '🌳 Ground'} · ${match.rules.oversPerInnings} ov · ${match.rules.playersPerSide}-a-side ${match.rules.lastManStanding ? '· Last Man Standing' : ''}</div>
        <div style="margin-top:8px;font-size:16px"><b>${esc(match.result || 'In progress')}</b></div>
        <div class="muted small">Toss: ${esc(SC.teamName(match, match.toss.wonBy))} elected to ${match.toss.decision}</div>
        ${(() => { const h = ST.headToHead(SC.teamName(match, 0), SC.teamName(match, 1)); return h.played > 1 ? `<div class="muted small" style="margin-top:4px">Head-to-head: ${esc(h.a)} <b>${h.aWins}</b> – <b>${h.bWins}</b> ${esc(h.b)}${h.ties ? ' · ' + h.ties + ' tie' + (h.ties > 1 ? 's' : '') : ''}</div>` : ''; })()}
      </div>

      ${potm ? `<div class="card" style="border-color:#6a4f15;background:linear-gradient(180deg,#241b06,#1a1405)">
        <div class="row" style="gap:12px">
          ${avatar(S.Players.get(potm.pid), 'lg')}
          <div style="flex:1;min-width:0">
            <div class="small" style="color:var(--accent);letter-spacing:.5px">⭐ ${match.status === 'complete' ? 'PLAYER OF THE MATCH' : 'TOP PERFORMER'}</div>
            <div style="font-size:18px;font-weight:800" data-pl="${potm.pid}">${esc(pname(potm.pid))}</div>
            <div class="small muted">${esc(potm.line)}</div>
          </div>
        </div></div>` : ''}

      ${hasBalls ? `<div class="card">
        <div class="tabs"><button data-ch="worm" class="${cardChart === 'worm' ? 'active' : ''}">📈 Worm</button>
          <button data-ch="manhattan" class="${cardChart === 'manhattan' ? 'active' : ''}">📊 Manhattan</button></div>
        <div id="chart-box" style="margin-top:12px">${cardChart === 'worm' ? APP.charts.wormSVG(match) : APP.charts.manhattanSVG(match)}</div>
      </div>` : ''}

      ${match.innings.map((inn, i) => inningsCard(match, inn, i)).join('')}
      ${hasBalls ? awardCard(match.status === 'complete' ? '🏅 Match awards' : '🏅 Match awards (so far)', ST.awards([match], { minBowlBalls: 1 }), 'Man of the match') : ''}
      ${match.status === 'live' ? `<button class="btn primary block" id="card-resume" style="margin-top:12px">▸ Resume scoring</button>` : ''}
      <button class="btn ghost block small" id="card-del" style="margin-top:12px">Delete match</button>
    `;
    $$('#screen [data-ch]').forEach((b) => b.onclick = () => {
      cardChart = b.dataset.ch;
      $$('#screen [data-ch]').forEach((x) => x.classList.toggle('active', x.dataset.ch === cardChart));
      $('#chart-box').innerHTML = cardChart === 'worm' ? APP.charts.wormSVG(match) : APP.charts.manhattanSVG(match);
    });
    if ($('#card-resume')) $('#card-resume').onclick = () => go('live', { id: match.id });
    $('#card-del').onclick = () => confirm('Delete match?', 'Remove permanently?', () => { S.Matches.remove(match.id); go('home'); }, 'Delete', true);
    $('#card-share').onclick = () => shareMenu(match);
    $$('#screen [data-pl]').forEach((e) => e.onclick = () => go('player', { id: e.dataset.pl }));
  }

  function inningsCard(match, inn, idx) {
    const batOrder = Object.keys(inn.batStats).sort((a, b) => inn.batStats[a].order - inn.batStats[b].order);
    const bowlers = Object.keys(inn.bowlStats);
    const extras = inn.extras;
    const exTotal = extras.wide + extras.noball + extras.bye + extras.legbye;
    return `<div class="card">
      <div class="row spread"><h4 style="color:var(--green)">${esc(SC.teamName(match, inn.battingTeam))}${inn.superOver ? ' <span class="badge">⚡ Super Over</span>' : ''}</h4>
        <b>${inn.runs}/${inn.wickets} <span class="muted small">(${SC.oversText(inn.legalBalls)} ov)</span></b></div>
      <table class="sc-table" style="margin-top:8px">
        <tr><th>Batter</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
        ${batOrder.map((pid) => {
          const b = inn.batStats[pid];
          const sr = b.balls ? (b.runs / b.balls * 100).toFixed(0) : '0';
          return `<tr><td data-pl="${pid}">${jerseyPrefix(pid)}${esc(pname(pid))}</td>
            <td class="dim" style="text-align:left">${b.out ? dismissalLine(b) : (b.retired ? 'retired' : 'not out')}</td>
            <td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr}</td></tr>`;
        }).join('')}
        <tr><td colspan="2" class="dim">Extras (wd ${extras.wide}, nb ${extras.noball}, b ${extras.bye}, lb ${extras.legbye})</td><td colspan="5" style="text-align:left">${exTotal}</td></tr>
      </table>
      ${inn.fow.length ? `<div class="small muted" style="margin-top:6px"><b>Fall:</b> ${inn.fow.map((f) => `${f.score}-${f.wkts} (${esc(pname(f.player))}, ${f.over})`).join(', ')}</div>` : ''}
      ${(inn.partnerships || []).filter((p) => p.runs > 0 || p.balls > 0).length ? `<div class="small muted" style="margin-top:4px"><b>Partnerships:</b> ${inn.partnerships.filter((p) => p.runs > 0 || p.balls > 0).map((p) => `${p.runs}${p.out ? '' : '*'} (${esc(pname(p.a))}/${esc(pname(p.b))})`).join(', ')}</div>` : ''}
      <table class="sc-table" style="margin-top:10px">
        <tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
        ${bowlers.map((pid) => {
          const w = inn.bowlStats[pid];
          const ov = Math.floor(w.balls / 6) + '.' + (w.balls % 6);
          const econ = w.balls ? (w.runsConceded / w.balls * 6).toFixed(1) : '0.0';
          return `<tr><td data-pl="${pid}">${jerseyPrefix(pid)}${esc(pname(pid))}</td><td>${ov}</td><td>${w.maidens}</td><td>${w.runsConceded}</td><td><b>${w.wickets}</b></td><td>${econ}</td></tr>`;
        }).join('')}
      </table>
    </div>`;
  }
  function dismissalLine(b) {
    const f = b.fielder ? pname(b.fielder) : '';
    const bwl = b.bowler ? pname(b.bowler) : '';
    switch (b.how) {
      case 'bowled': return 'b ' + bwl;
      case 'lbw': return 'lbw b ' + bwl;
      case 'caught': return 'c ' + f + ' b ' + bwl;
      case 'stumped': return 'st ' + f + ' b ' + bwl;
      case 'runout': return 'run out (' + f + ')';
      case 'hitwicket': return 'hit wkt b ' + bwl;
      case 'retired': return 'retired';
      default: return b.how;
    }
  }

  function shareMenu(match) {
    const s = sheet('Share scorecard', `<div class="opt-list">
      <button class="opt" data-a="wa">📲 Share on WhatsApp</button>
      <button class="opt" data-a="img">🖼️ Share image (PNG)</button>
      <button class="opt" data-a="imgdl">⬇️ Save image (PNG)</button>
      <button class="opt" data-a="text">📋 Share / copy as text</button>
    </div>
    <div class="center" style="margin-top:12px"><img id="share-preview" style="max-width:60%;border-radius:14px;border:1px solid var(--line)" alt=""></div>`);
    // live preview thumbnail
    try {
      const svg = APP.charts.scorecardCardSVG(match);
      $('#share-preview', s.overlay).src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (e) {}
    $$('.opt', s.overlay).forEach((b) => b.onclick = () => {
      const a = b.dataset.a; s.close();
      if (a === 'wa') whatsapp(scorecardText(match));
      else if (a === 'text') shareCard(match);
      else exportScorecardImage(match, a === 'img');
    });
  }

  function exportScorecardImage(match, share) {
    let svg;
    try { svg = APP.charts.scorecardCardSVG(match); } catch (e) { return toast('Could not build image', 'err'); }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0a0f0d'; ctx.fillRect(0, 0, 1080, 1080);
      ctx.drawImage(img, 0, 0, 1080, 1080);
      URL.revokeObjectURL(url);
      const fname = `sixer-${SC.teamName(match, 0)}-vs-${SC.teamName(match, 1)}.png`.replace(/[^\w.-]+/g, '_');
      canvas.toBlob(async (png) => {
        if (!png) return toast('Export failed', 'err');
        const file = new File([png], fname, { type: 'image/png' });
        if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: BRAND, text: match.result || '' }); return; } catch (e) { /* fall through to download */ }
        }
        const u = URL.createObjectURL(png);
        const link = document.createElement('a'); link.href = u; link.download = fname; link.click();
        setTimeout(() => URL.revokeObjectURL(u), 1500);
        toast('Image saved');
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Image export failed', 'err'); };
    img.src = url;
  }

  function scorecardText(match) {
    const lines = [];
    lines.push(`🏏 *${SC.teamName(match, 0)}* vs *${SC.teamName(match, 1)}*`);
    lines.push(`${fmtDateTime(match.date)}${match.venue ? ' · 📍 ' + match.venue : ''}`);
    match.innings.forEach((inn) => lines.push(`${SC.teamName(match, inn.battingTeam)}: ${inn.runs}/${inn.wickets} (${SC.oversText(inn.legalBalls)} ov)`));
    lines.push(match.result || 'In progress');
    const potm = ST.playerOfMatch(match);
    if (potm && match.status === 'complete') lines.push(`⭐ Player of the Match: ${pname(potm.pid)} (${potm.line})`);
    lines.push('');
    lines.push(teamLineup(match, 0));
    lines.push(teamLineup(match, 1));
    if (match.roomCode && match.status !== 'complete') lines.push(`\nWatch live: ${location.origin + location.pathname}?watch=${match.roomCode}`);
    lines.push('— via Sixer');
    return lines.join('\n');
  }

  function shareCard(match) {
    const text = scorecardText(match);
    if (navigator.share) navigator.share({ title: BRAND, text }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(text); toast('Scorecard copied'); }
  }

  /* =========================================================
     STATS / LEADERBOARDS
  ========================================================= */
  let pendingStrikeAsk = false;
  let cardChart = 'worm';
  let statsTab = 'batting';
  function statsScreen(screen) {
    const rows = ST.leaderboard();
    screen.innerHTML = `
      <div class="screen-title"><h2>Leaderboards</h2></div>
      <div class="tabs">
        <button data-tab="batting" class="${statsTab === 'batting' ? 'active' : ''}">Batting</button>
        <button data-tab="bowling" class="${statsTab === 'bowling' ? 'active' : ''}">Bowling</button>
        <button data-tab="allround" class="${statsTab === 'allround' ? 'active' : ''}">All-round</button>
      </div>
      <div id="lb-body" style="margin-top:12px"></div>`;
    $$('#screen [data-tab]').forEach((b) => b.onclick = () => { statsTab = b.dataset.tab; render(); });
    const body = $('#lb-body');
    if (!rows.length) { body.innerHTML = `<div class="empty"><div class="big">📊</div>Play some matches to build stats.</div>`; return; }

    if (statsTab === 'batting') {
      const sorted = rows.slice().sort((a, b) => b.c.runs - a.c.runs);
      body.innerHTML = lbTable(['#', 'Player', 'M', 'Runs', 'HS', 'Avg', 'SR'],
        sorted.map((r, i) => [i + 1, plLink(r.player), r.c.mat, r.c.runs, r.c.hs + (r.c.hsNotOut ? '*' : ''), r.f.avg, r.f.sr]));
    } else if (statsTab === 'bowling') {
      const sorted = rows.slice().sort((a, b) => b.c.wkts - a.c.wkts || a.f.econ - b.f.econ);
      body.innerHTML = lbTable(['#', 'Player', 'M', 'Wkts', 'Best', 'Econ', 'Ov'],
        sorted.map((r, i) => [i + 1, plLink(r.player), r.c.mat, r.c.wkts, r.f.best, r.f.econ, r.f.overs]));
    } else {
      const sorted = rows.slice().sort((a, b) => (b.c.runs + b.c.wkts * 20) - (a.c.runs + a.c.wkts * 20));
      body.innerHTML = lbTable(['#', 'Player', 'Runs', 'Wkts', 'Ct', 'Pts'],
        sorted.map((r, i) => [i + 1, plLink(r.player), r.c.runs, r.c.wkts, r.c.catches, r.c.runs + r.c.wkts * 20]));
    }
    $$('#screen [data-pl]').forEach((e) => e.onclick = () => go('player', { id: e.dataset.pl }));
  }
  function plLink(p) { return `<span data-pl="${p.id}" style="color:var(--green)">${esc(p.name)}</span>`; }
  function lbTable(headers, rows) {
    return `<div class="card"><table class="sc-table">
      <tr>${headers.map((h, i) => `<th style="${i === 1 ? 'text-align:left' : ''}">${h}</th>`).join('')}</tr>
      ${rows.map((r) => `<tr>${r.map((c, i) => `<td style="${i === 1 ? 'text-align:left' : ''}">${c}</td>`).join('')}</tr>`).join('')}
    </table></div>`;
  }

  /* =========================================================
     SESSIONS (weekly)
  ========================================================= */
  let competeTab = 'cups';
  function sessionsScreen(screen, params, actions) {
    if (params.tab) competeTab = params.tab;
    const cups = S.Tournaments.all();
    const sessions = S.Sessions.all();
    actions.innerHTML = `<button class="btn sm primary" id="se-add">＋ New</button>`;

    const tabs = `<div class="tabs" style="margin-bottom:12px">
        <button data-ct="cups" class="${competeTab === 'cups' ? 'active' : ''}">🏆 Tournaments</button>
        <button data-ct="weeks" class="${competeTab === 'weeks' ? 'active' : ''}">🗓️ Weeks</button>
      </div>`;

    if (competeTab === 'cups') {
      screen.innerHTML = `<div class="screen-title"><h2>Compete</h2></div>${tabs}
        <p class="muted small">Run a proper tournament: league fixtures, points table with NRR, semis and a final.</p>
        <button class="btn primary block" id="cup-new" style="margin:12px 0">🏆 New tournament</button>
        ${cups.length ? cups.map((t) => {
          const champ = TR.champion(t);
          const played = t.fixtures.filter(TR.isPlayed).length;
          return `<div class="list-link" data-cup="${t.id}">
            <div style="min-width:0"><b>${esc(t.name)}</b>
              <div class="small muted">${t.teamIds.length} teams · ${played}/${t.fixtures.length} played${champ ? ' · 🏆 ' + esc(teamName(champ)) : ''}</div></div>
            <span class="badge ${t.status === 'done' ? 'done' : 'live'}">${t.status === 'done' ? 'Finished' : (t.status === 'playoffs' ? 'Playoffs' : 'League')}</span>
          </div>`;
        }).join('') : `<div class="empty"><div class="big">🏆</div>No tournaments yet.</div>`}`;
      $('#cup-new').onclick = newTournament;
      $('#se-add').onclick = newTournament;
      $$('#screen [data-cup]').forEach((e) => e.onclick = () => go('cup', { id: e.dataset.cup }));
    } else {
      screen.innerHTML = `<div class="screen-title"><h2>Compete</h2></div>${tabs}
        <p class="muted small">Group casual games by week. Tap a week to see its matches & stats.</p>
        ${sessions.length ? sessions.map((se) => {
          const ms = S.Sessions.matches(se.id);
          return `<div class="list-link" data-se="${se.id}">
            <div><b>${esc(se.name)}</b><div class="small muted">${fmtDate(se.date)} · ${ms.length} match${ms.length !== 1 ? 'es' : ''}</div></div>
            <span class="muted">›</span></div>`;
        }).join('') : `<div class="empty"><div class="big">🗓️</div>No weeks yet.</div>`}`;
      $('#se-add').onclick = () => prompt('New week', 'Name', 'Week of ' + fmtDate(Date.now()), (v) => { if (v) { S.Sessions.add({ name: v }); render(); } });
      $$('#screen [data-se]').forEach((e) => e.onclick = () => go('session', { id: e.dataset.se }));
    }
    $$('#screen [data-ct]').forEach((b) => b.onclick = () => { competeTab = b.dataset.ct; render(); });
  }

  const teamName = (id) => { const t = S.Teams.get(id); return t ? t.name : '—'; };

  function newTournament() {
    const teams = S.Teams.all();
    if (teams.length < 2) {
      return confirm('Create teams first', 'A tournament needs at least 2 saved teams. Create them under Squad → Teams.', () => go('players', { tab: 'teams' }), 'Go to Teams');
    }
    const d = S.Settings.get().defaults;
    const sel = new Set();
    const s = sheet('New tournament', `
      <label class="field"><span>Tournament name</span><input id="cp-name" placeholder="e.g. Sunday Box Cup"></label>
      <div class="grid cols-2">
        <label class="field"><span>Overs / innings</span><input id="cp-ov" type="number" min="1" max="50" value="${d.oversPerInnings}"></label>
        <label class="field"><span>Players / side</span><input id="cp-pps" type="number" min="2" max="16" value="${d.playersPerSide}"></label>
      </div>
      <label class="field"><span>Format</span>
        <select id="cp-fmt">
          <option value="league_playoffs">League + Semis + Final</option>
          <option value="league_only">League only (top of table wins)</option>
          <option value="double_rr">Double round-robin + playoffs</option>
          <option value="knockout">Knockout (single elimination)</option>
        </select></label>
      <div class="small muted" style="margin:6px 0">Pick the teams taking part</div>
      <div class="plist" id="cp-teams" style="max-height:36vh;overflow:auto">
        ${teams.map((t) => `<div class="prow" data-t="${t.id}">
          ${teamLogoHTML(t)}
          <div class="meta"><div class="nm">${esc(t.name)}</div><div class="sub">${t.players.length} players</div></div>
          <span class="pill">+</span></div>`).join('')}
      </div>
      <div class="small muted center" id="cp-count" style="margin-top:8px">0 teams selected</div>
      <button class="btn primary block" id="cp-ok" style="margin-top:10px">Create tournament</button>`);
    $$('#cp-teams [data-t]', s.overlay).forEach((row) => row.onclick = () => {
      const id = row.dataset.t;
      const pill = row.querySelector('.pill');
      if (sel.has(id)) { sel.delete(id); row.style.borderColor = ''; row.style.background = ''; pill.className = 'pill'; pill.textContent = '+'; }
      else { sel.add(id); row.style.borderColor = 'var(--green)'; row.style.background = 'var(--green-d)'; pill.className = 'pill on'; pill.textContent = '✓'; }
      $('#cp-count', s.overlay).textContent = sel.size + ' teams selected';
    });
    $('#cp-ok', s.overlay).onclick = () => {
      const name = $('#cp-name', s.overlay).value.trim();
      if (!name) return toast('Enter a tournament name', 'err');
      if (sel.size < 2) return toast('Pick at least 2 teams', 'err');
      const rules = Object.assign({}, d, {
        oversPerInnings: clampInt($('#cp-ov', s.overlay).value, 1, 50, d.oversPerInnings),
        playersPerSide: clampInt($('#cp-pps', s.overlay).value, 2, 16, d.playersPerSide),
      });
      const t = TR.create({ name, teamIds: Array.from(sel), rules, format: $('#cp-fmt', s.overlay).value });
      s.close(); toast('Tournament created'); go('cup', { id: t.id });
    };
  }

  /* ---- Tournament detail ---- */
  function cupScreen(screen, params, actions) {
    const t = S.Tournaments.get(params.id);
    if (!t) return go('sessions');
    TR.advance(t); // create semis/final as soon as they're possible
    const rows = TR.table(t);
    const champ = TR.champion(t);
    const next = TR.nextFixture(t);
    actions.innerHTML = `<button class="btn sm" id="cup-del">Delete</button>`;

    const fixtureRow = (f) => {
      const m = TR.matchOf(f);
      const done = TR.isPlayed(f);
      const live = m && m.status === 'live';
      const w = TR.winnerOf(f);
      return `<div class="list-link" data-fx="${f.id}">
        <div style="min-width:0">
          <div><b>${esc(teamName(f.a))}</b> <span class="muted">vs</span> <b>${esc(teamName(f.b))}</b></div>
          <div class="small muted">${TR.roundLabelOf(t, f.round)}${done ? ' · ' + esc(m.result || '') : (live ? ' · in progress' : ' · not played')}</div>
        </div>
        <span class="badge ${done ? 'done' : (live ? 'live' : '')}">${done ? (w ? '🏅' : 'Tie') : (live ? 'Resume' : 'Play ▸')}</span>
      </div>`;
    };
    const isKO = t.format === 'knockout';
    const grouped = TR.roundOrder(t);

    screen.innerHTML = `
      <div class="screen-title"><h2>${esc(t.name)}</h2>
        <span class="badge ${t.status === 'done' ? 'done' : 'live'}">${t.status === 'done' ? 'Finished' : (t.status === 'playoffs' ? 'Playoffs' : (isKO ? 'Knockout' : 'League'))}</span></div>

      ${champ ? `<div class="card center" style="border-color:#6a4f15;background:linear-gradient(180deg,#241b06,#1a1405)">
        <div class="small" style="color:var(--accent);letter-spacing:2px">🏆 CHAMPION</div>
        <div style="font-size:26px;font-weight:900;margin-top:4px">${esc(teamName(champ))}</div></div>` : ''}

      ${next && t.status !== 'done' ? `<button class="btn primary block" id="cup-next" style="margin:12px 0;padding:16px">
        ▸ Play next: ${esc(teamName(next.a))} vs ${esc(teamName(next.b))}
        <span class="small" style="opacity:.75">(${TR.roundLabelOf(t, next.round)})</span></button>` : ''}

      ${isKO ? '' : `<div class="card">
        <h4>Points table</h4>
        <table class="sc-table" style="margin-top:8px">
          <tr><th style="text-align:left">Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>Pts</th><th>NRR</th></tr>
          ${rows.map((r, i) => `<tr>
            <td style="text-align:left">${i < 4 && (t.format === 'league_playoffs' || t.format === 'double_rr') && rows.length >= 4 ? '<span style="color:var(--green)">•</span> ' : ''}${esc(r.name)}</td>
            <td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td><b>${r.pts}</b></td>
            <td style="color:${r.nrr >= 0 ? 'var(--green)' : 'var(--red)'}">${r.nrrStr}</td></tr>`).join('')}
        </table>
        ${(t.format === 'league_playoffs' || t.format === 'double_rr') && rows.length >= 4 ? '<div class="small muted" style="margin-top:6px">• Top 4 qualify for the semi-finals</div>' : ''}
      </div>`}

      ${awardCard('🏅 Tournament awards', ST.awards(S.Tournaments.matches(t.id)), 'Player of the tournament')}

      ${grouped.map((r) => { const byes = (t.koByes && t.koByes[r]) || []; return `<div class="card"><h4>${esc(TR.roundLabelOf(t, r))}</h4>
        <div style="margin-top:8px">${t.fixtures.filter((f) => f.round === r).map(fixtureRow).join('')}</div>
        ${byes.length ? `<div class="small muted" style="margin-top:6px">Bye: ${byes.map((id) => esc(teamName(id))).join(', ')}</div>` : ''}</div>`; }).join('')}
    `;
    if ($('#cup-next')) $('#cup-next').onclick = () => openFixture(t, next);
    $$('#screen [data-fx]').forEach((e) => e.onclick = () => openFixture(t, t.fixtures.find((f) => f.id === e.dataset.fx)));
    $('#cup-del').onclick = () => confirm('Delete tournament?', 'Removes the tournament and its matches.', () => { S.Tournaments.remove(t.id); go('sessions'); }, 'Delete', true);
  }

  /* Start (or resume) the match for a fixture. */
  function openFixture(t, f) {
    if (!f) return;
    const existing = TR.matchOf(f);
    if (existing) return go(existing.status === 'live' ? 'live' : 'scorecard', { id: existing.id });

    const teamA = S.Teams.get(f.a), teamB = S.Teams.get(f.b);
    if (!teamA || !teamB) return toast('Team missing', 'err');
    const s = sheet('Toss', `
      <div class="small muted" style="margin-bottom:7px">Who won the toss?</div>
      <div class="chips" id="ts-who">
        <button class="chip sel" data-w="0">${esc(teamA.name)}</button>
        <button class="chip" data-w="1">${esc(teamB.name)}</button>
      </div>
      <div class="small muted" style="margin:14px 0 7px">Elected to</div>
      <div class="chips" id="ts-dec">
        <button class="chip sel" data-d="bat">🏏 Bat</button>
        <button class="chip" data-d="bowl">🎯 Bowl</button>
      </div>
      <button class="btn block" id="ts-flip" style="margin-top:12px">🎲 Auto flip</button>
      <button class="btn primary block" id="ts-ok" style="margin-top:8px">Start match ▸</button>`);
    let wonBy = 0, decision = 'bat';
    const wire = (sel, key, cb) => $$(sel + ' .chip', s.overlay).forEach((b) => b.onclick = () => {
      $$(sel + ' .chip', s.overlay).forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel'); cb(b.dataset[key]);
    });
    wire('#ts-who', 'w', (v) => wonBy = parseInt(v, 10));
    wire('#ts-dec', 'd', (v) => decision = v);
    $('#ts-flip', s.overlay).onclick = () => { const r = flipToss(s.overlay, teamA.name, teamB.name); wonBy = r.wonBy; decision = r.decision; };
    $('#ts-ok', s.overlay).onclick = () => {
      s.close();
      const match = SC.newMatch({
        format: t.rules.format || 'box', rules: Object.assign({}, t.rules),
        teams: [
          { name: teamA.name, players: teamA.players.slice(), teamId: teamA.id, logo: teamA.logo || '' },
          { name: teamB.name, players: teamB.players.slice(), teamId: teamB.id, logo: teamB.logo || '' },
        ],
        toss: { wonBy, decision },
      });
      match.tournamentId = t.id;
      match.fixtureId = f.id;
      S.Matches.save(match);
      f.matchId = match.id;
      S.Tournaments.save(t);
      openInningsFlow(match);
    };
  }

  // Awards card for a set of matches (day/session or tournament)
  function awardCard(title, aw, mvpLabel) {
    if (!aw) return '';
    mvpLabel = mvpLabel || 'Player of the day';
    const row = (emoji, label, r, line) => r ? `<div class="award">
        <span class="aw-emoji">${emoji}</span>
        <div class="aw-meta"><div class="aw-label">${esc(label)}</div>
          <div class="aw-name" data-pl="${r.player.id}">${esc(r.player.name)}</div>
          <div class="small muted">${line(r)}</div></div></div>` : '';
    return `<div class="card"><h4>${esc(title)}</h4>
      <div class="awards">
        ${row('🏆', mvpLabel, aw.potd, (r) => `${r.c.runs} runs · ${r.c.wkts} wkts · impact ${Math.round(r.impact)}`)}
        ${row('🟠', 'Orange Cap · runs', aw.orangeCap, (r) => `${r.c.runs} runs`)}
        ${row('🟣', 'Purple Cap · wickets', aw.purpleCap, (r) => `${r.c.wkts} wkts`)}
        ${row('🥇', 'Best batter', aw.bestBatter, (r) => `${r.c.runs} (${r.c.balls}) · SR ${r.f.sr}`)}
        ${row('🎯', 'Best bowler', aw.bestBowler, (r) => `${r.c.wkts} wkts · econ ${r.f.econ}`)}
        ${row('🌟', 'Best all-rounder', aw.bestAllrounder, (r) => `${r.c.runs} runs · ${r.c.wkts} wkts`)}
        ${row('🧤', 'Best fielder', aw.bestFielder, (r) => `${r.field} dismissal${r.field !== 1 ? 's' : ''}`)}
        ${row('💚', 'Best economy', aw.bestEcon, (r) => `econ ${r.f.econ} · ${r.f.overs} ov`)}
      </div></div>`;
  }

  // Randomise a chip-based toss sheet (#ts-who / #ts-dec); returns {wonBy, decision}
  function flipToss(overlay, aName, bName) {
    const wonBy = Math.floor(Math.random() * 2);
    const decision = Math.random() < 0.5 ? 'bat' : 'bowl';
    $$('#ts-who .chip', overlay).forEach((x) => x.classList.toggle('sel', parseInt(x.dataset.w, 10) === wonBy));
    $$('#ts-dec .chip', overlay).forEach((x) => x.classList.toggle('sel', x.dataset.d === decision));
    toast(`🪙 ${wonBy === 0 ? aName : bName} won the toss — chose to ${decision}`);
    return { wonBy, decision };
  }

  // Start another match reusing the two teams from the last match in a session
  function tossThenStart(teamA, teamB, rules, format, sessionId, venue) {
    const s = sheet('Toss', `
      <label class="field"><span>Venue</span><input id="ts-venue" value="${esc(venue || '')}" placeholder="Venue"></label>
      <div class="small muted" style="margin-bottom:7px">Who won the toss?</div>
      <div class="chips" id="ts-who">
        <button class="chip sel" data-w="0">${esc(teamA.name)}</button>
        <button class="chip" data-w="1">${esc(teamB.name)}</button>
      </div>
      <div class="small muted" style="margin:14px 0 7px">Elected to</div>
      <div class="chips" id="ts-dec">
        <button class="chip sel" data-d="bat">🏏 Bat</button>
        <button class="chip" data-d="bowl">🎯 Bowl</button>
      </div>
      <button class="btn block" id="ts-flip" style="margin-top:12px">🎲 Auto flip</button>
      <button class="btn primary block" id="ts-ok" style="margin-top:8px">Start match ▸</button>`);
    let wonBy = 0, decision = 'bat';
    const wire = (sel, key, cb) => $$(sel + ' .chip', s.overlay).forEach((b) => b.onclick = () => {
      $$(sel + ' .chip', s.overlay).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); cb(b.dataset[key]);
    });
    wire('#ts-who', 'w', (v) => wonBy = parseInt(v, 10));
    wire('#ts-dec', 'd', (v) => decision = v);
    $('#ts-flip', s.overlay).onclick = () => { const r = flipToss(s.overlay, teamA.name, teamB.name); wonBy = r.wonBy; decision = r.decision; };
    $('#ts-ok', s.overlay).onclick = () => {
      const v = $('#ts-venue', s.overlay) ? $('#ts-venue', s.overlay).value.trim() : '';
      s.close();
      const match = SC.newMatch({ sessionId, format: format || 'box', rules: Object.assign({}, rules), teams: [teamA, teamB], toss: { wonBy, decision }, venue: v, date: Date.now() });
      openInningsFlow(match);
    };
  }
  function playAgainSameTeams(se) {
    const ms = S.Sessions.matches(se.id).sort((a, b) => b.date - a.date);
    const last = ms.find((m) => m.teams && m.teams.length === 2);
    if (!last) { draft = null; go('newmatch'); setTimeout(() => { if (draft) draft.sessionId = se.id; }, 0); return; }
    const A = last.teams[0], B = last.teams[1];
    tossThenStart(
      { name: A.name, players: A.players.slice(), teamId: A.teamId, logo: A.logo || '' },
      { name: B.name, players: B.players.slice(), teamId: B.teamId, logo: B.logo || '' },
      last.rules, last.format, se.id, last.venue || '');
  }

  function sessionScreen(screen, params, actions) {
    const se = S.Sessions.get(params.id);
    if (!se) return go('sessions');
    const ms = S.Sessions.matches(se.id).sort((a, b) => b.date - a.date);
    actions.innerHTML = `<button class="btn sm" id="ss-play">＋ New</button>`;
    const table = ST.standings(ms);
    const hasPrev = ms.some((m) => m.teams && m.teams.length === 2);
    screen.innerHTML = `
      <div class="screen-title"><h2>${esc(se.name)}</h2></div>
      <div class="muted small">${fmtDate(se.date)} · ${ms.length} matches</div>

      ${table.length ? `<div class="card" style="margin-top:12px">
        <h4>Points table</h4>
        <table class="sc-table" style="margin-top:8px">
          <tr><th style="text-align:left">Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>Pts</th><th>NRR</th></tr>
          ${table.map((t) => `<tr>
            <td style="text-align:left">${esc(t.name)}</td>
            <td>${t.p}</td><td>${t.w}</td><td>${t.l}</td><td>${t.t}</td>
            <td><b>${t.pts}</b></td>
            <td style="color:${t.nrr >= 0 ? 'var(--green)' : 'var(--red)'}">${t.nrrStr}</td></tr>`).join('')}
        </table>
        <div class="small muted" style="margin-top:6px">2 pts win · 1 tie · NRR = run rate for − against (all-out counts full overs)</div>
      </div>` : ''}

      <button class="btn primary block" id="ss-again" style="margin-top:12px;padding:15px">${hasPrev ? '🔁 Play again — same teams' : '🏏 Start first match'}</button>
      <div class="card" style="margin-top:12px">
        <h4>Matches</h4>
        ${ms.length ? ms.map(matchListItem).join('') : `<div class="muted small" style="margin-top:8px">No matches yet — tap the button above to start.</div>`}
      </div>
      ${awardCard('🏅 Awards of the day', ST.awards(ms))}
      <button class="btn ghost block small" id="ss-del" style="margin-top:12px">Delete session</button>
    `;
    const newMatchHere = () => { draft = null; go('newmatch'); setTimeout(() => { if (draft) draft.sessionId = se.id; }, 0); };
    $('#ss-play').onclick = newMatchHere;
    $('#ss-again').onclick = () => hasPrev ? playAgainSameTeams(se) : newMatchHere();
    $('#ss-del').onclick = () => confirm('Delete session?', 'This also removes its matches.', () => { S.Sessions.remove(se.id); go('sessions'); }, 'Delete', true);
    $$('#screen [data-match]').forEach((e) => e.onclick = () => { const m = S.Matches.get(e.dataset.match); go(m.status === 'live' ? 'live' : 'scorecard', { id: m.id }); });
    $$('#screen [data-pl]').forEach((e) => e.onclick = () => go('player', { id: e.dataset.pl }));
  }

  /* =========================================================
     SETTINGS / BACKUP
  ========================================================= */
  function settingsScreen(screen) {
    const d = S.Settings.get().defaults;
    screen.innerHTML = `
      <div class="screen-title"><h2>Settings</h2></div>
      <div class="card">
        <h4>Default match rules</h4>
        <p class="muted small">Pre-fill values for new matches.</p>
        <div class="grid cols-2" style="margin-top:8px">
          <label class="field"><span>Overs</span><input id="st-overs" type="number" value="${d.oversPerInnings}"></label>
          <label class="field"><span>Players/side</span><input id="st-pps" type="number" value="${d.playersPerSide}"></label>
        </div>
        ${toggleStatic('Last Man Standing (default on)', d.lastManStanding)}
        <button class="btn primary block" id="st-save" style="margin-top:10px">Save defaults</button>
      </div>
      <div class="card">
        <h4>📡 Live sharing ${SY.configured() ? '<span class="badge done">On</span>' : '<span class="badge">Off</span>'}</h4>
        <p class="muted small">Let many phones watch one match live, and let anyone take over scoring. Free — powered by Firebase.</p>
        ${SY.configured()
          ? `<p class="small" style="color:var(--green)">✓ Connected. Use “📡 Go Live” while scoring to get a share link & code.</p>`
          : `<ol class="small muted" style="margin:6px 0 0 18px;line-height:1.7">
               <li>Create a free project at <b>console.firebase.google.com</b></li>
               <li>Build → <b>Realtime Database</b> → Create (test mode)</li>
               <li>Project settings → add a <b>Web app</b> → copy its config</li>
               <li>Paste it into <b>js/firebase-config.js</b> and redeploy</li>
             </ol>
             <p class="small muted" style="margin-top:8px">Suggested database rules (anyone with a code can watch/score):</p>
             <pre class="small" style="background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:10px;overflow:auto;white-space:pre">{ "rules": { "rooms": { ".read": true, ".write": true } } }</pre>`}
      </div>

      <div class="card">
        <h4>☁️ Cloud backup</h4>
        <p class="muted small">Back up your whole database (players, teams, matches, stats) to the cloud so it survives a lost phone. Keep your backup code to restore on any device.</p>
        <div id="st-cloudcode" class="small" style="margin:6px 0"></div>
        <button class="btn primary block" id="st-cloud-backup" ${SY.available() ? '' : 'disabled'}>☁️ Back up now</button>
        <button class="btn block" id="st-cloud-restore" style="margin-top:8px" ${SY.available() ? '' : 'disabled'}>☁️ Restore from a code</button>
        ${SY.available() ? '' : '<p class="small muted" style="margin-top:6px">Cloud sync needs Firebase to be set up (it is, on this build).</p>'}
      </div>

      <div class="card">
        <h4>Backup & restore (file)</h4>
        <p class="muted small">Or keep an offline copy as a file.</p>
        <button class="btn block" id="st-export" style="margin-top:8px">⬇️ Export backup (JSON)</button>
        <button class="btn block" id="st-import" style="margin-top:8px">⬆️ Import backup</button>
        <input type="file" id="st-file" accept="application/json" class="hidden">
        <button class="btn danger block" id="st-wipe" style="margin-top:14px">Erase all data</button>
      </div>
      <div class="card center muted small">
        <b>${esc(BRAND)}</b> · Box & Ground Cricket Scorer<br>Offline-first PWA · No login, no OTP
      </div>
    `;
    $('#st-save').onclick = () => {
      S.Settings.updateDefaults({ oversPerInnings: clampInt($('#st-overs').value, 1, 50, 6), playersPerSide: clampInt($('#st-pps').value, 2, 16, 8) });
      toast('Defaults saved');
    };
    // ---- cloud backup ----
    const savedCode = localStorage.getItem('sixer.backupCode');
    const codeEl = $('#st-cloudcode');
    if (codeEl && savedCode) codeEl.innerHTML = `Your backup code: <b style="color:var(--accent);letter-spacing:2px">${esc(savedCode)}</b> — keep it safe`;
    if ($('#st-cloud-backup')) $('#st-cloud-backup').onclick = () => {
      if (!SY.available()) return toast('Cloud not available', 'err');
      let code = localStorage.getItem('sixer.backupCode');
      if (!code) { code = ''; for (let i = 0; i < 6; i++) code += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]; localStorage.setItem('sixer.backupCode', code); }
      const btn = $('#st-cloud-backup'); btn.textContent = '☁️ Backing up…'; btn.disabled = true;
      SY.cloudBackup(code, S.exportJSON()).then((ok) => {
        btn.disabled = false; btn.textContent = '☁️ Back up now';
        if (ok) { localStorage.setItem('sixer.backupAt', String(Date.now())); toast('Backed up · code ' + code); if (codeEl) codeEl.innerHTML = `Your backup code: <b style="color:var(--accent);letter-spacing:2px">${esc(code)}</b> — keep it safe`; }
        else toast('Backup failed — check cloud rules', 'err');
      });
    };
    if ($('#st-cloud-restore')) $('#st-cloud-restore').onclick = () => {
      prompt('Restore from cloud', '6-letter backup code', localStorage.getItem('sixer.backupCode') || '', (code) => {
        code = (code || '').trim().toUpperCase(); if (!code) return;
        toast('Fetching…');
        SY.cloudRestore(code).then((v) => {
          if (!v) return toast('No backup found for that code', 'err');
          confirm('Restore backup?', 'This replaces everything on this device with the cloud backup from ' + fmtDate(v.ts) + '.', () => {
            try { S.importJSON(v.data); localStorage.setItem('sixer.backupCode', code); toast('Restored from cloud'); go('home'); }
            catch (e) { toast('Backup was unreadable', 'err'); }
          }, 'Restore');
        });
      }, 'e.g. K7PWA2');
    };
    $('#st-export').onclick = () => download(`sixer-backup-${new Date().toISOString().slice(0, 10)}.json`, S.exportJSON());
    $('#st-import').onclick = () => $('#st-file').click();
    $('#st-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { try { S.importJSON(reader.result); toast('Backup restored'); go('home'); } catch (err) { toast('Invalid backup file', 'err'); } };
      reader.readAsText(f);
    };
    $('#st-wipe').onclick = () => confirm('Erase everything?', 'Deletes all players, matches and sessions on this device.', () => { S.wipe(); go('home'); toast('All data erased'); }, 'Erase', true);
  }
  function toggleStatic(label, on) {
    return `<div class="toggle"><div>${label}</div>
      <label class="switch"><input type="checkbox" ${on ? 'checked' : ''} disabled><span class="track"></span><span class="thumb"></span></label></div>`;
  }

  /* =========================================================
     ROUTER TABLE + BOOT
  ========================================================= */
  const SCREENS = {
    home: homeScreen, players: playersScreen, player: playerProfile,
    newmatch: newMatchScreen, live: liveScreen, scorecard: scorecardScreen,
    stats: statsScreen, sessions: sessionsScreen, session: sessionScreen,
    cup: cupScreen, watch: watchScreen, settings: settingsScreen,
  };

  // PWA update prompt — shown when a new deployed version is ready to install
  APP.onUpdateReady = function (reg) {
    if (document.getElementById('update-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.className = 'update-bar';
    bar.innerHTML = `<span>🔄 New version of ${esc(BRAND)} is ready</span><button class="btn sm" id="upd-now">Update</button>`;
    document.body.appendChild(bar);
    document.getElementById('upd-now').onclick = () => {
      document.getElementById('upd-now').textContent = 'Updating…';
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      else location.reload();
    };
  };

  $$('#bottomnav button').forEach((b) => b.onclick = () => { if (b.dataset.route === 'newmatch') { draft = null; return chooseGameMode(); } go(b.dataset.route); });
  $('#brand-name').textContent = BRAND;

  // deep link: ?watch=CODE opens straight into a live match
  const watchCode = new URLSearchParams(location.search).get('watch');
  if (watchCode && SY.available()) watchRoom(watchCode);
  else render();
})();
