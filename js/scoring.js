/* Sixer — scoring engine. Handles box & ground cricket incl. Last Man Standing. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});
  const uid = () => APP.uid('m');

  function newMatch(cfg) {
    return {
      id: uid(),
      sessionId: cfg.sessionId || null,
      date: Date.now(),
      status: 'live',
      format: cfg.format || 'box',
      venue: cfg.venue || '',
      rules: Object.assign({}, cfg.rules),
      teams: cfg.teams, // [{name,players:[pid]}, {name,players:[pid]}]
      toss: cfg.toss, // {wonBy, decision}
      innings: [],
      currentInnings: -1,
      result: '',
      undoStack: [],
    };
  }

  function emptyInnings(battingTeam, bowlingTeam) {
    return {
      battingTeam, bowlingTeam,
      runs: 0, wickets: 0, legalBalls: 0,
      extras: { wide: 0, noball: 0, bye: 0, legbye: 0 },
      batStats: {}, bowlStats: {},
      battingOrder: [],
      striker: null, nonStriker: null, bowler: null, prevBowler: null,
      lastMan: false, freeHit: false,
      curOverBowlerRuns: 0, curOverBowlerBalls: 0,
      fow: [], timeline: [],
      target: null, closed: false, closeReason: '',
    };
  }

  function ensureBat(inn, pid, order) {
    if (!inn.batStats[pid]) inn.batStats[pid] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: '', bowler: '', fielder: '', order: order != null ? order : Object.keys(inn.batStats).length };
    return inn.batStats[pid];
  }
  function ensureBowl(inn, pid) {
    if (!inn.bowlStats[pid]) inn.bowlStats[pid] = { balls: 0, runsConceded: 0, wickets: 0, wides: 0, noballs: 0, dots: 0, maidens: 0 };
    return inn.bowlStats[pid];
  }

  function startInnings(match, { battingTeam, order, striker, nonStriker, bowler }) {
    const bowlingTeam = battingTeam === 0 ? 1 : 0;
    const inn = emptyInnings(battingTeam, bowlingTeam);
    inn.battingOrder = order.slice();
    if (match.innings[0]) inn.target = match.innings[0].runs + 1;
    inn.striker = striker;
    inn.nonStriker = match.rules.singleBatsman ? null : nonStriker;
    inn.bowler = bowler;
    ensureBat(inn, striker, 0);
    if (inn.nonStriker) ensureBat(inn, nonStriker, 1);
    ensureBowl(inn, bowler);
    match.innings.push(inn);
    match.currentInnings = match.innings.length - 1;
    return inn;
  }

  const cur = (match) => match.innings[match.currentInnings];
  const maxWickets = (match) => {
    const pps = match.rules.playersPerSide;
    if (match.rules.singleBatsman) return pps;
    return match.rules.lastManStanding ? pps : pps - 1;
  };

  function snapshot(match) {
    const snap = JSON.stringify({ innings: match.innings, currentInnings: match.currentInnings, result: match.result, status: match.status });
    match.undoStack.push(snap);
    if (match.undoStack.length > 60) match.undoStack.shift();
  }
  function canUndo(match) { return match.undoStack.length > 0; }
  function undo(match) {
    if (!match.undoStack.length) return false;
    const snap = JSON.parse(match.undoStack.pop());
    match.innings = snap.innings;
    match.currentInnings = snap.currentInnings;
    match.result = snap.result;
    match.status = snap.status;
    return true;
  }

  /* Core: record a delivery.
     input = { runs, extra:null|'wide'|'noball'|'bye'|'legbye', wicket:null|{type,who:'striker'|'nonstriker',fielder} } */
  function recordBall(match, input) {
    const inn = cur(match);
    if (inn.closed) return;
    snapshot(match);

    const R = match.rules;
    const runs = input.runs || 0;
    const extra = input.extra || null;
    const wkt = input.wicket || null;
    const wasFreeHit = inn.freeHit;

    const strikerId = inn.striker;
    const bowlerId = inn.bowler;
    const bs = ensureBat(inn, strikerId);
    const bw = ensureBowl(inn, bowlerId);

    let legal = true;
    let teamRuns = 0;
    let bowlerCharged = 0;
    let batRuns = 0;
    let facedBall = false;

    if (extra === 'wide') {
      legal = !R.reBowlWide ? false : false; // wide never counts as legal when re-bowled; if not re-bowled it counts
      legal = !R.reBowlWide; // count as ball only if NOT re-bowled
      const pen = R.wideRuns + runs; // runs = byes run on the wide
      teamRuns = pen; bowlerCharged = pen;
      inn.extras.wide += pen;
      bw.wides++;
    } else if (extra === 'noball') {
      legal = !R.reBowlNoBall;
      batRuns = runs;                 // runs off the bat on a no-ball
      teamRuns = R.noBallRuns + runs;
      bowlerCharged = R.noBallRuns + runs;
      inn.extras.noball += R.noBallRuns;
      bw.noballs++;
      bs.runs += batRuns;
      if (batRuns === 4) bs.fours++;
      if (batRuns === 6) bs.sixes++;
      if (R.noBallFreeHit) inn._setFreeHit = true;
    } else if (extra === 'bye') {
      legal = true; facedBall = true;
      teamRuns = runs; bowlerCharged = 0;
      inn.extras.bye += runs;
    } else if (extra === 'legbye') {
      legal = true; facedBall = true;
      teamRuns = runs; bowlerCharged = 0;
      inn.extras.legbye += runs;
    } else {
      legal = true; facedBall = true;
      batRuns = runs; teamRuns = runs; bowlerCharged = runs;
      bs.runs += batRuns;
      if (batRuns === 4) bs.fours++;
      if (batRuns === 6) bs.sixes++;
    }

    if (facedBall) bs.balls++;
    inn.runs += teamRuns;

    // bowler accounting
    bw.runsConceded += bowlerCharged;
    if (legal) { bw.balls++; inn.legalBalls++; inn.curOverBowlerBalls++; }
    inn.curOverBowlerRuns += bowlerCharged;
    if (legal && bowlerCharged === 0 && !wkt) bw.dots++;

    // wicket
    let wicketText = '';
    let newBatsmanNeeded = false;
    if (wkt) {
      const outIsStriker = (wkt.who || 'striker') === 'striker';
      const dismissedId = outIsStriker ? inn.striker : inn.nonStriker;
      wkt._outId = dismissedId;
      const ob = ensureBat(inn, dismissedId);
      ob.out = true;
      ob.how = wkt.type;
      ob.fielder = wkt.fielder || '';
      const credited = !['runout', 'retired'].includes(wkt.type);
      if (credited) { ob.bowler = bowlerId; bw.wickets++; }
      inn.wickets++;
      inn.fow.push({ score: inn.runs, wkts: inn.wickets, player: dismissedId, over: oversText(inn.legalBalls) });
      wicketText = 'WICKET — ' + dismissalText(wkt);

      // determine batting continuation
      const pps = R.playersPerSide;
      if (R.singleBatsman) {
        if (inn.wickets >= pps) { /* all out */ }
        else { newBatsmanNeeded = true; inn.striker = null; }
      } else {
        const transitionToLastMan = R.lastManStanding && inn.wickets === pps - 1 && !inn.lastMan;
        if (inn.wickets >= maxWickets(match)) {
          // all out
        } else if (transitionToLastMan) {
          inn.lastMan = true;
          // surviving batsman stays. If striker out, the non-striker becomes the lone striker.
          if (outIsStriker) { inn.striker = inn.nonStriker; }
          inn.nonStriker = null;
        } else {
          // need a new batsman to replace the out one
          newBatsmanNeeded = true;
          if (outIsStriker) inn.striker = null; else inn.nonStriker = null;
        }
      }
    }

    // strike rotation (runs run between wickets) — only when pair batting & not last man & not single
    const rotatable = !R.singleBatsman && !inn.lastMan;
    if (rotatable && !newBatsmanNeeded) {
      const runsRun = (extra === 'wide') ? runs : (extra === 'noball' ? batRuns : runs);
      if (runsRun % 2 === 1) swapEnds(inn);
    }

    // free hit handling
    if (legal) inn.freeHit = false;
    if (inn._setFreeHit) { inn.freeHit = true; inn._setFreeHit = false; }

    // ball event
    const ev = {
      n: inn.timeline.length + 1,
      over: oversText(inn.legalBalls),
      runsBat: batRuns,
      extraType: extra,
      teamRuns,
      wicket: wkt ? { type: wkt.type, who: wkt._outId, fielder: wkt.fielder || '' } : null,
      legal, striker: strikerId, bowler: bowlerId,
      freeHit: wasFreeHit,
      text: ballText({ runs, extra, batRuns, teamRuns, wkt, wicketText, R, freeHit: wasFreeHit }),
    };
    inn.timeline.push(ev);

    // over complete?
    let overComplete = false;
    if (legal && inn.curOverBowlerBalls >= 6) {
      overComplete = true;
      if (inn.curOverBowlerRuns === 0) bw.maidens++;
      inn.prevBowler = inn.bowler;
      inn.curOverBowlerBalls = 0; inn.curOverBowlerRuns = 0;
      if (rotatable && !newBatsmanNeeded) swapEnds(inn);
      inn.bowler = null; // UI must pick next bowler
    }

    // innings end checks
    const overLimitBalls = R.oversPerInnings * 6;
    if (inn.wickets >= maxWickets(match)) closeInnings(match, 'All out');
    else if (inn.legalBalls >= overLimitBalls) closeInnings(match, 'Overs completed');
    else if (inn.target != null && inn.runs >= inn.target) closeInnings(match, 'Target chased');

    return { overComplete, newBatsmanNeeded: newBatsmanNeeded && !inn.closed, closed: inn.closed };
  }

  function swapEnds(inn) { const t = inn.striker; inn.striker = inn.nonStriker; inn.nonStriker = t; }

  function setNewBatsman(match, pid) {
    const inn = cur(match);
    snapshot(match);
    ensureBat(inn, pid, inn.battingOrder.indexOf(pid));
    if (inn.striker == null) inn.striker = pid; else inn.nonStriker = pid;
  }
  function setNewBowler(match, pid) {
    const inn = cur(match);
    snapshot(match);
    ensureBowl(inn, pid);
    inn.bowler = pid;
  }
  function manualSwap(match) { snapshot(match); swapEnds(cur(match)); }

  function closeInnings(match, reason) {
    const inn = cur(match);
    inn.closed = true; inn.closeReason = reason;
    if (match.currentInnings === 1) { match.status = 'complete'; match.result = computeResult(match); }
  }
  function endInningsManually(match, reason) { snapshot(match); closeInnings(match, reason || 'Declared'); }

  function computeResult(match) {
    const a = match.innings[0], b = match.innings[1];
    if (!a || !b) return '';
    const tA = teamName(match, a.battingTeam), tB = teamName(match, b.battingTeam);
    if (b.runs >= (a.runs + 1)) {
      const wktsLeft = maxWickets(match) - b.wickets;
      return `${tB} won by ${wktsLeft} wicket${wktsLeft !== 1 ? 's' : ''}`;
    }
    if (b.runs === a.runs) return 'Match tied';
    return `${tA} won by ${a.runs - b.runs} run${a.runs - b.runs !== 1 ? 's' : ''}`;
  }

  function teamName(match, idx) { return match.teams[idx].name || ('Team ' + (idx + 1)); }

  /* ---------- helpers ---------- */
  function oversText(balls) { return Math.floor(balls / 6) + '.' + (balls % 6); }
  function rr(runs, balls) { return balls ? (runs / balls * 6).toFixed(2) : '0.00'; }
  function reqRR(target, runs, ballsLeft) { return ballsLeft > 0 ? ((target - runs) / ballsLeft * 6).toFixed(2) : '—'; }

  function dismissalText(wkt, outId) {
    const map = { bowled: 'b', caught: 'c', runout: 'run out', stumped: 'st', lbw: 'lbw', hitwicket: 'hit wkt', retired: 'retired' };
    return map[wkt.type] || wkt.type;
  }

  function ballText({ runs, extra, batRuns, teamRuns, wkt, wicketText, freeHit }) {
    let s = '';
    if (freeHit) s += 'FREE HIT — ';
    if (extra === 'wide') s += 'Wide' + (runs ? ' +' + runs : '');
    else if (extra === 'noball') s += 'No-ball' + (batRuns ? ', ' + batRuns + ' run' + (batRuns > 1 ? 's' : '') : '');
    else if (extra === 'bye') s += runs + ' bye' + (runs > 1 ? 's' : '');
    else if (extra === 'legbye') s += runs + ' leg bye' + (runs > 1 ? 's' : '');
    else if (runs === 0) s += 'Dot ball';
    else if (runs === 4) s += 'FOUR!';
    else if (runs === 6) s += 'SIX!';
    else s += runs + ' run' + (runs > 1 ? 's' : '');
    if (wkt) s += (s ? ' — ' : '') + 'OUT (' + dismissalText(wkt) + ')';
    return s;
  }

  function battingTeamFirst(match) {
    const t = match.toss;
    if (t.decision === 'bat') return t.wonBy;
    return t.wonBy === 0 ? 1 : 0;
  }

  APP.scoring = {
    newMatch, startInnings, recordBall, setNewBatsman, setNewBowler, manualSwap,
    endInningsManually, computeResult, cur, maxWickets, undo, canUndo,
    oversText, rr, reqRR, teamName, dismissalText, battingTeamFirst,
  };
})();
