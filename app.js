/* ═══════════════════════════════════════════════════
   HuntAI v3 — app.js
   ═══════════════════════════════════════════════════ */

const STATE = {
  jobs: [],
  applications: {},
  profile: { yearsExp: '', skills: [], needsSponsorship: false },
  settings: {
    apifyKey: '',
    roles: ['Data Analyst','Business Analyst','BI Analyst','Analytics Engineer','Data Engineer'],
    locations: ['Remote','United States','India'],
    interval: 3600,
  },
  gmail: { connected: false, email: '' },
  activeSrcs: new Set(['LinkedIn','Indeed','Glassdoor','Wellfound','Greenhouse','Company Site','Google Jobs']),
  fetchCount: 0,
  detailId: null,
  theme: 'dark',
};

// ── PERSISTENCE ──────────────────────────────────────
function save() {
  try {
    localStorage.setItem('huntai_apps', JSON.stringify(STATE.applications));
    localStorage.setItem('huntai_settings', JSON.stringify(STATE.settings));
    localStorage.setItem('huntai_profile', JSON.stringify(STATE.profile));
    localStorage.setItem('huntai_gmail', JSON.stringify(STATE.gmail));
    localStorage.setItem('huntai_jobs', JSON.stringify(STATE.jobs.slice(0,300)));
    localStorage.setItem('huntai_theme', STATE.theme);
  } catch(e) { console.warn('Save error',e); }
}

function load() {
  try {
    const a = localStorage.getItem('huntai_apps'); if (a) STATE.applications = JSON.parse(a);
    const s = localStorage.getItem('huntai_settings'); if (s) STATE.settings = {...STATE.settings,...JSON.parse(s)};
    const p = localStorage.getItem('huntai_profile'); if (p) STATE.profile = {...STATE.profile,...JSON.parse(p)};
    const g = localStorage.getItem('huntai_gmail'); if (g) STATE.gmail = JSON.parse(g);
    const j = localStorage.getItem('huntai_jobs'); if (j) STATE.jobs = JSON.parse(j);
    const t = localStorage.getItem('huntai_theme'); if (t) STATE.theme = t;
  } catch(e) { console.warn('Load error',e); }
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

// ── PANEL NAVIGATION ─────────────────────────────────
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
  const text = [raw.jobDescription||'', raw.description||'', raw.descriptionText||'', raw.snippet||''].join(' ').toLowerCase();
  if (!text || text.length < 60) return 'unknown';

  const YES = ['visa sponsorship available','sponsorship provided','we sponsor','will sponsor','open to sponsorship',
    'can sponsor','h1b sponsor','h-1b sponsor','sponsorship offered','visa support','work authorization provided',
    'open to visa','sponsorship considered'];
  if (YES.some(p => text.includes(p))) return 'yes';

  const NO = ['no sponsorship','not able to sponsor','unable to sponsor','cannot sponsor','sponsorship not available',
    'does not sponsor','will not sponsor','we do not sponsor','no visa sponsorship','must be authorized to work',
    'must be legally authorized','must be eligible to work','candidates must have work authorization',
    'no work visa','citizens or permanent residents','green card or citizenship','us citizen or',
    'must be a us citizen','not eligible for sponsorship'];
  if (NO.some(p => text.includes(p))) return 'no';

  return 'unknown';
}

function sponsorshipLabel(status) {
  if (status === 'yes') return { text: '✦ Sponsors visas', cls: 'sponsor-yes' };
  if (status === 'no')  return { text: '✗ No sponsorship', cls: 'sponsor-no' };
  return { text: '? Sponsorship unknown', cls: 'sponsor-unknown' };
}

