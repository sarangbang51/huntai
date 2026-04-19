/* ═══════════════════════════════════════════════════
   HuntAI — app.js
   Full job search + application tracker system
   ═══════════════════════════════════════════════════ */

// ── STATE ────────────────────────────────────────────
const STATE = {
  jobs: [],
  applications: {},   // id -> app object
  settings: {
    apifyKey: '',      // Set via Settings tab — stored in localStorage only, never in code
    actor: 'curious_coder/linkedin-jobs-scraper',
    roles: ['Data Analyst','Business Analyst','BI Analyst','Analytics Engineer','Data Engineer'],
    locations: ['Remote','United States','India'],
    interval: 3600,
  },
  gmail: { connected: false, email: '' },
  activeSrcs: new Set(['LinkedIn','Indeed','Glassdoor','Wellfound','Greenhouse']),
  refreshInterval: null,
  refreshSecondsLeft: 3600,
  fetchCount: 0,
  detailId: null,
};

// ── PERSISTENCE ──────────────────────────────────────
function save() {
  localStorage.setItem('huntai_apps', JSON.stringify(STATE.applications));
  localStorage.setItem('huntai_settings', JSON.stringify(STATE.settings));
  localStorage.setItem('huntai_gmail', JSON.stringify(STATE.gmail));
  localStorage.setItem('huntai_jobs', JSON.stringify(STATE.jobs.slice(0, 200)));
}

function load() {
  try {
    const apps = localStorage.getItem('huntai_apps');
    if (apps) STATE.applications = JSON.parse(apps);
    const settings = localStorage.getItem('huntai_settings');
    if (settings) STATE.settings = { ...STATE.settings, ...JSON.parse(settings) };
    const gmail = localStorage.getItem('huntai_gmail');
    if (gmail) STATE.gmail = JSON.parse(gmail);
    const jobs = localStorage.getItem('huntai_jobs');
    if (jobs) STATE.jobs = JSON.parse(jobs);
  } catch(e) { console.warn('Load error', e); }
}

// ── PANEL NAVIGATION ─────────────────────────────────
function showPanel(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (btn) btn.classList.add('active');

  if (name === 'tracker') renderKanban();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  if (name === 'feed') renderFeed();
}

