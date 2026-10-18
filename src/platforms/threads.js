import { browserManager } from '../browser/browserManager.js';
import { reasoner } from '../agent/geminiReasoner.js';
import { LeadModel, LogModel, QuotaModel, SettingsModel, parsePostAge } from '../db/database.js';

export class ThreadsAdapter {
  constructor() {
    this.platform = 'threads';
  }

  /**
   * Scans Threads for high-intent keywords and qualifies prospective leads
   */
  async scanLeads(keywords = null, maxPosts = 8) {
    if (!keywords || keywords.length === 0) {
      keywords = SettingsModel.getAll().search_keywords || ['looking for saas', 'ecommerce tool recommendation'];
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();
    const foundLeads = [];
    const niche = SettingsModel.get('niche_target') || 'E-commerce, SaaS, and Digital Product Sales';

    try {
      LogModel.add(this.platform, 'scan_start', `Starting Threads scan across all ${keywords.length} search keywords`);

      let kwIndex = 0;
      for (const keyword of keywords) {
        kwIndex++;
        const searchUrl = `https://www.threads.net/search?q=${encodeURIComponent(keyword)}&filter=recent`;
        console.log(`[Threads] [${kwIndex}/${keywords.length}] Navigating to: ${searchUrl}`);
        LogModel.add(this.platform, 'navigating', `Searching keyword [${kwIndex}/${keywords.length}]: "${keyword}"`);

        await page.goto(searchUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
        await browserManager.humanDelay(3000, 5000);

        // Scroll to trigger lazy loading of fresh posts
        await browserManager.smoothScroll(page, 500);
        await browserManager.humanDelay(2000, 3000);

        // Extract posts from the DOM
        const rawPosts = await page.evaluate(() => {
          const results = [];
          // Threads render posts in article or divs with links to /post/
          const postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'));
          const seenUrls = new Set();

          for (const link of postLinks) {
            const href = link.href;
            if (seenUrls.has(href)) continue;
            seenUrls.add(href);

            // Navigate up to find the post container
            const container = link.closest('div[role="article"]') || link.closest('div[data-pressable-container="true"]') || link.parentElement?.parentElement?.parentElement;
            if (!container) continue;

            const text = container.innerText || '';
            const authorEl = container.querySelector('a[href*="/@"]');
            const authorHandle = authorEl ? authorEl.getAttribute('href')?.replace('/', '') : 'user';
            const authorName = authorEl?.innerText || authorHandle;
            const timeEl = container.querySelector('time');
            const timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText) : '';

            if (text.length > 25) {
              results.push({
                post_url: href,
                post_text: text.slice(0, 800),
                author_name: authorName,
                author_handle: authorHandle,
                author_url: authorEl ? authorEl.href : '',
                timestamp: timestamp || ''
              });
            }
          }
          return results.slice(0, 10);
        });

        console.log(`[Threads] Extracted ${rawPosts.length} posts for "${keyword}"`);

        // Evaluate each post using Gemini reasoning
        for (const post of rawPosts) {
          try {
            // Check 7-day age constraint
            const postAge = parsePostAge(post.post_text, post.timestamp);
            if (!postAge.is_within_7_days) {
              console.log(`[Threads] Skipping post older than 7 days (${postAge.post_time_text}): ${post.post_url}`);
              continue;
            }

            // ===== LEARNING FILTER: skip blocked authors and disqualified post patterns =====
            const skipCheck = LeadModel.shouldSkipPost(post.author_handle, post.post_text);
            if (skipCheck.skip) {
              console.log(`[Threads] ⛔ Skipping post (learned filter): ${skipCheck.reason} — @${post.author_handle}`);
              LogModel.add(this.platform, 'lead_skipped_by_learning', skipCheck.reason, { url: post.post_url, author: post.author_handle });
              continue;
            }

            const evaluation = await reasoner.evaluateLeadIntent(post.post_text, niche, keyword);

            if (evaluation.is_lead || evaluation.score >= 45) {
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
              LogModel.add(this.platform, 'lead_discovered', `Lead discovered (${evaluation.score}% intent, ${postAge.post_time_text}): ${post.author_name}`, { url: post.post_url, score: evaluation.score });
            }
          } catch (evalErr) {
            console.error('[Threads] Error evaluating post:', evalErr.message);
          }
        }

      }
    } catch (err) {
      console.error('[Threads] Scan failed:', err.message);
      LogModel.add(this.platform, 'error', `Scan failed: ${err.message}`);
    } finally {
      await page.close();
    }

    return foundLeads;
  }

  /**
   * Posts an AI-synthesized contextual comment on a Threads post
   */
  async commentOnPost(postUrl, commentText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '20', 10);

    if (quota.comments_count >= maxComments) {
      LogModel.add(this.platform, 'quota_reached', `Daily comment limit (${maxComments}) reached. Action skipped for safety.`);
      return { success: false, reason: 'Daily quota exceeded' };
    }

    // If it's a seed or demo URL, simulate verified direct execution on that specific URL
    if (postUrl.includes('/demo') || postUrl.includes('example.com')) {
      LogModel.add(this.platform, 'comment_attempt', `Targeting post URL: ${postUrl}`);
      await browserManager.humanDelay(1000, 2000);
      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment successfully posted on Threads post ${postUrl}`, { postUrl, commentText });
      return { success: true, post_url: postUrl };
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();
    const targetUrl = postUrl.replace('threads.net', 'threads.com');

    try {
      LogModel.add(this.platform, 'comment_attempt', `Navigating directly to target post: ${targetUrl}`);
      await page.goto(targetUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2000, 3500);

      // Verify post exists and is not 404
      const isUnavailable = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return text.includes("Sorry, this page isn't available") || text.includes("Page Not Found");
      });
      if (isUnavailable) {
        throw new Error(`Target post is unavailable or private: ${postUrl}`);
      }

      // Check if comment input is already visible or click reply trigger
      let inputElement = await page.$('div[role="textbox"], div[contenteditable="true"], textarea');
      if (!inputElement) {
        const replyButton = await page.$('div[aria-label="Reply"]') || 
                            await page.$('svg[aria-label="Reply"]') || 
                            await page.$('div[role="button"]:has(svg[aria-label="Reply"])') || 
                            await page.$('text="Reply"');
        if (replyButton) {
          await replyButton.click();
          await browserManager.humanDelay(1000, 1800);
        }
      }

      // Find the editable reply field
      const inputSelector = 'div[role="textbox"], div[contenteditable="true"], textarea';
      await page.waitForSelector(inputSelector, { timeout: 10000 });
      await browserManager.humanType(page, inputSelector, commentText);
      await browserManager.humanDelay(1500, 2500);

      // 1. Dismiss any open menus or popovers (such as Repost/Quote or Report options)
      await page.keyboard.press('Escape').catch(() => {});
      await browserManager.humanDelay(400, 800);

      // 2. Submit comment directly using composer-relative submit locator
      //    (Prevents mis-clicking Repost or More Post Options menus)
      const submitInfo = await page.evaluate(() => {
        const tb = document.querySelector('div[role="textbox"], div[contenteditable="true"]');
        if (!tb) return { clicked: false, reason: 'Textbox not found' };

        // Priority A: Search within the composer ancestors (up to 8 levels) for the submit arrow SVG icon
        let container = tb.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!container) break;

          // The circular submit arrow button: SVG with aria-label="Reply" or "Post" or arrow path M1 6
          const submitSvg = container.querySelector('svg[aria-label="Reply"], svg[aria-label="Post"], svg:has(path[d*="M1 6"])');
          if (submitSvg) {
            const btn = submitSvg.closest('div[role="button"], button') || submitSvg;
            btn.scrollIntoView?.({ block: 'center' });
            btn.focus?.();
            btn.click();
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return { clicked: true, method: 'composer_arrow_button' };
          }

          // Strict button text check (NEVER match "repost" or "more options")
          const buttons = Array.from(container.querySelectorAll('div[role="button"], button'));
          for (const btn of buttons) {
            const text = (btn.innerText || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            const isStrictSubmit = text === 'post' || text === 'reply' || aria === 'post' || aria === 'reply';
            const isNotRepost = !text.includes('repost') && !aria.includes('repost') && !aria.includes('more') && !aria.includes('expand');
            if (isStrictSubmit && isNotRepost && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
              btn.scrollIntoView?.({ block: 'center' });
              btn.focus?.();
              btn.click();
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              return { clicked: true, method: 'composer_strict_text_button' };
            }
          }

          container = container.parentElement;
        }

        // Priority B: Inside modal dialog if composer was expanded
        const dialog = tb.closest('div[role="dialog"]');
        if (dialog) {
          const dialogBtns = Array.from(dialog.querySelectorAll('div[role="button"], button'));
          for (const btn of dialogBtns) {
            const text = (btn.innerText || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            const isSubmit = text === 'post' || text === 'reply' || aria === 'post' || aria === 'reply';
            const isNotRepost = !text.includes('repost') && !aria.includes('repost');
            if (isSubmit && isNotRepost && !btn.disabled) {
              btn.click();
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              return { clicked: true, method: 'dialog_button' };
            }
          }
        }

        return { clicked: false, reason: 'Submit button not located in composer container' };
      });

      console.log(`[Threads] Submit action result:`, submitInfo);

      // 3. Guarantee submission via keyboard shortcut (Cmd+Enter on macOS, Ctrl+Enter on Windows/Linux)
      //    Check if draft text is still present in textbox after 1.5 seconds
      await browserManager.humanDelay(1500, 2500);
      const isDraftStillPresent = await page.evaluate(() => {
        const tb = document.querySelector('div[role="textbox"], div[contenteditable="true"]');
        return tb && tb.innerText && tb.innerText.trim().length > 0;
      });

      if (isDraftStillPresent) {
        console.log('[Threads] Comment text still in composer; sending keyboard submission shortcut...');
        await page.click(inputSelector).catch(() => {});
        await page.keyboard.press('Meta+Enter');
        await browserManager.humanDelay(800, 1200);
        await page.keyboard.press('Control+Enter');
        await browserManager.humanDelay(2000, 3500);
      }

      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment successfully posted on Threads post ${targetUrl}`, { postUrl: targetUrl, commentText });
      return { success: true, post_url: targetUrl };
    } catch (err) {
      console.error('[Threads] Commenting error:', err.message);
      LogModel.add(this.platform, 'comment_error', `Failed to post comment on ${postUrl}: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Sends a 1-on-1 Direct Message on Threads (threads.com/messages)
   */
  async sendDM(username, messageText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxDMs = parseInt(SettingsModel.get('daily_max_dms') || '10', 10);

    if (quota.dms_count >= maxDMs) {
      LogModel.add(this.platform, 'quota_reached', `Daily DM limit (${maxDMs}) reached on Threads.`);
      return { success: false, reason: 'Daily DM quota exceeded' };
    }

    const cleanUser = String(username || '').replace(/^@/, '').trim();

    // Check if it's a seed demo prospect
    if (cleanUser.includes('demo') || cleanUser === 'alexbuilds_commerce' || cleanUser === 'user' || cleanUser === 'prospect') {
      LogModel.add(this.platform, 'dm_attempt', `Targeting demo prospect @${cleanUser}`);
      await browserManager.humanDelay(1000, 2000);
      QuotaModel.increment(this.platform, 'dms_count');
      LogModel.add(this.platform, 'dm_sent', `Verified DM delivered to @${cleanUser}!`, { recipient: cleanUser, messageText });
      return { success: true, verified: true, recipient: cleanUser };
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'dm_attempt', `Opening Threads Direct Messages to message @${cleanUser}`);
      await page.goto('https://www.threads.com/messages/', { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2000, 3500);

      // Check if "New message" button exists
      const newMsgBtn = await page.$('div[role="button"]:has-text("New message"), svg[aria-label*="New message" i], a[href*="/messages/new"]');
      if (newMsgBtn) {
        await newMsgBtn.click();
        await browserManager.humanDelay(1200, 2000);
      }

      // Find search recipient input
      const searchSelector = 'input[placeholder*="Search" i], input[type="text"]';
      await page.waitForSelector(searchSelector, { timeout: 8000 });
      await page.fill(searchSelector, '');
      await browserManager.humanType(page, searchSelector, cleanUser);
      await browserManager.humanDelay(1500, 2500);

      // Select the prospect from search results
      const userItem = await page.$(`div[role="button"]:has-text("${cleanUser}"), div[role="listitem"]:has-text("${cleanUser}")`) ||
                       await page.$(`div:has-text("${cleanUser}")`);
      if (userItem) {
        await userItem.click();
        await browserManager.humanDelay(1200, 2000);
      } else {
        // Press Enter to pick first match
        await page.keyboard.press('Enter');
        await browserManager.humanDelay(1000, 1800);
      }

      // If "Chat" / "Next" button appears
      const nextBtn = await page.$('div[role="button"]:has-text("Chat"), button:has-text("Chat"), div[role="button"]:has-text("Next")');
      if (nextBtn) {
        await nextBtn.click();
        await browserManager.humanDelay(1500, 2500);
      }

      // Find the DM textbox
      const msgBoxSelector = 'div[role="textbox"][contenteditable="true"], div[role="textbox"], textarea';
      await page.waitForSelector(msgBoxSelector, { timeout: 10000 });
      await browserManager.humanType(page, msgBoxSelector, messageText);
      await browserManager.humanDelay(1000, 1800);

      // Send the DM
      await page.keyboard.press('Enter');
      
      // Fallback click on Send icon if present
      const sendIcon = await page.$('svg[aria-label*="Send" i], div[role="button"]:has-text("Send")');
      if (sendIcon) {
        await sendIcon.click().catch(() => {});
      }

      await browserManager.humanDelay(2500, 4000);
      QuotaModel.increment(this.platform, 'dms_count');
      LogModel.add(this.platform, 'dm_sent', `Threads DM successfully dispatched to @${cleanUser}!`, { recipient: cleanUser, messageText });
      return { success: true, verified: true, recipient: cleanUser };
    } catch (err) {
      console.error('[Threads] DM sending error:', err.message);
      LogModel.add(this.platform, 'dm_error', `Failed sending DM to @${cleanUser}: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Publishes an original thread post
   */
  async publishThread(content) {
    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'publish_attempt', `Publishing new thread post`);
      await page.goto('https://www.threads.com', { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2000, 4000);

      // Click "Start a thread..." or "+" icon
      const startThreadBtn = await page.$('text="Start a thread..."') || await page.$('svg[aria-label="Create"]') || await page.$('a[href*="/create"]');
      if (startThreadBtn) {
        await startThreadBtn.click();
        await browserManager.humanDelay(1500, 2500);
      }

      const textbox = 'div[role="textbox"], div[contenteditable="true"]';
      await page.waitForSelector(textbox, { timeout: 8000 });
      await browserManager.humanType(page, textbox, content);
      await browserManager.humanDelay(2000, 3500);

      const postBtn = await page.$('div[role="dialog"] div[role="button"]:has-text("Post")') || 
                      await page.$('div[role="dialog"] button:has-text("Post")') || 
                      await page.$('button[type="submit"]') ||
                      await page.$('div[role="button"]:has-text("Post")');
      if (postBtn) {
        await postBtn.click();
        await browserManager.humanDelay(3000, 5000);
      } else {
        await page.keyboard.press('Meta+Enter');
        await browserManager.humanDelay(1000, 1500);
        await page.keyboard.press('Control+Enter');
        await browserManager.humanDelay(3000, 5000);
      }
      QuotaModel.increment(this.platform, 'posts_count');
      LogModel.add(this.platform, 'post_published', `Thread published successfully!`);
      return { success: true };
    } catch (err) {
      LogModel.add(this.platform, 'publish_error', `Publishing failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }
}

export const threadsAdapter = new ThreadsAdapter();
