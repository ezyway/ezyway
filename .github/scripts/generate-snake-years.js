#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const LOGIN = process.env.GITHUB_USER || 'ezyway';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'snake-years-generator',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function getYearsData() {
  const userQ = `query($login:String!){ user(login:$login){ createdAt } }`;
  const u = await graphql(userQ, { login: LOGIN });
  const created = new Date(u.user.createdAt);
  const startYear = created.getUTCFullYear();
  const now = new Date();
  const endYear = now.getUTCFullYear();
  const years = [];
  for (let y = endYear; y >= startYear; y--) {
    const from = `${y}-01-01T00:00:00Z`;
    const toDate = (y === endYear) ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59));
    const to = toDate.toISOString();
    const q = `query($login:String!,$from:DateTime!,$to:DateTime!){
      user(login:$login){
        contributionsCollection(from:$from,to:$to){
          contributionCalendar{
            totalContributions
            weeks{ contributionDays{ contributionCount date weekday } }
          }
        }
      }
    }`;
    const d = await graphql(q, { login: LOGIN, from, to });
    const cal = d.user.contributionsCollection.contributionCalendar;
    const days = cal.weeks.flatMap((w, wi) => w.contributionDays.map((day, di) => ({
      ...day,
      wi,
      di,
    })));
    years.push({ year: y, total: cal.totalContributions, weeks: cal.weeks, days });
  }
  return years;
}

function level(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

function palettes(dark) {
  if (dark) {
    return {
      bg: '#0d1117',
      empty: '#161b22',
      levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
      snake: '#f778ba',
      snakeHead: '#ff7b72',
      text: '#c9d1d9',
      muted: '#8b949e',
      labelBg: 'rgba(13,17,23,0.85)',
    };
  }
  return {
    bg: '#ffffff',
    empty: '#ebedf0',
    levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39',
    ],
    snake: '#8a63d2',
    snakeHead: '#6f42c1',
    text: '#24292f',
    muted: '#57606a',
    labelBg: 'rgba(255,255,255,0.85)',
  };
}