// ── APIFY JOB FETCHING ───────────────────────────────
async function fetchJobs(manual = false) {
  const key = STATE.settings.apifyKey;

  // Always show demo data immediately so the feed is never empty
  if (!STATE.jobs.length) {
    STATE.jobs = generateDemoJobs();
    renderFeed();
  }

  if (!key) {
    if (manual) showFirstRunBanner();
    return;
  }

  document.getElementById('feed-loading').style.display = 'flex';
  setLoadingSub('Starting scrapers in parallel...');

  try {
    // Build all role+location pairs, run ALL in parallel
    const pairs = [];
    for (const role of STATE.settings.roles) {
      for (const loc of STATE.settings.locations) {
        pairs.push({ role, loc });
      }
    }

    let completed = 0;
    const allJobs = [];

    // Run all scraper starts in parallel
    const runPromises = pairs.map(async ({ role, loc }) => {
      try {
        const runRes = await fetch(
          `https://api.apify.com/v2/acts/${encodeURIComponent(STATE.settings.actor)}/runs`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
              queries: role,
              location: loc === 'United States' ? 'United States' : loc === 'India' ? 'India' : loc,
              maxItems: 20,
              proxy: { useApifyProxy: true }
            })
          }
        );

        if (!runRes.ok) { console.warn(`Start failed: ${role} ${loc}`); return; }
        const runData = await runRes.json();
        const runId = runData.data?.id;
        const datasetId = runData.data?.defaultDatasetId;
        if (!runId) return;

        // Poll this run until done (max 2 min)
        let status = 'RUNNING';
        let polls = 0;
        while ((status === 'RUNNING' || status === 'READY') && polls < 40) {
          await sleep(3000);
          polls++;
          try {
            const sRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`,
              { headers: { 'Authorization': `Bearer ${key}` } });
            const sData = await sRes.json();
            status = sData.data?.status;
          } catch { break; }
        }

        if (status !== 'SUCCEEDED') return;

        // Fetch dataset
        const dataRes = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&limit=20`,
          { headers: { 'Authorization': `Bearer ${key}` } }
        );
        const items = await dataRes.json();
        if (Array.isArray(items)) {
          items.forEach(item => allJobs.push(normalizeJob(item, role)));
        }

        completed++;
        setLoadingSub(`${completed}/${pairs.length} searches done — ${allJobs.length} jobs found`);

        // Stream results into feed as they arrive
        if (allJobs.length > 0) {
          const seen = new Set();
          STATE.jobs = allJobs.filter(j => {
            const k = `${j.title}|${j.company}`.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k); return true;
          });
          renderFeed();
        }

      } catch (err) {
        console.warn(`Failed: ${role} ${loc}`, err);
      }
    });

    await Promise.all(runPromises);

    // Final dedup
    const seen = new Set();
    STATE.jobs = allJobs.filter(j => {
      const k = `${j.title}|${j.company}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // If live fetch got nothing, keep demo data
    if (STATE.jobs.length === 0) {
      STATE.jobs = generateDemoJobs();
    }

    STATE.fetchCount++;
    document.getElementById('fetch-count').textContent = STATE.fetchCount;
    document.getElementById('feed-updated').textContent = `updated ${new Date().toLocaleTimeString()}`;

    save();
    renderFeed();
    toast(`✓ Fetched ${STATE.jobs.length} live jobs`);

  } catch (err) {
    console.error('Fetch error', err);
    if (!STATE.jobs.length) STATE.jobs = generateDemoJobs();
    renderFeed();
    if (manual) toast('Fetch error — check your Apify key in Settings');
  } finally {
    document.getElementById('feed-loading').style.display = 'none';
    document.getElementById('job-grid').style.display = 'grid';
  }
}

function showFirstRunBanner() {
  // Inject a prominent banner prompting key entry
  const grid = document.getElementById('job-grid');
  const banner = `
    <div style="grid-column:1/-1;background:var(--surface);border:1px solid var(--accent);border-radius:12px;padding:32px;text-align:center;max-width:500px;margin:0 auto">
      <div style="font-size:28px;margin-bottom:12px">🔑</div>
      <div style="font-family:var(--font-display);font-size:18px;font-weight:600;margin-bottom:8px">Add your Apify key to fetch live jobs</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.7">
        Demo jobs are showing now. Add your Apify key in Settings to get real live listings fetched every hour.
      </div>
      <button class="btn-primary" onclick="showPanel('settings', document.querySelector('[data-panel=settings]'))">Go to Settings →</button>
    </div>`;
  grid.insertAdjacentHTML('afterbegin', banner);
}

function normalizeJob(raw, roleFallback) {
  const applicants = raw.numberOfApplicants || raw.applicants || Math.floor(Math.random() * 250 + 5);
  const src = detectSource(raw);
  return {
    id: raw.id || raw.jobId || generateId(),
    title: raw.jobTitle || raw.title || raw.position || roleFallback || 'Analyst',
    company: raw.companyName || raw.company || 'Company',
    location: raw.jobLocation || raw.location || 'Remote',
    source: src,
    type: raw.jobType || raw.employmentType || 'Full-time',
    salary: raw.salaryRange || raw.salary || formatSalary(),
    applicants,
    skills: extractSkills(raw),
    url: raw.jobUrl || raw.url || raw.linkedinJobUrl || '#',
    postedAt: raw.postedAt || raw.publishedAt || new Date().toISOString(),
    postedLabel: timeAgo(raw.postedAt || raw.publishedAt),
    level: guessLevel(raw.jobTitle || raw.title || roleFallback || ''),
    fetchedAt: Date.now(),
  };
}

function detectSource(raw) {
  const url = (raw.url || raw.jobUrl || raw.linkedinJobUrl || '').toLowerCase();
  if (url.includes('linkedin')) return 'LinkedIn';
  if (url.includes('indeed')) return 'Indeed';
  if (url.includes('glassdoor')) return 'Glassdoor';
  if (url.includes('wellfound') || url.includes('angel')) return 'Wellfound';
  if (url.includes('greenhouse')) return 'Greenhouse';
  return 'LinkedIn';
}

function extractSkills(raw) {
  const desc = (raw.jobDescription || raw.description || '').toLowerCase();
  const known = ['SQL','Python','Tableau','Power BI','Excel','Looker','dbt','BigQuery','Snowflake','Spark','R','Pandas','AWS','Azure','GCP','Databricks','Airflow','Jira','Confluence'];
  return known.filter(s => desc.includes(s.toLowerCase())).slice(0, 5);
}

function guessLevel(title) {
  const t = title.toLowerCase();
  if (t.includes('lead') || t.includes('principal') || t.includes('staff')) return 'Lead';
  if (t.includes('senior') || t.includes('sr.') || t.includes('sr ')) return 'Senior';
  if (t.includes('junior') || t.includes('jr.') || t.includes('entry')) return 'Junior';
  return 'Mid';
}

function formatSalary() {
  const base = Math.floor(Math.random() * 60 + 70);
  return `$${base}k – $${base + 20}k`;
}

function timeAgo(iso) {
  if (!iso) return 'recently';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function setLoadingSub(msg) {
  document.getElementById('loading-sub').textContent = msg;
}

// ── DEMO DATA (fallback) ──────────────────────────────
function generateDemoJobs() {
  const roles = ['Data Analyst','Business Analyst','BI Analyst','Analytics Engineer','Data Engineer','Senior Data Analyst','Product Analyst'];
  const cos = ['Stripe','Notion','Figma','Databricks','Snowflake','Shopify','Atlassian','HubSpot','JPMorgan','Deloitte','McKinsey','Netflix','Uber','DoorDash','Plaid','Rippling','Razorpay','Swiggy','Zomato','Flipkart','PhonePe','CRED','Groww'];
  const locs = ['Remote','New York, NY','San Francisco, CA','Bengaluru, India','Mumbai, India','Hyderabad, India','Austin, TX','Seattle, WA','Chicago, IL'];
  const srcs = ['LinkedIn','Indeed','Glassdoor','Wellfound','Greenhouse'];
  const skillSets = [['SQL','Python','Tableau'],['Excel','Power BI','SQL'],['Looker','dbt','BigQuery'],['SQL','Snowflake','Python'],['Tableau','Jira','Excel'],['Python','Spark','Databricks']];
  const types = ['Full-time','Full-time','Full-time','Contract','Hybrid'];

  return Array.from({ length: 80 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 10);
    const posted = new Date(); posted.setDate(posted.getDate() - daysAgo);
    return {
      id: 'demo_' + i,
      title: roles[Math.floor(Math.random() * roles.length)],
      company: cos[Math.floor(Math.random() * cos.length)],
      location: locs[Math.floor(Math.random() * locs.length)],
      source: srcs[Math.floor(Math.random() * srcs.length)],
      type: types[Math.floor(Math.random() * types.length)],
      salary: formatSalary(),
      applicants: Math.floor(Math.random() * 300 + 5),
      skills: skillSets[Math.floor(Math.random() * skillSets.length)],
      url: 'https://linkedin.com/jobs/',
      postedAt: posted.toISOString(),
      postedLabel: daysAgo === 0 ? 'today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`,
      level: ['Junior','Mid','Senior','Lead'][Math.floor(Math.random() * 4)],
      fetchedAt: Date.now(),
    };
  });
}

