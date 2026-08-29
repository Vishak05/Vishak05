#!/usr/bin/env node
// Renders assets/profile-card.svg from live GitHub stats.
// Run with GITHUB_TOKEN set. Without one it renders with sample data
// so the layout can be checked locally.

const fs = require('fs');
const path = require('path');

const USER = process.env.PROFILE_USER || 'Vishak05';
const TOKEN = process.env.GITHUB_TOKEN;

// Generated SVGs live on their own branch, never on main, so routine stat
// refreshes cannot collide with hand edits. See ASSET_BRANCH in card.yml.
const ASSET_BRANCH = process.env.ASSET_BRANCH || 'assets';
const assetUrl = (name) =>
  `https://raw.githubusercontent.com/${USER}/${USER}/refs/heads/${ASSET_BRANCH}/${name}`;

const C = {
  card: '#121212',
  stroke: '#3f3f46',
  text: '#ffffff',
  muted: '#9ca3af',
  // Sits outside any card, so it must read on GitHub light and dark alike.
  mutedOnPage: '#6b7280',
  desc: '#9fb3cc',
  red: '#dc2626',
  redDim: '#7f1d1d',
  redDeep: '#2a0d0d',
  hiFill: '#2b1a06',
  hiLine: '#b45309',
  hiText: '#f59e0b',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-card-generator',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const QUERY = `
query ($login: String!, $from: DateTime!) {
  user(login: $login) {
    pinnedItems(first: 6, types: REPOSITORY) {
      nodes {
        ... on Repository {
          name
          description
          url
          primaryLanguage { name }
        }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        primaryLanguage { name }
      }
    }
    contributionsCollection(from: $from) {
      totalCommitContributions
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

function currentStreak(days) {
  // Walk backwards from the most recent day. A blank today does not break the
  // streak (the day is still open); any earlier blank day does.
  const sorted = days.slice().sort((a, b) => a.date.localeCompare(b.date));
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].contributionCount > 0) streak++;
    else if (i === sorted.length - 1) continue;
    else break;
  }
  return streak;
}

function topLanguages(repos) {
  const counts = new Map();
  for (const r of repos) {
    if (!r.primaryLanguage) continue;
    const n = r.primaryLanguage.name;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3).reduce((a, [, n]) => a + n, 0);
  const out = top.map(([name, n]) => ({ name, pct: n / total }));
  if (rest > 0) out.push({ name: 'Other', pct: rest / total });
  return out;
}

async function collect() {
  if (!TOKEN) {
    console.warn('! No GITHUB_TOKEN - rendering with sample data.');
    return {
      commits: 312,
      repos: 24,
      streak: 48,
      stars: 6,
      langs: [
        { name: 'Python', pct: 0.45 },
        { name: 'JavaScript', pct: 0.25 },
        { name: 'HTML', pct: 0.18 },
        { name: 'Other', pct: 0.12 },
      ],
      work: SAMPLE_WORK,
    };
  }

  const meta = await gql('query($login:String!){user(login:$login){createdAt}}', { login: USER });
  const startYear = new Date(meta.user.createdAt).getUTCFullYear();
  const nowYear = new Date().getUTCFullYear();

  // contributionsCollection covers at most one year per call, so walk the
  // account year by year and sum. The final pass is the current year, whose
  // calendar and repo list are the ones we render.
  let commits = 0;
  let latest = null;
  for (let y = startYear; y <= nowYear; y++) {
    const from = new Date(Date.UTC(y, 0, 1)).toISOString();
    const data = await gql(QUERY, { login: USER, from });
    commits += data.user.contributionsCollection.totalCommitContributions;
    latest = data;
  }

  const repos = latest.user.repositories;
  // The calendar spans a full year from `from`, so it runs past today with
  // zero-filled future days. Those would end the streak walk immediately.
  const today = new Date().toISOString().slice(0, 10);
  const days = latest.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => d.date <= today);

  const pinned = latest.user.pinnedItems.nodes
    .filter(Boolean)
    .map((r) => ({ url: r.url, title: r.name, desc: r.description || '' }));

  if (pinned.length === 0) console.warn('! No pinned repositories found.');

  return {
    commits,
    repos: repos.totalCount,
    streak: currentStreak(days),
    stars: repos.nodes.reduce((a, r) => a + r.stargazerCount, 0),
    langs: topLanguages(repos.nodes),
    work: pinned,
  };
}