// ── JOB FETCHING ──────────────────────────────────────
async function fetchJobs(manual = false) {
  const key = STATE.settings.apifyKey;
  if (!key) { if (manual) showNoKeyBanner(); return; }

  document.getElementById('feed-loading').style.display = 'flex';
  setLoadingSub('Queuing searches across Google Jobs + LinkedIn...');

  const allJobs = [];
  let completed = 0;

  const queries = [];
  for (const role of STATE.settings.roles) {
    for (const loc of STATE.settings.locations) {
      let q = role;
      if (STATE.profile.yearsExp) {
        const y = parseInt(STATE.profile.yearsExp);
        if (y <= 2) q += ' entry level'; else if (y >= 6) q += ' senior';
      }
      queries.push({ query: q, location: loc });
    }
  }

  const promises = queries.map(async ({ query, location }) => {
    try {
      let jobs = await runGoogleJobsScraper(key, query, location);
      if (!jobs || jobs.length === 0) jobs = await runLinkedInScraper(key, query, location);
      if (jobs && jobs.length) {
        jobs.forEach(j => allJobs.push(j));
        completed++;
        setLoadingSub(`${completed}/${queries.length} searches done — ${allJobs.length} jobs found`);
        STATE.jobs = dedup(allJobs);
        renderFeed();
      }
    } catch(e) { console.warn(`Failed: ${query} in ${location}`, e); }
  });

  await Promise.all(promises);

  STATE.jobs = dedup(allJobs);
  STATE.fetchCount++;
  document.getElementById('fetch-count').textContent = STATE.fetchCount;
  document.getElementById('feed-updated').textContent = `updated ${new Date().toLocaleTimeString()}`;
  save();
  renderFeed();
  document.getElementById('feed-loading').style.display = 'none';
  document.getElementById('job-grid').style.display = 'grid';

  if (allJobs.length > 0) toast(`✓ Fetched ${STATE.jobs.length} jobs from across the web`);
  else if (manual) toast('No jobs returned — check your Apify key in Settings');
}

async function runGoogleJobsScraper(key, query, location) {
  try {
    const runRes = await fetch('https://api.apify.com/v2/acts/apify~google-jobs-scraper/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ queries: `${query} ${location}`, maxJobsPerQuery: 20, saveHtml: false, saveText: true, proxyConfig: { useApifyProxy: true } })
    });
    if (!runRes.ok) return null;
    const { data } = await runRes.json();
    if (!data?.id) return null;
    const items = await pollAndFetch(key, data.id, data.defaultDatasetId, 40);
    return items.map(r => normalizeGoogleJob(r, query, location));
  } catch(e) { console.warn('Google Jobs error', e); return null; }
}

async function runLinkedInScraper(key, query, location) {
  try {
    const runRes = await fetch('https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ queries: query, location, maxItems: 20, proxy: { useApifyProxy: true } })
    });
    if (!runRes.ok) return null;
    const { data } = await runRes.json();
    if (!data?.id) return null;
    const items = await pollAndFetch(key, data.id, data.defaultDatasetId, 40);
    return items.map(r => normalizeLinkedInJob(r, query));
  } catch(e) { console.warn('LinkedIn error', e); return null; }
}