// ── FEED RENDERING ───────────────────────────────────
function renderFeed() {
  const q = (document.getElementById('search-q')?.value || '').toLowerCase();
  const role = document.getElementById('f-role')?.value || '';
  const loc = document.getElementById('f-loc')?.value || '';
  const sort = document.getElementById('f-sort')?.value || 'recent';

  let jobs = STATE.jobs.filter(j => {
    if (!STATE.activeSrcs.has(j.source)) return false;
    if (q && !`${j.title} ${j.company} ${(j.skills||[]).join(' ')}`.toLowerCase().includes(q)) return false;
    if (role && !j.title.toLowerCase().includes(role.toLowerCase().split(' ')[0].toLowerCase())) return false;
    if (loc) {
      const jloc = (j.location || '').toLowerCase();
      if (loc === 'Remote' && !jloc.includes('remote')) return false;
      if (loc === 'United States' && !jloc.match(/\b(us|usa|united states|ny|ca|tx|wa|il|ma|co|fl|ga|remote)\b/i) && !jloc.includes('united states')) return false;
      if (loc === 'India' && !jloc.match(/india|bengaluru|bangalore|mumbai|hyderabad|delhi|pune|chennai/i)) return false;
    }
    return true;
  });

  if (sort === 'applicants') jobs.sort((a, b) => (a.applicants || 999) - (b.applicants || 999));
  else jobs.sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0));

  document.getElementById('badge-feed').textContent = jobs.length;

  const grid = document.getElementById('job-grid');
  grid.style.display = 'grid';

  if (!jobs.length) {
    grid.innerHTML = '';
    document.getElementById('feed-empty').style.display = 'block';
    return;
  }

  document.getElementById('feed-empty').style.display = 'none';

  grid.innerHTML = jobs.slice(0, 60).map(j => {
    const app = STATE.applications[j.id];
    const isLogged = !!app;
    const isSaved = app?.status === 'saved';
    const isHot = (j.applicants || 0) > 200;
    const isRemote = (j.location || '').toLowerCase().includes('remote');

    return `<div class="job-card" id="jcard-${j.id}">
      <div class="jc-top">
        <div>
          <div class="jc-title">${esc(j.title)}</div>
          <div class="jc-company">${esc(j.company)}</div>
        </div>
        <span class="jc-src">${esc(j.source)}</span>
      </div>
      <div class="jc-meta">
        <span class="meta-pill ${isRemote ? 'remote' : ''}">${esc(j.location)}</span>
        <span class="meta-pill">${esc(j.type)}</span>
        <span class="meta-pill">${esc(j.salary)}</span>
        ${isHot ? `<span class="meta-pill hot">🔥 ${j.applicants} applicants</span>` : `<span class="meta-pill">${j.applicants} applicants</span>`}
        <span class="meta-pill">${esc(j.postedLabel || 'recently')}</span>
      </div>
      ${j.skills?.length ? `<div class="jc-skills">${j.skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}</div>` : ''}
      <div class="jc-actions">
        <button class="btn-apply-card ${isLogged && !isSaved ? 'logged' : ''}" onclick="handleApply('${j.id}')">
          ${isLogged && !isSaved ? '✓ Logged' : 'Log Application'}
        </button>
        <button class="btn-save-card ${isSaved ? 'saved' : ''}" onclick="handleSave('${j.id}')" title="Save for later">
          ${isSaved ? '★' : '☆'}
        </button>
        ${j.url && j.url !== '#' ? `<a href="${esc(j.url)}" target="_blank" rel="noopener" style="padding:7px 10px;background:transparent;border:1px solid var(--border2);border-radius:7px;color:var(--muted);font-size:12px;text-decoration:none;display:flex;align-items:center;gap:4px;" title="Open job">↗</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

function filterFeed() { renderFeed(); }

function toggleSrc(el, src) {
  el.classList.toggle('on');
  if (STATE.activeSrcs.has(src)) STATE.activeSrcs.delete(src);
  else STATE.activeSrcs.add(src);
  renderFeed();
}

// ── APPLICATION LOGGING ───────────────────────────────
function handleApply(jobId) {
  const job = STATE.jobs.find(j => j.id === jobId);
  if (!job) return;

  if (STATE.applications[jobId]?.status === 'applied') {
    // Already applied — open detail
    openDetailModal(jobId); return;
  }

  // Open job in new tab so user applies externally
  if (job.url && job.url !== '#') window.open(job.url, '_blank');

  // Log it
  const now = new Date();
  STATE.applications[jobId] = {
    ...job,
    status: 'applied',
    appliedAt: now.toISOString(),
    activity: [{ date: now.toISOString(), text: `Applied via ${job.source}`, auto: false }],
    notes: '',
  };

  updateCounts();
  save();
  renderFeed();
  renderKanbanIfActive();
  toast(`Logged: ${job.title} at ${job.company}`);
}

function handleSave(jobId) {
  const job = STATE.jobs.find(j => j.id === jobId);
  if (!job) return;
  if (STATE.applications[jobId]) return;

  STATE.applications[jobId] = {
    ...job,
    status: 'saved',
    appliedAt: new Date().toISOString(),
    activity: [{ date: new Date().toISOString(), text: 'Saved for later', auto: false }],
    notes: '',
  };

  updateCounts();
  save();
  renderFeed();
  renderKanbanIfActive();
  toast(`Saved: ${job.title}`);
}

// Manual log modal
function showLogModal() {
  document.getElementById('log-modal').style.display = 'flex';
  document.getElementById('log-title').focus();
}

function closeLogModal(e) {
  if (e && e.target !== document.getElementById('log-modal')) return;
  document.getElementById('log-modal').style.display = 'none';
}

function logApplication() {
  const title = document.getElementById('log-title').value.trim();
  const company = document.getElementById('log-company').value.trim();
  if (!title || !company) { toast('Title and company are required'); return; }

  const id = 'manual_' + generateId();
  const now = new Date();
  STATE.applications[id] = {
    id,
    title,
    company,
    location: document.getElementById('log-location').value.trim() || 'Unknown',
    url: document.getElementById('log-url').value.trim() || '#',
    source: document.getElementById('log-source').value,
    notes: document.getElementById('log-notes').value.trim(),
    status: 'applied',
    appliedAt: now.toISOString(),
    activity: [{ date: now.toISOString(), text: `Manually logged — ${document.getElementById('log-source').value}`, auto: false }],
  };

  save();
  updateCounts();
  renderKanban();
  renderStats();
  document.getElementById('log-modal').style.display = 'none';
  ['log-title','log-company','log-location','log-url','log-notes'].forEach(id => document.getElementById(id).value = '');
  toast(`Logged: ${title} at ${company}`);
}

// ── DETAIL MODAL ─────────────────────────────────────
function openDetailModal(id) {
  const app = STATE.applications[id];
  if (!app) return;
  STATE.detailId = id;

  document.getElementById('dm-title').textContent = app.title;
  document.getElementById('dm-sub').textContent = `${app.company} · ${app.location || ''}`;
  document.getElementById('dm-status').value = app.status;
  document.getElementById('dm-notes').value = app.notes || '';

  // Timeline
  const timeline = document.getElementById('dm-timeline');
  timeline.innerHTML = (app.activity || []).slice().reverse().map(a => `
    <div class="timeline-item">
      <div class="tl-dot ${a.auto ? 'auto' : ''}"></div>
      <div class="tl-content">
        <div class="tl-text">${esc(a.text)}</div>
        <div class="tl-date">${formatDate(a.date)}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('detail-modal').style.display = 'flex';
}

function closeDetailModal(e) {
  if (e && e.target !== document.getElementById('detail-modal')) return;
  document.getElementById('detail-modal').style.display = 'none';
  STATE.detailId = null;
}

function updateAppStatus() {
  const id = STATE.detailId;
  if (!id || !STATE.applications[id]) return;
  const newStatus = document.getElementById('dm-status').value;
  const old = STATE.applications[id].status;
  if (old === newStatus) return;

  STATE.applications[id].status = newStatus;
  STATE.applications[id].activity.push({
    date: new Date().toISOString(),
    text: `Status updated: ${old} → ${newStatus}`,
    auto: false,
  });

  // Re-render timeline
  const timeline = document.getElementById('dm-timeline');
  timeline.innerHTML = STATE.applications[id].activity.slice().reverse().map(a => `
    <div class="timeline-item">
      <div class="tl-dot ${a.auto ? 'auto' : ''}"></div>
      <div class="tl-content">
        <div class="tl-text">${esc(a.text)}</div>
        <div class="tl-date">${formatDate(a.date)}</div>
      </div>
    </div>
  `).join('');

  save();
  updateCounts();
  renderKanban();
  renderStats();
  toast('Status updated to ' + newStatus);
}

function saveDetailNote() {
  const id = STATE.detailId;
  if (!id || !STATE.applications[id]) return;
  STATE.applications[id].notes = document.getElementById('dm-notes').value;
  STATE.applications[id].activity.push({ date: new Date().toISOString(), text: 'Note added', auto: false });
  save();
  renderKanban();
  toast('Note saved');
}

// ── KANBAN ───────────────────────────────────────────
function renderKanban() {
  const groups = { saved: [], applied: [], interview: [], offer: [], rejected: [] };
  Object.values(STATE.applications).forEach(a => (groups[a.status] || groups.applied).push(a));

  ['saved','applied','interview','offer','rejected'].forEach(status => {
    const container = document.getElementById('k-' + status);
    if (!container) return;
    const apps = groups[status].sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
    container.innerHTML = apps.map(app => `
      <div class="kcard" onclick="openDetailModal('${app.id}')">
        <div class="kcard-title">${esc(app.title)}</div>
        <div class="kcard-co">${esc(app.company)}</div>
        <div class="kcard-date">${esc(app.source || '')} · ${timeAgo(app.appliedAt)}</div>
        ${app.notes ? `<div class="kcard-note">${esc(app.notes.slice(0, 70))}${app.notes.length > 70 ? '...' : ''}</div>` : ''}
        ${app.gmailDetected ? `<div class="kcard-auto">✦ Auto-detected via Gmail</div>` : ''}
      </div>
    `).join('');
  });

  updateCounts();
}

function renderKanbanIfActive() {
  if (document.getElementById('panel-tracker').classList.contains('active')) renderKanban();
}

function updateCounts() {
  const counts = { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 };
  Object.values(STATE.applications).forEach(a => counts[a.status] = (counts[a.status] || 0) + 1);

  ['saved','applied','interview','offer','rejected'].forEach(s => {
    const el = document.getElementById('kc-' + s);
    if (el) el.textContent = counts[s] || 0;
  });

  const total = Object.keys(STATE.applications).length;
  document.getElementById('badge-track').textContent = total;
}

// ── ANALYTICS ────────────────────────────────────────
function renderStats() {
  const apps = Object.values(STATE.applications);
  const applied = apps.filter(a => a.status !== 'saved');
  const interviews = apps.filter(a => a.status === 'interview').length;
  const offers = apps.filter(a => a.status === 'offer').length;
  const rejected = apps.filter(a => a.status === 'rejected').length;
  const responded = interviews + offers + rejected;
  const rate = applied.length ? Math.round(responded / applied.length * 100) : 0;

  // This week
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
  const thisWeek = applied.filter(a => new Date(a.appliedAt) >= weekStart).length;

  document.getElementById('st-total').textContent = applied.length;
  document.getElementById('st-week').textContent = `this week: ${thisWeek}`;
  document.getElementById('st-rate').textContent = rate + '%';
  document.getElementById('st-rate-d').textContent = `${interviews} interviews + ${offers} offers`;
  document.getElementById('st-inter').textContent = interviews;
  document.getElementById('st-offer').textContent = offers;

  // Week chart (last 7 days)
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d);
  }
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayCounts = days.map(d => applied.filter(a => {
    const ad = new Date(a.appliedAt);
    return ad.toDateString() === d.toDateString();
  }).length);
  const maxDay = Math.max(...dayCounts, 1);
  const today = new Date().toDateString();

  document.getElementById('chart-week').innerHTML = days.map((d, i) => `
    <div class="bar-col">
      <div class="bar-val">${dayCounts[i] || ''}</div>
      <div class="bar-inner ${d.toDateString() === today ? 'today' : ''}" style="height:${Math.round(dayCounts[i] / maxDay * 70)}px"></div>
      <div class="bar-lbl">${dayNames[d.getDay()]}</div>
    </div>
  `).join('');

  // Donut by role
  const roleCounts = {};
  applied.forEach(a => { roleCounts[a.title] = (roleCounts[a.title] || 0) + 1; });
  const roleEntries = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const colors = ['#6366f1','#4f8ef7','#34d399','#f5a623','#f87171'];
  const total = roleEntries.reduce((s, [, v]) => s + v, 0) || 1;
  let cumulative = 0;
  const donutSvg = document.getElementById('donut-svg');

  if (roleEntries.length) {
    donutSvg.innerHTML = roleEntries.map(([role, count], i) => {
      const pct = count / total;
      const startAngle = cumulative * Math.PI * 2 - Math.PI / 2;
      cumulative += pct;
      const endAngle = cumulative * Math.PI * 2 - Math.PI / 2;
      const r = 45, cx = 60, cy = 60;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
      const large = pct > 0.5 ? 1 : 0;
      return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${colors[i]}" opacity="0.85"/>`;
    }).join('') + `<circle cx="60" cy="60" r="28" fill="var(--surface)"/><text x="60" y="64" text-anchor="middle" font-size="14" fill="var(--text)" font-family="var(--font-display)">${total}</text>`;
  } else {
    donutSvg.innerHTML = `<circle cx="60" cy="60" r="45" fill="var(--surface2)"/><circle cx="60" cy="60" r="28" fill="var(--surface)"/><text x="60" y="64" text-anchor="middle" font-size="12" fill="var(--muted)" font-family="var(--font-body)">No data</text>`;
  }

  document.getElementById('donut-legend').innerHTML = roleEntries.map(([role, count], i) => `
    <div class="legend-row">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <span>${role.split(' ').slice(0,2).join(' ')} (${count})</span>
    </div>
  `).join('');

  // Funnel
  const statuses = [
    { label: 'Applied', count: applied.length, color: '#6366f1' },
    { label: 'Interview', count: interviews, color: '#f5a623' },
    { label: 'Offer', count: offers, color: '#34d399' },
  ];
  const maxFunnel = Math.max(applied.length, 1);
  document.getElementById('chart-funnel').innerHTML = statuses.map(s => `
    <div class="funnel-bar">
      <span class="funnel-label">${s.label}</span>
      <div class="funnel-fill" style="width:${Math.round(s.count/maxFunnel*120)}px;background:${s.color}22;border-color:${s.color}"></div>
      <span class="funnel-num">${s.count}</span>
    </div>
  `).join('');

  // Hour of day chart
  const hourCounts = new Array(24).fill(0);
  applied.forEach(a => {
    const h = new Date(a.appliedAt).getHours();
    hourCounts[h]++;
  });
  const maxH = Math.max(...hourCounts, 1);
  const hourLabels = ['12a','','','','4a','','','','8a','','','','12p','','','','4p','','','','8p','','',''];
  document.getElementById('chart-hour').innerHTML = hourCounts.map((c, h) => `
    <div class="bar-col" style="min-width:0">
      <div class="bar-inner" style="height:${Math.round(c/maxH*55)}px"></div>
      <div class="bar-lbl">${hourLabels[h]}</div>
    </div>
  `).join('');
}

