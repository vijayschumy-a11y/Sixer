/* Sixer — match charts: worm (cumulative) & manhattan (runs per over) as inline SVG. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});
  const C = ['#19c37d', '#4aa8ff']; // innings colours

  // Build per-over buckets from an innings timeline.
  function perOver(inn) {
    const overs = [];
    let runs = 0, legal = 0, wkts = 0, cum = 0;
    inn.timeline.forEach((ev) => {
      runs += ev.teamRuns;
      if (ev.wicket) wkts++;
      if (ev.legal) {
        legal++;
        if (legal % 6 === 0) { cum += runs; overs.push({ over: legal / 6, runs, wkts, cum }); runs = 0; wkts = 0; }
      }
    });
    if (legal % 6 !== 0 || legal === 0) { // trailing partial over
      cum += runs;
      overs.push({ over: Math.ceil(legal / 6) || (overs.length + 1), runs, wkts, cum, partial: true });
    }
    return overs;
  }

  function maxOvers(match) {
    return Math.max(match.rules.oversPerInnings, ...match.innings.map((i) => perOver(i).length || 0), 1);
  }
  function maxRuns(match, mode) {
    let m = 1;
    match.innings.forEach((inn) => perOver(inn).forEach((o) => { m = Math.max(m, mode === 'worm' ? o.cum : o.runs); }));
    if (match.innings[0]) m = Math.max(m, match.innings[0].runs + 1);
    return m;
  }

  const W = 480, H = 240, PADL = 34, PADB = 26, PADT = 12, PADR = 10;
  const px = (over, maxO) => PADL + (over / maxO) * (W - PADL - PADR);
  const py = (val, maxV) => H - PADB - (val / maxV) * (H - PADT - PADB);

  function axes(maxO, maxV, ylabel) {
    let s = `<line x1="${PADL}" y1="${PADT}" x2="${PADL}" y2="${H - PADB}" stroke="#23362d"/>
      <line x1="${PADL}" y1="${H - PADB}" x2="${W - PADR}" y2="${H - PADB}" stroke="#23362d"/>`;
    // y gridlines
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const v = Math.round((maxV / steps) * i);
      const y = py(v, maxV);
      s += `<line x1="${PADL}" y1="${y}" x2="${W - PADR}" y2="${y}" stroke="#1a271f" stroke-dasharray="3 4"/>
        <text x="${PADL - 5}" y="${y + 4}" fill="#5f7a6e" font-size="10" text-anchor="end">${v}</text>`;
    }
    // x labels every ~ overs
    const stepO = Math.ceil(maxO / 6);
    for (let o = stepO; o <= maxO; o += stepO) {
      const x = px(o, maxO);
      s += `<text x="${x}" y="${H - PADB + 14}" fill="#5f7a6e" font-size="10" text-anchor="middle">${o}</text>`;
    }
    s += `<text x="${(W) / 2}" y="${H - 2}" fill="#5f7a6e" font-size="10" text-anchor="middle">Overs</text>`;
    return s;
  }

  function wormSVG(match) {
    const maxO = maxOvers(match), maxV = maxRuns(match, 'worm');
    let body = axes(maxO, maxV, 'Runs');
    // target line for 2nd innings
    if (match.innings[1]) {
      const t = match.innings[0].runs;
      const y = py(t, maxV);
      body += `<line x1="${PADL}" y1="${y}" x2="${W - PADR}" y2="${y}" stroke="#ffd24a" stroke-dasharray="5 4" opacity="0.7"/>
        <text x="${W - PADR}" y="${y - 4}" fill="#ffd24a" font-size="10" text-anchor="end">Target ${t + 1}</text>`;
    }
    match.innings.forEach((inn, idx) => {
      const data = perOver(inn);
      if (!data.length) return;
      const pts = [`${px(0, maxO)},${py(0, maxV)}`].concat(data.map((o) => `${px(o.over, maxO)},${py(o.cum, maxV)}`));
      body += `<polyline points="${pts.join(' ')}" fill="none" stroke="${C[idx]}" stroke-width="2.5" stroke-linejoin="round"/>`;
      // wicket dots
      data.forEach((o) => { if (o.wkts) body += `<circle cx="${px(o.over, maxO)}" cy="${py(o.cum, maxV)}" r="3.5" fill="#ff5d5d"/>`; });
    });
    return svgWrap(body) + legend(match);
  }

  function manhattanSVG(match) {
    const maxO = maxOvers(match), maxV = maxRuns(match, 'manhattan');
    let body = axes(maxO, maxV, 'Runs/over');
    const innCount = match.innings.length;
    const slotW = (W - PADL - PADR) / maxO;
    match.innings.forEach((inn, idx) => {
      const data = perOver(inn);
      const bw = (slotW * 0.72) / innCount;
      data.forEach((o) => {
        const x = PADL + (o.over - 1) * slotW + slotW * 0.14 + idx * bw;
        const y = py(o.runs, maxV);
        const h = (H - PADB) - y;
        body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${C[idx]}" opacity="0.9"/>`;
        if (o.wkts) body += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" fill="#ff5d5d" font-size="9" text-anchor="middle">${'✕'.repeat(Math.min(o.wkts, 2))}</text>`;
      });
    });
    return svgWrap(body) + legend(match);
  }

  function svgWrap(body) {
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block">${body}</svg>`;
  }
  function legend(match) {
    return `<div class="row" style="gap:14px;justify-content:center;margin-top:6px;font-size:11.5px">
      ${match.innings.map((inn, i) => `<span class="row" style="gap:5px"><span style="width:11px;height:11px;border-radius:3px;background:${C[i]};display:inline-block"></span>${APP.scoring.teamName(match, inn.battingTeam)}</span>`).join('')}
      <span class="row" style="gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:#ff5d5d;display:inline-block"></span>Wicket</span>
    </div>`;
  }

  /* ---------- Shareable square scorecard image (pure SVG, rasterisable to PNG) ---------- */
  function xesc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function scorecardCardSVG(match) {
    const SCo = APP.scoring, ST = APP.stats, S = APP.store;
    const IW = 1080, IH = 1080;
    const innOf = (idx) => match.innings.find((i) => i.battingTeam === idx);
    const line = (idx) => {
      const inn = innOf(idx);
      return inn ? `${inn.runs}/${inn.wickets}  (${SCo.oversText(inn.legalBalls)} ov)` : 'Did not bat';
    };
    const potm = ST.playerOfMatch(match);
    const pl = potm ? S.Players.get(potm.pid) : null;

    const teamBlock = (idx, y) => `
      <text x="80" y="${y}" fill="#eaf3ee" font-size="46" font-weight="700">${xesc(trunc(SCo.teamName(match, idx), 18))}</text>
      <text x="${IW - 80}" y="${y}" fill="#19c37d" font-size="52" font-weight="800" text-anchor="end">${xesc(line(idx))}</text>`;

    let potmSVG = '';
    if (potm) {
      const cy = 820, cx = 130, r = 70;
      const avatar = pl && pl.photo
        ? `<clipPath id="pc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
           <image href="${pl.photo}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#pc)" preserveAspectRatio="xMidYMid slice"/>
           <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffd24a" stroke-width="4"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#182a22" stroke="#ffd24a" stroke-width="4"/>
           <text x="${cx}" y="${cy + 16}" fill="#8aa79a" font-size="44" font-weight="700" text-anchor="middle">${xesc(APP.ui.initials(pl ? pl.name : '?'))}</text>`;
      potmSVG = `
        <text x="240" y="${cy - 34}" fill="#ffd24a" font-size="26" font-weight="700" letter-spacing="2">⭐ PLAYER OF THE MATCH</text>
        <text x="240" y="${cy + 12}" fill="#eaf3ee" font-size="44" font-weight="800">${xesc(trunc(pl ? pl.name : '', 22))}</text>
        <text x="240" y="${cy + 54}" fill="#8aa79a" font-size="28">${xesc(trunc(potm.line, 46))}</text>
        ${avatar}`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${IW}" height="${IH}" viewBox="0 0 ${IW} ${IH}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#12281f"/><stop offset="1" stop-color="#0a0f0d"/></linearGradient></defs>
      <rect width="${IW}" height="${IH}" fill="url(#bg)"/>
      <rect x="40" y="40" width="${IW - 80}" height="${IH - 80}" rx="40" fill="#0f1714" stroke="#23362d" stroke-width="2"/>
      <circle cx="120" cy="120" r="26" fill="#c0292b" stroke="#7d1b1c" stroke-width="4"/>
      <text x="168" y="132" fill="#eaf3ee" font-size="44" font-weight="800" letter-spacing="3">SIXER</text>
      <text x="${IW - 80}" y="128" fill="#5f7a6e" font-size="26" text-anchor="end">${match.format === 'box' ? 'Box cricket' : 'Ground'} · ${match.rules.oversPerInnings} ov</text>
      <line x1="80" y1="200" x2="${IW - 80}" y2="200" stroke="#23362d" stroke-width="2"/>

      ${teamBlock(0, 340)}
      ${teamBlock(1, 470)}

      <rect x="80" y="560" width="${IW - 160}" height="110" rx="18" fill="#0c2e22" stroke="#1c5b43" stroke-width="2"/>
      <text x="${IW / 2}" y="628" fill="#bdf5dd" font-size="42" font-weight="800" text-anchor="middle">${xesc(trunc(match.result || 'In progress', 40))}</text>

      ${potmSVG}

      <line x1="80" y1="${IH - 130}" x2="${IW - 80}" y2="${IH - 130}" stroke="#23362d" stroke-width="2"/>
      <text x="80" y="${IH - 80}" fill="#5f7a6e" font-size="26">${xesc(APP.ui.fmtDate(match.date))}${match.rules.lastManStanding ? ' · Last Man Standing' : ''}</text>
      <text x="${IW - 80}" y="${IH - 80}" fill="#5f7a6e" font-size="26" text-anchor="end">${match.rules.playersPerSide}-a-side</text>
    </svg>`;
  }

  APP.charts = { perOver, wormSVG, manhattanSVG, scorecardCardSVG };
})();
