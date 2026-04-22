/* ═══════════════════════════════════════════════════
   HuntAI v4
   Fixes: correct actor names + inputs, redirect URLs
   New: ntfy.sh reminders, export/import, autocomplete,
        date filter, Supabase sync
   ═══════════════════════════════════════════════════ */

// ── ACTORS ─────────────────────────────────────────────
const ACTORS = {
  linkedin: 'curious_coder~linkedin-jobs-scraper',   // uses ~ not /
  google:   'jupri~google-jobs-scraper',              // Google Jobs = company sites + everywhere
};

// ── SUGGESTIONS DATA ─────────────────────────────────
const ROLE_SUGGESTIONS = [
  'Data Analyst','Senior Data Analyst','Junior Data Analyst',
  'Business Analyst','Senior Business Analyst','Junior Business Analyst',
  'BI Analyst','Business Intelligence Analyst',
  'Analytics Engineer','Senior Analytics Engineer',
  'Data Engineer','Senior Data Engineer','Junior Data Engineer',
  'Product Analyst','Marketing Analyst','Financial Analyst',
  'Operations Analyst','Quantitative Analyst','Risk Analyst',
  'Data Scientist','Machine Learning Engineer','SQL Analyst',
];

const LOCATION_SUGGESTIONS = [
  'Remote','London, UK','Manchester, UK','Birmingham, UK','Edinburgh, UK',
  'United States','New York, NY','San Francisco, CA','Chicago, IL',
  'Austin, TX','Seattle, WA','Boston, MA','Los Angeles, CA','Denver, CO',
  'India','Bengaluru, India','Mumbai, India','Hyderabad, India',
  'Delhi, India','Pune, India','Chennai, India','Gurugram, India',
  'Canada','Toronto, Canada','Vancouver, Canada',
  'Australia','Sydney, Australia','Melbourne, Australia',
  'Singapore','Dubai, UAE','Germany','Netherlands',
];

// ── STATE ─────────────────────────────────────────────
const STATE = {
  jobs: [],
  applications: {},
  profile: { yearsExp: '', skills: [], ntfyTopic: '' },
  settings: {
    apifyKey: '',
    roles: ['Data Analyst','Business Analyst','BI Analyst','Analytics Engineer','Data Engineer'],
    locations: ['Remote','United States','India'],
    interval: 3600,
    dateFilter: 'any',   // 'any' | '2h' | '24h' | '2d' | '7d'
    supabaseUrl: '',
    supabaseKey: '',
  },
  gmail: { connected: false, email: '' },
  fetchCount: 0,
  detailId: null,
  theme: 'dark',
  reminderInterval: null,
};

// ── PERSISTENCE ───────────────────────────────────────
function save() {
  try {
    localStorage.setItem('huntai_apps', JSON.stringify(STATE.applications));
    localStorage.setItem('huntai_settings', JSON.stringify(STATE.settings));
    localStorage.setItem('huntai_profile', JSON.stringify(STATE.profile));
    localStorage.setItem('huntai_gmail', JSON.stringify(STATE.gmail));
    localStorage.setItem('huntai_jobs', JSON.stringify(STATE.jobs.slice(0, 300)));
    localStorage.setItem('huntai_theme', STATE.theme);
  } catch(e) { console.warn('Save error', e); }
  if (STATE.settings.supabaseUrl && STATE.settings.supabaseKey) syncToSupabase();
}

function load() {
  try {
    const a = localStorage.getItem('huntai_apps'); if (a) STATE.applications = JSON.parse(a);
    const s = localStorage.getItem('huntai_settings'); if (s) STATE.settings = {...STATE.settings, ...JSON.parse(s)};
    const p = localStorage.getItem('huntai_profile'); if (p) STATE.profile = {...STATE.profile, ...JSON.parse(p)};
    const g = localStorage.getItem('huntai_gmail'); if (g) STATE.gmail = JSON.parse(g);
    const j = localStorage.getItem('huntai_jobs'); if (j) STATE.jobs = JSON.parse(j);
    const t = localStorage.getItem('huntai_theme'); if (t) STATE.theme = t;
  } catch(e) { console.warn('Load error', e); }
}

// ── THEME ─────────────────────────────────────────────
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

// ── SPONSORSHIP DETECTION ─────────────────────────────
function detectSponsorship(raw) {
  const text = [raw.jobDescription||'', raw.description||'', raw.descriptionText||'', raw.snippet||'', raw.jobDetails||''].join(' ').toLowerCase();
  if (!text || text.length < 60) return 'unknown';
  const YES = ['visa sponsorship available','sponsorship provided','we sponsor','will sponsor','open to sponsorship','can sponsor','h1b sponsor','h-1b sponsor','sponsorship offered','visa support','work authorization provided','open to visa','sponsorship considered','able to sponsor'];
  if (YES.some(p => text.includes(p))) return 'yes';
  const NO = ['no sponsorship','not able to sponsor','unable to sponsor','cannot sponsor','sponsorship not available','does not sponsor','will not sponsor','we do not sponsor','no visa sponsorship','must be authorized to work','must be legally authorized','must be eligible to work','no work visa','citizens or permanent residents','green card or citizenship','us citizen or','must be a us citizen','not eligible for sponsorship','work permit required'];
  if (NO.some(p => text.includes(p))) return 'no';
  return 'unknown';
}