// 24x24 icon fragments. {FG} is substituted with the foreground colour.
const ICONS = {
  football:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="{FG}" stroke-width="1.8"/>' +
    '<path d="M12 7.4l3.3 2.4-1.26 3.9H9.96L8.7 9.8z" fill="{FG}"/>' +
    '<path d="M12 3v2.3M4.3 9.6l2.2.7M19.7 9.6l-2.2.7M7.6 19.2l1.35-1.85M16.4 19.2l-1.35-1.85" stroke="{FG}" stroke-width="1.5" stroke-linecap="round" fill="none"/>',
  basketball:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="{FG}" stroke-width="1.8"/>' +
    '<path d="M3 12h18M12 3v18" stroke="{FG}" stroke-width="1.4" fill="none"/>' +
    '<path d="M5.6 5.6a10 10 0 010 12.8M18.4 5.6a10 10 0 000 12.8" stroke="{FG}" stroke-width="1.4" fill="none"/>',
  flame:
    '<path d="M12 2c1 4-3 5-3 9a3 3 0 006 0c0-1-.5-2-.5-3 2 1.5 3.5 3.5 3.5 6a6 6 0 11-12 0c0-4.5 4-7 6-12z" fill="{FG}"/>',
  trophy:
    '<path d="M7 4h10v4a5 5 0 01-10 0V4z" fill="none" stroke="{FG}" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M7 5.5H4.5V7a3.5 3.5 0 003 3.45M17 5.5h2.5V7a3.5 3.5 0 01-3 3.45" fill="none" stroke="{FG}" stroke-width="1.5"/>' +
    '<path d="M12 13v4M8.5 20h7M9.5 20l.6-3h3.8l.6 3" fill="none" stroke="{FG}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  game:
    '<path d="M8 8.5h8a5.5 5.5 0 015.05 7.65l-.6 1.4a2.3 2.3 0 01-3.8.63L15.2 16H8.8l-1.45 2.18a2.3 2.3 0 01-3.8-.63l-.6-1.4A5.5 5.5 0 018 8.5z" fill="none" stroke="{FG}" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M7.2 11.4v2.4M6 12.6h2.4M16.1 11.9h.01M17.9 13.4h.01" stroke="{FG}" stroke-width="1.7" stroke-linecap="round"/>',
  gear:
    '<path d="M10.5 2h3l.4 2.3 1.6.9 2.2-.9 1.5 2.6-1.8 1.5v1.8l1.8 1.5-1.5 2.6-2.2-.9-1.6.9-.4 2.3h-3l-.4-2.3-1.6-.9-2.2.9-1.5-2.6L6.6 12v-1.8L4.8 8.7l1.5-2.6 2.2.9 1.6-.9L10.5 2zm1.5 6a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" fill="{FG}"/>',
  chart:
    '<polyline points="3.5,16.8 9,11.2 13,14.8 20.5,6.5" fill="none" stroke="{FG}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M15.4 6.5h5.1v5.1" fill="none" stroke="{FG}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};

const icon = (name, x, y, fill, size = 18) =>
  `<g transform="translate(${x},${y}) scale(${size / 24})">${ICONS[name].split('{FG}').join(fill)}</g>`;

function starburst(cx, cy, rOuter, rInner, points) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${C.red}"/>`;
}

// Icons are assigned by position so the set stays varied whatever is pinned.
const WORK_ICONS = ['game', 'gear', 'chart', 'football', 'basketball', 'trophy'];