async function pollAndFetch(key, runId, datasetId, maxPolls) {
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

// ── NORMALIZERS ───────────────────────────────────────
function normalizeGoogleJob(raw, qFallback, location) {
  const desc = raw.description || raw.jobDescription || raw.snippet || '';
  return {
    id: raw.jobId || raw.id || generateId(),
    title: raw.title || raw.jobTitle || qFallback,
    company: raw.companyName || raw.company || raw.employer || 'Unknown',
    location: raw.location || raw.jobLocation || location || 'Remote',
    source: detectSourceFromRaw(raw),
    type: raw.employmentType || raw.jobType || guessType(desc),
    salary: raw.salary || raw.salaryRange || extractSalary(desc),
    applicants: raw.applyCount || raw.numberOfApplicants || null,
    skills: extractSkills(desc),
    description: desc,
    sponsorship: detectSponsorship(raw),
    url: raw.jobUrl || raw.applyUrl || raw.url || '#',
    postedAt: raw.datePosted || raw.postedAt || new Date().toISOString(),
    postedLabel: timeAgo(raw.datePosted || raw.postedAt),
    level: guessLevel(raw.title || raw.jobTitle || qFallback || ''),
    fetchedAt: Date.now(),
  };
}

function normalizeLinkedInJob(raw, qFallback) {
  const desc = raw.jobDescription || raw.description || '';
  return {
    id: raw.id || raw.jobId || generateId(),
    title: raw.jobTitle || raw.title || qFallback,
    company: raw.companyName || raw.company || 'Unknown',
    location: raw.jobLocation || raw.location || 'Remote',
    source: 'LinkedIn',
    type: raw.jobType || raw.employmentType || 'Full-time',
    salary: raw.salaryRange || raw.salary || extractSalary(desc),
    applicants: raw.numberOfApplicants || raw.applicants || null,
    skills: extractSkills(desc),
    description: desc,
    sponsorship: detectSponsorship(raw),
    url: raw.jobUrl || raw.url || raw.linkedinJobUrl || '#',
    postedAt: raw.postedAt || raw.publishedAt || new Date().toISOString(),
    postedLabel: timeAgo(raw.postedAt || raw.publishedAt),
    level: guessLevel(raw.jobTitle || raw.title || qFallback || ''),
    fetchedAt: Date.now(),
  };
}

function detectSourceFromRaw(raw) {
  const url = (raw.jobUrl || raw.applyUrl || raw.url || '').toLowerCase();
  const via = (raw.via || raw.source || '').toLowerCase();
  if (url.includes('linkedin') || via.includes('linkedin')) return 'LinkedIn';
  if (url.includes('indeed') || via.includes('indeed')) return 'Indeed';
  if (url.includes('glassdoor') || via.includes('glassdoor')) return 'Glassdoor';
  if (url.includes('wellfound') || url.includes('angel')) return 'Wellfound';
  if (url.includes('greenhouse')) return 'Greenhouse';
  if (url.includes('lever')) return 'Lever';
  if (url.includes('workday')) return 'Workday';
  if (url.includes('ashby')) return 'Ashby';
  const co = (raw.companyName || raw.company || '').toLowerCase().replace(/\s+/g,'');
  if (co && url.includes(co)) return 'Company Site';
  return 'Google Jobs';
}

function extractSkills(text) {
  if (!text) return [];
  const t = text.toLowerCase();
  const known = ['SQL','Python','Tableau','Power BI','Excel','Looker','dbt','BigQuery','Snowflake',
    'Spark','R','Pandas','AWS','Azure','GCP','Databricks','Airflow','Jira','Confluence','Kafka','SAP','Redshift'];
  return known.filter(s => t.includes(s.toLowerCase())).slice(0,5);
}

function extractSalary(text) {
  if (!text) return null;
  const m = text.match(/\$[\d,]+k?\s*[-–]\s*\$[\d,]+k?/i) || text.match(/\$[\d,]{4,}/i);
  return m ? m[0] : null;
}

function guessType(text) {
  const t = (text||'').toLowerCase();
  if (t.includes('contract')) return 'Contract';
  if (t.includes('part-time')) return 'Part-time';
  if (t.includes('hybrid')) return 'Hybrid';
  if (t.includes('remote')) return 'Remote';
  return 'Full-time';
}

function guessLevel(title) {
  const t = title.toLowerCase();
  if (t.includes('lead')||t.includes('principal')||t.includes('staff')) return 'Lead';
  if (t.includes('senior')||t.includes('sr.')) return 'Senior';
  if (t.includes('junior')||t.includes('jr.')||t.includes('entry')) return 'Junior';
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
    const k = `${(j.title||'').toLowerCase()}|${(j.company||'').toLowerCase()}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

function setLoadingSub(msg) { const el = document.getElementById('loading-sub'); if (el) el.textContent = msg; }

function showNoKeyBanner() {
  const grid = document.getElementById('job-grid');
  grid.innerHTML = `<div style="grid-column:1/-1;border:1px solid var(--accent);border-radius:12px;padding:36px;text-align:center;max-width:480px;margin:0 auto">
    <div style="font-size:32px;margin-bottom:14px">🔑</div>
    <div style="font-family:var(--font-display);font-size:18px;font-weight:600;margin-bottom:8px">Add your Apify key to fetch live jobs</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.7">Fetches from Google Jobs (covers 100s of company career sites), LinkedIn, Indeed and more.</div>
    <button class="btn-primary" onclick="showPanel('settings')">Open Settings →</button>
  </div>`;
  grid.style.display = 'grid';
}

// ── PROFILE / MATCH SCORE ─────────────────────────────
function matchScore(job) {
  if (!STATE.profile.skills.length && !STATE.profile.yearsExp) return null;
  let score = 50;
  const jobSkills = (job.skills||[]).map(s=>s.toLowerCase());
  const userSkills = STATE.profile.skills.map(s=>s.toLowerCase());
  if (userSkills.length && jobSkills.length) {
    const matches = userSkills.filter(s=>jobSkills.includes(s)).length;
    score += Math.round((matches/userSkills.length)*40);
  }
  if (STATE.profile.yearsExp) {
    const y = parseInt(STATE.profile.yearsExp), lvl = job.level||'Mid';
    if ((y<=2&&lvl==='Junior')||(y>=3&&y<=5&&lvl==='Mid')||(y>=5&&(lvl==='Senior'||lvl==='Lead'))) score+=10;
    else score -= 5;
  }
  return Math.min(100, Math.max(0, score));
}

function matchBadge(score) {
  if (score===null) return '';
  const cls = score>=80?'match-high':score>=60?'match-mid':'match-low';
  return `<span class="match-badge ${cls}">${score}% match</span>`;
}

// ── FEED ─────────────────────────────────────────────
function renderFeed() {
  const q = (document.getElementById('search-q')?.value||'').toLowerCase();
  const role = document.getElementById('f-role')?.value||'';
  const loc = document.getElementById('f-loc')?.value||'';
  const sort = document.getElementById('f-sort')?.value||'recent';
  const sponsorF = document.getElementById('f-sponsor')?.value||'all';

  let jobs = STATE.jobs.filter(j => {
    if (q && !`${j.title} ${j.company} ${(j.skills||[]).join(' ')}`.toLowerCase().includes(q)) return false;
    if (role && !j.title.toLowerCase().includes(role.toLowerCase().split(' ')[0])) return false;
    if (loc) {
      const jloc = (j.location||'').toLowerCase();
      if (loc==='Remote' && !jloc.includes('remote')) return false;
      if (loc==='United States' && !jloc.match(/united states|new york|san francisco|chicago|austin|seattle|boston|denver|remote/i)) return false;
      if (loc==='India' && !jloc.match(/india|bengaluru|bangalore|mumbai|hyderabad|delhi|pune/i)) return false;
    }
    if (sponsorF==='yes' && j.sponsorship!=='yes') return false;
    if (sponsorF==='no' && j.sponsorship!=='no') return false;
    if (sponsorF==='unknown' && j.sponsorship!=='unknown') return false;
    if (sponsorF==='hide_no' && j.sponsorship==='no') return false;
    return true;
  });

  if (sort==='applicants') jobs.sort((a,b)=>(a.applicants||999)-(b.applicants||999));
  else if (sort==='match') jobs.sort((a,b)=>(matchScore(b)||0)-(matchScore(a)||0));
  else jobs.sort((a,b)=>(b.fetchedAt||0)-(a.fetchedAt||0));

  document.getElementById('badge-feed').textContent = jobs.length;
  const grid = document.getElementById('job-grid');
  grid.style.display = 'grid';

  if (!jobs.length && STATE.jobs.length===0) { showNoKeyBanner(); return; }
  if (!jobs.length) { grid.innerHTML=''; document.getElementById('feed-empty').style.display='block'; return; }
  document.getElementById('feed-empty').style.display = 'none';

  grid.innerHTML = jobs.slice(0,80).map(j => {
    const app = STATE.applications[j.id];
    const isLogged = !!app && app.status!=='saved';
    const isSaved = app?.status==='saved';
    const isHot = (j.applicants||0)>200;
    const isRemote = (j.location||'').toLowerCase().includes('remote');
    const score = matchScore(j);
    const sp = sponsorshipLabel(j.sponsorship||'unknown');

    return `<div class="job-card" id="jcard-${j.id}">
      <div class="jc-top">
        <div style="flex:1;min-width:0">
          <div class="jc-title">${esc(j.title)}</div>
          <div class="jc-company">${esc(j.company)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          <span class="jc-src">${esc(j.source)}</span>
          ${score!==null ? matchBadge(score) : ''}
        </div>
      </div>
      <div class="jc-meta">
        <span class="meta-pill ${isRemote?'remote':''}">${esc(j.location)}</span>
        <span class="meta-pill">${esc(j.type||'Full-time')}</span>
        ${j.salary?`<span class="meta-pill">${esc(j.salary)}</span>`:''}
        ${j.applicants?(isHot?`<span class="meta-pill hot">🔥 ${j.applicants} applicants</span>`:`<span class="meta-pill">${j.applicants} applicants</span>`):''}
        <span class="meta-pill">${esc(j.postedLabel||'recently')}</span>
      </div>
      <div class="jc-meta" style="margin-top:-2px">
        <span class="sponsor-pill ${sp.cls}">${sp.text}</span>
      </div>
      ${j.skills?.length?`<div class="jc-skills">${j.skills.map(s=>`<span class="skill-tag">${esc(s)}</span>`).join('')}</div>`:''}
      <div class="jc-actions">
        <button class="btn-apply-card ${isLogged?'logged':''}" onclick="handleApply('${j.id}')">${isLogged?'✓ Logged':'Log Application'}</button>
        <button class="btn-save-card ${isSaved?'saved':''}" onclick="handleSave('${j.id}')" title="Save">${isSaved?'★':'☆'}</button>
        ${j.url&&j.url!=='#'?`<a href="${esc(j.url)}" target="_blank" rel="noopener" class="btn-link-card" title="Open job">↗</a>`:''}
      </div>
    </div>`;
  }).join('');
}

function filterFeed() { renderFeed(); }
function toggleSrc(el, src) {
  el.classList.toggle('on');
  if (STATE.activeSrcs.has(src)) STATE.activeSrcs.delete(src); else STATE.activeSrcs.add(src);
  renderFeed();
}

// ── APPLICATIONS ──────────────────────────────────────
function handleApply(jobId) {
  const job = STATE.jobs.find(j=>j.id===jobId);
  if (!job) return;
  if (STATE.applications[jobId]?.status==='applied') { openDetailModal(jobId); return; }
  if (job.url&&job.url!=='#') window.open(job.url,'_blank');
  const now = new Date();
  STATE.applications[jobId] = { ...job, status:'applied', appliedAt:now.toISOString(), activity:[{date:now.toISOString(),text:`Applied via ${job.source}`,auto:false}], notes:'' };
  updateCounts(); save(); renderFeed(); renderKanbanIfActive();
  toast(`Logged: ${job.title} at ${job.company}`);
}

function handleSave(jobId) {
  const job = STATE.jobs.find(j=>j.id===jobId);
  if (!job||STATE.applications[jobId]) return;
  STATE.applications[jobId] = { ...job, status:'saved', appliedAt:new Date().toISOString(), activity:[{date:new Date().toISOString(),text:'Saved for later',auto:false}], notes:'' };
  updateCounts(); save(); renderFeed(); renderKanbanIfActive();
  toast(`Saved: ${job.title}`);
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

function showLogModal() { document.getElementById('log-modal').style.display='flex'; document.getElementById('log-title').focus(); }
function closeLogModal(e) { if (e&&e.target!==document.getElementById('log-modal')) return; document.getElementById('log-modal').style.display='none'; }

function logApplication() {
  const title = document.getElementById('log-title').value.trim();
  const company = document.getElementById('log-company').value.trim();
  if (!title||!company) { toast('Title and company required'); return; }
  const id = 'manual_'+generateId(), now = new Date();
  STATE.applications[id] = { id,title,company,
    location: document.getElementById('log-location').value.trim()||'Unknown',
    url: document.getElementById('log-url').value.trim()||'#',
    source: document.getElementById('log-source').value,
    notes: document.getElementById('log-notes').value.trim(),
    status:'applied', appliedAt:now.toISOString(),
    activity:[{date:now.toISOString(),text:`Manually logged — ${document.getElementById('log-source').value}`,auto:false}]
  };
  save(); updateCounts(); renderKanban(); renderStats();
  document.getElementById('log-modal').style.display='none';
  ['log-title','log-company','log-location','log-url','log-notes'].forEach(i=>{document.getElementById(i).value='';});
  toast(`Logged: ${title} at ${company}`);
}

// ── DETAIL MODAL ─────────────────────────────────────
function openDetailModal(id) {
  const app = STATE.applications[id];
  if (!app) return;
  STATE.detailId = id;
  document.getElementById('dm-title').textContent = app.title;
  document.getElementById('dm-sub').textContent = `${app.company} · ${app.location||''}`;
  document.getElementById('dm-status').value = app.status;
  document.getElementById('dm-notes').value = app.notes||'';
  const sp = sponsorshipLabel(app.sponsorship||'unknown');
  const spEl = document.getElementById('dm-sponsor');
  if (spEl) { spEl.textContent=sp.text; spEl.className=`sponsor-pill ${sp.cls}`; }
  renderTimeline(id);
  document.getElementById('detail-modal').style.display='flex';
}

function closeDetailModal(e) { if (e&&e.target!==document.getElementById('detail-modal')) return; document.getElementById('detail-modal').style.display='none'; STATE.detailId=null; }

function renderTimeline(id) {
  const app = STATE.applications[id];
  if (!app) return;
  document.getElementById('dm-timeline').innerHTML = (app.activity||[]).slice().reverse().map(a=>`
    <div class="timeline-item"><div class="tl-dot ${a.auto?'auto':''}"></div>
    <div class="tl-content"><div class="tl-text">${esc(a.text)}</div><div class="tl-date">${formatDate(a.date)}</div></div></div>`).join('');
}

function updateAppStatus() {
  const id = STATE.detailId;
  if (!id||!STATE.applications[id]) return;
  const newStatus = document.getElementById('dm-status').value;
  const old = STATE.applications[id].status;
  if (old===newStatus) return;
  STATE.applications[id].status = newStatus;
  STATE.applications[id].activity.push({date:new Date().toISOString(),text:`Status: ${old} → ${newStatus}`,auto:false});
  renderTimeline(id); save(); updateCounts(); renderKanban(); renderStats();
  toast('Status: '+newStatus);
}

function saveDetailNote() {
  const id = STATE.detailId;
  if (!id||!STATE.applications[id]) return;
  STATE.applications[id].notes = document.getElementById('dm-notes').value;
  STATE.applications[id].activity.push({date:new Date().toISOString(),text:'Note added',auto:false});
  save(); renderKanban(); toast('Note saved');
}

// ── KANBAN ───────────────────────────────────────────
function renderKanban() {
  const groups = {saved:[],applied:[],interview:[],offer:[],rejected:[]};
  Object.values(STATE.applications).forEach(a=>(groups[a.status]||groups.applied).push(a));
  ['saved','applied','interview','offer','rejected'].forEach(status=>{
    const el = document.getElementById('k-'+status);
    if (!el) return;
    const apps = groups[status].sort((a,b)=>new Date(b.appliedAt)-new Date(a.appliedAt));
    el.innerHTML = apps.map(app=>{
      const sp = sponsorshipLabel(app.sponsorship||'unknown');
      return `<div class="kcard" onclick="openDetailModal('${app.id}')">
        <div class="kcard-title">${esc(app.title)}</div>
        <div class="kcard-co">${esc(app.company)}</div>
        <div class="kcard-date">${esc(app.source||'')} · ${timeAgo(app.appliedAt)}</div>
        <span class="sponsor-pill ${sp.cls}" style="font-size:10px;margin-top:4px;display:inline-block">${sp.text}</span>
        ${app.notes?`<div class="kcard-note">${esc(app.notes.slice(0,60))}${app.notes.length>60?'...':''}</div>`:''}
        ${app.gmailDetected?`<div class="kcard-auto">✦ Auto via Gmail</div>`:''}
      </div>`;
    }).join('') || `<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px 0">Empty</div>`;
  });
  updateCounts();
}

