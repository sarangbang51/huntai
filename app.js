/* ═══════════════════════════════════════════════════
   HuntAI V2
   - Supabase cloud database (applications, resume, profile)
   - AI resume matching + cover letter (Claude API)
   - Google Jobs + LinkedIn dual scraping
   - Keys stay in localStorage only
   ═══════════════════════════════════════════════════ */

// ── ACTORS ───────────────────────────────────────────
const ACTORS = {
  linkedin: 'curious_coder~linkedin-jobs-scraper',
  google:   'apify~google-jobs-scraper',
};

// ── AUTOCOMPLETE DATA ────────────────────────────────
const ROLE_SUGGESTIONS = [
  'Data Analyst','Senior Data Analyst','Junior Data Analyst',
  'Business Analyst','Senior Business Analyst','Junior Business Analyst',
  'BI Analyst','Business Intelligence Analyst','Analytics Engineer',
  'Senior Analytics Engineer','Data Engineer','Senior Data Engineer',
  'Product Analyst','Marketing Analyst','Financial Analyst',
  'Operations Analyst','Quantitative Analyst','Risk Analyst',
  'Data Scientist','Machine Learning Engineer','SQL Analyst',
];

const LOCATION_SUGGESTIONS = [
  'Remote','United States','India','United Kingdom',
  'London, UK','Manchester, UK','New York, NY','San Francisco, CA',
  'Chicago, IL','Austin, TX','Seattle, WA','Boston, MA',
  'Bengaluru, India','Mumbai, India','Hyderabad, India',
  'Delhi, India','Pune, India','Gurugram, India',
  'Canada','Toronto, Canada','Australia','Singapore','Dubai, UAE',
];

const SKILL_SUGGESTIONS = [
  'SQL','Python','Tableau','Power BI','Excel','Looker','dbt',
  'BigQuery','Snowflake','Spark','R','Pandas','AWS','Azure',
  'GCP','Databricks','Airflow','Jira','Alteryx','SAP','Redshift','DAX',
];

// ── STATE ────────────────────────────────────────────
const STATE = {
  jobs: [],
  applications: {},
  profile: {
    yearsExp: '',
    skills: [],
    ntfyTopic: '',
    resumeText: '',      // stored in Supabase
    resumeFileName: '',
  },
  settings: {
    apifyKey: '',
    anthropicKey: '',
    roles: ['Data Analyst','Business Analyst','BI Analyst','Analytics Engineer','Data Engineer'],
    locations: ['Remote','United States','India'],
    interval: 3600,
    supabaseUrl: '',
    supabaseKey: '',
  },
  gmail: { connected: false, email: '' },
  fetchCount: 0,
  detailId: null,
  theme: 'dark',
  aiPanelJobId: null,
};

// ── LOCAL STORAGE (keys only) ────────────────────────
function saveLocal() {
  try {
    localStorage.setItem('huntai_settings', JSON.stringify(STATE.settings));
    localStorage.setItem('huntai_theme', STATE.theme);
    localStorage.setItem('huntai_jobs', JSON.stringify(STATE.jobs.slice(0, 300)));
    localStorage.setItem('huntai_gmail', JSON.stringify(STATE.gmail));
  } catch(e) { console.warn('LocalStorage save error', e); }
}

function loadLocal() {
  try {
    const s = localStorage.getItem('huntai_settings');
    if (s) STATE.settings = { ...STATE.settings, ...JSON.parse(s) };
    const t = localStorage.getItem('huntai_theme');
    if (t) STATE.theme = t;
    const j = localStorage.getItem('huntai_jobs');
    if (j) STATE.jobs = JSON.parse(j);
    const g = localStorage.getItem('huntai_gmail');
    if (g) STATE.gmail = JSON.parse(g);
  } catch(e) { console.warn('LocalStorage load error', e); }
}

// ── SUPABASE DATABASE ────────────────────────────────
function sb() {
  const { supabaseUrl, supabaseKey } = STATE.settings;
  if (!supabaseUrl || !supabaseKey) return null;
  return { url: supabaseUrl.replace(/\/$/, ''), key: supabaseKey };
}