// Only used when running without a token, to preview the layout.
const SAMPLE_WORK = [
  { url: 'https://github.com/Vishak05/dual-stream-deepfake-detection', title: 'dual-stream-deepfake-detection', desc: 'Dual-stream spatial-frequency deepfake detector, extending a ResNet-18 baseline with an FFT-based branch.' },
  { url: 'https://github.com/Vishak05/tether', title: 'tether', desc: '' },
  { url: 'https://github.com/Vishak05/wardrobe-stylist', title: 'wardrobe-stylist', desc: '' },
  { url: 'https://github.com/Vishak05/Startup-Pitch-Evaluation', title: 'Startup-Pitch-Evaluation', desc: '' },
  { url: 'https://github.com/Vishak05/Stock-Market-Portfolio', title: 'Stock-Market-Portfolio', desc: 'A Stock Market Portfolio application to track investments and monitor stock performance.' },
];

const W = 830;
const P = 8;
const CW = W - P * 2;
const F = 'font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"';

const cardRect = (x, y, w, h, fill = C.card, stroke = C.stroke) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;

const wrap = (h, body, label) =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">`,
    '  ' + body.join('\n  '),
    '</svg>',
    '',
  ].join('\n');

function renderMain(d) {
  const o = [];

  // header
  o.push(cardRect(P, 8, CW, 92));
  o.push(`<rect x="24" y="24" width="44" height="44" rx="10" fill="${C.redDeep}" stroke="${C.red}" stroke-width="1.5"/>`);
  o.push(`<text x="46" y="54" ${F} font-size="21" font-weight="700" fill="${C.red}" text-anchor="middle">V</text>`);
  o.push(`<text x="84" y="45" ${F} font-size="19" font-weight="700" fill="${C.text}">Vishak</text>`);
  o.push(`<text x="84" y="67" ${F} font-size="12.5" fill="${C.muted}">Full-stack developer · quantum ML researcher</text>`);
  o.push(starburst(770, 54, 36, 20, 10));
  o.push(`<text x="770" y="50" ${F} font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">GG</text>`);
  o.push(`<text x="770" y="63" ${F} font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">WP</text>`);

  // quote
  o.push(cardRect(P, 110, CW, 42));
  o.push(`<text x="32" y="136" ${F} font-size="13" font-style="italic" fill="#e5e7eb">&quot;Ship it, then level it up.&quot;</text>`);

  // stat tiles
  const tiles = [
    { icon: 'football', value: d.commits, label: 'Commits' },
    { icon: 'basketball', value: d.repos, label: 'Repos' },
    { icon: 'flame', value: d.streak, label: 'Streak', hi: true },
    { icon: 'trophy', value: d.stars, label: 'Stars' },
  ];
  const gap = 10;
  const tw = (CW - gap * 3) / 4;
  tiles.forEach((t, i) => {
    const x = P + i * (tw + gap);
    const fg = t.hi ? C.hiText : C.text;
    o.push(cardRect(x, 162, tw, 88, t.hi ? C.hiFill : C.card, t.hi ? C.hiLine : C.stroke));
    o.push(icon(t.icon, x + tw / 2 - 9, 180, fg));
    o.push(`<text x="${x + tw / 2}" y="222" ${F} font-size="22" font-weight="700" fill="${fg}" text-anchor="middle">${t.value}</text>`);
    o.push(`<text x="${x + tw / 2}" y="240" ${F} font-size="11" fill="${t.hi ? C.hiText : C.muted}" text-anchor="middle">${t.label}</text>`);
  });

  // top languages
  o.push(cardRect(P, 262, CW, 80));
  o.push(`<text x="24" y="283" ${F} font-size="11" fill="${C.muted}">Top languages</text>`);
  const barX = 20;
  const barY = 292;
  const barW = CW - 24;
  const barH = 9;
  const shades = [C.red, C.redDim, '#d4d4d8', '#71717a'];
  o.push(`<clipPath id="langbar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="4.5"/></clipPath>`);
  o.push('<g clip-path="url(#langbar)">');
  let cx = barX;
  d.langs.forEach((l, i) => {
    const w = barW * l.pct;
    o.push(`<rect x="${cx.toFixed(1)}" y="${barY}" width="${(w + 1).toFixed(1)}" height="${barH}" fill="${shades[i % shades.length]}"><title>${esc(l.name)} ${(l.pct * 100).toFixed(0)}%</title></rect>`);
    cx += w;
  });
  o.push('</g>');

  // Legend: the bar alone shows proportion but not which language is which.
  // Widths are estimated from character count - there is no text metrics API
  // here - so the spacing is generous enough to absorb the error.
  let lx = barX + 4;
  d.langs.forEach((l, i) => {
    const label = `${l.name} ${(l.pct * 100).toFixed(0)}%`;
    o.push(`<rect x="${lx.toFixed(1)}" y="316" width="8" height="8" rx="2" fill="${shades[i % shades.length]}"/>`);
    o.push(`<text x="${(lx + 13).toFixed(1)}" y="324" ${F} font-size="11" fill="${C.muted}">${esc(label)}</text>`);
    lx += 13 + label.length * 6.1 + 18;
  });

  o.push(`<text x="20" y="369" ${F} font-size="11" fill="${C.mutedOnPage}">Selected work</text>`);

  return wrap(378, o, 'Vishak - GitHub profile card');
}