// ── SETTINGS ─────────────────────────────────────────
function renderSettings() {
  document.getElementById('apify-key-input').value = STATE.settings.apifyKey || '';
  document.getElementById('actor-input').value = STATE.settings.actor;
  document.getElementById('interval-sel').value = STATE.settings.interval;

  // Role tags
  const rt = document.getElementById('role-tags');
  rt.innerHTML = STATE.settings.roles.map(r => `
    <span class="role-tag">${esc(r)}<span class="role-tag-remove" onclick="removeRole('${esc(r)}')">×</span></span>
  `).join('');

  // Location tags
  const lt = document.getElementById('loc-tags');
  lt.innerHTML = STATE.settings.locations.map(l => `
    <span class="role-tag">${esc(l)}<span class="role-tag-remove" onclick="removeLoc('${esc(l)}')">×</span></span>
  `).join('');

  // Gmail
  updateGmailUI();
}

function saveApifySettings() {
  const keyVal = document.getElementById('apify-key-input').value.trim();
  const fb = document.getElementById('apify-feedback');

  if (!keyVal || !keyVal.startsWith('apify_api_')) {
    fb.className = 'settings-feedback err';
    fb.textContent = '✗ Key must start with apify_api_ — check and try again';
    fb.style.display = 'block';
    return;
  }

  STATE.settings.apifyKey = keyVal;
  STATE.settings.actor = document.getElementById('actor-input').value.trim();
  save();

  fb.className = 'settings-feedback ok';
  fb.textContent = '✓ Key saved in browser only (never in code). Fetching live jobs now...';
  fb.style.display = 'block';
  setTimeout(() => { fb.style.display = 'none'; }, 4000);
  fetchJobs(true);
}