async function sbFetch(path, method = 'GET', body = null, extra = {}) {
  const db = sb(); if (!db) return null;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': db.key,
      'Authorization': `Bearer ${db.key}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
      ...extra,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${db.url}/rest/v1/${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    console.warn('Supabase error:', res.status, err);
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Save everything to Supabase
async function saveToCloud() {
  if (!sb()) return;
  try {
    // Save profile + resume
    await sbFetch('huntai_profile', 'POST', {
      id: 'main',
      years_exp: STATE.profile.yearsExp,
      skills: JSON.stringify(STATE.profile.skills),
      ntfy_topic: STATE.profile.ntfyTopic,
      resume_text: STATE.profile.resumeText,
      resume_filename: STATE.profile.resumeFileName,
      updated_at: new Date().toISOString(),
    });

    // Save all applications
    const apps = Object.values(STATE.applications);
    for (const app of apps) {
      await sbFetch('huntai_applications', 'POST', {
        id: app.id,
        title: app.title,
        company: app.company,
        location: app.location,
        source: app.source,
        url: app.url,
        status: app.status,
        notes: app.notes || '',
        sponsorship: app.sponsorship || 'unknown',
        applied_at: app.appliedAt,
        activity: JSON.stringify(app.activity || []),
        gmail_detected: app.gmailDetected || false,
        updated_at: new Date().toISOString(),
      });
    }
  } catch(e) { console.warn('Cloud save error', e); }
}

// Load everything from Supabase
async function loadFromCloud() {
  if (!sb()) return false;
  try {
    setCloudStatus('syncing');

    // Load profile
    const profiles = await sbFetch('huntai_profile?id=eq.main&select=*');
    if (profiles?.[0]) {
      const p = profiles[0];
      STATE.profile = {
        ...STATE.profile,
        yearsExp: p.years_exp || '',
        skills: JSON.parse(p.skills || '[]'),
        ntfyTopic: p.ntfy_topic || '',
        resumeText: p.resume_text || '',
        resumeFileName: p.resume_filename || '',
      };
    }

    // Load applications
    const apps = await sbFetch('huntai_applications?select=*&order=applied_at.desc');
    if (apps?.length) {
      STATE.applications = {};
      apps.forEach(a => {
        STATE.applications[a.id] = {
          id: a.id,
          title: a.title,
          company: a.company,
          location: a.location,
          source: a.source,
          url: a.url,
          status: a.status,
          notes: a.notes,
          sponsorship: a.sponsorship,
          appliedAt: a.applied_at,
          activity: JSON.parse(a.activity || '[]'),
          gmailDetected: a.gmail_detected,
        };
      });
    }

    setCloudStatus('connected');
    updateCounts();
    return true;
  } catch(e) {
    console.warn('Cloud load error', e);
    setCloudStatus('error');
    return false;
  }
}

async function deleteFromCloud(id) {
  await sbFetch(`huntai_applications?id=eq.${id}`, 'DELETE');
}

function setCloudStatus(status) {
  const el = document.getElementById('cloud-status');
  const dot = document.getElementById('cloud-dot');
  if (!el || !dot) return;
  const map = {
    connected: { text: 'Cloud synced', color: 'var(--green)' },
    syncing:   { text: 'Syncing...', color: 'var(--amber)' },
    error:     { text: 'Sync error', color: 'var(--red)' },
    none:      { text: 'No database', color: 'var(--muted2)' },
  };
  const s = map[status] || map.none;
  el.textContent = s.text;
  dot.style.background = s.color;
  if (status === 'connected') dot.style.boxShadow = `0 0 6px ${s.color}`;
  else dot.style.boxShadow = 'none';
}

function save() {
  saveLocal();
  saveToCloud(); // non-blocking
}

// ── THEME ────────────────────────────────────────────
function applyTheme(t) {
  STATE.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀' : '☾';
  localStorage.setItem('huntai_theme', t);
}
function toggleTheme() { applyTheme(STATE.theme === 'dark' ? 'light' : 'dark'); }

// ── PANEL NAV ─────────────────────────────────────────
function showPanel(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  const navBtn = btn || document.querySelector(`[data-panel="${name}"]`);
  if (navBtn) navBtn.classList.add('active');
  if (name === 'tracker') renderKanban();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  if (name === 'feed') renderFeed();
}

// ── SPONSORSHIP DETECTION ────────────────────────────
function detectSponsorship(raw) {
  const text = [raw.jobDescription||'',raw.description||'',raw.descriptionText||'',raw.snippet||''].join(' ').toLowerCase();
  if (!text || text.length < 60) return 'unknown';
  const YES = ['visa sponsorship available','sponsorship provided','we sponsor','will sponsor','open to sponsorship','can sponsor','h1b sponsor','h-1b sponsor','sponsorship offered','visa support','work authorization provided','able to sponsor'];
  if (YES.some(p => text.includes(p))) return 'yes';
  const NO = ['no sponsorship','not able to sponsor','unable to sponsor','cannot sponsor','does not sponsor','will not sponsor','no visa sponsorship','must be authorized to work','must be legally authorized','no work visa','citizens or permanent residents','us citizen or','must be a us citizen','not eligible for sponsorship'];
  if (NO.some(p => text.includes(p))) return 'no';
  return 'unknown';
}

function sponsorshipLabel(s) {
  if (s === 'yes') return { text: '✦ Sponsors visas', cls: 'sponsor-yes' };
  if (s === 'no')  return { text: '✗ No sponsorship', cls: 'sponsor-no' };
  return { text: '? Sponsorship unknown', cls: 'sponsor-unknown' };
}

// ── DATE FILTER ──────────────────────────────────────
function withinDateFilter(postedAt, filter) {
  if (!filter || filter === 'any') return true;
  if (!postedAt) return true;
  const diff = Date.now() - new Date(postedAt).getTime();
  if (filter === '2h'  && diff > 2  * 3600000) return false;
  if (filter === '24h' && diff > 24 * 3600000) return false;
  if (filter === '2d'  && diff > 2  * 86400000) return false;
  if (filter === '7d'  && diff > 7  * 86400000) return false;
  return true;
}

// ── AI RESUME MATCHING ───────────────────────────────
async function getAIMatchScore(job) {
  const key = STATE.settings.anthropicKey;
  const resume = STATE.profile.resumeText;
  if (!key || !resume) return null;
  if (!job.description || job.description.length < 100) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `You are a job matching expert. Analyze how well this candidate matches this job.

RESUME:
${resume.slice(0, 2000)}

JOB TITLE: ${job.title} at ${job.company}
JOB DESCRIPTION:
${job.description.slice(0, 1500)}

Respond ONLY with valid JSON, no markdown:
{
  "score": <0-100 integer>,
  "verdict": "<one line: Strong Match / Good Match / Partial Match / Weak Match>",
  "matching_skills": ["skill1", "skill2"],
  "gaps": ["gap1", "gap2"],
  "tip": "<one sentence on how to position yourself for this role>"
}`
        }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) { console.warn('AI match error', e); return null; }
}

async function generateCoverLetter(job) {
  const key = STATE.settings.anthropicKey;
  const resume = STATE.profile.resumeText;
  if (!key) { toast('Add your Anthropic API key in Settings'); return null; }
  if (!resume) { toast('Upload your resume in Settings first'); return null; }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Write a compelling, concise cover letter for this job application.

CANDIDATE RESUME:
${resume.slice(0, 2000)}

JOB: ${job.title} at ${job.company}
LOCATION: ${job.location}
JOB DESCRIPTION:
${(job.description || '').slice(0, 1500)}

Instructions:
- 3 short paragraphs, max 250 words total
- Opening: show genuine interest in the specific company/role
- Middle: highlight 2-3 most relevant achievements from resume using their language
- Closing: clear call to action
- Professional but warm tone
- Do NOT use generic phrases like "I am writing to express my interest"
- Reference specific details from the job description
- Output only the letter text, no subject line or date`
        }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch(e) { console.warn('Cover letter error', e); return null; }
}

async function generateTailoredBullets(job) {
  const key = STATE.settings.anthropicKey;
  const resume = STATE.profile.resumeText;
  if (!key || !resume) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `Rewrite 3-4 resume bullet points tailored specifically for this job.

RESUME:
${resume.slice(0, 2000)}

JOB: ${job.title} at ${job.company}
JOB DESCRIPTION: ${(job.description || '').slice(0, 1000)}

Instructions:
- Pick the 3-4 most relevant existing bullets from the resume
- Rewrite them using keywords and language from the job description
- Keep quantified achievements (numbers, percentages)
- Make them ATS-friendly
- Output as a JSON array of strings only, no markdown:
["bullet 1", "bullet 2", "bullet 3"]`
        }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '[]';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) { console.warn('Bullets error', e); return null; }
}

// ── AI PANEL ─────────────────────────────────────────
async function openAIPanel(jobId) {
  const job = STATE.jobs.find(j => j.id === jobId);
  if (!job) return;

  STATE.aiPanelJobId = jobId;
  const panel = document.getElementById('ai-panel');
  panel.style.display = 'flex';

  // Reset
  document.getElementById('ai-job-title').textContent = `${job.title} at ${job.company}`;
  document.getElementById('ai-match-section').innerHTML = '<div class="ai-loading">Analysing your resume against this role<span class="dots"></span></div>';
  document.getElementById('ai-cover-section').innerHTML = '';
  document.getElementById('ai-bullets-section').innerHTML = '';

  if (!STATE.settings.anthropicKey) {
    document.getElementById('ai-match-section').innerHTML = `
      <div class="ai-no-key">
        <div style="font-size:24px;margin-bottom:8px">🔑</div>
        <div style="font-weight:500;margin-bottom:6px">Add your Anthropic API key</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px">Go to Settings → Anthropic API key</div>
        <button class="btn-primary" onclick="showPanel('settings');closeAIPanel()">Open Settings</button>
      </div>`;
    return;
  }

  if (!STATE.profile.resumeText) {
    document.getElementById('ai-match-section').innerHTML = `
      <div class="ai-no-key">
        <div style="font-size:24px;margin-bottom:8px">📄</div>
        <div style="font-weight:500;margin-bottom:6px">Upload your resume first</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px">Go to Settings → Resume</div>
        <button class="btn-primary" onclick="showPanel('settings');closeAIPanel()">Upload Resume</button>
      </div>`;
    return;
  }

  // Get match score
  const match = await getAIMatchScore(job);
  if (match) {
    const scoreColor = match.score >= 75 ? 'var(--green)' : match.score >= 55 ? 'var(--amber)' : 'var(--red)';
    document.getElementById('ai-match-section').innerHTML = `
      <div class="ai-score-ring" style="border-color:${scoreColor}">
        <div class="ai-score-num" style="color:${scoreColor}">${match.score}</div>
        <div class="ai-score-label">/ 100</div>
      </div>
      <div class="ai-score-details">
        <div class="ai-verdict" style="color:${scoreColor}">${match.verdict}</div>
        ${match.matching_skills?.length ? `
          <div class="ai-section-label">Your matching skills</div>
          <div class="ai-tags">${match.matching_skills.map(s => `<span class="ai-tag green">${s}</span>`).join('')}</div>` : ''}
        ${match.gaps?.length ? `
          <div class="ai-section-label" style="margin-top:10px">Gaps to address</div>
          <div class="ai-tags">${match.gaps.map(g => `<span class="ai-tag red">${g}</span>`).join('')}</div>` : ''}
        ${match.tip ? `<div class="ai-tip">💡 ${match.tip}</div>` : ''}
      </div>`;
  } else {
    document.getElementById('ai-match-section').innerHTML = '<div style="color:var(--muted);font-size:13px">Could not analyse — check job has a description</div>';
  }

  // Buttons for cover letter + bullets
  document.getElementById('ai-cover-section').innerHTML = `
    <button class="btn-ai-action" onclick="loadCoverLetter('${jobId}')">
      ✦ Generate Cover Letter
    </button>
    <div id="ai-cover-output" style="display:none"></div>`;

  document.getElementById('ai-bullets-section').innerHTML = `
    <button class="btn-ai-action" onclick="loadTailoredBullets('${jobId}')">
      ✦ Generate Tailored Resume Bullets
    </button>
    <div id="ai-bullets-output" style="display:none"></div>`;
}

