/* Sixer — career & leaderboard stats aggregated from completed/live matches. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});

  function blankCareer(pid) {
    return {
      pid,
      mat: 0, inns: 0, notOut: 0, runs: 0, balls: 0, fours: 0, sixes: 0, hs: 0, hsNotOut: false,
      thirties: 0, fifties: 0, hundreds: 0, ducks: 0,
      // bowling
      bInns: 0, bBalls: 0, bRuns: 0, wkts: 0, maidens: 0, bestW: 0, bestR: Infinity, fifers: 0,
      // fielding
      catches: 0, runouts: 0, stumpings: 0,
    };
  }

  function career(pid, matches) {
    const c = blankCareer(pid);
    const ms = (matches || APP.store.Matches.all());
    let playedMatch = false;
    ms.forEach((m) => {
      let inThisMatch = false;
      m.innings.forEach((inn) => {
        // batting
        const bs = inn.batStats[pid];
        if (bs) {
          inThisMatch = true;
          c.inns++;
          c.runs += bs.runs; c.balls += bs.balls; c.fours += bs.fours; c.sixes += bs.sixes;
          if (!bs.out) c.notOut++;
          if (bs.runs === 0 && bs.out && bs.balls > 0) c.ducks++;
          if (bs.runs > c.hs) { c.hs = bs.runs; c.hsNotOut = !bs.out; }
          if (bs.runs >= 100) c.hundreds++; else if (bs.runs >= 50) c.fifties++; else if (bs.runs >= 30) c.thirties++;
        }
        // bowling
        const wb = inn.bowlStats[pid];
        if (wb && (wb.balls > 0 || wb.wides > 0 || wb.noballs > 0)) {
          inThisMatch = true;
          c.bInns++;
          c.bBalls += wb.balls; c.bRuns += wb.runsConceded; c.wkts += wb.wickets; c.maidens += wb.maidens;
          if (wb.wickets >= 5) c.fifers++;
          if (wb.wickets > c.bestW || (wb.wickets === c.bestW && wb.runsConceded < c.bestR)) {
            c.bestW = wb.wickets; c.bestR = wb.runsConceded;
          }
        }
        // fielding (from dismissals)
        Object.values(inn.batStats).forEach((b) => {
          if (b.fielder === pid) {
            if (b.how === 'caught') c.catches++;
            else if (b.how === 'runout') c.runouts++;
            else if (b.how === 'stumped') c.stumpings++;
          }
        });
      });
      if (inThisMatch) { c.mat++; playedMatch = true; }
    });
    return c;
  }

  function fmt(c) {
    const avg = (c.inns - c.notOut) > 0 ? (c.runs / (c.inns - c.notOut)).toFixed(2) : (c.runs > 0 ? '—' : '0.00');
    const sr = c.balls > 0 ? (c.runs / c.balls * 100).toFixed(1) : '0.0';
    const econ = c.bBalls > 0 ? (c.bRuns / c.bBalls * 6).toFixed(2) : '0.00';
    const bowlAvg = c.wkts > 0 ? (c.bRuns / c.wkts).toFixed(2) : '—';
    const bowlSR = c.wkts > 0 ? (c.bBalls / c.wkts).toFixed(1) : '—';
    const best = c.bestW > 0 ? `${c.bestW}/${c.bestR === Infinity ? 0 : c.bestR}` : '—';
    const overs = Math.floor(c.bBalls / 6) + '.' + (c.bBalls % 6);
    return { avg, sr, econ, bowlAvg, bowlSR, best, overs };
  }

  function leaderboard(matches) {
    const all = APP.store.Players.all();
    const rows = all.map((p) => {
      const c = career(p.id, matches);
      return { player: p, c, f: fmt(c) };
    }).filter((r) => r.c.mat > 0);
    return rows;
  }

  /* ---------- Player of the Match (auto-pick) ----------
     Impact = batting + bowling + fielding contribution across both innings. */
  function playerOfMatch(match) {
    const scores = {}; // pid -> {pts, bat:'', bowl:'', field:''}
    const bump = (pid, pts) => { if (!scores[pid]) scores[pid] = { pts: 0, bat: '', bowl: '', field: 0 }; scores[pid].pts += pts; };

    match.innings.forEach((inn) => {
      // batting impact
      Object.keys(inn.batStats).forEach((pid) => {
        const b = inn.batStats[pid];
        if (b.balls === 0 && b.runs === 0) return;
        let p = b.runs + b.fours * 1 + b.sixes * 2;
        if (b.runs >= 100) p += 50; else if (b.runs >= 50) p += 25; else if (b.runs >= 30) p += 10;
        if (b.balls >= 6) p += (b.runs / b.balls) * 3; // strike-rate sweetener
        if (b.runs === 0 && b.out && b.balls > 0) p -= 5; // duck penalty
        bump(pid, p);
        scores[pid].bat = `${b.runs}${b.out ? '' : '*'} (${b.balls})`;
      });
      // bowling impact
      Object.keys(inn.bowlStats).forEach((pid) => {
        const w = inn.bowlStats[pid];
        if (w.balls === 0) return;
        let p = w.wickets * 22 + w.maidens * 6 + w.dots * 0.5;
        const econ = w.runsConceded / w.balls * 6;
        p += Math.max(-6, (7 - econ) * (w.balls / 6)); // reward economy over overs bowled
        bump(pid, p);
        const ov = Math.floor(w.balls / 6) + '.' + (w.balls % 6);
        scores[pid].bowl = `${w.wickets}/${w.runsConceded} (${ov})`;
      });
      // fielding impact
      Object.values(inn.batStats).forEach((b) => {
        if (!b.fielder) return;
        const pts = b.how === 'caught' ? 8 : (b.how === 'runout' ? 10 : (b.how === 'stumped' ? 10 : 0));
        if (pts) { bump(b.fielder, pts); scores[b.fielder].field += 1; }
      });
    });

    let best = null;
    Object.keys(scores).forEach((pid) => { if (!best || scores[pid].pts > scores[best].pts) best = pid; });
    if (!best) return null;
    const s = scores[best];
    const parts = [];
    if (s.bat) parts.push(s.bat + ' bat');
    if (s.bowl) parts.push(s.bowl + ' bowl');
    if (s.field) parts.push(s.field + ' field');
    return { pid: best, pts: Math.round(s.pts), line: parts.join(' · ') };
  }

  /* ---------- Points table + Net Run Rate (per group of matches) ----------
     NRR uses full over-quota when a side is bowled out (standard convention). */
  function standings(matches) {
    const SCo = APP.scoring;
    const T = {};
    const get = (n) => T[n] || (T[n] = { name: n, p: 0, w: 0, l: 0, t: 0, pts: 0, rf: 0, bf: 0, ra: 0, ba: 0 });
    matches.filter((m) => m.status === 'complete' && m.innings.length === 2).forEach((m) => {
      const i0 = m.innings[0], i1 = m.innings[1];
      const A = get(SCo.teamName(m, i0.battingTeam));
      const B = get(SCo.teamName(m, i1.battingTeam));
      const eb = (inn) => { const allOut = inn.wickets >= SCo.maxWickets(m); return (allOut ? m.rules.oversPerInnings * 6 : inn.legalBalls) || 1; };
      A.p++; B.p++;
      A.rf += i0.runs; A.bf += eb(i0); A.ra += i1.runs; A.ba += eb(i1);
      B.rf += i1.runs; B.bf += eb(i1); B.ra += i0.runs; B.ba += eb(i0);
      if (i1.runs > i0.runs) { B.w++; A.l++; B.pts += 2; }
      else if (i1.runs < i0.runs) { A.w++; B.l++; A.pts += 2; }
      else { A.t++; B.t++; A.pts++; B.pts++; }
    });
    const rows = Object.values(T).map((r) => {
      const nrr = (r.rf / (r.bf / 6)) - (r.ra / (r.ba / 6));
      return Object.assign(r, { nrr, nrrStr: (nrr >= 0 ? '+' : '') + nrr.toFixed(3) });
    });
    rows.sort((a, b) => b.pts - a.pts || b.nrr - a.nrr || a.name.localeCompare(b.name));
    return rows;
  }

  APP.stats = { career, fmt, leaderboard, blankCareer, playerOfMatch, standings };
})();