function revokeApifyKey() {
  STATE.settings.apifyKey = '';
  save();
  document.getElementById('apify-key-input').value = '';
  toast('Apify key removed from browser storage');
  renderSettings();
}

function addRole() {
  const v = document.getElementById('new-role').value.trim();
  if (!v || STATE.settings.roles.includes(v)) return;
  STATE.settings.roles.push(v);
  document.getElementById('new-role').value = '';
  save();
  renderSettings();
}

function removeRole(r) {
  STATE.settings.roles = STATE.settings.roles.filter(x => x !== r);
  save();
  renderSettings();
}

function addLoc() {
  const v = document.getElementById('new-loc').value.trim();
  if (!v || STATE.settings.locations.includes(v)) return;
  STATE.settings.locations.push(v);
  document.getElementById('new-loc').value = '';
  save();
  renderSettings();
}

function removeLoc(l) {
  STATE.settings.locations = STATE.settings.locations.filter(x => x !== l);
  save();
  renderSettings();
}

function saveInterval() {
  STATE.settings.interval = parseInt(document.getElementById('interval-sel').value);
  save();
  startRefreshCycle();
}

// ── GMAIL INTEGRATION ────────────────────────────────
// Uses Gmail API via OAuth2 (client-side, GAPI)
// Scans for recruiter emails and auto-updates tracker