function renderKanbanIfActive() { if (document.getElementById('panel-tracker').classList.contains('active')) renderKanban(); }

function updateCounts() {
  const counts = {saved:0,applied:0,interview:0,offer:0,rejected:0};
  Object.values(STATE.applications).forEach(a=>counts[a.status]=(counts[a.status]||0)+1);
  ['saved','applied','interview','offer','rejected'].forEach(s=>{ const el=document.getElementById('kc-'+s); if(el) el.textContent=counts[s]||0; });
  document.getElementById('badge-track').textContent = Object.keys(STATE.applications).length;
}

// ── ANALYTICS ────────────────────────────────────────
function renderStats() {
  const apps = Object.values(STATE.applications);
  const applied = apps.filter(a=>a.status!=='saved');
  const interviews = apps.filter(a=>a.status==='interview').length;
  const offers = apps.filter(a=>a.status==='offer').length;
  const rejected = apps.filter(a=>a.status==='rejected').length;
  const responded = interviews+offers+rejected;
  const rate = applied.length ? Math.round(responded/applied.length*100) : 0;
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate()-7);
  const thisWeek = applied.filter(a=>new Date(a.appliedAt)>=weekStart).length;

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

// ── SETTINGS ─────────────────────────────────────────
function renderSettings() {
  const ki=document.getElementById('apify-key-input'); if(ki) ki.value=STATE.settings.apifyKey||'';
  const ii=document.getElementById('interval-sel'); if(ii) ii.value=STATE.settings.interval;
  document.getElementById('p-exp').value=STATE.profile.yearsExp||'';
  document.getElementById('p-sponsorship').checked=STATE.profile.needsSponsorship;
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
  STATE.profile.needsSponsorship=document.getElementById('p-sponsorship').checked;
  save(); renderFeed();
  toast('Profile saved — match scores updated');
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
  if (!keyVal||!keyVal.startsWith('apify_api_')) { fb.className='settings-feedback err'; fb.textContent='✗ Key must start with apify_api_'; fb.style.display='block'; return; }
  STATE.settings.apifyKey=keyVal; save();
  fb.className='settings-feedback ok'; fb.textContent='✓ Saved in browser only. Fetching now...'; fb.style.display='block';
  setTimeout(()=>{fb.style.display='none';},4000);
  fetchJobs(true);
}