async function loadCoverLetter(jobId) {
  const job = STATE.jobs.find(j => j.id === jobId);
  if (!job) return;
  const btn = document.querySelector('#ai-cover-section .btn-ai-action');
  if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }
  const letter = await generateCoverLetter(job);
  const out = document.getElementById('ai-cover-output');
  if (letter && out) {
    out.style.display = 'block';
    out.innerHTML = `
      <div class="ai-output-box">
        <div class="ai-output-header">
          <span>Cover Letter</span>
          <button class="btn-copy" onclick="copyText('ai-cover-text')">Copy</button>
        </div>
        <div id="ai-cover-text" class="ai-output-text">${esc(letter)}</div>
      </div>`;
    if (btn) { btn.textContent = '↻ Regenerate Cover Letter'; btn.disabled = false; }
  }
}

async function loadTailoredBullets(jobId) {
  const job = STATE.jobs.find(j => j.id === jobId);
  if (!job) return;
  const btn = document.querySelector('#ai-bullets-section .btn-ai-action');
  if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }
  const bullets = await generateTailoredBullets(job);
  const out = document.getElementById('ai-bullets-output');
  if (bullets && out) {
    out.style.display = 'block';
    out.innerHTML = `
      <div class="ai-output-box">
        <div class="ai-output-header">
          <span>Tailored Resume Bullets</span>
          <button class="btn-copy" onclick="copyText('ai-bullets-text')">Copy all</button>
        </div>
        <div id="ai-bullets-text" class="ai-output-text">${bullets.map(b => `• ${esc(b)}`).join('\n')}</div>
      </div>`;
    if (btn) { btn.textContent = '↻ Regenerate Bullets'; btn.disabled = false; }
  }
}

function copyText(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => toast('Copied to clipboard'));
}

function closeAIPanel() {
  document.getElementById('ai-panel').style.display = 'none';
  STATE.aiPanelJobId = null;
}

// ── JOB FETCHING ─────────────────────────────────────
async function fetchJobs(manual = false) {
  const key = STATE.settings.apifyKey;
  if (!key) { if (manual) showNoKeyBanner(); return; }

  document.getElementById('feed-loading').style.display = 'flex';
  document.getElementById('feed-empty').style.display = 'none';
  setLoadingSub('Starting LinkedIn + Google Jobs scrapers...');

  const allJobs = [];
  let completed = 0;
  const pairs = [];

  for (const loc of STATE.settings.locations) {
    for (const role of STATE.settings.roles) {
      let q = role;
      if (STATE.profile.yearsExp) {
        const y = parseInt(STATE.profile.yearsExp);
        if (y <= 2) q += ' entry level'; else if (y >= 6) q += ' senior';
      }
      pairs.push({ query: q, location: loc });
    }
  }

  await Promise.all(pairs.map(async ({ query, location }) => {
    try {
      // LinkedIn (confirmed working)
      const liJobs = await runLinkedInScraper(key, query, location);
      if (liJobs?.length) liJobs.forEach(j => allJobs.push(j));

      // Google Jobs (company sites, Greenhouse, Lever, Workday, Indeed etc)
      const gJobs = await runGoogleJobsScraper(key, query, location);
      if (gJobs?.length) gJobs.forEach(j => allJobs.push(j));

      completed++;
      setLoadingSub(`${completed}/${pairs.length} done — ${allJobs.length} jobs found`);
      if (allJobs.length > 0) { STATE.jobs = dedup(allJobs); renderFeed(); }
    } catch(e) { console.warn(`Failed: ${query} in ${location}`, e); }
  }));

  STATE.jobs = dedup(allJobs);
  STATE.fetchCount++;
  const t = new Date().toLocaleTimeString();
  document.getElementById('feed-updated').textContent = `updated ${t} · ${STATE.jobs.length} jobs`;
  document.getElementById('feed-updated-sidebar').textContent = `Last fetch: ${t}`;
  saveLocal();
  renderFeed();
  document.getElementById('feed-loading').style.display = 'none';
  document.getElementById('job-grid').style.display = 'grid';
  if (allJobs.length > 0) toast(`✓ ${STATE.jobs.length} jobs from LinkedIn + Google Jobs`);
  else if (manual) toast('No jobs returned — check your Apify key in Settings');
}

// ── LINKEDIN SCRAPER ─────────────────────────────────
async function runLinkedInScraper(key, query, location) {
  try {
    const body = {
      urls: [buildLinkedInUrl(query, location)],
      count: 25,
      scrapeCompany: false,
      splitByLocation: false,
    };
    const runRes = await fetch('https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!runRes.ok) { console.warn('LinkedIn start failed:', runRes.status); return null; }
    const { data } = await runRes.json();
    if (!data?.id) return null;
    const items = await pollAndFetch(key, data.id, data.defaultDatasetId);
    return items.map(r => normalizeJob(r, query, 'LinkedIn'));
  } catch(e) { console.warn('LinkedIn error:', e.message); return null; }
}

function buildLinkedInUrl(query, location) {
  const kw = encodeURIComponent(query);
  const loc = encodeURIComponent(location);
  let url = `https://www.linkedin.com/jobs/search/?keywords=${kw}&location=${loc}&f_TPR=r86400&position=1&pageNum=0`;
  if (location.toLowerCase() === 'remote') url += '&f_WT=2';
  return url;
}

// ── GOOGLE JOBS SCRAPER ──────────────────────────────
// Covers: company career pages, Greenhouse, Lever, Workday, Ashby, Indeed, Glassdoor
async function runGoogleJobsScraper(key, query, location) {
  try {
    const body = {
      queries: [`${query} jobs ${location}`],
      maxPagesPerQuery: 1,
      resultsPerPage: 20,
      countryCode: locationToCountry(location),
      languageCode: 'en',
      saveHtml: false,
    };
    const runRes = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(ACTORS.google)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!runRes.ok) { console.warn('Google Jobs start failed:', runRes.status); return null; }
    const { data } = await runRes.json();
    if (!data?.id) return null;
    const items = await pollAndFetch(key, data.id, data.defaultDatasetId);
    return items.map(r => normalizeJob(r, query, detectSrc(r)));
  } catch(e) { console.warn('Google Jobs error:', e.message); return null; }
}

function locationToCountry(loc) {
  const l = loc.toLowerCase();
  if (l.includes('india') || l.includes('bengaluru') || l.includes('mumbai')) return 'IN';
  if (l.includes('uk') || l.includes('london') || l.includes('manchester')) return 'GB';
  if (l.includes('canada') || l.includes('toronto')) return 'CA';
  if (l.includes('australia') || l.includes('sydney')) return 'AU';
  return 'US';
}