function sponsorshipLabel(s) {
  if (s === 'yes') return { text: '✦ Sponsors visas', cls: 'sponsor-yes' };
  if (s === 'no')  return { text: '✗ No sponsorship', cls: 'sponsor-no' };
  return { text: '? Sponsorship unknown', cls: 'sponsor-unknown' };
}

// ── DATE FILTER HELPER ────────────────────────────────
function withinDateFilter(postedAt, filter) {
  if (!filter || filter === 'any') return true;
  if (!postedAt) return true; // unknown date — show it
  const posted = new Date(postedAt).getTime();
  const now = Date.now();
  const diff = now - posted;
  if (filter === '2h'  && diff > 2  * 3600 * 1000) return false;
  if (filter === '24h' && diff > 24 * 3600 * 1000) return false;
  if (filter === '2d'  && diff > 2  * 86400 * 1000) return false;
  if (filter === '7d'  && diff > 7  * 86400 * 1000) return false;
  return true;
}

// ── JOB FETCHING ─────────────────────────────────────
async function fetchJobs(manual = false) {
  const key = STATE.settings.apifyKey;
  if (!key) { if (manual) showNoKeyBanner(); return; }

  document.getElementById('feed-loading').style.display = 'flex';
  document.getElementById('feed-empty').style.display = 'none';
  setLoadingSub('Starting Google Jobs + LinkedIn scrapers...');

  const allJobs = [];
  let completed = 0;

  // Build search pairs
  const pairs = [];
  for (const role of STATE.settings.roles) {
    for (const loc of STATE.settings.locations) {
      let q = role;
      if (STATE.profile.yearsExp) {
        const y = parseInt(STATE.profile.yearsExp);
        if (y <= 2) q += ' entry level'; else if (y >= 6) q += ' senior';
      }
      pairs.push({ query: q, location: loc, role });
    }
  }

  // Run ALL in parallel — Google Jobs primary, LinkedIn fallback
  await Promise.all(pairs.map(async ({ query, location, role }) => {
    try {
      // 1st: Google Jobs (covers company sites, Greenhouse, Lever, Workday, Indeed etc)
      let jobs = await runGoogleJobsScraper(key, query, location);

      // 2nd: LinkedIn scraper as fallback/supplement
      const linkedInJobs = await runLinkedInScraper(key, query, location);
      if (linkedInJobs && linkedInJobs.length) {
        jobs = [...(jobs || []), ...linkedInJobs];
      }

      if (jobs && jobs.length) {
        jobs.forEach(j => allJobs.push(j));
      }

      completed++;
      setLoadingSub(`${completed}/${pairs.length} searches done — ${allJobs.length} jobs found`);
      if (allJobs.length > 0) { STATE.jobs = dedup(allJobs); renderFeed(); }
    } catch(e) { console.warn(`Failed: ${query} in ${location}`, e); }
  }));

  STATE.jobs = dedup(allJobs);
  STATE.fetchCount++;
  document.getElementById('fetch-count').textContent = STATE.fetchCount;
  const updatedMsg = `updated ${new Date().toLocaleTimeString()} · ${STATE.jobs.length} jobs`;
  document.getElementById('feed-updated').textContent = updatedMsg;
  document.getElementById('feed-updated-sidebar').textContent = `Last fetch: ${new Date().toLocaleTimeString()}`;
  save();
  renderFeed();
  document.getElementById('feed-loading').style.display = 'none';
  document.getElementById('job-grid').style.display = 'grid';

  if (allJobs.length > 0) toast(`✓ Fetched ${STATE.jobs.length} jobs from Google Jobs + LinkedIn`);
  else if (manual) toast('No jobs returned — see Settings to verify your Apify key');
}