function revokeApifyKey() { STATE.settings.apifyKey=''; save(); document.getElementById('apify-key-input').value=''; toast('Key removed'); }
function addRole() { const v=document.getElementById('new-role').value.trim(); if(!v||STATE.settings.roles.includes(v)) return; STATE.settings.roles.push(v); document.getElementById('new-role').value=''; save(); renderSettings(); }
function removeRole(r) { STATE.settings.roles=STATE.settings.roles.filter(x=>x!==r); save(); renderSettings(); }
function addLoc() { const v=document.getElementById('new-loc').value.trim(); if(!v||STATE.settings.locations.includes(v)) return; STATE.settings.locations.push(v); document.getElementById('new-loc').value=''; save(); renderSettings(); }
function removeLoc(l) { STATE.settings.locations=STATE.settings.locations.filter(x=>x!==l); save(); renderSettings(); }
function saveInterval() { STATE.settings.interval=parseInt(document.getElementById('interval-sel').value); save(); }

// ── GMAIL ────────────────────────────────────────────
function connectGmail() {
  document.getElementById('gmail-info').innerHTML=`
    <strong style="color:var(--text)">Setup steps:</strong><br><br>
    1. <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--blue)">console.cloud.google.com</a> → New project<br>
    2. Enable Gmail API → OAuth consent → Add email<br>
    3. Credentials → OAuth Client ID (Web app)<br>
    4. Authorized origin: <code style="color:var(--accent)">https://sarangbang51.github.io</code><br>
    5. Paste Client ID:<br><br>
    <input class="settings-input" id="gclient-input" placeholder="Google Client ID..." style="margin-bottom:8px">
    <button class="btn-primary" onclick="initGmailAuth()" style="width:100%">Connect Gmail</button>`;
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
        processGmailMessage(h.find(x=>x.name==='Subject')?.value||'',h.find(x=>x.name==='From')?.value||'',h.find(x=>x.name==='Date')?.value||'');
      }
    }
  } catch(e) { console.warn('Gmail scan',e); }
}