// ── POLL & FETCH ─────────────────────────────────────
async function pollAndFetch(key, runId, datasetId, maxPolls = 45) {
  let status = 'RUNNING', polls = 0;
  while ((status === 'RUNNING' || status === 'READY') && polls < maxPolls) {
    await sleep(3000); polls++;
    try {
      const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: { 'Authorization': `Bearer ${key}` } });
      status = (await r.json()).data?.status;
    } catch { break; }
  }
  if (status !== 'SUCCEEDED') return [];
  const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&limit=25`, { headers: { 'Authorization': `Bearer ${key}` } });
  const items = await r.json();
  return Array.isArray(items) ? items : [];
}

// ── JOB NORMALIZER ───────────────────────────────────
function normalizeJob(raw, qFallback, srcOverride) {
  const desc = raw.jobDescription || raw.description || raw.descriptionText || raw.snippet || '';
  let url = raw.jobUrl || raw.applyUrl || raw.url || raw.linkedinJobUrl || '';
  if (!url || url === '#') {
    url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(raw.jobTitle || qFallback)}`;
  }
  return {
    id: raw.id || raw.jobId || raw.jobPostingId || generateId(),
    title: raw.jobTitle || raw.title || raw.position || qFallback || 'Analyst',
    company: raw.companyName || raw.company || raw.employer || 'Unknown',
    location: raw.jobLocation || raw.location || raw.locationName || 'Remote',
    source: srcOverride || detectSrc(raw, url),
    type: raw.jobType || raw.employmentType || guessType(desc),
    salary: raw.salaryRange || raw.salary || extractSalary(desc),
    applicants: raw.numberOfApplicants || raw.applicants || raw.applyCount || null,
    skills: extractSkills(desc),
    description: desc,
    sponsorship: detectSponsorship(raw),
    url,
    postedAt: raw.postedAt || raw.publishedAt || raw.datePosted || new Date().toISOString(),
    postedLabel: timeAgo(raw.postedAt || raw.publishedAt || raw.datePosted),
    level: guessLevel(raw.jobTitle || raw.title || qFallback || ''),
    fetchedAt: Date.now(),
    aiScore: null, // filled lazily
  };
}

function detectSrc(raw, url = '') {
  const u = (url || raw.jobUrl || raw.url || '').toLowerCase();
  const via = (raw.via || raw.source || '').toLowerCase();
  if (u.includes('linkedin') || via.includes('linkedin')) return 'LinkedIn';
  if (u.includes('indeed') || via.includes('indeed')) return 'Indeed';
  if (u.includes('glassdoor') || via.includes('glassdoor')) return 'Glassdoor';
  if (u.includes('greenhouse')) return 'Greenhouse';
  if (u.includes('lever')) return 'Lever';
  if (u.includes('workday')) return 'Workday';
  if (u.includes('wellfound') || u.includes('angel')) return 'Wellfound';
  if (u.includes('ashby')) return 'Ashby';
  const co = (raw.companyName || raw.company || '').toLowerCase().replace(/[^a-z]/g, '');
  if (co && co.length > 3 && u.includes(co)) return 'Company Site';
  return 'Google Jobs';
}

function extractSkills(text) {
  if (!text) return [];
  const t = text.toLowerCase();
  const known = ['SQL','Python','Tableau','Power BI','Excel','Looker','dbt','BigQuery','Snowflake','Spark','R','Pandas','AWS','Azure','GCP','Databricks','Airflow','Jira','Alteryx','SAP','Redshift','DAX','Scala'];
  return known.filter(s => t.includes(s.toLowerCase())).slice(0, 5);
}

function extractSalary(text) {
  if (!text) return null;
  const m = text.match(/[\$£₹][\d,]+k?\s*[-–]\s*[\$£₹][\d,]+k?/i) || text.match(/[\$£₹][\d,]{4,}/i);
  return m ? m[0] : null;
}

function guessType(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('contract')) return 'Contract';
  if (t.includes('part-time')) return 'Part-time';
  if (t.includes('hybrid')) return 'Hybrid';
  if (t.includes('remote')) return 'Remote';
  return 'Full-time';
}

function guessLevel(title) {
  const t = title.toLowerCase();
  if (t.includes('lead') || t.includes('principal') || t.includes('staff')) return 'Lead';
  if (t.includes('senior') || t.includes('sr.')) return 'Senior';
  if (t.includes('junior') || t.includes('jr.') || t.includes('entry')) return 'Junior';
  return 'Mid';
}

function timeAgo(iso) {
  if (!iso) return 'recently';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : `${Math.floor(d/7)}w ago`;
}