// ── LINKEDIN SCRAPER ─────────────────────────────────
// curious_coder actor requires urls[] array of LinkedIn search URLs
// Error "input.urls is required" confirmed this format
async function runLinkedInScraper(key, query, location) {
  try {
    // Build LinkedIn job search URL — this is what the actor needs
    const searchUrl = buildLinkedInSearchUrl(query, location);
    const body = {
      urls: [{ url: searchUrl }],  // ← REQUIRED: array of LinkedIn URLs
      maxItems: 25,
      saveOnlyUniqueItems: true,
      proxy: { useApifyProxy: true },
    };

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTORS.linkedin)}/runs`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }, body: JSON.stringify(body) }
    );

    if (!runRes.ok) {
      const err = await runRes.json().catch(() => ({}));
      console.warn('LinkedIn scraper failed:', runRes.status, err?.error?.message);
      return null;
    }

    const { data } = await runRes.json();
    if (!data?.id) return null;
    const items = await pollAndFetch(key, data.id, data.defaultDatasetId);
    return items.map(r => normalizeLinkedInJob(r, query));
  } catch(e) { console.warn('LinkedIn scraper error:', e.message); return null; }
}

// Build LinkedIn job search URL from role + location
function buildLinkedInSearchUrl(query, location) {
  const kw = encodeURIComponent(query);
  const loc = encodeURIComponent(location);
  // f_TPR=r86400 = posted in last 24h, f_WT=2 = remote
  let url = `https://www.linkedin.com/jobs/search/?keywords=${kw}&location=${loc}&f_TPR=r86400&start=0`;
  if (location.toLowerCase() === 'remote') url += '&f_WT=2';
  return url;
}

// ── GOOGLE JOBS SCRAPER ───────────────────────────────
// Covers company career pages, Greenhouse, Lever, Workday, Indeed, Glassdoor
// = the "search everywhere including company websites" feature
async function runGoogleJobsScraper(key, query, location) {
  try {
    const body = {
      query: `${query} ${location} jobs`,   // Google Jobs search string
      maxResults: 20,
      country: locationToCountryCode(location),
      language: 'en',
      proxy: { useApifyProxy: true },
    };

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTORS.google)}/runs`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }, body: JSON.stringify(body) }
    );

    if (!runRes.ok) {
      console.warn('Google Jobs scraper failed:', runRes.status);
      return null;
    }

    const { data } = await runRes.json();
    if (!data?.id) return null;
    const items = await pollAndFetch(key, data.id, data.defaultDatasetId);
    return items.map(r => normalizeLinkedInJob(r, query)); // same normalizer works
  } catch(e) { console.warn('Google Jobs scraper error:', e.message); return null; }
}

function locationToCountryCode(location) {
  const l = location.toLowerCase();
  if (l.includes('india') || l.includes('bengaluru') || l.includes('mumbai') || l.includes('hyderabad')) return 'IN';
  if (l.includes('uk') || l.includes('london') || l.includes('manchester')) return 'GB';
  if (l.includes('canada') || l.includes('toronto') || l.includes('vancouver')) return 'CA';
  if (l.includes('australia') || l.includes('sydney') || l.includes('melbourne')) return 'AU';
  return 'US'; // default
}

// Bebity scraper removed — using Google Jobs + LinkedIn instead

// ── POLL & FETCH DATASET ──────────────────────────────
async function pollAndFetch(key, runId, datasetId, maxPolls = 45) {
  let status = 'RUNNING', polls = 0;
  while ((status === 'RUNNING' || status === 'READY' || status === 'ABORTING') && polls < maxPolls) {
    await sleep(3000); polls++;
    try {
      const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`,
        { headers: { 'Authorization': `Bearer ${key}` } });
      const d = await r.json();
      status = d.data?.status;
      const count = d.data?.stats?.itemCount || 0;
      if (count > 0) setLoadingSub(`Found ${count} jobs in this batch...`);
    } catch { break; }
  }
  if (status !== 'SUCCEEDED') { console.warn('Actor ended with status:', status); return []; }
  const r = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&limit=25`,
    { headers: { 'Authorization': `Bearer ${key}` } }
  );
  const items = await r.json();
  return Array.isArray(items) ? items : [];
}

// ── NORMALIZER ────────────────────────────────────────
function normalizeLinkedInJob(raw, qFallback) {
  const desc = raw.jobDescription || raw.description || raw.descriptionText || raw.snippet || '';

  // Build the best possible URL with multiple fallbacks
  let url = raw.jobUrl || raw.applyUrl || raw.url || raw.linkedinJobUrl || raw.externalApplyUrl || '';
  // If URL is a LinkedIn redirect, use it directly (followApplyRedirects handles it)
  // If no URL at all, build a LinkedIn search URL
  if (!url || url === '#') {
    const title = encodeURIComponent(raw.jobTitle || raw.title || qFallback || 'analyst');
    const co = encodeURIComponent(raw.companyName || raw.company || '');
    url = `https://www.linkedin.com/jobs/search/?keywords=${title}${co ? `+${co}` : ''}`;
  }

  return {
    id: raw.id || raw.jobId || raw.jobPostingId || generateId(),
    title: raw.jobTitle || raw.title || raw.position || qFallback || 'Analyst',
    company: raw.companyName || raw.company || raw.employer || 'Unknown',
    location: raw.jobLocation || raw.location || raw.locationName || 'Remote',
    source: detectSource(raw, url),
    type: raw.jobType || raw.employmentType || guessType(desc),
    salary: raw.salaryRange || raw.salary || raw.salaryText || extractSalary(desc),
    applicants: raw.numberOfApplicants || raw.applicants || raw.applyCount || null,
    skills: extractSkills(desc),
    description: desc,
    sponsorship: detectSponsorship(raw),
    url,
    postedAt: raw.postedAt || raw.publishedAt || raw.datePosted || new Date().toISOString(),
    postedLabel: timeAgo(raw.postedAt || raw.publishedAt || raw.datePosted),
    level: guessLevel(raw.jobTitle || raw.title || qFallback || ''),
    fetchedAt: Date.now(),
  };
}

