import { browserManager } from '../browser/browserManager.js';
import { reasoner } from '../agent/geminiReasoner.js';
import { LeadModel, LogModel, QuotaModel, SettingsModel, parsePostAge } from '../db/database.js';

export class FacebookAdapter {
  constructor() {
    this.platform = 'facebook';
  }

  /**
   * Scans Facebook Search for posts asking for recommendations, tools, or services
   */
  async scanLeads(keywords = null, maxPosts = 8) {
    if (!keywords || keywords.length === 0) {
      keywords = SettingsModel.getAll().search_keywords || ['looking for ecommerce', 'shopify store recommendation'];
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();
    const foundLeads = [];
    const niche = SettingsModel.get('niche_target') || 'E-commerce, SaaS, and Digital Product Sales';

    try {
      LogModel.add(this.platform, 'scan_start', `Starting Facebook scan across all ${keywords.length} search keywords`);

      let kwIndex = 0;
      for (const keyword of keywords) {
        kwIndex++;
        const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(keyword)}&filters=eyJycF9jaHJvbm9fc29ydDoiZXhwZWN0ZWRfc29ydF9ieV9kYXRlIn0%3D`; // Recent posts filter
        console.log(`[Facebook] [${kwIndex}/${keywords.length}] Navigating to: ${searchUrl}`);
        LogModel.add(this.platform, 'navigating', `Searching keyword [${kwIndex}/${keywords.length}]: "${keyword}"`);

        await page.goto(searchUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
        await browserManager.humanDelay(3500, 5500);

        await browserManager.smoothScroll(page, 700);
        await browserManager.humanDelay(2500, 4000);

        const rawPosts = await page.evaluate(() => {
          const results = [];
          // Facebook post containers in feed/search
          const feedUnits = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"]'));

          for (const unit of feedUnits) {
            // Find true post permalink
            let postUrl = null;
            const linkCandidates = Array.from(unit.querySelectorAll('a[href]'));
            for (const a of linkCandidates) {
              const href = a.href || '';
              if (
                href.includes('/posts/') ||
                href.includes('/permalink/') ||
                href.includes('story_fbid=') ||
                href.includes('/videos/') ||
                href.includes('/reel/') ||
                href.includes('/photos/')
              ) {
                if (href.includes('story_fbid=')) {
                  try {
                    const u = new URL(href);
                    postUrl = `${u.origin}${u.pathname}?story_fbid=${u.searchParams.get('story_fbid')}&id=${u.searchParams.get('id') || ''}`;
                  } catch {
                    postUrl = href;
                  }
                } else {
                  postUrl = href.split('?')[0];
                }
                break;
              }
            }

            // Check timestamp link which usually points directly to the post permalink
            if (!postUrl) {
              const timeLink = unit.querySelector('span > a[role="link"][href*="facebook.com"], a[aria-label*="ago" i], a[aria-label*="yesterday" i], a[aria-label*="hr" i], a[aria-label*="min" i]');
              if (timeLink && timeLink.href && !timeLink.href.includes('/search/')) {
                postUrl = timeLink.href.split('?')[0];
              }
            }

            // Fallback to page URL with author hash if permalink not extracted
            if (!postUrl) {
              postUrl = window.location.href + '#' + Math.random().toString(36).substring(7);
            }

            // Find post message content
            const messageEl = unit.querySelector('div[dir="auto"], div[data-ad-preview="message"]');
            const postText = messageEl ? messageEl.innerText.trim() : '';

            // Find author
            const authorEl = unit.querySelector('h2 a, h3 a, strong a');
            const authorName = authorEl ? authorEl.innerText.trim() : 'Facebook User';
            const authorUrl = authorEl ? authorEl.href.split('?')[0] : '';

            if (postText.length > 25) {
              results.push({
                post_url: postUrl,
                post_text: postText.slice(0, 800),
                author_name: authorName,
                author_handle: authorName.toLowerCase().replace(/\s+/g, '.'),
                author_url: authorUrl
              });
            }
          }
          return results.slice(0, 10);
        });

        console.log(`[Facebook] Extracted ${rawPosts.length} posts for "${keyword}"`);

        for (const post of rawPosts) {
          try {
            // 1. Check 7-day age constraint
            const postAge = parsePostAge(post.post_text);
            if (!postAge.is_within_7_days) {
              console.log(`[Facebook] Skipping post older than 7 days (${postAge.post_time_text}): ${post.post_url}`);
              continue;
            }

            // 2. Learning Filter: skip blocked authors or disqualified phrases
            const skipCheck = LeadModel.shouldSkipPost(post.author_handle, post.post_text);
            if (skipCheck.skip) {
              console.log(`[Facebook] ⛔ Skipping post (learned filter): ${skipCheck.reason} — @${post.author_handle}`);
              LogModel.add(this.platform, 'lead_skipped_by_learning', skipCheck.reason, { url: post.post_url, author: post.author_handle });
              continue;
            }

            const evaluation = await reasoner.evaluateLeadIntent(post.post_text, niche, keyword);

            if (evaluation.is_lead || evaluation.score >= 50) {
              const aiComment = await reasoner.synthesizeComment(post.post_text, post.author_name, evaluation, niche);

              const leadRecord = {
                platform: this.platform,
                author_name: post.author_name,
                author_handle: post.author_handle,
                author_url: post.author_url,
                post_url: post.post_url,
                post_text: post.post_text,
                intent_score: evaluation.score,
                intent_reason: evaluation.reason,
                keyword_matched: keyword,
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
              LogModel.add(this.platform, 'lead_discovered', `Facebook Lead (${evaluation.score}%, ${postAge.post_time_text}): ${post.author_name}`, { url: post.post_url, score: evaluation.score });
            }
          } catch (evalErr) {
            console.error('[Facebook] Evaluation error:', evalErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[Facebook] Scan failed:', err.message);
      LogModel.add(this.platform, 'error', `Scan failed: ${err.message}`);
    } finally {
      await page.close();
    }

    return foundLeads;
  }

  /**
   * Comments on a Facebook post with robust handling for Lexical editor,
   * collapsed comment boxes, cookie overlays, and login detection.
   */
  async commentOnPost(postUrl, commentText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '20', 10);

    if (quota.comments_count >= maxComments) {
      LogModel.add(this.platform, 'quota_reached', `Daily comment limit (${maxComments}) reached on Facebook.`);
      return { success: false, reason: 'Daily quota exceeded' };
    }

    if (postUrl.includes('/demo') || postUrl.includes('example.com')) {
      LogModel.add(this.platform, 'comment_attempt', `Targeting Facebook post: ${postUrl}`);
      await browserManager.humanDelay(1000, 2000);
      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment posted on Facebook post ${postUrl}!`, { postUrl, commentText });
      return { success: true, post_url: postUrl };
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'comment_attempt', `Commenting on Facebook post: ${postUrl}`);

      // Strip hash fragments if it was a search URL fallback
      const cleanUrl = postUrl.split('#')[0];
      await page.goto(cleanUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(3000, 5000);

      // 1. Dismiss Facebook cookie banners or overlays
      try {
        const cookieBtn = await page.$('button[data-cookiebanner="accept_button"], button:has-text("Allow all cookies"), button:has-text("Decline optional cookies"), div[aria-label="Decline optional cookies"]');
        if (cookieBtn) {
          await cookieBtn.click().catch(() => {});
          await browserManager.humanDelay(800, 1500);
        }
      } catch (_) {}

      // Press Escape to dismiss any popups
      await page.keyboard.press('Escape').catch(() => {});
      await browserManager.humanDelay(500, 1000);

      // 2. Check if Facebook requires login
      const isLoggedOut = await page.evaluate(() => {
        return !!(document.querySelector('input[name="email"]') && document.querySelector('input[name="pass"]')) ||
               window.location.pathname.startsWith('/login');
      });
      if (isLoggedOut) {
        throw new Error('Facebook requires an active login session in Chrome. Please open Facebook in Chrome (:9222) and sign in.');
      }

      // 3. Scroll down slightly to trigger lazy-loading of interactions
      await page.evaluate(() => window.scrollBy(0, 350));
      await browserManager.humanDelay(1500, 2500);

      // 4. Locate comment input trigger or contenteditable box
      const inputSelectors = [
        'div[data-lexical-editor="true"][role="textbox"]',
        'div[aria-label*="Write a comment" i]',
        'div[aria-label*="Write an answer" i]',
        'div[aria-label*="Write a public comment" i]',
        'div[aria-label*="Comment as" i]',
        'div[role="textbox"][contenteditable="true"]',
        'form div[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'form [contenteditable="true"]',
        'textarea[placeholder*="comment" i]'
      ];

      let targetInput = null;
      for (const sel of inputSelectors) {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          targetInput = el;
          break;
        }
      }

      // 5. If comment box is collapsed, click the "Comment" button trigger
      if (!targetInput) {
        console.log('[Facebook] Comment box not yet visible, clicking Comment button trigger...');
        const commentButtonSelectors = [
          'div[aria-label*="Leave a comment" i]',
          'div[aria-label*="Comment" i][role="button"]',
          'div[role="button"]:has-text("Comment")',
          'span:has-text("Comment")',
          'form [role="button"]:has-text("Comment")',
          'div[role="article"] div[role="button"]:has-text("Comment")'
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
        throw new Error('Facebook comment box is collapsed or restricted on this post. You can open the post directly in Chrome to comment.');
      }

      // 6. Focus & Type into the comment input
      await targetInput.click().catch(() => {});
      await browserManager.humanDelay(600, 1200);

      await page.keyboard.type(commentText, { delay: 35 });
      await browserManager.humanDelay(1500, 2500);

      // 7. Submit via Enter key
      await page.keyboard.press('Enter');
      await browserManager.humanDelay(2000, 3500);

      // Check if send button needs to be clicked (e.g. blue arrow or "Post" button)
      const sendButton = await page.$('div[aria-label*="Comment" i][role="button"], div[aria-label*="Post" i][role="button"], div[aria-label*="Send" i], svg[aria-label*="Send" i]');
      if (sendButton && await sendButton.isVisible()) {
        await sendButton.click().catch(() => {});
        await browserManager.humanDelay(2000, 3500);
      }

      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment posted on Facebook!`, { postUrl, commentText });
      return { success: true, post_url: postUrl };
    } catch (err) {
      LogModel.add(this.platform, 'comment_error', `Facebook comment failed: ${err.message}`);
      return { success: false, error: err.message, post_url: postUrl };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Publishes a status update to user feed
   */
  async publishPost(content) {
    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'publish_attempt', `Publishing Facebook update`);
      await page.goto('https://www.facebook.com/', { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2500, 4500);

      // Dismiss cookies
      try {
        const cookieBtn = await page.$('button[data-cookiebanner="accept_button"], button:has-text("Allow all cookies"), button:has-text("Decline optional cookies")');
        if (cookieBtn && await cookieBtn.isVisible()) {
          await cookieBtn.click().catch(() => {});
          await browserManager.humanDelay(600, 1200);
        }
      } catch (_) {}

      // Click "What's on your mind?"
      const composerBtn = await page.$('span:has-text("What\'s on your mind")') ||
                          await page.$('div[role="button"]:has-text("What\'s on your mind")') ||
                          await page.$('div[aria-label*="Create a post" i]') ||
                          await page.$('div[role="button"]:has-text("Create a post")');
      if (composerBtn) {
        await composerBtn.click().catch(() => {});
        await browserManager.humanDelay(2000, 3000);
      }

      const textboxSelectors = [
        'div[role="dialog"] div[data-lexical-editor="true"][role="textbox"]',
        'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
        'div[role="dialog"] div[role="textbox"]',
        'div[data-lexical-editor="true"][role="textbox"]'
      ];
      let textbox = null;
      for (const sel of textboxSelectors) {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          textbox = el;
          break;
        }
      }
      if (!textbox) {
        try {
          textbox = await page.waitForSelector('div[role="dialog"] div[role="textbox"], div[data-lexical-editor="true"][role="textbox"]', { timeout: 8000 });
        } catch (_) {}
      }

      if (!textbox) {
        throw new Error('Facebook composer textbox not found.');
      }

      await browserManager.humanType(page, textbox, content);
      await browserManager.humanDelay(2000, 3500);

      const postBtn = await page.$('div[role="dialog"] div[aria-label="Post"], div[role="dialog"] button:has-text("Post"), div[role="dialog"] div[role="button"]:has-text("Post")');
      if (postBtn && await postBtn.isVisible()) {
        await postBtn.click().catch(() => {});
        await browserManager.humanDelay(4000, 6000);
        QuotaModel.increment(this.platform, 'posts_count');
        LogModel.add(this.platform, 'post_published', `Facebook post published!`);
        return { success: true };
      }
      throw new Error('Post button not found');
    } catch (err) {
      LogModel.add(this.platform, 'publish_error', `Publish failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }
}

export const facebookAdapter = new FacebookAdapter();
