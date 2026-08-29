#!/usr/bin/env node
// Renders assets/profile-card.svg from live GitHub stats.
// Run with GITHUB_TOKEN set. Without one it renders with sample data
// so the layout can be checked locally.

const fs = require('fs');
const path = require('path');

const USER = process.env.PROFILE_USER || 'Vishak05';
const TOKEN = process.env.GITHUB_TOKEN;

const C = {
  page: '#0a0a0a',
  card: '#121212',
  stroke: '#3f3f46',
  text: '#ffffff',
  muted: '#9ca3af',
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
  const days = latest.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays);

  return {
    commits,
    repos: repos.totalCount,
    streak: currentStreak(days),
    stars: repos.nodes.reduce((a, r) => a + r.stargazerCount, 0),
    langs: topLanguages(repos.nodes),
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

const WORK = [
  { icon: 'game', title: 'tether', desc: 'Control your Windows laptop from your phone over Tailscale.' },
  { icon: 'gear', title: 'dual-stream-deepfake-detection', desc: 'ResNet-18 plus an FFT branch for spatial-frequency deepfake detection.' },
  { icon: 'chart', title: 'Stock-Market-Portfolio', desc: 'MERN-stack tracker for investments and stock performance.' },
];

function render(d, work) {
  const W = 650;
  const P = 8;
  const CW = W - P * 2;
  const F = 'font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"';
  const card = (x, y, w, h, fill = C.card, stroke = C.stroke) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;

  const o = [];

  // header
  o.push(card(P, 8, CW, 92));
  o.push(`<rect x="24" y="24" width="44" height="44" rx="10" fill="${C.redDeep}" stroke="${C.red}" stroke-width="1.5"/>`);
  o.push(`<text x="46" y="54" ${F} font-size="21" font-weight="700" fill="${C.red}" text-anchor="middle">V</text>`);
  o.push(`<text x="84" y="45" ${F} font-size="19" font-weight="700" fill="${C.text}">Vishak</text>`);
  o.push(`<text x="84" y="67" ${F} font-size="12.5" fill="${C.muted}">Full-stack developer · quantum ML researcher</text>`);
  o.push(starburst(590, 54, 36, 20, 10));
  o.push(`<text x="590" y="50" ${F} font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">GG</text>`);
  o.push(`<text x="590" y="63" ${F} font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">WP</text>`);

  // quote
  o.push(card(P, 110, CW, 42));
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
    o.push(card(x, 162, tw, 88, t.hi ? C.hiFill : C.card, t.hi ? C.hiLine : C.stroke));
    o.push(icon(t.icon, x + tw / 2 - 9, 180, fg));
    o.push(`<text x="${x + tw / 2}" y="222" ${F} font-size="22" font-weight="700" fill="${fg}" text-anchor="middle">${t.value}</text>`);
    o.push(`<text x="${x + tw / 2}" y="240" ${F} font-size="11" fill="${t.hi ? C.hiText : C.muted}" text-anchor="middle">${t.label}</text>`);
  });

  // top languages
  o.push(card(P, 262, CW, 52));
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

  // selected work
  o.push(`<text x="20" y="343" ${F} font-size="11" fill="${C.muted}">Selected work</text>`);
  const cardH = 68;
  let y = 354;
  for (const w of work) {
    o.push(card(P, y, CW, cardH));
    o.push(icon(w.icon, 28, y + 24, C.red, 20));
    o.push(`<text x="58" y="${y + 30}" ${F} font-size="14" font-weight="700" fill="${C.text}">${esc(w.title)}</text>`);
    o.push(`<text x="58" y="${y + 50}" ${F} font-size="12.5" fill="${C.desc}">${esc(w.desc)}</text>`);
    y += cardH + 10;
  }

  const H = y + 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vishak - GitHub profile card">`,
    `  <rect width="${W}" height="${H}" fill="${C.page}"/>`,
    '  ' + o.join('\n  '),
    '</svg>',
    '',
  ].join('\n');
}

(async () => {
  const data = await collect();
  const svg = render(data, WORK);
  const dir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'profile-card.svg');
  fs.writeFileSync(out, svg);
  console.log(`wrote ${out} (${svg.length} bytes)`);
  console.log(`  commits=${data.commits} repos=${data.repos} streak=${data.streak} stars=${data.stars}`);
  console.log(`  langs=${data.langs.map((l) => `${l.name} ${(l.pct * 100).toFixed(0)}%`).join(', ')}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