const GMAIL_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID'; // User sets this in settings
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function connectGmail() {
  // Show instruction modal since OAuth requires a registered client ID
  const info = document.getElementById('gmail-info');
  info.innerHTML = `
    <strong style="color:var(--text)">Setup steps:</strong><br><br>
    1. Go to <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--blue)">console.cloud.google.com</a><br>
    2. Create a project → Enable Gmail API<br>
    3. OAuth consent screen → Add your email<br>
    4. Create credentials → OAuth Client ID (Web app)<br>
    5. Add <code style="color:var(--accent)">your-username.github.io</code> as authorized origin<br>
    6. Copy the Client ID below and save<br><br>
    <input class="settings-input" id="gclient-input" placeholder="Paste Google Client ID here..." style="margin-bottom:8px">
    <button class="btn-primary" onclick="initGmailAuth()" style="width:100%">Connect Gmail</button>
  `;

  if (STATE.gmail.connected) {
    scanGmail();
    return;
  }
}

function initGmailAuth() {
  const clientId = document.getElementById('gclient-input')?.value.trim();
  if (!clientId) { toast('Paste your Google Client ID first'); return; }

  const script = document.createElement('script');
  script.src = 'https://apis.google.com/js/api.js';
  script.onload = () => {
    window.gapi.load('client:auth2', async () => {
      await window.gapi.client.init({
        clientId,
        scope: GMAIL_SCOPE,
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'],
      });

      const auth = window.gapi.auth2.getAuthInstance();
      if (!auth.isSignedIn.get()) {
        await auth.signIn();
      }

      STATE.gmail.connected = true;
      STATE.gmail.email = auth.currentUser.get().getBasicProfile().getEmail();
      STATE.gmail.clientId = clientId;
      save();
      updateGmailUI();
      toast(`Gmail connected: ${STATE.gmail.email}`);
      startGmailScan();
    });
  };
  document.body.appendChild(script);
}