function detectSource(raw, url) {
  const u = (url || '').toLowerCase();
  const via = (raw.via || raw.source || raw.jobSource || '').toLowerCase();
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
  return 'LinkedIn';
}

function extractSkills(text) {
  if (!text) return [];
  const t = text.toLowerCase();
  const known = ['SQL','Python','Tableau','Power BI','Excel','Looker','dbt','BigQuery','Snowflake','Spark','R','Pandas','AWS','Azure','GCP','Databricks','Airflow','Jira','Confluence','Kafka','SAP','Redshift','DAX','SSRS','Scala','Alteryx'];
  return known.filter(s => t.includes(s.toLowerCase())).slice(0, 5);
}

function extractSalary(text) {
  if (!text) return null;
  const m = text.match(/\$[\d,]+k?\s*[-–]\s*\$[\d,]+k?/i) || text.match(/£[\d,]+k?\s*[-–]\s*£[\d,]+k?/i) || text.match(/₹[\d,]+\s*[-–]\s*₹[\d,]+/i);
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
  if (t.includes('senior') || t.includes('sr.') || t.includes('sr ')) return 'Senior';
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
  return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
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
    <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.7">
      Fetches from LinkedIn, Indeed, Greenhouse, Lever, Workday and more via Apify scrapers.
    </div>
    <button class="btn-primary" onclick="showPanel('settings')">Open Settings →</button>
  </div>`;
}

// ── PROFILE / MATCH SCORE ─────────────────────────────
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
      if (loc === 'UK' && !jloc.match(/uk|united kingdom|london|manchester|birmingham|edinburgh/i)) return false;
    }
    if (sponsorF === 'yes' && j.sponsorship !== 'yes') return false;
    if (sponsorF === 'no' && j.sponsorship !== 'no') return false;
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
    const hasUrl = j.url && j.url !== '#';

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
        ${j.applicants ? (isHot ? `<span class="meta-pill hot">🔥 ${j.applicants} applicants</span>` : `<span class="meta-pill">${j.applicants} applicants</span>`) : ''}
        <span class="meta-pill">${esc(j.postedLabel || 'recently')}</span>
      </div>
      <div style="margin-bottom:8px">
        <span class="sponsor-pill ${sp.cls}">${sp.text}</span>
      </div>
      ${j.skills?.length ? `<div class="jc-skills">${j.skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="jc-actions">
        <button class="btn-apply-card ${isLogged ? 'logged' : ''}" onclick="handleApply('${j.id}')">
          ${isLogged ? '✓ Logged' : 'Log Application'}
        </button>
        <button class="btn-save-card ${isSaved ? 'saved' : ''}" onclick="handleSave('${j.id}')" title="Save for later">
          ${isSaved ? '★' : '☆'}
        </button>
        ${hasUrl ? `<a href="${esc(j.url)}" target="_blank" rel="noopener" class="btn-link-card" title="Open job posting">↗ Open</a>` : ''}
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
  // Open the job URL in new tab
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
    activity: [{ date: new Date().toISOString(), text: 'Saved for later', auto: false }], notes: '',
    savedAt: new Date().toISOString() };
  updateCounts(); save(); renderFeed(); renderKanbanIfActive();
  toast(`Saved: ${job.title} — reminder in 24h if not applied`);
  scheduleNtfyReminder(job);
}

