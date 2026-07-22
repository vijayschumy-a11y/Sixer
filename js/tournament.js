/* Sixer — tournament engine: round-robin fixtures, points table, playoffs, champion. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});

  const ROUND_LABEL = { league: 'League', sf1: 'Semi-Final 1', sf2: 'Semi-Final 2', final: 'Final' };

  /* Single round-robin: every team plays every other team once. */
  function generateLeague(teamIds) {
    const fx = [];
    for (let i = 0; i < teamIds.length; i++) {
      for (let j = i + 1; j < teamIds.length; j++) {
        fx.push({ id: APP.uid('fx'), round: 'league', a: teamIds[i], b: teamIds[j], matchId: null });
      }
    }
    return fx;
  }

  function create({ name, teamIds, rules, format }) {
    return APP.store.Tournaments.add({
      name, teamIds: teamIds.slice(), rules: Object.assign({}, rules),
      format: format || 'league_playoffs',
      fixtures: generateLeague(teamIds),
      status: 'league',
    });
  }

  const matchOf = (fx) => (fx.matchId ? APP.store.Matches.get(fx.matchId) : null);
  const isPlayed = (fx) => { const m = matchOf(fx); return !!(m && m.status === 'complete'); };

  /* Winner of a fixture's match, as a teamId (null if tied/unplayed). */
  function winnerOf(fx) {
    const m = matchOf(fx);
    if (!m || m.status !== 'complete' || m.innings.length < 2) return null;
    const i0 = m.innings[0], i1 = m.innings[1];
    if (i0.runs === i1.runs) return null; // tie
    const winIdx = i1.runs > i0.runs ? i1.battingTeam : i0.battingTeam;
    return m.teams[winIdx].teamId || null;
  }

  const leagueFixtures = (t) => t.fixtures.filter((f) => f.round === 'league');
  const leagueComplete = (t) => { const l = leagueFixtures(t); return l.length > 0 && l.every(isPlayed); };
  const has = (t, round) => t.fixtures.some((f) => f.round === round);

  /* Points table, ordered. Rows come from stats.standings keyed by teamId. */
  function table(t) {
    // league standings count league fixtures only — playoff results must not move the table
    const leagueIds = new Set(leagueFixtures(t).map((f) => f.matchId).filter(Boolean));
    const ms = APP.store.Tournaments.matches(t.id).filter((m) => m.status === 'complete' && leagueIds.has(m.id));
    const rows = APP.stats.standings(ms);
    const byId = {};
    rows.forEach((r) => { if (r.teamId) byId[r.teamId] = r; });
    // include teams that haven't played yet so the table is complete from day one
    return t.teamIds.map((id) => {
      const team = APP.store.Teams.get(id);
      return byId[id] || {
        teamId: id, name: team ? team.name : '—',
        p: 0, w: 0, l: 0, t: 0, pts: 0, rf: 0, bf: 0, ra: 0, ba: 0, nrr: 0, nrrStr: '+0.000',
      };
    }).sort((x, y) => y.pts - x.pts || y.nrr - x.nrr || x.name.localeCompare(y.name));
  }

  /* Advance the tournament: create playoff fixtures when they become possible. */
  function advance(t) {
    let changed = false;
    if (t.format === 'league_only') {
      if (leagueComplete(t) && t.status !== 'done') { t.status = 'done'; changed = true; }
      if (changed) APP.store.Tournaments.save(t);
      return changed;
    }

    if (leagueComplete(t)) {
      const standings = table(t);
      const n = standings.length;
      if (n >= 4 && !has(t, 'sf1')) {
        t.fixtures.push({ id: APP.uid('fx'), round: 'sf1', a: standings[0].teamId, b: standings[3].teamId, matchId: null });
        t.fixtures.push({ id: APP.uid('fx'), round: 'sf2', a: standings[1].teamId, b: standings[2].teamId, matchId: null });
        t.status = 'playoffs'; changed = true;
      } else if (n >= 2 && n < 4 && !has(t, 'final')) {
        // too few teams for semis — top 2 go straight to the final
        t.fixtures.push({ id: APP.uid('fx'), round: 'final', a: standings[0].teamId, b: standings[1].teamId, matchId: null });
        t.status = 'playoffs'; changed = true;
      }
    }

    const sf1 = t.fixtures.find((f) => f.round === 'sf1');
    const sf2 = t.fixtures.find((f) => f.round === 'sf2');
    if (sf1 && sf2 && isPlayed(sf1) && isPlayed(sf2) && !has(t, 'final')) {
      const w1 = winnerOf(sf1), w2 = winnerOf(sf2);
      if (w1 && w2) {
        t.fixtures.push({ id: APP.uid('fx'), round: 'final', a: w1, b: w2, matchId: null });
        changed = true;
      }
    }

    const fin = t.fixtures.find((f) => f.round === 'final');
    if (fin && isPlayed(fin) && t.status !== 'done') { t.status = 'done'; changed = true; }

    if (changed) APP.store.Tournaments.save(t);
    return changed;
  }

  function champion(t) {
    const fin = t.fixtures.find((f) => f.round === 'final');
    if (fin && isPlayed(fin)) return winnerOf(fin);
    if (t.format === 'league_only' && leagueComplete(t)) { const s = table(t); return s.length ? s[0].teamId : null; }
    return null;
  }

  /* Next unplayed fixture — powers the one-tap "Play next match" button. */
  function nextFixture(t) {
    return t.fixtures.find((f) => !f.matchId) || t.fixtures.find((f) => !isPlayed(f)) || null;
  }

  APP.tournament = {
    ROUND_LABEL, create, generateLeague, table, advance, champion,
    nextFixture, winnerOf, isPlayed, matchOf, leagueComplete, leagueFixtures,
  };
})();