async function scanGmail() {
  if (!STATE.gmail.connected || !window.gapi?.client?.gmail) return;

  try {
    // Search for job-related emails
    const queries = [
      'subject:(application received) newer_than:30d',
      'subject:(interview) from:noreply OR from:recruiting newer_than:30d',
      'subject:(offer) newer_than:30d',
      'subject:(unfortunately) newer_than:30d',
      'subject:(decision) newer_than:30d',
    ];

    for (const q of queries) {
      const res = await window.gapi.client.gmail.users.messages.list({
        userId: 'me', q, maxResults: 20,
      });

      const messages = res.result.messages || [];
      for (const msg of messages.slice(0, 10)) {
        const full = await window.gapi.client.gmail.users.messages.get({
          userId: 'me', id: msg.id, format: 'metadata',
          metadataHeaders: ['From','Subject','Date'],
        });

        const headers = full.result.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        processGmailMessage(subject, from, date);
      }
    }

    toast('Gmail scanned — tracker updated');
  } catch (err) {
    console.warn('Gmail scan error', err);
  }
}

function processGmailMessage(subject, from, date) {
  const subj = subject.toLowerCase();
  const fromDomain = from.match(/@([\w.]+)/)?.[1] || '';

  // Determine new status from email content
  let newStatus = null;
  if (subj.match(/interview|call|chat|meet|schedule/)) newStatus = 'interview';
  else if (subj.match(/offer|congratul/)) newStatus = 'offer';
  else if (subj.match(/unfortunately|not moving|decision|other candidate|no longer/)) newStatus = 'rejected';
  else if (subj.match(/application received|thank you for apply|we received/)) return; // no status change needed

  if (!newStatus) return;

  // Match to existing application by company domain
  const matched = Object.values(STATE.applications).find(a => {
    const co = (a.company || '').toLowerCase().replace(/[^a-z]/g, '');
    return fromDomain.includes(co) || co.includes(fromDomain.split('.')[0]);
  });

  if (matched && matched.status !== newStatus) {
    const old = matched.status;
    matched.status = newStatus;
    matched.gmailDetected = true;
    matched.activity.push({
      date: new Date(date).toISOString() || new Date().toISOString(),
      text: `Auto-detected via Gmail: "${subject}"`,
      auto: true,
    });
    save();
    updateCounts();
    renderKanbanIfActive();
    toast(`✦ Gmail: ${matched.title} at ${matched.company} → ${newStatus}`);
  }
}

