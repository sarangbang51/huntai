# HuntAI V2 — Setup Guide

## What's new in V2
- ✅ Supabase cloud database (data works across all browsers/devices)
- ✅ AI resume matching powered by Claude (match score on every job)
- ✅ AI cover letter generation (one click per job)
- ✅ AI tailored resume bullets (rewritten in the job's language)
- ✅ Google Jobs scraper (company sites + Greenhouse/Lever/Workday/Indeed)
- ✅ LinkedIn scraper (existing, confirmed working)

---

## Step 1 — Deploy to GitHub Pages
Replace your existing 3 files on GitHub:
- `index.html`
- `app.js`
- `styles.css`

---

## Step 2 — Supabase Setup (5 mins)

1. Go to **supabase.com** → Sign up with GitHub
2. Click **New Project** → name it `huntai`
3. Choose a region close to you
4. Go to **SQL Editor** (left sidebar)
5. Run this SQL:

```sql
CREATE TABLE huntai_profile (
  id text PRIMARY KEY,
  years_exp text,
  skills text,
  ntfy_topic text,
  resume_text text,
  resume_filename text,
  updated_at timestamptz
);

CREATE TABLE huntai_applications (
  id text PRIMARY KEY,
  title text,
  company text,
  location text,
  source text,
  url text,
  status text,
  notes text,
  sponsorship text,
  applied_at timestamptz,
  activity text,
  gmail_detected bool DEFAULT false,
  updated_at timestamptz
);
```

6. Go to **Settings → API**
7. Copy **Project URL** and **anon/public key**
8. In HuntAI → Settings → Supabase → paste both → Connect & Sync

---

## Step 3 — Anthropic API Key (for AI features)

1. Go to **console.anthropic.com** → Sign up
2. Go to **API Keys** → Create Key
3. Copy the key (starts with `sk-ant-`)
4. In HuntAI → Settings → Anthropic → paste key → Save

Free tier gives $5 credit ≈ 500 job analyses

---

## Step 4 — Upload Your Resume

1. Convert your PDF resume to .txt (open in Word → Save As → Plain Text)
2. In HuntAI → Settings → Resume → Upload Resume (.txt)
3. Resume is stored in Supabase — available everywhere

---

## How AI matching works

Every job card shows a **% match** based on your skills and experience level.

Click **✦ AI** on any job card to get:
- Detailed match score with explanation
- Gaps between your profile and the job
- Cover letter (one click, tailored to that specific role + company)
- Resume bullets rewritten in the job's language

---

## Keys — where they're stored

| Key | Stored in |
|-----|-----------|
| Apify API key | Browser localStorage |
| Anthropic API key | Browser localStorage |
| Supabase URL + key | Browser localStorage |
| Your applications | Supabase database |
| Your resume | Supabase database |
| Your profile | Supabase database |

---

Built by Sarang Bang × Claude