// Each work card is its own SVG so the README can wrap it in a link.
// GitHub inserts ~6px of leading between stacked images, so the card sits
// flush at the top of its own canvas with no built-in bottom gap.
function renderWork(w, i) {
  const H = 70;
  const o = [];
  o.push(cardRect(P, 1, CW, 68));
  o.push(icon(WORK_ICONS[i % WORK_ICONS.length], 28, 25, C.red, 20));
  if (w.desc) {
    o.push(`<text x="58" y="31" ${F} font-size="14" font-weight="700" fill="${C.text}">${esc(w.title)}</text>`);
    o.push(`<text x="58" y="51" ${F} font-size="12.5" fill="${C.desc}">${esc(truncate(w.desc, 104))}</text>`);
  } else {
    // No description on GitHub - centre the title rather than print a filler line.
    o.push(`<text x="58" y="40" ${F} font-size="14" font-weight="700" fill="${C.text}">${esc(w.title)}</text>`);
  }
  return wrap(H, o, w.desc ? `${w.title} - ${w.desc}` : w.title);
}

// The snake workflow writes snake.svg to the output branch. Pull it in and
// frame it so it reads as part of the same panel instead of a loose image.
// The plain /output/ raw path serves a stale tree, so use /refs/heads/.
async function fetchSnake() {
  const url = `https://raw.githubusercontent.com/${USER}/${USER}/refs/heads/output/snake.svg`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'profile-card-generator' } });
    if (!res.ok) {
      console.warn(`! snake.svg not available (HTTP ${res.status}) - skipping snake card.`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`! could not fetch snake.svg (${e.message}) - skipping snake card.`);
    return null;
  }
}