function deleteApplication(id) {
  if (!STATE.applications[id]) return;
  const app = STATE.applications[id];
  if (!confirm(`Delete "${app.title} at ${app.company}"?\nThis cannot be undone.`)) return;
  delete STATE.applications[id];
  save(); updateCounts(); renderKanban(); renderStats(); renderFeed();
  document.getElementById('detail-modal').style.display = 'none';
  STATE.detailId = null;
  toast('Application deleted');
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
    activity: [{ date: now.toISOString(), text: `Manually logged`, auto: false }] };
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
  // Show open link in modal
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
    `<div class="timeline-item"><div class="tl-dot ${a.auto ? 'auto' : ''}"></div>
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
  const groups = { saved:[], applied:[], interview:[], offer:[], rejected:[] };
  Object.values(STATE.applications).forEach(a => (groups[a.status] || groups.applied).push(a));
  ['saved','applied','interview','offer','rejected'].forEach(status => {
    const el = document.getElementById('k-' + status); if (!el) return;
    el.innerHTML = groups[status].sort((a,b) => new Date(b.appliedAt)-new Date(a.appliedAt)).map(app => {
      const sp = sponsorshipLabel(app.sponsorship || 'unknown');
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
  const counts = { saved:0, applied:0, interview:0, offer:0, rejected:0 };
  Object.values(STATE.applications).forEach(a => counts[a.status] = (counts[a.status]||0)+1);
  ['saved','applied','interview','offer','rejected'].forEach(s => { const el=document.getElementById('kc-'+s); if(el) el.textContent=counts[s]||0; });
  document.getElementById('badge-track').textContent = Object.keys(STATE.applications).length;
}

// ── NTFY.SH PHONE REMINDERS ──────────────────────────
function scheduleNtfyReminder(job) {
  const topic = STATE.profile.ntfyTopic;
  if (!topic) return;
  // Schedule reminder 24h after saving
  setTimeout(() => {
    const app = STATE.applications[job.id];
    // Only remind if still 'saved' (not yet applied)
    if (app && app.status === 'saved') {
      sendNtfyNotification(topic,
        `⏰ Reminder: Apply to ${job.title}`,
        `You saved "${job.title}" at ${job.company} 24 hours ago. Don't forget to apply!\n\n${job.url || ''}`
      );
    }
  }, 24 * 60 * 60 * 1000);
}

async function sendNtfyNotification(topic, title, message) {
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': 'default',
        'Tags': 'briefcase',
        'Content-Type': 'text/plain',
      },
      body: message,
    });
    console.log('Ntfy notification sent:', title);
  } catch(e) { console.warn('Ntfy error:', e.message); }
}

function testNtfy() {
  const topic = document.getElementById('ntfy-topic').value.trim();
  if (!topic) { toast('Enter your ntfy topic first'); return; }
  STATE.profile.ntfyTopic = topic;
  save();
  sendNtfyNotification(topic,
    '✅ HuntAI Connected!',
    'Your phone reminders are set up. You will be notified 24h after saving a job if you have not applied yet.'
  );
  toast('Test notification sent — check your phone!');
}

// ── EXPORT / IMPORT DATA ─────────────────────────────
function exportData() {
  const data = {
    exported: new Date().toISOString(),
    version: 4,
    applications: STATE.applications,
    settings: { ...STATE.settings, apifyKey: '' }, // don't export key
    profile: STATE.profile,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `huntai-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  toast('Data exported — save this file safely');
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
      if (data.settings) STATE.settings = { ...STATE.settings, ...data.settings, apifyKey: STATE.settings.apifyKey };
      save(); updateCounts(); renderKanban(); renderStats();
      toast(`Imported ${Object.keys(data.applications||{}).length} applications`);
    } catch(e) { toast('Import failed — invalid file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── SUPABASE SYNC ─────────────────────────────────────
async function syncToSupabase() {
  const { supabaseUrl, supabaseKey } = STATE.settings;
  if (!supabaseUrl || !supabaseKey) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/huntai_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: 'main',
        applications: JSON.stringify(STATE.applications),
        profile: JSON.stringify(STATE.profile),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch(e) { console.warn('Supabase sync error:', e.message); }
}

async function loadFromSupabase() {
  const { supabaseUrl, supabaseKey } = STATE.settings;
  if (!supabaseUrl || !supabaseKey) { toast('Add Supabase URL and key first'); return; }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/huntai_data?id=eq.main&select=*`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const rows = await r.json();
    if (rows?.[0]) {
      STATE.applications = JSON.parse(rows[0].applications || '{}');
      STATE.profile = { ...STATE.profile, ...JSON.parse(rows[0].profile || '{}') };
      save(); updateCounts(); renderKanban(); renderStats();
      toast(`Synced from cloud — ${Object.keys(STATE.applications).length} applications loaded`);
    } else { toast('No cloud data found yet'); }
  } catch(e) { toast('Supabase sync failed — check URL and key'); }
}

function saveSupabaseSettings() {
  STATE.settings.supabaseUrl = document.getElementById('sb-url').value.trim().replace(/\/$/, '');
  STATE.settings.supabaseKey = document.getElementById('sb-key').value.trim();
  save();
  toast('Supabase settings saved — syncing now...');
  syncToSupabase();
}

