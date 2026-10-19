import { browserManager } from '../browser/browserManager.js';
import { reasoner } from '../agent/geminiReasoner.js';
import { LogModel, SettingsModel, QuotaModel, db } from '../db/database.js';

// Ensure table exists for tracking managed groups
db.exec(`
  CREATE TABLE IF NOT EXISTS social_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL, -- 'facebook' or 'linkedin'
    group_name TEXT NOT NULL,
    group_url TEXT NOT NULL UNIQUE,
    member_count TEXT,
    activity_rate TEXT,
    privacy TEXT, -- 'Public' or 'Private'
    status TEXT DEFAULT 'active', -- 'active', 'slow', 'dead', 'left'
    rules_summary TEXT,
    rules_allow_links INTEGER DEFAULT 0,
    last_post_date TEXT,
    days_silent INTEGER DEFAULT 0,
    discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export class GroupsEngine {
  /**
   * Search active Facebook groups in target niche
   */
  static async searchFacebookGroups(topic = 'clinic owners dentists', limit = 10) {
    const context = await browserManager.getContext();
    const page = await context.newPage();
    const groups = [];

    try {
      LogModel.add('facebook', 'group_search_start', `Hunting active Facebook groups for: "${topic}"`);
      const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(topic)}`;
      console.log(`[GroupsEngine] Navigating to: ${searchUrl}`);

      await page.goto(searchUrl, { timeout: 40000, waitUntil: 'domcontentloaded' }).catch(() => {});
      await browserManager.humanDelay(3000, 5000);

      // Dismiss cookie/login overlays if any
      await page.keyboard.press('Escape').catch(() => {});
      await browserManager.smoothScroll(page, 700);
      await browserManager.humanDelay(2000, 3500);

      const parsedGroups = await page.evaluate((maxCount) => {
        const items = [];
        const candidateAnchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
        const seenUrls = new Set();

        for (const a of candidateAnchors) {
          const href = a.href || '';
          if (href.includes('/groups/') && !href.includes('/search/') && !href.includes('/feed/')) {
            const cleanUrl = href.split('?')[0].replace(/\/+$/, '');
            if (seenUrls.has(cleanUrl)) continue;
            seenUrls.add(cleanUrl);

            // Container extraction
            const card = a.closest('div[role="feed"] > div, div[role="article"]') || a.parentElement?.parentElement;
            const cardText = card ? card.innerText : a.innerText;

            // Extract title
            const nameEl = a.querySelector('span, strong') || a;
            const name = nameEl.innerText.trim();

            if (name.length >= 3 && !name.toLowerCase().includes('groups')) {
              // Extract member count & posts per day from text snippet
              const memberMatch = cardText.match(/([\d.,]+[KkMm]?)\s+members/i);
              const activityMatch = cardText.match(/([\d.,]+)\s+posts?\s+(a\s+day|a\s+week|a\s+month)/i);
              const isPrivate = cardText.toLowerCase().includes('private');

              items.push({
                group_name: name,
                group_url: cleanUrl,
                member_count: memberMatch ? memberMatch[0] : 'Active community',
                activity_rate: activityMatch ? activityMatch[0] : 'Regular posts',
                privacy: isPrivate ? 'Private' : 'Public',
                snippet: cardText.slice(0, 300)
              });
            }
          }
          if (items.length >= maxCount) break;
        }
        return items;
      }, limit);

      const insertStmt = db.prepare(`
        INSERT INTO social_groups (platform, group_name, group_url, member_count, activity_rate, privacy, status, updated_at)
        VALUES ('facebook', @group_name, @group_url, @member_count, @activity_rate, @privacy, 'active', CURRENT_TIMESTAMP)
        ON CONFLICT(group_url) DO UPDATE SET
          member_count = excluded.member_count,
          activity_rate = excluded.activity_rate,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const g of parsedGroups) {
        try {
          insertStmt.run(g);
          groups.push(g);
        } catch (_) {}
      }

      LogModel.add('facebook', 'group_search_complete', `Discovered ${groups.length} active Facebook groups for "${topic}"`);
    } catch (err) {
      console.error('[GroupsEngine] Facebook group search failed:', err.message);
      LogModel.add('facebook', 'error', `Facebook group search error: ${err.message}`);
    } finally {
      await page.close();
    }

    return groups;
  }

  /**
   * Audits joined groups for inactivity & admin compliance
   */
  static async auditJoinedGroups(platform = 'facebook') {
    const groups = db.prepare('SELECT * FROM social_groups WHERE platform = ? ORDER BY days_silent DESC').all(platform);
    return groups;
  }

  /**
   * Leave or remove a dead group from tracking
   */
  static leaveGroup(groupId) {
    return db.prepare("UPDATE social_groups SET status = 'left', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(groupId);
  }

  /**
   * Synthesize a value-first, admin-safe response to an inquiry post inside a group.
   * Strictly avoids spammy links to prevent admin bans!
   */
  static async synthesizeSafeGroupResponse(postText, authorName, groupRules = '') {
    const niche = SettingsModel.get('niche_target') || 'Clinic Owners & Local Healthcare Providers';
    const hasStrictNoLinks = groupRules.toLowerCase().includes('no links') || groupRules.toLowerCase().includes('no promo');

    const prompt = `You are Suraj Jaiswal, founder of The Digital Frog, an authoritative AI Growth and Video Systems Strategist.
You are writing a helpful, value-first response to an inquiry inside a professional community group.

Target Niche: ${niche}
Group Rules: ${hasStrictNoLinks ? 'STRICT NO-PROMO & NO LINKS POLICY ENFORCED BY ADMIN' : 'Respectful, value-focused engagement'}
Post by ${authorName}: "${postText}"

Guidelines to ensure 100% compliance with group admins:
1. NEVER include URLs or links if the rules restrict promotion.
2. NEVER pitch a sale directly.
3. Answer the person's core problem with 2-3 specific, actionable expert steps.
4. Conclude with an open-ended diagnostic question so the author naturally replies or sends a private message.
5. Keep it warm, concise, and deeply knowledgeable (under 90 words).`;

    try {
      const response = await reasoner.model.generateContent(prompt);
      return response.response.text().trim();
    } catch (_) {
      return `Hey ${authorName}, great question. From working with similar practices, the biggest bottleneck here usually comes down to lead response speed and consistent educational video presence. A great first step is mapping out your top 3 patient objections and answering them in short 45-second clips. Happy to share a quick structure if you're exploring this!`;
    }
  }
}
