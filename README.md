# Anti-Gravity Autonomous Social Growth & Lead Automation Engine 🚀
*(No-API Browser-Controlled Multi-Platform Agent for Threads, Instagram, Facebook, and LinkedIn)*

## Overview
This automation is an intelligent, browser-controlled social media workflow and growth engine designed to run **without official API keys, developer app reviews, or paywalls**. It uses persistent Chrome sessions and AI reasoning (powered by Gemini) to:
1. **Hunt High-Intent Buying Leads**: Scans social posts across Threads, LinkedIn, Facebook, and Instagram for people explicitly asking for software, store setup, automation, SaaS tools, and development services.
2. **AI Intent Scoring**: Evaluates posts using reasoning models to distinguish genuine buyers (70–100% intent) from noise or spam.
3. **Contextual Humanized Engagement**: Generates value-driven, conversational comments answering their questions instead of generic copy-paste pitches.
4. **1-on-1 Consultative DMs**: Follows up with prospective leads until converted.
5. **Autonomous Content Studio**: Generates platform-tailored viral hooks, thought-leadership posts, and image generation prompts, publishing them directly via browser automation.
6. **Anti-Ban Safeguards**: Implements persistent profiles, human-like typing jitter, random pauses, and strict daily quota limits (e.g. 20 comments/day, 10 DMs/day).

---

## Architecture & Project Structure

```
Lead and Social automation/
├── public/                       # Glassmorphic Control Dashboard (Frontend)
│   ├── index.html                # UI Structure & Navigation
│   ├── style.css                 # Dark Glassmorphism Design System
│   └── app.js                    # WebSockets, Lead Pipeline, & Content Studio
├── src/
│   ├── agent/
│   │   ├── geminiReasoner.js     # AI Intent Scoring, Comment Synthesis, & Post Generator
│   │   └── orchestrator.js       # Master Multi-Platform Task Runner & WebSocket Event Hub
│   ├── browser/
│   │   └── browserManager.js     # Persistent Chrome Context & Stealth Automation
│   ├── platforms/
│   │   ├── threads.js            # Threads Scanner, Commenter, & Thread Publisher
│   │   ├── linkedin.js           # LinkedIn Feed Search, Commenter, & Update Publisher
│   │   ├── facebook.js           # Facebook Search & Group Scanner, Commenter, & Poster
│   │   └── instagram.js          # Instagram Hashtags/Explore Scanner, Commenter, & DM Engine
│   ├── db/
│   │   └── database.js           # Embedded SQLite Database (Leads CRM, Quotas, Logs, Settings)
│   └── server/
│       └── index.js              # Express REST API & WebSocket Server
├── user_data/                    # Persistent Chrome session data (cookies, logins)
├── growth_engine.db              # SQLite Database file
└── package.json                  # Dependencies & scripts
```

---

## Quick Start Guide

### 1. Start the Automation Control Center
The server runs locally on port 3000:
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

### 2. Connect Your Social Accounts (1-Time Setup)
Since this automation works via **browser control without APIs**, you only need to log in once:
1. Go to the **Browser Profiles** tab in the dashboard.
2. Click **Open Threads Login Window**, **Open LinkedIn Login Window**, **Open Facebook Login Window**, or **Open Instagram Login Window**.
3. A visible Chrome window will launch. Log in to your personal or brand profile.
4. Once logged in, your session cookies and tokens are permanently saved in `./user_data/chrome_profile`. You never have to log in again.

---

### 3. Hunt High-Intent Leads
1. Click **Hunt High-Intent Leads** in the top right or go to the **Lead Hunter & CRM** tab.
2. The agent navigates to recent discussions matching your keywords (e.g. `looking for saas`, `need ecommerce store`, `best tool for sales`).
3. Posts are automatically scored for buying intent (0–100%) and saved into your CRM pipeline.
4. You can:
   - Click **💬 Review & Post AI Comment** to preview and publish a contextual reply directly onto their post via browser automation.
   - Click **✉️ Draft & Send DM** to initiate a consultative outreach sequence.
   - Click **🏆 Mark Converted** when the lead enters your sales pipeline.

---

### 4. Content Studio & Publishing
1. Go to the **Content Studio** tab.
2. Choose your platform (LinkedIn, Threads, Facebook).
3. Enter an optional topic angle or click **Generate High-Converting Post & Visual Concept**.
4. The reasoning engine crafts platform-native copy, hashtags, and an image generation prompt.
5. Click **🚀 Publish Now via Browser Control** to have the agent post it directly to your feed.

---

### 5. Customizing Niche & AI Reasoning
Go to the **Agent Intelligence** tab to configure:
- **Target Niche**: Customize your specific service (e.g., E-commerce, SaaS, Web Development, Mobile Apps, Marketing).
- **Search Queries**: Add target keywords where people ask for recommendations.
- **Gemini API Key**: Add your Gemini key (e.g. Gemini 2.5 Flash / Pro) or leave it empty to use the built-in heuristic reasoning engine.
- **Daily Safety Limits**: Adjust max comments and DMs per day to guarantee account safety.