function processGmailMessage(subject, from, date) {
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
function toast(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),3000); }

document.addEventListener('keydown',e=>{
  if (e.key==='Escape') { document.getElementById('detail-modal').style.display='none'; document.getElementById('log-modal').style.display='none'; }
  if (e.key==='Enter') { if(document.activeElement?.id==='new-role') addRole(); if(document.activeElement?.id==='new-loc') addLoc(); if(document.activeElement?.id==='p-skill-input') addProfileSkill(); }
});

// ── BOOT ─────────────────────────────────────────────
(function init() {
  load();
  applyTheme(STATE.theme);
  updateGmailUI();
  updateCounts();

  if (STATE.jobs.length > 0) {
    renderFeed();
    document.getElementById('feed-updated').textContent = `cached · ${new Date(STATE.jobs[0]?.fetchedAt||Date.now()).toLocaleTimeString()}`;
  } else {
    showNoKeyBanner();
    document.getElementById('feed-loading').style.display='none';
    document.getElementById('job-grid').style.display='grid';
  }

  if (STATE.settings.apifyKey) setTimeout(()=>fetchJobs(false), 800);

  // Silent hourly background refresh
  setInterval(()=>{ if(STATE.settings.apifyKey) fetchJobs(false); }, (STATE.settings.interval||3600)*1000);

  if (STATE.gmail.connected) setTimeout(startGmailScan, 2000);
  document.getElementById('fetch-count').textContent = STATE.fetchCount;
})();