function renderSnakeCard(raw) {
  const open = raw.match(/<svg[\s>][^>]*>/i);
  if (!open) return null;
  // snk emits viewBox="-16 -32 880 192" - a negative origin. Ignoring minX/minY
  // shifts the graph out of its frame and leaves dead space below it.
  const vb = open[0].match(/viewBox="([-\d.\s]+)"/i);
  let minX = 0;
  let minY = 0;
  let sw;
  let sh;
  if (vb) {
    const parts = vb[1].trim().split(/\s+/).map(Number);
    [minX, minY, sw, sh] = parts;
  } else {
    sw = parseFloat((open[0].match(/width="([\d.]+)"/i) || [])[1]);
    sh = parseFloat((open[0].match(/height="([\d.]+)"/i) || [])[1]);
  }
  if (!sw || !sh) return null;

  const inner = raw.slice(open.index + open[0].length, raw.lastIndexOf('</svg>'));

  // The declared viewBox runs well past the calendar (snk leaves room for a
  // stack indicator), which would frame the graph with dead space. Measure the
  // real grid instead: rows repeat once per week, so a y value shared by many
  // cells is a row, while stray one-off values are not.
  const cell = parseFloat((raw.match(/\.c\{[^}]*height:\s*([\d.]+)px/) || [])[1]) || 12;
  const tally = new Map();
  for (const m of raw.matchAll(/\sy="(-?[\d.]+)"/g)) {
    const v = Number(m[1]);
    tally.set(v, (tally.get(v) || 0) + 1);
  }
  const rows = [...tally.entries()].filter(([, n]) => n >= 10).map(([v]) => v);
  const contentBottom = rows.length ? Math.max(...rows) + cell : minY + sh;
  sh = Math.min(sh, contentBottom - minY);
  const padX = 16;
  const padTop = 30;
  const padBottom = 14;
  const avail = CW - padX * 2;
  const scale = avail / sw;
  const cardH = Math.round(sh * scale) + padTop + padBottom;
  const H = cardH + 2;

  const o = [];
  o.push(cardRect(P, 1, CW, cardH));
  o.push(`<text x="24" y="23" ${F} font-size="11" fill="${C.muted}">Contributions</text>`);
  const tx = (P + padX - minX * scale).toFixed(2);
  const ty = (padTop - minY * scale).toFixed(2);
  o.push(`<clipPath id="snakeclip"><rect x="${P}" y="1" width="${CW}" height="${cardH}" rx="10"/></clipPath>`);
  o.push(`<g clip-path="url(#snakeclip)"><g transform="translate(${tx},${ty}) scale(${scale.toFixed(4)})">${inner}</g></g>`);
  return wrap(H, o, 'Contribution graph');
}

const truncate = (t, n) => (t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`);

// Rewrites the block between the WORK markers so the links always match
// whatever is pinned on GitHub.
function updateReadme(work, hasSnake) {
  const file = path.join(__dirname, '..', 'README.md');
  const md = fs.readFileSync(file, 'utf8');
  const START = '<!-- WORK:START -->';
  const END = '<!-- WORK:END -->';
  const a = md.indexOf(START);
  const b = md.indexOf(END);
  if (a === -1 || b === -1) {
    console.warn('! README work markers not found - left untouched.');
    return;
  }
  const rows = work.map((w, i) =>
    `<a href="${w.url}"><img src="${assetUrl(`work-${i + 1}.svg`)}" width="100%" alt="${esc(w.title)}" /></a>`
  );
  if (hasSnake) {
    rows.push(`<img src="${assetUrl('snake-card.svg')}" width="100%" alt="Contribution graph" />`);
  }
  const next = md.slice(0, a + START.length) + '\n' + rows.join('\n') + '\n' + md.slice(b);
  if (next !== md) {
    fs.writeFileSync(file, next);
    console.log(`updated README work block (${work.length} cards)`);
  }
}

(async () => {
  const data = await collect();
  const dir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(dir, { recursive: true });

  const work = data.work;
  const files = [['card-main.svg', renderMain(data)]];
  work.forEach((w, i) => files.push([`work-${i + 1}.svg`, renderWork(w, i)]));

  const rawSnake = await fetchSnake();
  const snakeCard = rawSnake ? renderSnakeCard(rawSnake) : null;
  if (snakeCard) files.push(['snake-card.svg', snakeCard]);

  for (const [name, svg] of files) {
    fs.writeFileSync(path.join(dir, name), svg);
    console.log(`wrote assets/${name} (${svg.length} bytes)`);
  }
  console.log(`  commits=${data.commits} repos=${data.repos} streak=${data.streak} stars=${data.stars}`);
  console.log(`  langs=${data.langs.map((l) => `${l.name} ${(l.pct * 100).toFixed(0)}%`).join(', ')}`);
  console.log(`  pinned=${work.map((w) => w.title).join(', ')}`);

  // Remove cards left over from a larger previous pin set.
  for (let i = work.length + 1; i <= 12; i++) {
    const stale = path.join(dir, `work-${i}.svg`);
    if (fs.existsSync(stale)) {
      fs.unlinkSync(stale);
      console.log(`removed stale assets/work-${i}.svg`);
    }
  }

  updateReadme(work, Boolean(snakeCard));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
