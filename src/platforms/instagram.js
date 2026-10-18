import { browserManager } from '../browser/browserManager.js';
import { reasoner } from '../agent/geminiReasoner.js';
import { LeadModel, LogModel, QuotaModel, SettingsModel, parsePostAge } from '../db/database.js';

export class InstagramAdapter {
  constructor() {
    this.platform = 'instagram';
  }

  /**
   * Scans Instagram tags and explore posts for service inquiries
   */
  async scanLeads(hashtags = null, maxPosts = 8) {
    if (!hashtags || hashtags.length === 0) {
      hashtags = ['ecommercegrowth', 'shopifytips', 'saasstartup', 'dropshippingstore', 'automationtools', 'leadgeneration'];
      // Clean and deduplicate tags
      const cleanList = [];
      for (const item of hashtags) {
        const words = String(item).toLowerCase().split(/\s+/).filter(w => !['looking', 'for', 'need', 'who', 'can', 'someone', 'to', 'a', 'an', 'the'].includes(w));
        const combined = words.join('').replace(/[^a-z0-9]/g, '');
        if (combined.length >= 3) cleanList.push(combined);
        // Also add multi-word clean subterms if helpful
        if (words.length >= 2) {
          const sub = words.slice(-2).join('').replace(/[^a-z0-9]/g, '');
          if (sub.length >= 4 && !cleanList.includes(sub)) cleanList.push(sub);
        }
      }
      hashtags = [...new Set(cleanList)];
      if (hashtags.length === 0) hashtags = ['ecommercegrowth', 'shopifytips', 'saasstartup'];
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();
    const foundLeads = [];
    const niche = SettingsModel.get('niche_target') || 'E-commerce, SaaS, and Digital Product Sales';

    try {
      LogModel.add(this.platform, 'scan_start', `Starting Instagram scan across all ${hashtags.length} tags`);

      let tagIndex = 0;
      for (const tag of hashtags) {
        tagIndex++;
        const cleanTag = tag.replace('#', '').trim();
        const tagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanTag)}/`;
        console.log(`[Instagram] [${tagIndex}/${hashtags.length}] Navigating to: ${tagUrl}`);
        LogModel.add(this.platform, 'navigating', `Exploring tag [${tagIndex}/${hashtags.length}]: #${cleanTag}`);

        await page.goto(tagUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
        await browserManager.humanDelay(3000, 5000);

        await browserManager.smoothScroll(page, 500);
        await browserManager.humanDelay(2000, 3500);

        // Find post links
        const postHrefs = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
          return [...new Set(links.map(l => l.href))].slice(0, 4);
        });

        for (const postUrl of postHrefs) {
          try {
            await page.goto(postUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
            await browserManager.humanDelay(2000, 4000);

            const postData = await page.evaluate(() => {
              const captionEl = document.querySelector('h1, span._ap3a._aaco._aacu._aacx._aad7._aade');
              const text = captionEl ? captionEl.innerText : '';
              const authorEl = document.querySelector('header a[role="link"]');
              const authorHandle = authorEl ? authorEl.innerText : 'user';
              const timeEl = document.querySelector('time');
              const timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText) : '';
              return {
                text,
                author_handle: authorHandle,
                author_name: authorHandle,
                author_url: authorEl ? authorEl.href : '',
                timestamp
              };
            });

            if (postData.text && postData.text.length > 20) {
              // 1. Check 7-day age constraint
              const postAge = parsePostAge(postData.text, postData.timestamp);
              if (!postAge.is_within_7_days) {
                console.log(`[Instagram] Skipping post older than 7 days (${postAge.post_time_text}): ${postUrl}`);
                continue;
              }

              // 2. Learning Filter: skip blocked authors or disqualified patterns
              const skipCheck = LeadModel.shouldSkipPost(postData.author_handle, postData.text);
              if (skipCheck.skip) {
                console.log(`[Instagram] ⛔ Skipping post (learned filter): ${skipCheck.reason} — @${postData.author_handle}`);
                LogModel.add(this.platform, 'lead_skipped_by_learning', skipCheck.reason, { url: postUrl, author: postData.author_handle });
                continue;
              }

              const evaluation = await reasoner.evaluateLeadIntent(postData.text, niche, `#${tag}`);

              if (evaluation.is_lead || evaluation.score >= 45) {
                const aiComment = await reasoner.synthesizeComment(postData.text, postData.author_name, evaluation, niche);

                const leadRecord = {
                  platform: this.platform,
                  author_name: postData.author_name,
                  author_handle: postData.author_handle,
                  author_url: postData.author_url,
                  post_url: postUrl,
                  post_text: postData.text.slice(0, 800),
                  intent_score: evaluation.score,
                  intent_reason: evaluation.reason,
                  keyword_matched: `#${tag}`,
                  status: 'discovered',
                  ai_comment: aiComment,
                  post_date: postAge.post_date,
                  post_time_text: postAge.post_time_text,
                  post_age_days: postAge.post_age_days,
                  discovered_at: new Date().toISOString(),
                  reached_out_at: null,
                  last_comment_url: null
                };

                LeadModel.create(leadRecord);
                foundLeads.push(leadRecord);
                LogModel.add(this.platform, 'lead_discovered', `Instagram Lead (${evaluation.score}%, ${postAge.post_time_text}): @${postData.author_handle}`, { url: postUrl, score: evaluation.score });
              }
            }
          } catch (itemErr) {
            console.error('[Instagram] Post evaluation error:', itemErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[Instagram] Scan failed:', err.message);
      LogModel.add(this.platform, 'error', `Instagram scan failed: ${err.message}`);
    } finally {
      await page.close();
    }

    return foundLeads;
  }

  /**
   * Comments on an Instagram post
   */
  async commentOnPost(postUrl, commentText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '20', 10);

    if (quota.comments_count >= maxComments) {
      LogModel.add(this.platform, 'quota_reached', `Daily comment limit (${maxComments}) reached on Instagram.`);
      return { success: false, reason: 'Daily quota exceeded' };
    }

    if (postUrl.includes('/demo') || postUrl.includes('/p/demo') || postUrl.includes('example.com')) {
      LogModel.add(this.platform, 'comment_attempt', `Targeting Instagram post: ${postUrl}`);
      await browserManager.humanDelay(1000, 2000);
      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment posted on Instagram post ${postUrl}!`, { postUrl, commentText });
      return { success: true, post_url: postUrl };
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'comment_attempt', `Commenting on Instagram post: ${postUrl}`);
      await page.goto(postUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(3000, 5000);

      const commentArea = 'textarea[aria-label*="Add a comment"], textarea[placeholder*="Add a comment"]';
      await page.waitForSelector(commentArea, { timeout: 10000 });
      await browserManager.humanType(page, commentArea, commentText);
      await browserManager.humanDelay(1500, 2500);

      // Click "Post"
      const postBtn = await page.$('div[role="button"]:has-text("Post")') || await page.$('button:has-text("Post")');
      if (postBtn) {
        await postBtn.click();
        await browserManager.humanDelay(3000, 5000);
        QuotaModel.increment(this.platform, 'comments_count');
        LogModel.add(this.platform, 'comment_posted', `Comment posted on Instagram!`, { postUrl, commentText });
        return { success: true };
      }
      throw new Error('Instagram Post button not found');
    } catch (err) {
      LogModel.add(this.platform, 'comment_error', `Instagram comment failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close();
    }
  }

  /**
   * Sends a 1-on-1 direct message on Instagram
   */
  async sendDM(username, messageText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxDMs = parseInt(SettingsModel.get('daily_max_dms') || '10', 10);

    if (quota.dms_count >= maxDMs) {
      LogModel.add(this.platform, 'quota_reached', `Daily DM limit reached on Instagram.`);
      return { success: false, reason: 'Daily DM quota exceeded' };
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      const cleanUser = username.replace('@', '');
      LogModel.add(this.platform, 'dm_attempt', `Sending DM to @${cleanUser}`);
      await page.goto(`https://www.instagram.com/direct/t/new/`, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(3000, 4500);

      // Search recipient
      const searchInput = 'input[name="queryBox"], input[placeholder*="Search"]';
      await page.waitForSelector(searchInput, { timeout: 10000 });
      await browserManager.humanType(page, searchInput, cleanUser);
      await browserManager.humanDelay(2000, 3000);

      // Select first match
      const userItem = await page.$(`span:has-text("${cleanUser}")`) || await page.$('div[role="button"][tabindex="0"]');
      if (userItem) {
        await userItem.click();
        await browserManager.humanDelay(1500, 2500);
      }

      // Click "Chat" / "Next"
      const chatBtn = await page.$('div[role="button"]:has-text("Chat")') || await page.$('div[role="button"]:has-text("Next")');
      if (chatBtn) {
        await chatBtn.click();
        await browserManager.humanDelay(2000, 3500);
      }

      // Enter message
      const msgBox = 'div[role="textbox"][contenteditable="true"]';
      await page.waitForSelector(msgBox, { timeout: 10000 });
      await browserManager.humanType(page, msgBox, messageText);
      await browserManager.humanDelay(1500, 2500);

      await page.keyboard.press('Enter');
      await browserManager.humanDelay(3000, 5000);

      QuotaModel.increment(this.platform, 'dms_count');
      LogModel.add(this.platform, 'dm_sent', `Instagram DM sent to @${cleanUser}!`);
      return { success: true };
    } catch (err) {
      LogModel.add(this.platform, 'dm_error', `DM to @${username} failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close();
    }
  }
}

export const instagramAdapter = new InstagramAdapter();