// ── AUTOCOMPLETE ──────────────────────────────────────
function setupAutocomplete(inputId, suggestions, onSelect) {
  const input = document.getElementById(inputId); if (!input) return;
  let dropdown = null;

  function removeDropdown() { if (dropdown) { dropdown.remove(); dropdown = null; } }

  input.addEventListener('input', () => {
    removeDropdown();
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    const matches = suggestions.filter(s => s.toLowerCase().includes(val)).slice(0, 6);
    if (!matches.length) return;

    dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    matches.forEach(m => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = m;
      item.onmousedown = (e) => { e.preventDefault(); input.value = m; removeDropdown(); if (onSelect) onSelect(m); };
      dropdown.appendChild(item);
    });

    input.parentNode.style.position = 'relative';
    input.parentNode.appendChild(dropdown);
  });

  input.addEventListener('blur', () => setTimeout(removeDropdown, 150));
  input.addEventListener('keydown', e => {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.autocomplete-item');
    const active = dropdown.querySelector('.autocomplete-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? active.nextElementSibling : items[0];
      if (active) active.classList.remove('active');
      if (next) next.classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? active.previousElementSibling : items[items.length-1];
      if (active) active.classList.remove('active');
      if (prev) prev.classList.add('active');
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      input.value = active.textContent;
      removeDropdown();
      if (onSelect) onSelect(active.textContent);
    } else if (e.key === 'Escape') { removeDropdown(); }
  });
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
  const thisWeek = applied.filter(a => new Date(a.appliedAt) >= weekStart).length;

  document.getElementById('st-total').textContent = applied.length;
  document.getElementById('st-week').textContent = `this week: ${thisWeek}`;
  document.getElementById('st-rate').textContent = rate + '%';
  document.getElementById('st-rate-d').textContent = `${interviews} interviews + ${offers} offers`;
  document.getElementById('st-inter').textContent = interviews;
  document.getElementById('st-offer').textContent = offers;

  const spYes=applied.filter(a=>a.sponsorship==='yes').length;
  const spNo=applied.filter(a=>a.sponsorship==='no').length;
  const spUnk=applied.filter(a=>!a.sponsorship||a.sponsorship==='unknown').length;
  const spEl=document.getElementById('st-sponsor');
  if (spEl) spEl.innerHTML=`<span class="sponsor-yes">✦ ${spYes} sponsor</span> &nbsp;<span class="sponsor-no">✗ ${spNo} no</span> &nbsp;<span class="sponsor-unknown">? ${spUnk} unknown</span>`;

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
  if (roleEntries.length) {
    donutSvg.innerHTML=roleEntries.map(([,count],i)=>{
      const pct=count/total,s=cum*Math.PI*2-Math.PI/2;cum+=pct;const e=cum*Math.PI*2-Math.PI/2;
      const r=45,cx=60,cy=60,x1=cx+r*Math.cos(s),y1=cy+r*Math.sin(s),x2=cx+r*Math.cos(e),y2=cy+r*Math.sin(e);
      return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${pct>.5?1:0},1 ${x2},${y2} Z" fill="${colors[i]}" opacity="0.85"/>`;
    }).join('')+`<circle cx="60" cy="60" r="28" fill="var(--surface)"/><text x="60" y="64" text-anchor="middle" font-size="14" fill="var(--text)">${total}</text>`;
  } else {
    donutSvg.innerHTML=`<circle cx="60" cy="60" r="45" fill="var(--surface2)"/><circle cx="60" cy="60" r="28" fill="var(--surface)"/><text x="60" y="64" text-anchor="middle" font-size="12" fill="var(--muted)">No data</text>`;
  }
  document.getElementById('donut-legend').innerHTML=roleEntries.map(([role,count],i)=>`
    <div class="legend-row"><div class="legend-dot" style="background:${colors[i]}"></div><span>${role.split(' ').slice(0,2).join(' ')} (${count})</span></div>`).join('');

  const statuses=[{label:'Applied',count:applied.length,color:'#6366f1'},{label:'Interview',count:interviews,color:'#f5a623'},{label:'Offer',count:offers,color:'#34d399'}];
  const maxF=Math.max(applied.length,1);
  document.getElementById('chart-funnel').innerHTML=statuses.map(s=>`
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

// ── SETTINGS ──────────────────────────────────────────
function renderSettings() {
  const ki=document.getElementById('apify-key-input'); if(ki) ki.value=STATE.settings.apifyKey||'';
  const ii=document.getElementById('interval-sel'); if(ii) ii.value=STATE.settings.interval;
  document.getElementById('p-exp').value=STATE.profile.yearsExp||'';
  document.getElementById('ntfy-topic').value=STATE.profile.ntfyTopic||'';
  const sbUrl=document.getElementById('sb-url'); if(sbUrl) sbUrl.value=STATE.settings.supabaseUrl||'';
  const sbKey=document.getElementById('sb-key'); if(sbKey) sbKey.value=STATE.settings.supabaseKey||'';
  renderProfileSkills();
  document.getElementById('role-tags').innerHTML=STATE.settings.roles.map(r=>`<span class="role-tag">${esc(r)}<span class="role-tag-remove" onclick="removeRole('${esc(r)}')">×</span></span>`).join('');
  document.getElementById('loc-tags').innerHTML=STATE.settings.locations.map(l=>`<span class="role-tag">${esc(l)}<span class="role-tag-remove" onclick="removeLoc('${esc(l)}')">×</span></span>`).join('');
  updateGmailUI();
}

function renderProfileSkills() {
  const el=document.getElementById('profile-skill-tags'); if(!el) return;
  el.innerHTML=STATE.profile.skills.map(s=>`<span class="role-tag">${esc(s)}<span class="role-tag-remove" onclick="removeProfileSkill('${esc(s)}')">×</span></span>`).join('');
}

function saveProfile() {
  STATE.profile.yearsExp=document.getElementById('p-exp').value.trim();
  save(); renderFeed();
  toast('Profile saved');
}

function addProfileSkill() {
  const v=document.getElementById('p-skill-input').value.trim();
  if (!v||STATE.profile.skills.map(s=>s.toLowerCase()).includes(v.toLowerCase())) return;
  STATE.profile.skills.push(v); document.getElementById('p-skill-input').value='';
  save(); renderProfileSkills(); renderFeed();
}

function removeProfileSkill(s) { STATE.profile.skills=STATE.profile.skills.filter(x=>x!==s); save(); renderProfileSkills(); renderFeed(); }

function saveApifySettings() {
  const keyVal=document.getElementById('apify-key-input').value.trim();
  const fb=document.getElementById('apify-feedback');
  if (!keyVal||!keyVal.startsWith('apify_api_')) {
    fb.className='settings-feedback err'; fb.textContent='✗ Key must start with apify_api_'; fb.style.display='block'; return;
  }
  STATE.settings.apifyKey=keyVal; save();
  fb.className='settings-feedback ok'; fb.textContent='✓ Key saved. Fetching jobs now...'; fb.style.display='block';
  setTimeout(()=>{fb.style.display='none';},4000);
  fetchJobs(true);
}

function revokeApifyKey() { STATE.settings.apifyKey=''; save(); document.getElementById('apify-key-input').value=''; toast('Key removed'); }
function addRole(val) { const v=(val||document.getElementById('new-role').value).trim(); if(!v||STATE.settings.roles.includes(v)) return; STATE.settings.roles.push(v); document.getElementById('new-role').value=''; save(); renderSettings(); }
function removeRole(r) { STATE.settings.roles=STATE.settings.roles.filter(x=>x!==r); save(); renderSettings(); }
function addLoc(val) { const v=(val||document.getElementById('new-loc').value).trim(); if(!v||STATE.settings.locations.includes(v)) return; STATE.settings.locations.push(v); document.getElementById('new-loc').value=''; save(); renderSettings(); }
function removeLoc(l) { STATE.settings.locations=STATE.settings.locations.filter(x=>x!==l); save(); renderSettings(); }
function saveInterval() { STATE.settings.interval=parseInt(document.getElementById('interval-sel').value); save(); }

// ── GMAIL ─────────────────────────────────────────────
function connectGmail() {
  document.getElementById('gmail-info').innerHTML=`
    <strong style="color:var(--text)">Setup steps:</strong><br><br>
    1. <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--blue)">console.cloud.google.com</a> → New project<br>
    2. Enable Gmail API → OAuth consent → Add your Gmail<br>
    3. Credentials → OAuth Client ID (Web app)<br>
    4. Authorized JS origin: <code style="color:var(--accent)">https://sarangbang51.github.io</code><br>
    5. Paste your Client ID below:<br><br>
    <input class="settings-input" id="gclient-input" placeholder="Paste Google Client ID..." style="margin-bottom:8px">
    <button class="btn-primary" onclick="initGmailAuth()" style="width:100%">Connect Gmail →</button>`;
}

function initGmailAuth() {
  const clientId=document.getElementById('gclient-input')?.value.trim();
  if (!clientId) { toast('Paste Client ID first'); return; }
  const script=document.createElement('script');
  script.src='https://apis.google.com/js/api.js';
  script.onload=()=>{
    window.gapi.load('client:auth2',async()=>{
      await window.gapi.client.init({clientId,scope:'https://www.googleapis.com/auth/gmail.readonly',discoveryDocs:['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest']});
      const auth=window.gapi.auth2.getAuthInstance();
      if (!auth.isSignedIn.get()) await auth.signIn();
      STATE.gmail.connected=true; STATE.gmail.email=auth.currentUser.get().getBasicProfile().getEmail();
      save(); updateGmailUI(); toast(`Gmail: ${STATE.gmail.email}`); startGmailScan();
    });
  };
  document.body.appendChild(script);
}

async function scanGmail() {
  if (!STATE.gmail.connected||!window.gapi?.client?.gmail) return;
  try {
    for (const q of ['subject:(interview) newer_than:30d','subject:(offer) newer_than:30d','subject:(unfortunately) newer_than:30d']) {
      const res=await window.gapi.client.gmail.users.messages.list({userId:'me',q,maxResults:10});
      for (const msg of (res.result.messages||[]).slice(0,6)) {
        const full=await window.gapi.client.gmail.users.messages.get({userId:'me',id:msg.id,format:'metadata',metadataHeaders:['From','Subject','Date']});
        const h=full.result.payload.headers;
        processGmailMessage(h.find(x=>x.name==='Subject')?.value||'',h.find(x=>x.name==='From')?.value||'');
      }
    }
  } catch(e) { console.warn('Gmail scan',e); }
}

function processGmailMessage(subject, from) {
  const s=subject.toLowerCase();
  let ns=null;
  if (s.match(/interview|call|schedule/)) ns='interview';
  else if (s.match(/offer|congratul/)) ns='offer';
  else if (s.match(/unfortunately|not moving|other candidate/)) ns='rejected';
  if (!ns) return;
  const domain=from.match(/@([\w.]+)/)?.[1]||'';
  const matched=Object.values(STATE.applications).find(a=>{
    const co=(a.company||'').toLowerCase().replace(/[^a-z]/g,'');
    return domain.includes(co)||co.includes(domain.split('.')[0]);
  });
  if (matched&&matched.status!==ns) {
    matched.status=ns; matched.gmailDetected=true;
    matched.activity.push({date:new Date().toISOString(),text:`Auto via Gmail: "${subject}"`,auto:true});
    save(); updateCounts(); renderKanbanIfActive();
    toast(`✦ Gmail: ${matched.title} → ${ns}`);
    if (STATE.profile.ntfyTopic) sendNtfyNotification(STATE.profile.ntfyTopic, `✦ Application Update: ${matched.title}`, `Status changed to ${ns} at ${matched.company}`);
  }
}

function startGmailScan() { scanGmail(); setInterval(scanGmail,30*60*1000); }
function updateGmailUI() {
  const dot=document.getElementById('gmail-dot'),label=document.getElementById('gmail-label');
  if (STATE.gmail.connected) { dot?.classList.add('connected'); if(label) label.textContent=STATE.gmail.email||'Connected'; }
  else { dot?.classList.remove('connected'); if(label) label.textContent='Connect Gmail'; }
}

// ── HELPERS ───────────────────────────────────────────
function generateId() { return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function esc(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function formatDate(iso) { if(!iso) return ''; try{return new Date(iso).toLocaleString();}catch{return iso;} }
function toast(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),3500); }

document.addEventListener('keydown', e => {
  if (e.key==='Escape') { document.getElementById('detail-modal').style.display='none'; document.getElementById('log-modal').style.display='none'; }
  if (e.key==='Enter') {
    if (document.activeElement?.id==='new-role') addRole();
    if (document.activeElement?.id==='new-loc') addLoc();
    if (document.activeElement?.id==='p-skill-input') addProfileSkill();
  }
});

// ── BOOT ──────────────────────────────────────────────
(function init() {
  load();
  applyTheme(STATE.theme);
  updateGmailUI();
  updateCounts();

  if (STATE.jobs.length > 0) {
    renderFeed();
    document.getElementById('feed-updated').textContent = `cached · ${new Date(STATE.jobs[0]?.fetchedAt||Date.now()).toLocaleTimeString()}`;
    document.getElementById('feed-updated-sidebar').textContent = `Last fetch: ${new Date(STATE.jobs[0]?.fetchedAt||Date.now()).toLocaleTimeString()}`;
  } else {
    showNoKeyBanner();
    document.getElementById('feed-loading').style.display = 'none';
    document.getElementById('job-grid').style.display = 'grid';
  }

  // Fetch live in background if key exists
  if (STATE.settings.apifyKey) setTimeout(() => fetchJobs(false), 800);

  // Silent auto-refresh
  setInterval(() => { if (STATE.settings.apifyKey) fetchJobs(false); }, (STATE.settings.interval||3600)*1000);

  // Setup autocomplete after DOM ready
  setTimeout(() => {
    setupAutocomplete('new-role', ROLE_SUGGESTIONS, val => addRole(val));
    setupAutocomplete('new-loc', LOCATION_SUGGESTIONS, val => addLoc(val));
    setupAutocomplete('p-skill-input', ['SQL','Python','Tableau','Power BI','Excel','Looker','dbt','BigQuery','Snowflake','Spark','R','Pandas','AWS','Azure','GCP','Databricks','Airflow','Jira','Alteryx','SAP','Redshift','Scala','DAX'], null);
  }, 500);

  if (STATE.gmail.connected) setTimeout(startGmailScan, 2000);
  document.getElementById('fetch-count').textContent = STATE.fetchCount;
})();
