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
      const cleanUrl = postUrl.split('?')[0].split('#')[0];
      await page.goto(cleanUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(3000, 5000);

      // 1. Dismiss cookie banners or popups
      try {
        const cookieBtn = await page.$('button:has-text("Allow all cookies"), button:has-text("Decline optional cookies"), button:has-text("Only allow essential cookies"), button:has-text("Accept")');
        if (cookieBtn && await cookieBtn.isVisible()) {
          await cookieBtn.click().catch(() => {});
          await browserManager.humanDelay(600, 1200);
        }
        const notNowBtn = await page.$('button:has-text("Not Now"), button:has-text("Cancel")');
        if (notNowBtn && await notNowBtn.isVisible()) {
          await notNowBtn.click().catch(() => {});
          await browserManager.humanDelay(400, 800);
        }
      } catch (_) {}

      await page.keyboard.press('Escape').catch(() => {});
      await browserManager.humanDelay(400, 800);

      // 2. Check if logged out
      const isLoggedOut = await page.evaluate(() => {
        return window.location.pathname.includes('/accounts/login') ||
               !!document.querySelector('form#loginForm, input[name="username"]');
      });
      if (isLoggedOut) {
        throw new Error('Instagram requires an active login session in Chrome. Please open Instagram in Chrome (:9222) and sign in.');
      }

      // Check if post is missing
      const isUnavailable = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return text.includes("Sorry, this page isn't available") || text.includes("Page Not Found");
      });
      if (isUnavailable) {
        throw new Error(`Target Instagram post is unavailable or private: ${postUrl}`);
      }

      // 3. Scroll down slightly to trigger lazy-loading of interactions
      await page.evaluate(() => window.scrollBy(0, 300));
      await browserManager.humanDelay(1500, 2500);

      // 4. Locate comment input trigger or contenteditable box
      const inputSelectors = [
        'textarea[aria-label*="Add a comment" i]',
        'textarea[placeholder*="Add a comment" i]',
        'div[data-lexical-editor="true"][role="textbox"]',
        'div[role="textbox"][contenteditable="true"]',
        'form textarea',
        'textarea'
      ];

      let targetInput = null;
      for (const sel of inputSelectors) {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          targetInput = el;
          break;
        }
      }

      // 5. If comment box is collapsed (e.g. reels or modal view), click comment bubble icon
      if (!targetInput) {
        console.log('[Instagram] Comment box not yet visible, clicking Comment bubble trigger...');
        const commentButtonSelectors = [
          'svg[aria-label*="Comment" i]',
          'div[role="button"]:has(svg[aria-label*="Comment" i])',
          'button:has(svg[aria-label*="Comment" i])',
          'span:has(svg[aria-label*="Comment" i])',
          'div[role="button"][tabindex="0"]:has(svg[aria-label*="Comment" i])'
        ];

        for (const btnSel of commentButtonSelectors) {
          const btn = await page.$(btnSel);
          if (btn && await btn.isVisible()) {
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click().catch(() => {});
            await browserManager.humanDelay(1500, 3000);
            break;
          }
        }

        // Re-check for input after trigger click
        for (const sel of inputSelectors) {
          const el = await page.$(sel);
          if (el && await el.isVisible()) {
            targetInput = el;
            break;
          }
        }
      }

      // If still not found, try waiting briefly with state: 'visible'
      if (!targetInput) {
        const combinedSelector = inputSelectors.join(', ');
        try {
          targetInput = await page.waitForSelector(combinedSelector, { timeout: 8000, state: 'visible' });
        } catch (_) {}
      }

      if (!targetInput) {
        throw new Error('Instagram comment box is collapsed or restricted on this post. You can open the post directly in Chrome to comment.');
      }

      // 6. Focus & Type into the comment input
      await targetInput.scrollIntoViewIfNeeded().catch(() => {});
      await targetInput.click().catch(() => {});
      await browserManager.humanDelay(600, 1200);

      await browserManager.humanType(page, targetInput, commentText);
      await browserManager.humanDelay(1500, 2500);

      // 7. Submit via "Post" button or Enter key
      const postBtn = await page.$('form button[type="submit"], div[role="button"]:has-text("Post"), button:has-text("Post"), div[aria-label="Post"][role="button"]');
      if (postBtn && await postBtn.isVisible()) {
        await postBtn.click().catch(() => {});
        await browserManager.humanDelay(3000, 5000);
      } else {
        await page.keyboard.press('Enter');
        await browserManager.humanDelay(3000, 5000);
      }

      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment posted on Instagram!`, { postUrl, commentText });
      return { success: true, post_url: postUrl };
    } catch (err) {
      LogModel.add(this.platform, 'comment_error', `Instagram comment failed: ${err.message}`);
      return { success: false, error: err.message, post_url: postUrl };
    } finally {
      await page.close().catch(() => {});
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

      // Dismiss cookie banners & popups
      try {
        const notNow = await page.$('button:has-text("Not Now"), button:has-text("Cancel")');
        if (notNow && await notNow.isVisible()) {
          await notNow.click().catch(() => {});
          await browserManager.humanDelay(500, 1000);
        }
      } catch (_) {}

      // Check login state
      const isLoggedOut = await page.evaluate(() => {
        return window.location.pathname.includes('/accounts/login') ||
               !!document.querySelector('form#loginForm, input[name="username"]');
      });
      if (isLoggedOut) {
        throw new Error('Instagram requires an active login session in Chrome. Please open Instagram in Chrome (:9222) and sign in.');
      }

      // Search recipient
      const searchSelectors = ['input[name="queryBox"]', 'input[placeholder*="Search" i]', 'input[type="text"]'];
      let searchInput = null;
      for (const sel of searchSelectors) {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          searchInput = el;
          break;
        }
      }
      if (!searchInput) {
        try {
          searchInput = await page.waitForSelector('input[name="queryBox"], input[placeholder*="Search" i]', { timeout: 8000 });
        } catch (_) {}
      }

      if (!searchInput) {
        throw new Error('Could not find Instagram DM search input.');
      }

      await browserManager.humanType(page, searchInput, cleanUser);
      await browserManager.humanDelay(2000, 3000);

      // Select first match
      const userItem = await page.$(`span:has-text("${cleanUser}")`) ||
                       await page.$(`div[role="button"]:has-text("${cleanUser}")`) ||
                       await page.$('div[role="button"][tabindex="0"]');
      if (userItem) {
        await userItem.click().catch(() => {});
        await browserManager.humanDelay(1500, 2500);
      } else {
        await page.keyboard.press('Enter');
        await browserManager.humanDelay(1000, 2000);
      }

      // Click "Chat" / "Next"
      const chatBtn = await page.$('div[role="button"]:has-text("Chat"), button:has-text("Chat"), div[role="button"]:has-text("Next"), button:has-text("Next")');
      if (chatBtn && await chatBtn.isVisible()) {
        await chatBtn.click().catch(() => {});
        await browserManager.humanDelay(2000, 3500);
      }

      // Enter message in DM box
      const msgSelectors = [
        'div[data-lexical-editor="true"][role="textbox"]',
        'div[role="textbox"][contenteditable="true"]',
        'div[role="textbox"]',
        'textarea'
      ];
      let msgBox = null;
      for (const sel of msgSelectors) {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          msgBox = el;
          break;
        }
      }
      if (!msgBox) {
        try {
          msgBox = await page.waitForSelector('div[role="textbox"][contenteditable="true"], div[role="textbox"]', { timeout: 8000 });
        } catch (_) {}
      }

      if (!msgBox) {
        throw new Error('Could not find Instagram DM message box.');
      }

      await browserManager.humanType(page, msgBox, messageText);
      await browserManager.humanDelay(1500, 2500);

      await page.keyboard.press('Enter');
      await browserManager.humanDelay(2500, 4000);

      // Click Send button fallback
      const sendIcon = await page.$('button:has-text("Send"), div[role="button"]:has-text("Send"), svg[aria-label*="Send" i]');
      if (sendIcon && await sendIcon.isVisible()) {
        await sendIcon.click().catch(() => {});
        await browserManager.humanDelay(1500, 2500);
      }

      QuotaModel.increment(this.platform, 'dms_count');
      LogModel.add(this.platform, 'dm_sent', `Instagram DM sent to @${cleanUser}!`, { recipient: cleanUser, messageText });
      return { success: true, recipient: cleanUser };
    } catch (err) {
      LogModel.add(this.platform, 'dm_error', `DM to @${username} failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }
}

export const instagramAdapter = new InstagramAdapter();