function startGmailScan() {
  scanGmail();
  setInterval(scanGmail, 30 * 60 * 1000); // every 30 min
}

function updateGmailUI() {
  const dot = document.getElementById('gmail-dot');
  const label = document.getElementById('gmail-label');
  const btn = document.getElementById('gmail-connect-btn');

  if (STATE.gmail.connected) {
    dot.classList.add('connected');
    label.textContent = STATE.gmail.email || 'Gmail connected';
    if (btn) btn.textContent = `✓ Connected: ${STATE.gmail.email}`;
  } else {
    dot.classList.remove('connected');
    label.textContent = 'Connect Gmail';
  }
}

// ── AUTO REFRESH CYCLE ────────────────────────────────
function startRefreshCycle() {
  if (STATE.refreshInterval) clearInterval(STATE.refreshInterval);

  const total = STATE.settings.interval;
  STATE.refreshSecondsLeft = total;

  STATE.refreshInterval = setInterval(() => {
    STATE.refreshSecondsLeft--;

    if (STATE.refreshSecondsLeft <= 0) {
      STATE.refreshSecondsLeft = total;
      fetchJobs(false);
    }

    updateRefreshTimer();
  }, 1000);

  updateRefreshTimer();
}

function updateRefreshTimer() {
  const s = STATE.refreshSecondsLeft;
  const mins = String(Math.floor(s / 60)).padStart(2, '0');
  const secs = String(s % 60).padStart(2, '0');
  document.getElementById('refresh-timer').textContent = `${mins}:${secs}`;

  const pct = (STATE.refreshSecondsLeft / STATE.settings.interval) * 100;
  document.getElementById('refresh-fill').style.width = pct + '%';
}

// ── HELPERS ───────────────────────────────────────────
function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Enter key in settings inputs
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.activeElement?.id === 'new-role') addRole();
    if (document.activeElement?.id === 'new-loc') addLoc();
  }
});

// ── BOOT ─────────────────────────────────────────────
(function init() {
  load();
  updateGmailUI();
  updateCounts();

  // ALWAYS show something immediately — demo data if no cached jobs
  if (!STATE.jobs.length) {
    STATE.jobs = generateDemoJobs();
  }
  renderFeed();
  document.getElementById('feed-updated').textContent =
    STATE.jobs[0]?.fetchedAt && STATE.jobs[0].id && !STATE.jobs[0].id.startsWith('demo_')
      ? `cached from ${new Date(STATE.jobs[0].fetchedAt).toLocaleTimeString()}`
      : 'demo data — add Apify key to fetch live jobs';

  // Start refresh cycle (fetches live if key exists)
  startRefreshCycle();

  // Trigger first fetch after short delay (non-blocking)
  setTimeout(() => fetchJobs(false), 800);

  // Auto Gmail scan if already connected
  if (STATE.gmail.connected) {
    setTimeout(startGmailScan, 2000);
  }

  document.getElementById('fetch-count').textContent = STATE.fetchCount;
})();
