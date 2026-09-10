# 🚀 Auto-Apply Command Center (v2.5)

> Autonomous, intelligent multi-platform job application system for **Wellfound**, **Naukri**, and **Indeed** built with **Playwright**, **Stealth CDP Automation**, **Local AI / Gemini**, a **Dynamic Q&A Knowledge Bank**, and a **Real-Time Web Dashboard**.

[![Repository](https://img.shields.io/badge/GitHub-Satyam--xD%2FWellfound--Apply-blue?style=flat&logo=github)](https://github.com/Satyam-xD/Wellfound-Apply)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=flat&logo=node.js)](https://nodejs.org)
[![Platforms](https://img.shields.io/badge/Platforms-Wellfound%20%7C%20Naukri%20%7C%20Indeed-success?style=flat)](https://wellfound.com)
[![Dashboard](https://img.shields.io/badge/Dashboard-localhost%3A3456-6366f1?style=flat)](http://localhost:3456)
[![License: ISC](https://img.shields.io/badge/License-ISC-purple.svg)](https://opensource.org/licenses/ISC)

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Local Web Dashboard (Command Center)](#-local-web-dashboard-command-center)
- [Smart Q&A Bank & Pause Alerts](#-smart-qa-bank--pause-alerts)
- [Dynamic Resume Switcher](#-dynamic-role-based-resume-switcher)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
  - [1. Installation](#1-installation)
  - [2. Configuration via Dashboard or .env](#2-configuration-via-dashboard-or-env)
  - [3. One-Time Login](#3-one-time-login)
  - [4. Launch Modes](#4-launch-modes)
- [CLI & Script Reference](#-cli--script-reference)
- [Automated Scheduling (Windows Task Scheduler)](#-automated-scheduling-windows-task-scheduler)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Disclaimer](#-disclaimer)

---

## 🌟 Overview

**Auto-Apply Command Center** automates the entire software engineering job application workflow across the 3 largest job platforms simultaneously:

1. **Launches stealth Chrome sessions** reusing your existing logins with anti-bot automation flags stripped.
2. **Filters listings intelligently** by candidate keywords, experience criteria, and senior/lead title blocklists.
3. **Selects the best resume PDF dynamically** based on job keywords (React, Backend/Python, AI/ML).
4. **Fills forms with 100% accuracy** using a persistent [qa-bank.json](qa-bank.json) database — pausing and alerting you with an in-page popup if an unknown question appears.
5. **Automatically solves Cloudflare Turnstile bot challenges** using trusted CDP hardware mouse clicks.
6. **Streams live execution logs in real time** to a local web dashboard on port `3456`.
7. **Logs every application** to `applications.csv` while enforcing strict daily safety limits (Wellfound: 50/day, Naukri: 50/day, Indeed: 60/day).

---

## ✨ Key Features

- 🖥️ **All-in-One Local Web Dashboard**:
  - Live execution feed with real-time Server-Sent Events (SSE).
  - One-click launch (`Dry Run` or `Live`) for Wellfound, Naukri, or Indeed.
  - Complete **Profile & Settings** editor that updates `.env` directly from the browser.
  - Live **Q&A Bank editor** and **Applications CSV explorer** (88+ applications loaded).

- ❓ **Persistent Q&A Knowledge Bank (`qa-bank.json`)**:
  - Prioritizes your exact answers for notice period, salary expectations, CTC, experience, relocation, and skills.
  - **Zero wrong answers**: When an unknown question appears, the bot pauses, chimes, and opens an alert popup in Chrome & the dashboard. Once answered, it saves permanently to `qa-bank.json` and resumes automatically.

- 📁 **Dynamic Role-Based Resume Switcher**:
  - Automatically matches job titles and descriptions against customized PDF resumes:
    - `fullstack.pdf` → React, Next.js, Frontend, MERN, Full Stack
    - `backend.pdf` → Python, Go, Node.js, FastAPI, SQL, Microservices
    - `ai_ml.pdf` → AI, GenAI, LLM, RAG, LangChain, Machine Learning
  - Seamless file upload attachment relay across all 3 platforms.

- 🛡️ **Cloudflare Turnstile Auto-Solver & Anti-Bot Protection**:
  - Automatically detects Turnstile iframes on Indeed and dispatches trusted CDP hardware clicks.
  - Strips `--enable-automation` and automation extensions to maintain `navigator.webdriver = false`.

- ⚡ **Multi-Platform Parallel Execution**:
  - Run all 3 platforms in parallel with human-paced randomized delays (60–150s) to protect your accounts.

---

## ⚡ Local Web Dashboard (Command Center)

Launch the dashboard at any time with:

```bash
npm run dashboard
```
*(Or `node dashboard/server.js`)*

Open your browser to: 👉 **[http://localhost:3456](http://localhost:3456)**

### Dashboard Tabs:
1. **📊 Overview & Controls**: Daily quota progress bars, master launcher (`Start All Live`, `Dry Run All`, `Stop All`), quick metrics, and embedded mini-terminal.
2. **🖥️ Live Terminal**: Real-time streaming console logs with auto-scroll, copy, clear, and platform filters (`Wellfound`, `Naukri`, `Indeed`, `Pauses`, `Errors`).
3. **⚙️ Profile & Settings**: Full candidate profile editor (identity, contact, experience, 5 resume highlights, application defaults, speed delays, API keys) saved directly to `.env`.
4. **❓ Q&A Bank**: Live searchable knowledge bank table with instant answer modal.
5. **📄 Applications Log**: Real-time table explorer for `applications.csv` with site dropdown and keyword search.
6. **📁 Dynamic Resumes**: Active keyword profile mappings and file size inspector for `resumes/`.

---

## ❓ Smart Q&A Bank & Pause Alerts

The bot maintains a persistent database at [`qa-bank.json`](qa-bank.json):

```json
{
  "answers": {
    "notice period": "Immediate (0 days)",
    "current ctc": "0",
    "expected ctc": "3-5 LPA",
    "years of experience": "1",
    "experience with react": "1",
    "are you willing to relocate": "Yes",
    "languages known": "English, Hindi"
  },
  "unanswered": []
}
```

- **Exact & Fuzzy Match**: Queries like *"How many years of work experience do you have with React?"* automatically match `"experience with react"`.
- **In-Page & In-Dashboard Alert**: If an unknown question is asked, the bot halts form submission, plays an audio alert, and displays a modal. You type the answer, click **Save & Resume**, and the bot records it permanently so it never stops for that question again.

---

## 📁 Dynamic Role-Based Resume Switcher

Resumes are placed inside the [`resumes/`](resumes/) directory:

```text
resumes/
├── config.json          # Keyword matcher rules & default fallback
├── fullstack.pdf        # Targeted for React / Frontend / Full Stack
├── backend.pdf          # Targeted for Python / Go / Node / Backend
└── ai_ml.pdf            # Targeted for GenAI / LLM / RAG / Machine Learning
```

Configure keywords in [`resumes/config.json`](resumes/config.json). The bot scores the job title and description and attaches the matching resume when file upload dialogs appear.

---

## 🏗️ Architecture

```text
├── dashboard/                   # ⚡ Local Web Control Center
│   ├── server.js                # Node HTTP server, SSE logs streamer & API
│   └── public/                  # Modern Glassmorphic Web App (HTML, CSS, JS)
│
├── shared/                      # 🔄 Shared Multi-Platform Utilities
│   ├── runner/
│   │   ├── browser.js           # Anti-bot Playwright persistent context
│   │   ├── config.js            # Profile and .env loader
│   │   ├── qa-manager.js        # Atomic Q&A Bank reader/writer
│   │   ├── resume-selector.js   # Dynamic role-to-resume scoring
│   │   └── csv-logger.js        # CSV application logger
│   └── inject/
│       └── utils.js             # In-page DOM helpers, countdowns & Q&A matcher
│
├── wellfound/                   # 📁 Wellfound (AngelList) Applier
│   ├── runner/supervisor.js     # Wellfound watcher & CDP click relay
│   └── inject/apply.js          # Wellfound form filler & tailored notes
│
├── naukri/                      # 📁 Naukri FastApply Applier
│   ├── runner/supervisor.js     # Naukri watcher & chatbot answerer
│   └── inject/apply.js          # Naukri questionnaire filler & submitter
│
├── indeed/                      # 📁 Indeed SmartApply Applier
│   ├── runner/supervisor.js     # Indeed Turnstile auto-solver & watcher
│   └── inject/apply.js          # Indeed multi-step form filler & CDP clicker
│
├── resumes/                     # 📄 PDF Resumes & config.json
├── qa-bank.json                 # ❓ Smart Q&A Knowledge Bank
├── applications.csv             # 📊 Centralized submitted applications log
├── index.js                     # 🚀 Multi-platform unified orchestrator
└── .env                         # 🔒 Candidate credentials & settings
```

---

## 🚀 Getting Started

### 1. Installation

```powershell
git clone https://github.com/Satyam-xD/Wellfound-Apply.git
cd Wellfound-Apply
npm install
```

### 2. Configuration via Dashboard or .env

You can configure all details directly in the Web Dashboard at **[http://localhost:3456](http://localhost:3456)** under **Profile & Settings**, or copy [.env.example](.env.example) to `.env`:

```powershell
copy .env.example .env
```

### 3. One-Time Login

Log in once to save your session cookies (never enter passwords during active runs):

```powershell
# Log in to all 3 platforms sequentially:
npm run login

# Or individually:
npm run login:wellfound
npm run login:naukri
npm run login:indeed
```

### 4. Launch Modes

#### Option A: Local Dashboard (Recommended)
```powershell
npm run dashboard
```
Open **[http://localhost:3456](http://localhost:3456)** and click **"Start All Live"** or **"Test Dry Run"**.

#### Option B: Terminal CLI
```powershell
# Run all 3 platforms live in parallel
npm start

# Run all 3 platforms in test Dry Run mode (no submissions)
npm run dry

# Run single platforms live:
npm run indeed
npm run naukri
npm run wellfound
```

---

## 📜 CLI & Script Reference

| Command | NPM Script | Description |
|---|---|---|
| `node dashboard/server.js` | `npm run dashboard` | **Command Center**: Launches Web Dashboard at `http://localhost:3456` |
| `node index.js all --live` | `npm start` | **All Platforms Live**: Runs Wellfound, Naukri, and Indeed in parallel |
| `node index.js all` | `npm run dry` | **All Platforms Dry Run**: Tests all 3 platforms without submitting |
| `node index.js all login` | `npm run login` | Sequential one-time login for all platforms |
| `node index.js indeed --live` | `npm run indeed` | **Indeed Live**: Runs auto-applier with Turnstile auto-solver |
| `node index.js indeed` | `npm run dry:indeed` | **Indeed Dry Run**: Tests Indeed without submitting |
| `node index.js indeed login` | `npm run login:indeed` | One-time login to Indeed |
| `node index.js naukri --live` | `npm run naukri` | **Naukri Live**: Runs FastApply on Naukri |
| `node index.js naukri` | `npm run dry:naukri` | **Naukri Dry Run**: Tests Naukri without submitting |
| `node index.js naukri login` | `npm run login:naukri` | One-time login to Naukri |
| `node index.js wellfound --live` | `npm run wellfound` | **Wellfound Live**: Runs auto-applier on Wellfound |
| `node index.js wellfound` | `npm run dry:wellfound` | **Wellfound Dry Run**: Tests Wellfound without submitting |
| `node index.js wellfound login` | `npm run login:wellfound` | One-time login to Wellfound |
| `node index.js all --live --offscreen` | `npm run offscreen` | Runs all platforms offscreen without stealing active window focus |

---

## ⏰ Automated Scheduling (Windows Task Scheduler)

To run the automation automatically every day at 11:00 AM on Windows:

```powershell
$repo = "D:\well"
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "index.js all --live --offscreen" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 11:00AM
Register-ScheduledTask -TaskName "AutoApplyDaily" -Action $action -Trigger $trigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)
```

Management commands:
```powershell
Start-ScheduledTask AutoApplyDaily       # Trigger immediately
Disable-ScheduledTask AutoApplyDaily     # Pause schedule
Enable-ScheduledTask AutoApplyDaily      # Resume schedule
Unregister-ScheduledTask AutoApplyDaily  # Delete schedule
```

---

## ❓ Troubleshooting & FAQ

- **Cloudflare Turnstile on Indeed:**
  - The bot automatically locates Turnstile iframes and dispatches trusted CDP hardware clicks. If a manual puzzle appears, solve it once in the open browser window.
- **Port 3456 already in use:**
  - Run `taskkill /F /IM node.exe` or start with a custom port: `PORT=3457 npm run dashboard`.
- **Bot pauses on an unknown question:**
  - Check the browser window or the Web Dashboard modal. Type your answer and click **Save & Resume** — it will be permanently remembered in `qa-bank.json`.
- **Reset daily quota counters:**
  - Counters automatically reset each day. To manually reset, delete `apply-state-wellfound.json`, `apply-state-naukri.json`, or `apply-state-indeed.json`.

---

## ⚠️ Disclaimer

Automating job applications may be subject to each platform's Terms of Service. This tool is built for personal productivity and incorporates anti-bot measures, humanized delays, and daily volume caps. Always test with **Dry Run** mode first.