function buildSVG(years, dark) {
  const p = palettes(dark);
  const cell = 11;
  const gap = 3;
  const step = cell + gap;
  const padX = 16;
  const padTop = 36;
  const padBottom = 16;
  const gridW = (weeksCount) => weeksCount * step - gap;
  const gridH = 7 * step - gap;
  const maxWeeks = Math.max(...years.map(y => y.weeks.length));
  const width = padX * 2 + gridW(maxWeeks);
  const height = padTop + gridH + padBottom;

  const perCell = 0.045; // seconds per step
  const endPause = 0.6; // pause at year end
  const yearDurations = years.map(y => (y.days.length * perCell) + endPause);
  const starts = [];
  let acc = 0;
  for (const d of yearDurations) { starts.push(acc); acc += d; }
  const total = acc;

  let defs = '';
  let body = '';

  // background
  body += `<rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="${p.bg}"/>`;

  years.forEach((y, yi) => {
    const gId = `year-${y.year}`;
    const xOff = padX;
    const yOff = padTop;
    const wCount = y.weeks.length;
    const yStart = starts[yi];
    const yDur = yearDurations[yi];
    // visibility for this year
    const visValues = years.map((_, j) => (j === yi ? 'visible' : 'hidden')).join(';');
    const visTimes = years.map((_, j) => (starts[j] / total).toFixed(6)).join(';');
    // group for year
    body += `<g id="${gId}" visibility="${yi === 0 ? 'visible' : 'hidden'}">`;
    body += `<animate attributeName="visibility" values="${visValues}" keyTimes="${visTimes};1" dur="${total}s" repeatCount="indefinite" calcMode="discrete" />`;

    // label
    body += `<text x="${padX}" y="22" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="13" font-weight="600" fill="${p.text}">${y.year} · ${y.total} contributions</text>`;

    // cells base
    y.weeks.forEach((w, wi) => {
      w.contributionDays.forEach((day, di) => {
        const x = xOff + wi * step;
        const yy = yOff + di * step;
        const lv = level(day.contributionCount);
        const base = p.levels[lv];
        const cid = `c-${y.year}-${wi}-${di}`;
        // base rect
        body += `<rect id="${cid}" x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="2" fill="${p.empty}" data-level="${lv}" data-count="${day.contributionCount}">`;
        // reveal to contribution color when snake reaches it (if has contributions) - "eaten"/visited highlight always, stronger if contributed
        const idx = wi * 7 + di; // position in traversal order within year
        const tHit = yStart + idx * perCell;
        // animate fill: stay empty until hit, then become base (or a "visited" color if 0)
        const visited = day.contributionCount > 0 ? base : (dark ? '#21262d' : '#dfe3e8');
        // use set to change at hit time within this year's active window - but easier: animate over global timeline with discrete values per year visibility; simpler: animate fill with keyTimes relative to global? Complex. Alternative: two states - before hit invisible overlay, at hit show visited.
        body += `</rect>`;
        body += `<rect x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="2" fill="${visited}" opacity="0">`;
        body += `<set attributeName="opacity" to="1" begin="${tHit.toFixed(4)}s; ${gId}.activate" dur="${(yDur - idx * perCell).toFixed(4)}s" />`;
        // reset each loop: hide at start of global cycle? easier approach: use animate with global timeline
        body += `<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${(tHit/total).toFixed(6)};${((tHit+0.001)/total).toFixed(6)};1" dur="${total}s" repeatCount="indefinite" calcMode="linear" />`;
        body += `</rect>`;
      });
    });

    // snake head
    // positions over this year's traversal
    const points = y.weeks.flatMap((w, wi) => w.contributionDays.map((day, di) => ({
      x: xOff + wi * step,
      y: yOff + di * step,
    })));
    if (points.length) {
      // build keyTimes/values for x,y over global timeline
      const kts = [];
      const xs = [];
      const ys = [];
      const ops = [];
      // before year
      if (yStart > 0) { kts.push(0); xs.push(points[0].x); ys.push(points[0].y); ops.push(0); kts.push((yStart/total)); xs.push(points[0].x); ys.push(points[0].y); ops.push(0); }
      else { kts.push(0); xs.push(points[0].x); ys.push(points[0].y); ops.push(1); }
      points.forEach((pt, i) => {
        const t = (yStart + i * perCell) / total;
        if (kts.length === 0 || Math.abs(t - kts[kts.length-1]) > 1e-9) {
          kts.push(t); xs.push(pt.x); ys.push(pt.y); ops.push(1);
        } else {
          xs[xs.length-1]=pt.x; ys[ys.length-1]=pt.y; ops[ops.length-1]=1;
        }
      });
      const yEnd = (yStart + yDur) / total;
      kts.push(Math.min(yEnd, 1)); xs.push(points[points.length-1].x); ys.push(points[points.length-1].y); ops.push(0);
      if (kts[kts.length-1] < 1) { kts.push(1); xs.push(points[0].x); ys.push(points[0].y); ops.push(0); }
      // normalize keyTimes strictly increasing
      for (let i=1;i<kts.length;i++) if (kts[i] <= kts[i-1]) kts[i]=Math.min(kts[i-1]+0.000001,1);
      if (kts[kts.length-1] < 1) { kts[kts.length-1]=1; }
      const kt = kts.map(v=>v.toFixed(6)).join(';');
      body += `<rect width="${cell}" height="${cell}" rx="3" fill="${p.snakeHead}" opacity="0">`;
      body += `<animate attributeName="x" values="${xs.join(';')}" keyTimes="${kt}" dur="${total}s" repeatCount="indefinite" calcMode="discrete" />`;
      body += `<animate attributeName="y" values="${ys.join(';')}" keyTimes="${kt}" dur="${total}s" repeatCount="indefinite" calcMode="discrete" />`;
      body += `<animate attributeName="opacity" values="${ops.join(';')}" keyTimes="${kt}" dur="${total}s" repeatCount="indefinite" calcMode="discrete" />`;
      body += `</rect>`;
    }

    body += `</g>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Contribution snake by year">\n${body}\n</svg>`;
}

(async () => {
  const years = await getYearsData();
  const outDir = process.argv[2] || 'dist';
  fs.mkdirSync(outDir, { recursive: true });
  const light = buildSVG(years, false);
  const dark = buildSVG(years, true);
  fs.writeFileSync(path.join(outDir, 'github-contribution-grid-snake.svg'), light);
  fs.writeFileSync(path.join(outDir, 'github-contribution-grid-snake-dark.svg'), dark);
  console.log(`Generated ${years.length} years -> ${outDir}`);
})();
