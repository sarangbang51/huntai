# HuntAI — Personal Job Search Dashboard

Your personal job hunting system. Fetches live DA/BA/BI/DE roles every hour, tracks every application, and auto-updates your tracker via Gmail.

---

## 🚀 Deploy to GitHub Pages (10 minutes)

### Step 1 — Create GitHub repo

1. Go to [github.com/new](https://github.com/new)
2. Name it exactly: `huntai` (or anything you want)
3. Set to **Public**
4. Click **Create repository**

### Step 2 — Upload the files

Upload all 3 files to your repo:
- `index.html`
- `styles.css`
- `app.js`

You can drag-and-drop them directly on GitHub.

### Step 3 — Enable GitHub Pages

1. In your repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` → folder: `/ (root)`
4. Click **Save**

Your site will be live at:
`https://YOUR-USERNAME.github.io/huntai/`

---

## ⚙️ Configuration

### Apify (already set)
Your Apify key is pre-loaded. The app uses `curious_coder/linkedin-jobs-scraper` to fetch jobs.

You can change roles and locations anytime from the **Settings** tab inside the app.

### Gmail Auto-Tracking (optional but powerful)

To enable automatic status updates when recruiters email you:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project (e.g. "HuntAI")
3. Enable **Gmail API** → APIs & Services → Enable APIs
4. Go to **OAuth consent screen** → External → Add your Gmail
5. Go to **Credentials** → Create → OAuth 2.0 Client ID
6. Application type: **Web application**
7. Authorized JavaScript origins: `https://YOUR-USERNAME.github.io`
8. Copy the **Client ID**
9. In HuntAI → **Settings** → Connect Gmail → paste Client ID

Once connected, HuntAI scans your inbox every 30 minutes and automatically moves applications to Interview / Offer / Rejected based on emails from recruiters.

---

## 📋 How it works

| Feature | How |
|--------|-----|
| Hourly job fetch | Apify scrapes LinkedIn, filters by your roles + locations |
| Log application | Click "Log Application" on any job card — opens the job + logs it instantly |
| Manual log | Tracker tab → "+ Log application" button |
| Auto status updates | Gmail scan detects recruiter emails, updates Kanban automatically |
| Data persistence | Everything saved to browser localStorage — survives refresh + closing tab |
| Analytics | Applications by day, role breakdown, funnel, hour-of-day chart |

---

## 🔧 Customization

Edit `app.js` — top of file:

```js
STATE.settings = {
  apifyKey: 'your_key_here',
  roles: ['Data Analyst', 'Business Analyst', ...],
  locations: ['Remote', 'United States', 'India'],
  interval: 3600, // seconds between fetches
}
```

Or just use the **Settings** tab in the app — no code needed.

---

## 📦 Files

```
huntai/
├── index.html   — Full dashboard UI
├── styles.css   — Dark theme styling  
├── app.js       — All logic: fetching, tracking, Gmail, charts
└── README.md    — This file
```

---

Built with Claude × Apify. No backend, no database, no cost beyond Apify credits (~$0.01/fetch).