function dedup(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    const k = `${(j.title||'').toLowerCase().trim()}|${(j.company||'').toLowerCase().trim()}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

function setLoadingSub(msg) { const el = document.getElementById('loading-sub'); if (el) el.textContent = msg; }

function showNoKeyBanner() {
  const grid = document.getElementById('job-grid');
  grid.style.display = 'grid';
  grid.innerHTML = `<div style="grid-column:1/-1;border:1px solid var(--accent);border-radius:12px;padding:36px;text-align:center;max-width:480px;margin:0 auto">
    <div style="font-size:32px;margin-bottom:14px">🔑</div>
    <div style="font-family:var(--font-display);font-size:18px;font-weight:600;margin-bottom:8px">Add your Apify key to fetch live jobs</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.7">Fetches from LinkedIn + Google Jobs (covers 100s of company career sites)</div>
    <button class="btn-primary" onclick="showPanel('settings')">Open Settings →</button>
  </div>`;
}

// ── PROFILE MATCH SCORE (keyword-based, instant) ─────
function matchScore(job) {
  if (!STATE.profile.skills.length && !STATE.profile.yearsExp) return null;
  let score = 50;
  const jobSkills = (job.skills || []).map(s => s.toLowerCase());
  const userSkills = STATE.profile.skills.map(s => s.toLowerCase());
  if (userSkills.length && jobSkills.length) {
    const matches = userSkills.filter(s => jobSkills.includes(s)).length;
    score += Math.round((matches / userSkills.length) * 40);
  }
  if (STATE.profile.yearsExp) {
    const y = parseInt(STATE.profile.yearsExp), lvl = job.level || 'Mid';
    if ((y<=2&&lvl==='Junior')||(y>=3&&y<=5&&lvl==='Mid')||(y>=5&&(lvl==='Senior'||lvl==='Lead'))) score += 10;
    else score -= 5;
  }
  return Math.min(100, Math.max(0, score));
}

function matchBadge(score) {
  if (score === null) return '';
  const cls = score >= 80 ? 'match-high' : score >= 60 ? 'match-mid' : 'match-low';
  return `<span class="match-badge ${cls}">${score}% match</span>`;
}

// ── FEED RENDERING ────────────────────────────────────
function renderFeed() {
  const q = (document.getElementById('search-q')?.value || '').toLowerCase();
  const role = document.getElementById('f-role')?.value || '';
  const loc = document.getElementById('f-loc')?.value || '';
  const sort = document.getElementById('f-sort')?.value || 'recent';
  const sponsorF = document.getElementById('f-sponsor')?.value || 'all';
  const dateF = document.getElementById('f-date')?.value || 'any';

  let jobs = STATE.jobs.filter(j => {
    if (q && !`${j.title} ${j.company} ${(j.skills||[]).join(' ')}`.toLowerCase().includes(q)) return false;
    if (role && !j.title.toLowerCase().includes(role.toLowerCase().split(' ')[0])) return false;
    if (loc) {
      const jloc = (j.location || '').toLowerCase();
      if (loc === 'Remote' && !jloc.includes('remote')) return false;
      if (loc === 'United States' && !jloc.match(/united states|new york|san francisco|chicago|austin|seattle|boston|denver|remote/i)) return false;
      if (loc === 'India' && !jloc.match(/india|bengaluru|bangalore|mumbai|hyderabad|delhi|pune/i)) return false;
      if (loc === 'United Kingdom' && !jloc.match(/uk|united kingdom|london|manchester|birmingham/i)) return false;
    }
    if (sponsorF === 'yes' && j.sponsorship !== 'yes') return false;
    if (sponsorF === 'hide_no' && j.sponsorship === 'no') return false;
    if (!withinDateFilter(j.postedAt, dateF)) return false;
    return true;
  });

  if (sort === 'applicants') jobs.sort((a, b) => (a.applicants||999) - (b.applicants||999));
  else if (sort === 'match') jobs.sort((a, b) => (matchScore(b)||0) - (matchScore(a)||0));
  else jobs.sort((a, b) => (b.fetchedAt||0) - (a.fetchedAt||0));

  document.getElementById('badge-feed').textContent = jobs.length;
  const grid = document.getElementById('job-grid');
  grid.style.display = 'grid';

  if (!jobs.length && STATE.jobs.length === 0) { showNoKeyBanner(); return; }
  if (!jobs.length) { grid.innerHTML = ''; document.getElementById('feed-empty').style.display = 'block'; return; }
  document.getElementById('feed-empty').style.display = 'none';

  grid.innerHTML = jobs.slice(0, 80).map(j => {
    const app = STATE.applications[j.id];
    const isLogged = !!app && app.status !== 'saved';
    const isSaved = app?.status === 'saved';
    const isHot = (j.applicants || 0) > 200;
    const score = matchScore(j);
    const sp = sponsorshipLabel(j.sponsorship || 'unknown');
    const hasResume = !!STATE.profile.resumeText;

    return `<div class="job-card" id="jcard-${j.id}">
      <div class="jc-top">
        <div style="flex:1;min-width:0">
          <div class="jc-title">${esc(j.title)}</div>
          <div class="jc-company">${esc(j.company)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          <span class="jc-src">${esc(j.source)}</span>
          ${score !== null ? matchBadge(score) : ''}
        </div>
      </div>
      <div class="jc-meta">
        <span class="meta-pill">${esc(j.location)}</span>
        <span class="meta-pill">${esc(j.type || 'Full-time')}</span>
        ${j.salary ? `<span class="meta-pill">${esc(j.salary)}</span>` : ''}
        ${j.applicants ? (isHot ? `<span class="meta-pill hot">🔥 ${j.applicants}</span>` : `<span class="meta-pill">${j.applicants} applicants</span>`) : ''}
        <span class="meta-pill">${esc(j.postedLabel || 'recently')}</span>
      </div>
      <div style="margin-bottom:8px"><span class="sponsor-pill ${sp.cls}">${sp.text}</span></div>
      ${j.skills?.length ? `<div class="jc-skills">${j.skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="jc-actions">
        <button class="btn-apply-card ${isLogged ? 'logged' : ''}" onclick="handleApply('${j.id}')">${isLogged ? '✓ Logged' : 'Log Application'}</button>
        <button class="btn-save-card ${isSaved ? 'saved' : ''}" onclick="handleSave('${j.id}')" title="Save">★</button>
        <button class="btn-ai-card ${!hasResume ? 'dim' : ''}" onclick="openAIPanel('${j.id}')" title="${hasResume ? 'AI match + cover letter' : 'Upload resume in Settings first'}">✦ AI</button>
        ${j.url && j.url !== '#' ? `<a href="${esc(j.url)}" target="_blank" rel="noopener" class="btn-link-card">↗</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

function filterFeed() { renderFeed(); }

// ── APPLICATIONS ──────────────────────────────────────
function handleApply(jobId) {
  const job = STATE.jobs.find(j => j.id === jobId);
  if (!job) return;
  if (STATE.applications[jobId]?.status === 'applied') { openDetailModal(jobId); return; }
  if (job.url && job.url !== '#') window.open(job.url, '_blank');
  const now = new Date();
  STATE.applications[jobId] = { ...job, status: 'applied', appliedAt: now.toISOString(),
    activity: [{ date: now.toISOString(), text: `Applied via ${job.source}`, auto: false }], notes: '' };
  updateCounts(); save(); renderFeed(); renderKanbanIfActive();
  toast(`Logged: ${job.title} at ${job.company}`);
}

function handleSave(jobId) {
  const job = STATE.jobs.find(j => j.id === jobId);
  if (!job || STATE.applications[jobId]) return;
  STATE.applications[jobId] = { ...job, status: 'saved', appliedAt: new Date().toISOString(),
    activity: [{ date: new Date().toISOString(), text: 'Saved for later', auto: false }], notes: '', savedAt: new Date().toISOString() };
  updateCounts(); save(); renderFeed(); renderKanbanIfActive();
  toast(`Saved — reminder in 24h`);
  scheduleNtfyReminder(job);
}

function deleteApplication(id) {
  if (!STATE.applications[id]) return;
  const app = STATE.applications[id];
  if (!confirm(`Delete "${app.title} at ${app.company}"?`)) return;
  delete STATE.applications[id];
  deleteFromCloud(id);
  updateCounts(); renderKanban(); renderStats(); renderFeed();
  document.getElementById('detail-modal').style.display = 'none';
  STATE.detailId = null;
  toast('Deleted');
}

function showLogModal() { document.getElementById('log-modal').style.display = 'flex'; document.getElementById('log-title').focus(); }
function closeLogModal(e) { if (e && e.target !== document.getElementById('log-modal')) return; document.getElementById('log-modal').style.display = 'none'; }

function logApplication() {
  const title = document.getElementById('log-title').value.trim();
  const company = document.getElementById('log-company').value.trim();
  if (!title || !company) { toast('Title and company required'); return; }
  const id = 'manual_' + generateId(), now = new Date();
  STATE.applications[id] = { id, title, company,
    location: document.getElementById('log-location').value.trim() || 'Unknown',
    url: document.getElementById('log-url').value.trim() || '#',
    source: document.getElementById('log-source').value,
    notes: document.getElementById('log-notes').value.trim(),
    status: 'applied', appliedAt: now.toISOString(),
    activity: [{ date: now.toISOString(), text: 'Manually logged', auto: false }] };
  save(); updateCounts(); renderKanban(); renderStats();
  document.getElementById('log-modal').style.display = 'none';
  ['log-title','log-company','log-location','log-url','log-notes'].forEach(i => { document.getElementById(i).value = ''; });
  toast(`Logged: ${title} at ${company}`);
}

// ── DETAIL MODAL ──────────────────────────────────────
function openDetailModal(id) {
  const app = STATE.applications[id];
  if (!app) return;
  STATE.detailId = id;
  document.getElementById('dm-title').textContent = app.title;
  document.getElementById('dm-sub').textContent = `${app.company} · ${app.location || ''}`;
  document.getElementById('dm-status').value = app.status;
  document.getElementById('dm-notes').value = app.notes || '';
  const sp = sponsorshipLabel(app.sponsorship || 'unknown');
  const spEl = document.getElementById('dm-sponsor');
  if (spEl) { spEl.textContent = sp.text; spEl.className = `sponsor-pill ${sp.cls}`; }
  const linkEl = document.getElementById('dm-open-link');
  if (linkEl && app.url && app.url !== '#') { linkEl.href = app.url; linkEl.style.display = 'inline-flex'; }
  else if (linkEl) linkEl.style.display = 'none';
  renderTimeline(id);
  document.getElementById('detail-modal').style.display = 'flex';
}

function closeDetailModal(e) { if (e && e.target !== document.getElementById('detail-modal')) return; document.getElementById('detail-modal').style.display = 'none'; STATE.detailId = null; }

function renderTimeline(id) {
  const app = STATE.applications[id]; if (!app) return;
  document.getElementById('dm-timeline').innerHTML = (app.activity||[]).slice().reverse().map(a =>
    `<div class="timeline-item"><div class="tl-dot ${a.auto?'auto':''}"></div>
    <div class="tl-content"><div class="tl-text">${esc(a.text)}</div><div class="tl-date">${formatDate(a.date)}</div></div></div>`).join('');
}

function updateAppStatus() {
  const id = STATE.detailId;
  if (!id || !STATE.applications[id]) return;
  const ns = document.getElementById('dm-status').value;
  const old = STATE.applications[id].status;
  if (old === ns) return;
  STATE.applications[id].status = ns;
  STATE.applications[id].activity.push({ date: new Date().toISOString(), text: `Status: ${old} → ${ns}`, auto: false });
  renderTimeline(id); save(); updateCounts(); renderKanban(); renderStats();
  toast('Status: ' + ns);
}

function saveDetailNote() {
  const id = STATE.detailId;
  if (!id || !STATE.applications[id]) return;
  STATE.applications[id].notes = document.getElementById('dm-notes').value;
  STATE.applications[id].activity.push({ date: new Date().toISOString(), text: 'Note added', auto: false });
  save(); renderKanban(); toast('Note saved');
}

// ── KANBAN ────────────────────────────────────────────
function renderKanban() {
  const groups = { saved:[],applied:[],interview:[],offer:[],rejected:[] };
  Object.values(STATE.applications).forEach(a => (groups[a.status]||groups.applied).push(a));
  ['saved','applied','interview','offer','rejected'].forEach(status => {
    const el = document.getElementById('k-'+status); if (!el) return;
    el.innerHTML = groups[status].sort((a,b) => new Date(b.appliedAt)-new Date(a.appliedAt)).map(app => {
      const sp = sponsorshipLabel(app.sponsorship||'unknown');
      return `<div class="kcard" onclick="openDetailModal('${app.id}')">
        <div class="kcard-title">${esc(app.title)}</div>
        <div class="kcard-co">${esc(app.company)}</div>
        <div class="kcard-date">${esc(app.source||'')} · ${timeAgo(app.appliedAt)}</div>
        <span class="sponsor-pill ${sp.cls}" style="font-size:10px;margin-top:4px;display:inline-block">${sp.text}</span>
        ${app.notes ? `<div class="kcard-note">${esc(app.notes.slice(0,60))}${app.notes.length>60?'...':''}</div>` : ''}
        ${app.gmailDetected ? `<div class="kcard-auto">✦ Auto via Gmail</div>` : ''}
      </div>`;
    }).join('') || `<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px 0">Empty</div>`;
  });
  updateCounts();
}

function renderKanbanIfActive() { if (document.getElementById('panel-tracker').classList.contains('active')) renderKanban(); }

function updateCounts() {
  const counts = { saved:0,applied:0,interview:0,offer:0,rejected:0 };
  Object.values(STATE.applications).forEach(a => counts[a.status]=(counts[a.status]||0)+1);
  ['saved','applied','interview','offer','rejected'].forEach(s => { const el=document.getElementById('kc-'+s); if(el) el.textContent=counts[s]||0; });
  document.getElementById('badge-track').textContent = Object.keys(STATE.applications).length;
}

// ── ANALYTICS ─────────────────────────────────────────
function renderStats() {
  const apps = Object.values(STATE.applications);
  const applied = apps.filter(a => a.status !== 'saved');
  const interviews = apps.filter(a => a.status === 'interview').length;
  const offers = apps.filter(a => a.status === 'offer').length;
  const rejected = apps.filter(a => a.status === 'rejected').length;
  const rate = applied.length ? Math.round((interviews+offers+rejected)/applied.length*100) : 0;
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate()-7);
  const thisWeek = applied.filter(a => new Date(a.appliedAt)>=weekStart).length;

  document.getElementById('st-total').textContent = applied.length;
  document.getElementById('st-week').textContent = `this week: ${thisWeek}`;
  document.getElementById('st-rate').textContent = rate+'%';
  document.getElementById('st-rate-d').textContent = `${interviews} interviews + ${offers} offers`;
  document.getElementById('st-inter').textContent = interviews;
  document.getElementById('st-offer').textContent = offers;

  const spYes=applied.filter(a=>a.sponsorship==='yes').length;
  const spNo=applied.filter(a=>a.sponsorship==='no').length;
  const spUnk=applied.filter(a=>!a.sponsorship||a.sponsorship==='unknown').length;
  const spEl=document.getElementById('st-sponsor');
  if (spEl) spEl.innerHTML=`<span class="sponsor-yes">✦ ${spYes}</span> &nbsp;<span class="sponsor-no">✗ ${spNo}</span> &nbsp;<span class="sponsor-unknown">? ${spUnk}</span>`;

  const days=[]; for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d);}
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayCounts=days.map(d=>applied.filter(a=>new Date(a.appliedAt).toDateString()===d.toDateString()).length);
  const maxDay=Math.max(...dayCounts,1);
  document.getElementById('chart-week').innerHTML=days.map((d,i)=>`
    <div class="bar-col"><div class="bar-val">${dayCounts[i]||''}</div>
    <div class="bar-inner ${d.toDateString()===new Date().toDateString()?'today':''}" style="height:${Math.round(dayCounts[i]/maxDay*70)}px"></div>
    <div class="bar-lbl">${dayNames[d.getDay()]}</div></div>`).join('');

  const roleCounts={};
  applied.forEach(a=>{roleCounts[a.title]=(roleCounts[a.title]||0)+1;});
  const roleEntries=Object.entries(roleCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const colors=['#6366f1','#4f8ef7','#34d399','#f5a623','#f87171'];
  const total=roleEntries.reduce((s,[,v])=>s+v,0)||1;
  let cum=0;
  const donutSvg=document.getElementById('donut-svg');
  if(roleEntries.length){
    donutSvg.innerHTML=roleEntries.map(([,count],i)=>{
      const pct=count/total,s=cum*Math.PI*2-Math.PI/2;cum+=pct;const e=cum*Math.PI*2-Math.PI/2;
      const r=45,cx=60,cy=60,x1=cx+r*Math.cos(s),y1=cy+r*Math.sin(s),x2=cx+r*Math.cos(e),y2=cy+r*Math.sin(e);
      return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${pct>.5?1:0},1 ${x2},${y2} Z" fill="${colors[i]}" opacity="0.85"/>`;
    }).join('')+`<circle cx="60" cy="60" r="28" fill="var(--surface)"/><text x="60" y="64" text-anchor="middle" font-size="14" fill="var(--text)">${total}</text>`;
  }
  document.getElementById('donut-legend').innerHTML=roleEntries.map(([role,count],i)=>`
    <div class="legend-row"><div class="legend-dot" style="background:${colors[i]}"></div><span>${role.split(' ').slice(0,2).join(' ')} (${count})</span></div>`).join('');

  const maxF=Math.max(applied.length,1);
  document.getElementById('chart-funnel').innerHTML=[{label:'Applied',count:applied.length,color:'#6366f1'},{label:'Interview',count:interviews,color:'#f5a623'},{label:'Offer',count:offers,color:'#34d399'}].map(s=>`
    <div class="funnel-bar"><span class="funnel-label">${s.label}</span>
    <div class="funnel-fill" style="width:${Math.round(s.count/maxF*120)}px;background:${s.color}22;border-color:${s.color}"></div>
    <span class="funnel-num">${s.count}</span></div>`).join('');

  const hourCounts=new Array(24).fill(0);
  applied.forEach(a=>hourCounts[new Date(a.appliedAt).getHours()]++);
  const maxH=Math.max(...hourCounts,1);
  const hourLabels=['12a','','','','4a','','','','8a','','','','12p','','','','4p','','','','8p','','',''];
  document.getElementById('chart-hour').innerHTML=hourCounts.map((c,h)=>`
    <div class="bar-col" style="min-width:0"><div class="bar-inner" style="height:${Math.round(c/maxH*55)}px"></div>
    <div class="bar-lbl">${hourLabels[h]}</div></div>`).join('');
}

// ── NTFY REMINDERS ───────────────────────────────────
function scheduleNtfyReminder(job) {
  const topic = STATE.profile.ntfyTopic;
  if (!topic) return;
  setTimeout(() => {
    const app = STATE.applications[job.id];
    if (app && app.status === 'saved') {
      sendNtfy(topic, `⏰ Apply to ${job.title}`, `You saved "${job.title}" at ${job.company} 24h ago. Don't forget to apply!\n${job.url||''}`);
    }
  }, 24 * 60 * 60 * 1000);
}

async function sendNtfy(topic, title, message) {
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Title': title, 'Priority': 'default', 'Tags': 'briefcase' },
      body: message,
    });
  } catch(e) { console.warn('Ntfy error', e); }
}

function testNtfy() {
  const topic = document.getElementById('ntfy-topic').value.trim();
  if (!topic) { toast('Enter your ntfy topic first'); return; }
  STATE.profile.ntfyTopic = topic;
  save();
  sendNtfy(topic, '✅ HuntAI V2 Connected!', 'Phone reminders active. You will be notified 24h after saving a job.');
  toast('Test sent — check your phone!');
}

// ── RESUME UPLOAD ────────────────────────────────────
function triggerResumeUpload() { document.getElementById('resume-file-input').click(); }

function handleResumeUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const text = ev.target.result;
    STATE.profile.resumeText = text;
    STATE.profile.resumeFileName = file.name;
    save();
    document.getElementById('resume-status').textContent = `✓ ${file.name} uploaded`;
    document.getElementById('resume-status').style.color = 'var(--green)';
    renderFeed(); // refresh match scores
    toast('Resume uploaded and saved to cloud');
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── EXPORT / IMPORT ──────────────────────────────────
function exportData() {
  const data = { exported: new Date().toISOString(), version: 2, applications: STATE.applications, profile: { ...STATE.profile } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `huntai-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  toast('Data exported');
}

function importData() { document.getElementById('import-file').click(); }

function handleImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.applications) STATE.applications = { ...STATE.applications, ...data.applications };
      if (data.profile) STATE.profile = { ...STATE.profile, ...data.profile };
      save(); updateCounts(); renderKanban(); renderStats();
      toast(`Imported ${Object.keys(data.applications||{}).length} applications`);
    } catch(e) { toast('Import failed — invalid file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── SETTINGS ─────────────────────────────────────────
function renderSettings() {
  const ki = document.getElementById('apify-key-input'); if(ki) ki.value = STATE.settings.apifyKey||'';
  const ai = document.getElementById('anthropic-key-input'); if(ai) ai.value = STATE.settings.anthropicKey||'';
  const sbUrl = document.getElementById('sb-url'); if(sbUrl) sbUrl.value = STATE.settings.supabaseUrl||'';
  const sbKey = document.getElementById('sb-key'); if(sbKey) sbKey.value = STATE.settings.supabaseKey||'';
  const ii = document.getElementById('interval-sel'); if(ii) ii.value = STATE.settings.interval;
  document.getElementById('p-exp').value = STATE.profile.yearsExp||'';
  document.getElementById('ntfy-topic').value = STATE.profile.ntfyTopic||'';

  const rs = document.getElementById('resume-status');
  if (rs) {
    if (STATE.profile.resumeFileName) {
      rs.textContent = `✓ ${STATE.profile.resumeFileName}`;
      rs.style.color = 'var(--green)';
    } else {
      rs.textContent = 'No resume uploaded';
      rs.style.color = 'var(--muted)';
    }
  }

  renderProfileSkills();
  document.getElementById('role-tags').innerHTML = STATE.settings.roles.map(r => `<span class="role-tag">${esc(r)}<span class="role-tag-remove" onclick="removeRole('${esc(r)}')">×</span></span>`).join('');
  document.getElementById('loc-tags').innerHTML = STATE.settings.locations.map(l => `<span class="role-tag">${esc(l)}<span class="role-tag-remove" onclick="removeLoc('${esc(l)}')">×</span></span>`).join('');
  updateGmailUI();
}

function renderProfileSkills() {
  const el = document.getElementById('profile-skill-tags'); if(!el) return;
  el.innerHTML = STATE.profile.skills.map(s => `<span class="role-tag">${esc(s)}<span class="role-tag-remove" onclick="removeProfileSkill('${esc(s)}')">×</span></span>`).join('');
}

function saveProfile() {
  STATE.profile.yearsExp = document.getElementById('p-exp').value.trim();
  save(); renderFeed();
  toast('Profile saved');
}

function addProfileSkill() {
  const v = document.getElementById('p-skill-input').value.trim();
  if (!v || STATE.profile.skills.map(s=>s.toLowerCase()).includes(v.toLowerCase())) return;
  STATE.profile.skills.push(v); document.getElementById('p-skill-input').value='';
  save(); renderProfileSkills(); renderFeed();
}

function removeProfileSkill(s) { STATE.profile.skills = STATE.profile.skills.filter(x=>x!==s); save(); renderProfileSkills(); renderFeed(); }

function saveApifySettings() {
  const keyVal = document.getElementById('apify-key-input').value.trim();
  const fb = document.getElementById('apify-feedback');
  if (!keyVal || !keyVal.startsWith('apify_api_')) {
    fb.className='settings-feedback err'; fb.textContent='✗ Must start with apify_api_'; fb.style.display='block'; return;
  }
  STATE.settings.apifyKey = keyVal; saveLocal();
  fb.className='settings-feedback ok'; fb.textContent='✓ Saved in browser. Fetching now...'; fb.style.display='block';
  setTimeout(()=>{fb.style.display='none';},4000);
  fetchJobs(true);
}

function saveAnthropicKey() {
  const keyVal = document.getElementById('anthropic-key-input').value.trim();
  const fb = document.getElementById('anthropic-feedback');
  if (!keyVal || !keyVal.startsWith('sk-ant-')) {
    fb.className='settings-feedback err'; fb.textContent='✗ Must start with sk-ant-'; fb.style.display='block'; return;
  }
  STATE.settings.anthropicKey = keyVal; saveLocal();
  fb.className='settings-feedback ok'; fb.textContent='✓ Saved in browser. AI features unlocked!'; fb.style.display='block';
  setTimeout(()=>{fb.style.display='none';},4000);
  renderFeed();
}

async function saveSupabaseSettings() {
  STATE.settings.supabaseUrl = document.getElementById('sb-url').value.trim().replace(/\/$/, '');
  STATE.settings.supabaseKey = document.getElementById('sb-key').value.trim();
  saveLocal();
  const fb = document.getElementById('sb-feedback');
  fb.className='settings-feedback ok'; fb.textContent='Connecting to Supabase...'; fb.style.display='block';
  const ok = await loadFromCloud();
  if (ok) {
    fb.textContent='✓ Connected! Data loaded from cloud.';
    updateCounts(); renderKanban();
  } else {
    fb.className='settings-feedback err';
    fb.textContent='✗ Connection failed — check URL and key. Make sure you ran the SQL setup.';
  }
}

function addRole(val) { const v=(val||document.getElementById('new-role').value).trim(); if(!v||STATE.settings.roles.includes(v)) return; STATE.settings.roles.push(v); document.getElementById('new-role').value=''; save(); renderSettings(); }
function removeRole(r) { STATE.settings.roles=STATE.settings.roles.filter(x=>x!==r); save(); renderSettings(); }
function addLoc(val) { const v=(val||document.getElementById('new-loc').value).trim(); if(!v||STATE.settings.locations.includes(v)) return; STATE.settings.locations.push(v); document.getElementById('new-loc').value=''; save(); renderSettings(); }
function removeLoc(l) { STATE.settings.locations=STATE.settings.locations.filter(x=>x!==l); save(); renderSettings(); }
function saveInterval() { STATE.settings.interval=parseInt(document.getElementById('interval-sel').value); save(); }

// ── GMAIL ─────────────────────────────────────────────
function connectGmail() {
  document.getElementById('gmail-info').innerHTML=`
    <strong style="color:var(--text)">Setup:</strong><br>
    1. <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--blue)">console.cloud.google.com</a> → New project<br>
    2. Enable Gmail API → OAuth consent → Add your email<br>
    3. Credentials → OAuth Client ID (Web app)<br>
    4. Authorized origin: <code style="color:var(--accent)">https://sarangbang51.github.io</code><br>
    5. Paste Client ID:<br><br>
    <input class="settings-input" id="gclient-input" placeholder="Google Client ID..." style="margin-bottom:8px">
    <button class="btn-primary" onclick="initGmailAuth()" style="width:100%">Connect →</button>`;
}

function initGmailAuth() {
  const clientId = document.getElementById('gclient-input')?.value.trim();
  if (!clientId) { toast('Paste Client ID first'); return; }
  const script = document.createElement('script');
  script.src = 'https://apis.google.com/js/api.js';
  script.onload = () => {
    window.gapi.load('client:auth2', async () => {
      await window.gapi.client.init({ clientId, scope: 'https://www.googleapis.com/auth/gmail.readonly', discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'] });
      const auth = window.gapi.auth2.getAuthInstance();
      if (!auth.isSignedIn.get()) await auth.signIn();
      STATE.gmail.connected = true; STATE.gmail.email = auth.currentUser.get().getBasicProfile().getEmail();
      saveLocal(); updateGmailUI(); toast(`Gmail: ${STATE.gmail.email}`); startGmailScan();
    });
  };
  document.body.appendChild(script);
}

async function scanGmail() {
  if (!STATE.gmail.connected || !window.gapi?.client?.gmail) return;
  try {
    for (const q of ['subject:(interview) newer_than:30d','subject:(offer) newer_than:30d','subject:(unfortunately) newer_than:30d']) {
      const res = await window.gapi.client.gmail.users.messages.list({ userId: 'me', q, maxResults: 10 });
      for (const msg of (res.result.messages||[]).slice(0,6)) {
        const full = await window.gapi.client.gmail.users.messages.get({ userId:'me', id:msg.id, format:'metadata', metadataHeaders:['From','Subject'] });
        const h = full.result.payload.headers;
        processGmailMsg(h.find(x=>x.name==='Subject')?.value||'', h.find(x=>x.name==='From')?.value||'');
      }
    }
  } catch(e) { console.warn('Gmail scan error', e); }
}

function processGmailMsg(subject, from) {
  const s = subject.toLowerCase();
  let ns = null;
  if (s.match(/interview|call|schedule/)) ns = 'interview';
  else if (s.match(/offer|congratul/)) ns = 'offer';
  else if (s.match(/unfortunately|not moving|other candidate/)) ns = 'rejected';
  if (!ns) return;
  const domain = from.match(/@([\w.]+)/)?.[1]||'';
  const matched = Object.values(STATE.applications).find(a => {
    const co = (a.company||'').toLowerCase().replace(/[^a-z]/g,'');
    return domain.includes(co) || co.includes(domain.split('.')[0]);
  });
  if (matched && matched.status !== ns) {
    matched.status = ns; matched.gmailDetected = true;
    matched.activity.push({ date: new Date().toISOString(), text: `Auto via Gmail: "${subject}"`, auto: true });
    save(); updateCounts(); renderKanbanIfActive();
    toast(`✦ Gmail: ${matched.title} → ${ns}`);
    if (STATE.profile.ntfyTopic) sendNtfy(STATE.profile.ntfyTopic, `✦ ${matched.title} update`, `Status changed to ${ns} at ${matched.company}`);
  }
}

function startGmailScan() { scanGmail(); setInterval(scanGmail, 30*60*1000); }
function updateGmailUI() {
  const dot = document.getElementById('gmail-dot'), label = document.getElementById('gmail-label');
  if (STATE.gmail.connected) { dot?.classList.add('connected'); if(label) label.textContent = STATE.gmail.email||'Connected'; }
  else { dot?.classList.remove('connected'); if(label) label.textContent = 'Connect Gmail'; }
}

// ── AUTOCOMPLETE ──────────────────────────────────────
function setupAutocomplete(inputId, suggestions, onSelect) {
  const input = document.getElementById(inputId); if (!input) return;
  let dd = null;
  const removeDd = () => { if(dd){dd.remove();dd=null;} };
  input.addEventListener('input', () => {
    removeDd();
    const val = input.value.trim().toLowerCase(); if (!val) return;
    const matches = suggestions.filter(s => s.toLowerCase().includes(val)).slice(0,6);
    if (!matches.length) return;
    dd = document.createElement('div'); dd.className = 'autocomplete-dropdown';
    matches.forEach(m => {
      const item = document.createElement('div'); item.className = 'autocomplete-item'; item.textContent = m;
      item.onmousedown = (e) => { e.preventDefault(); input.value = m; removeDd(); if(onSelect) onSelect(m); };
      dd.appendChild(item);
    });
    input.parentNode.style.position = 'relative'; input.parentNode.appendChild(dd);
  });
  input.addEventListener('blur', () => setTimeout(removeDd, 150));
  input.addEventListener('keydown', e => {
    if (!dd) return;
    const items = dd.querySelectorAll('.autocomplete-item');
    const active = dd.querySelector('.active');
    if (e.key==='ArrowDown') { e.preventDefault(); const next=active?active.nextElementSibling:items[0]; if(active)active.classList.remove('active'); if(next)next.classList.add('active'); }
    else if (e.key==='ArrowUp') { e.preventDefault(); const prev=active?active.previousElementSibling:items[items.length-1]; if(active)active.classList.remove('active'); if(prev)prev.classList.add('active'); }
    else if (e.key==='Enter'&&active) { e.preventDefault(); input.value=active.textContent; removeDd(); if(onSelect)onSelect(active.textContent); }
    else if (e.key==='Escape') removeDd();
  });
}

// ── HELPERS ───────────────────────────────────────────
function generateId() { return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function esc(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatDate(iso) { if(!iso) return ''; try{return new Date(iso).toLocaleString();}catch{return iso;} }
function toast(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),3500); }

document.addEventListener('keydown', e => {
  if (e.key==='Escape') {
    document.getElementById('detail-modal').style.display='none';
    document.getElementById('log-modal').style.display='none';
    closeAIPanel();
  }
  if (e.key==='Enter') {
    if(document.activeElement?.id==='new-role') addRole();
    if(document.activeElement?.id==='new-loc') addLoc();
    if(document.activeElement?.id==='p-skill-input') addProfileSkill();
  }
});

// ── BOOT ──────────────────────────────────────────────
(async function init() {
  loadLocal();
  applyTheme(STATE.theme);
  updateGmailUI();
  updateCounts();

  // Show cached jobs immediately
  if (STATE.jobs.length > 0) {
    renderFeed();
    document.getElementById('feed-updated').textContent = `cached · ${new Date(STATE.jobs[0]?.fetchedAt||Date.now()).toLocaleTimeString()}`;
    document.getElementById('feed-updated-sidebar').textContent = `Last fetch: ${new Date(STATE.jobs[0]?.fetchedAt||Date.now()).toLocaleTimeString()}`;
  } else {
    showNoKeyBanner();
    document.getElementById('feed-loading').style.display = 'none';
    document.getElementById('job-grid').style.display = 'grid';
  }

  // Load from Supabase if connected
  if (STATE.settings.supabaseUrl && STATE.settings.supabaseKey) {
    setCloudStatus('syncing');
    const ok = await loadFromCloud();
    if (ok) { renderKanban(); renderFeed(); }
  } else {
    setCloudStatus('none');
  }

  // Fetch live jobs
  if (STATE.settings.apifyKey) setTimeout(() => fetchJobs(false), 1000);

  // Auto refresh
  setInterval(() => { if(STATE.settings.apifyKey) fetchJobs(false); }, (STATE.settings.interval||3600)*1000);

  // Autocomplete
  setTimeout(() => {
    setupAutocomplete('new-role', ROLE_SUGGESTIONS, val => addRole(val));
    setupAutocomplete('new-loc', LOCATION_SUGGESTIONS, val => addLoc(val));
    setupAutocomplete('p-skill-input', SKILL_SUGGESTIONS, null);
  }, 500);

  if (STATE.gmail.connected) setTimeout(startGmailScan, 2000);
  document.getElementById('fetch-count').textContent = STATE.fetchCount;
})();
