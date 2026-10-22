import { browserManager } from '../browser/browserManager.js';
import { reasoner } from '../agent/geminiReasoner.js';
import { LeadModel, LogModel, QuotaModel, SettingsModel, SocialEngagementModel, parsePostAge } from '../db/database.js';

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
        // Sanitize keyword/tag: strip leading '#', '%23', spaces, and special symbols
        const cleanTag = String(tag)
          .replace(/^%23/i, '')
          .replace(/^#+/, '')
          .trim();
        const cleanKeyword = cleanTag.replace(/[^a-zA-Z0-9_]/g, '');

        if (!cleanKeyword) continue;

        LogModel.add(this.platform, 'navigating', `Searching Instagram [${tagIndex}/${hashtags.length}]: #${cleanKeyword}`);

        // 1. Try direct Explore Tag URL
        let searchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanKeyword)}/`;
        console.log(`[Instagram] [${tagIndex}/${hashtags.length}] Navigating to: ${searchUrl}`);

        await page.goto(searchUrl, { timeout: 35000, waitUntil: 'domcontentloaded' }).catch(() => {});
        await browserManager.humanDelay(2500, 4000);

        // Check if page threw "Something went wrong" (as shown in user's screenshot)
        let isErrorPage = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : '';
          return bodyText.includes('Something went wrong') ||
                 bodyText.includes("There's an issue and the page could not be loaded") ||
                 bodyText.includes("Sorry, this page isn't available");
        });

        // 2. If tag URL failed, fallback to Explore Keyword Search (STRICTLY clean keyword without '%23')
        if (isErrorPage) {
          searchUrl = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(cleanKeyword)}`;
          console.log(`[Instagram] Tag URL gave error, falling back to clean keyword search: ${searchUrl}`);
          await page.goto(searchUrl, { timeout: 35000, waitUntil: 'domcontentloaded' }).catch(() => {});
          await browserManager.humanDelay(2500, 4000);

          isErrorPage = await page.evaluate(() => {
            const bodyText = document.body ? document.body.innerText : '';
            return bodyText.includes('Something went wrong') ||
                   bodyText.includes("There's an issue and the page could not be loaded");
          });
        }

        // 3. If direct URLs still failed, navigate to Explore home and use search input
        if (isErrorPage) {
          console.log(`[Instagram] Direct search URLs restricted, attempting in-app search for: ${cleanKeyword}`);
          await page.goto('https://www.instagram.com/explore/', { timeout: 35000, waitUntil: 'domcontentloaded' }).catch(() => {});
          await browserManager.humanDelay(2000, 3500);

          try {
            const searchInput = await page.$('input[aria-label="Search input"], input[placeholder="Search"]');
            if (searchInput && await searchInput.isVisible()) {
              await searchInput.click().catch(() => {});
              await searchInput.fill(cleanKeyword).catch(() => {});
              await browserManager.humanDelay(1500, 2500);
              await page.keyboard.press('Enter').catch(() => {});
              await browserManager.humanDelay(3000, 4500);
            }
          } catch (_) {}
        }

        // Dismiss standard Instagram dialogs (Cookies, Not Now, Turn on Notifications)
        try {
          const dismissBtn = await page.$('button:has-text("Not Now"), button:has-text("Cancel"), button:has-text("Decline optional cookies"), button:has-text("Allow all cookies")');
          if (dismissBtn && await dismissBtn.isVisible()) {
            await dismissBtn.click().catch(() => {});
            await browserManager.humanDelay(500, 1000);
          }
        } catch (_) {}

        await browserManager.smoothScroll(page, 500);
        await browserManager.humanDelay(1800, 3000);

        // Find post and reel links (support both /p/ and /reel/)
        const postHrefs = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
          return [...new Set(links.map(l => l.href.split('?')[0]))].slice(0, 5);
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
   * Likes an Instagram post safely and strictly (NEVER reposts or shares).
   * Supports both currently active Playwright page or navigating to postUrl.
   */
  async likePost(pageOrUrl) {
    let page;
    let ownPage = false;

    if (typeof pageOrUrl === 'string') {
      if (pageOrUrl.includes('/demo') || pageOrUrl.includes('example.com')) {
        QuotaModel.increment(this.platform, 'likes_count');
        LogModel.add(this.platform, 'post_liked', `Liked post (demo mode): ${pageOrUrl}`);
        return { success: true, alreadyLiked: false };
      }
      const context = await browserManager.getContext();
      page = await context.newPage();
      ownPage = true;
      await page.goto(pageOrUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2500, 4000);
    } else {
      page = pageOrUrl;
    }

    try {
      const quota = QuotaModel.getToday(this.platform);
      const maxLikes = parseInt(SettingsModel.get('daily_max_likes') || '25', 10);
      if (quota.likes_count >= maxLikes) {
        return { success: false, reason: 'Daily like quota reached' };
      }

      const likeInfo = await page.evaluate(() => {
        // Collect all svgs on page
        const svgs = Array.from(document.querySelectorAll('svg'));
        const likeSvgs = svgs.filter(s => {
          const label = (s.getAttribute('aria-label') || '').toLowerCase();
          const title = s.querySelector('title')?.textContent?.toLowerCase() || '';
          return (label === 'like' || label === 'unlike' || title === 'like' || title === 'unlike') &&
                 !label.includes('repost') && !label.includes('share') && !label.includes('send');
        });

        if (likeSvgs.length === 0) return { found: false, reason: 'Like button SVG not found' };

        // Prefer 24px main action bar SVG (post like) over 16px comment like SVGs
        const mainLikeSvg = likeSvgs.find(s => {
          const w = s.getAttribute('width') || '';
          const h = s.getAttribute('height') || '';
          const rect = s.getBoundingClientRect();
          return w === '24' || h === '24' || (rect.width >= 20 && rect.height >= 20);
        }) || likeSvgs[likeSvgs.length - 1];

        const label = (mainLikeSvg.getAttribute('aria-label') || '').toLowerCase();
        if (label === 'unlike') {
          return { found: true, alreadyLiked: true, reason: 'Post is already liked' };
        }

        // Find clickable button or role="button" parent
        const btn = mainLikeSvg.closest('div[role="button"], button') || mainLikeSvg.parentElement;
        if (!btn) return { found: false, reason: 'Like button container not found' };

        // Strict safety check: ABSOLUTELY NEVER click anything with repost or share
        const btnAria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const btnText = (btn.innerText || '').toLowerCase();
        if (btnAria.includes('repost') || btnText.includes('repost') || btnAria.includes('share') || btnText.includes('share') || btnAria.includes('quote')) {
          return { found: false, reason: 'Safety blocked: target element is repost/share' };
        }

        btn.scrollIntoView?.({ block: 'nearest' });
        btn.click();
        return { found: true, alreadyLiked: false };
      });

      if (likeInfo.found) {
        if (!likeInfo.alreadyLiked) {
          await browserManager.humanDelay(1500, 3000);
          QuotaModel.increment(this.platform, 'likes_count');
          LogModel.add(this.platform, 'post_liked', 'Successfully liked Instagram post');
        } else {
          LogModel.add(this.platform, 'post_already_liked', 'Post was already liked');
        }
        return { success: true, alreadyLiked: likeInfo.alreadyLiked };
      }

      return { success: false, reason: likeInfo.reason };
    } catch (err) {
      LogModel.add(this.platform, 'like_error', `Failed to like Instagram post: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (ownPage && page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Comments on an Instagram post (supports either active page or URL string).
   * Strictly prevents clicking Repost/Share buttons.
   */
  async commentOnPost(pageOrUrl, commentText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '20', 10);

    if (quota.comments_count >= maxComments) {
      LogModel.add(this.platform, 'quota_reached', `Daily comment limit (${maxComments}) reached on Instagram.`);
      return { success: false, reason: 'Daily quota exceeded' };
    }

    let page;
    let ownPage = false;
    let postUrl = '';

    if (typeof pageOrUrl === 'string') {
      postUrl = pageOrUrl;
      if (postUrl.includes('/demo') || postUrl.includes('/p/demo') || postUrl.includes('example.com')) {
        LogModel.add(this.platform, 'comment_attempt', `Targeting Instagram post: ${postUrl}`);
        await browserManager.humanDelay(1000, 2000);
        QuotaModel.increment(this.platform, 'comments_count');
        LogModel.add(this.platform, 'comment_posted', `Comment posted on Instagram post ${postUrl}!`, { postUrl, commentText });
        return { success: true, post_url: postUrl };
      }

      const context = await browserManager.getContext();
      page = await context.newPage();
      ownPage = true;

      const cleanUrl = postUrl.split('?')[0].split('#')[0];
      await page.goto(cleanUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2500, 4500);
    } else {
      page = pageOrUrl;
      postUrl = page.url();
    }

    try {
      LogModel.add(this.platform, 'comment_attempt', `Commenting on Instagram post: ${postUrl}`);

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

      // 2b. DEDUPLICATION GUARD: Check if we or our account already commented on this post!
      const alreadyCommentedCheck = await page.evaluate((targetComment) => {
        // Find all visible comment author usernames
        const authorLinks = Array.from(document.querySelectorAll('article a[role="link"], div[role="dialog"] a[role="link"], ul a[role="link"]'));
        const handlesOnPost = authorLinks.map(a => (a.innerText || a.getAttribute('href') || '').toLowerCase().replace(/[^a-z0-9._]/g, ''));

        // Identify logged in username
        const myProfileA = document.querySelector('svg[aria-label="Profile"]')?.closest('a') ||
                           document.querySelector('a[href^="/"][role="link"]:has(img[alt*="profile"])');
        const myHandle = (myProfileA?.getAttribute('href') || '').replace(/\//g, '').toLowerCase() || 'autotoonbytes';

        const alreadyPresent = handlesOnPost.includes(myHandle);

        // Also check if text from target comment is already on the page
        const bodyText = document.body ? document.body.innerText : '';
        const snippet = (targetComment || '').slice(0, 30).trim();
        const snippetPresent = snippet.length > 10 && bodyText.includes(snippet);

        return { alreadyPresent, snippetPresent, myHandle };
      }, commentText);

      if (alreadyCommentedCheck.alreadyPresent || alreadyCommentedCheck.snippetPresent) {
        console.log(`[Instagram] ⚠️ Prevented duplicate comment on ${postUrl} (Found existing comment by @${alreadyCommentedCheck.myHandle} or matching text).`);
        LogModel.add(this.platform, 'duplicate_comment_prevented', `Skipped duplicate comment on ${postUrl} (@${alreadyCommentedCheck.myHandle} already commented)`);
        return { success: true, alreadyCommented: true, post_url: postUrl, message: 'Already commented on this post' };
      }

      // 3. Locate comment input trigger or contenteditable box
      const inputSelectors = [
        'textarea[placeholder*="Add a comment" i]',
        'textarea[aria-label*="Add a comment" i]',
        'div[data-lexical-editor="true"][role="textbox"]',
        'div[role="textbox"][contenteditable="true"]',
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

      // 4. If comment box is collapsed, click comment bubble icon
      if (!targetInput) {
        console.log('[Instagram] Comment box not yet visible, clicking Comment bubble trigger...');
        const commentButtonSelectors = [
          'svg[aria-label="Comment"]',
          'div[role="button"]:has(svg[aria-label="Comment"])',
          'button:has(svg[aria-label="Comment"])'
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

      if (!targetInput) {
        try {
          targetInput = await page.waitForSelector('textarea[placeholder*="Add a comment" i], div[role="textbox"]', { timeout: 8000, state: 'visible' });
        } catch (_) {}
      }

      if (!targetInput) {
        throw new Error('Instagram comment box is collapsed or restricted on this post.');
      }

      // 5. Focus & Type comment text
      await targetInput.scrollIntoViewIfNeeded().catch(() => {});
      await targetInput.click().catch(() => {});
      await browserManager.humanDelay(600, 1200);

      // Re-query active input in case DOM swapped placeholder
      const activeInput = await page.$('textarea:focus, div[role="textbox"]:focus') || targetInput;
      await browserManager.humanType(page, activeInput, commentText);
      await browserManager.humanDelay(1500, 2500);

      // 6. SINGLE-ACTION Submission: Use Post button IF present, otherwise Enter key (NEVER BOTH!)
      const clickedPostBtn = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        for (const b of btns) {
          const text = (b.innerText || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isExactPost = text === 'post' || aria === 'post';
          const isNotForbidden = !text.includes('repost') && !aria.includes('repost') &&
                                !text.includes('share') && !aria.includes('share') &&
                                !text.includes('tag') && !text.includes('emoji');
          if (isExactPost && isNotForbidden && !b.disabled && b.getAttribute('aria-disabled') !== 'true') {
            b.click();
            return true;
          }
        }
        return false;
      });

      if (!clickedPostBtn) {
        // If no explicit Post button found, use Enter key
        await page.keyboard.press('Enter');
      }

      await browserManager.humanDelay(2500, 4000);

      // 7. Verify and clear any remaining stale text in the input
      await page.evaluate(() => {
        const textareas = document.querySelectorAll('textarea, div[role="textbox"]');
        for (const ta of textareas) {
          if (ta.value) ta.value = '';
        }
      }).catch(() => {});

      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment posted on Instagram!`, { postUrl, commentText });
      return { success: true, post_url: postUrl };
    } catch (err) {
      LogModel.add(this.platform, 'comment_error', `Instagram comment failed: ${err.message}`);
      return { success: false, error: err.message, post_url: postUrl };
    } finally {
      if (ownPage && page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Sends a 1-on-1 direct message on Instagram.
   * Prioritizes clicking "Message" directly on user profile for instant 100% accurate chat navigation.
   */
  async sendDM(username, messageText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxDMs = parseInt(SettingsModel.get('daily_max_dms') || '10', 10);

    if (quota.dms_count >= maxDMs) {
      LogModel.add(this.platform, 'quota_reached', `Daily DM limit reached on Instagram.`);
      return { success: false, reason: 'Daily DM quota exceeded' };
    }

    const cleanUser = String(username || '').replace(/^@/, '').trim();
    if (cleanUser.includes('demo') || cleanUser === 'user' || cleanUser === 'prospect') {
      QuotaModel.increment(this.platform, 'dms_count');
      LogModel.add(this.platform, 'dm_sent', `Instagram DM sent (demo mode) to @${cleanUser}!`, { recipient: cleanUser, messageText });
      return { success: true, recipient: cleanUser };
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'dm_attempt', `Opening chat to send DM to @${cleanUser}`);

      // Step A: Visit user profile directly and click "Message" button
      await page.goto(`https://www.instagram.com/${cleanUser}/`, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2500, 4000);

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

      // Try finding the profile "Message" button
      let chatOpened = false;
      const messageBtn = await page.$('header div[role="button"]:has-text("Message"), header button:has-text("Message"), div[role="button"]:has-text("Message")');
      if (messageBtn && await messageBtn.isVisible()) {
        console.log(`[Instagram] Clicking direct profile Message button for @${cleanUser}...`);
        await messageBtn.click().catch(() => {});
        await browserManager.humanDelay(3000, 5000);

        // Dismiss any notification request popup
        try {
          const dismissBtn = await page.$('button:has-text("Not Now"), button:has-text("Cancel")');
          if (dismissBtn && await dismissBtn.isVisible()) {
            await dismissBtn.click().catch(() => {});
            await browserManager.humanDelay(500, 1000);
          }
        } catch (_) {}

        chatOpened = true;
      }

      // Step B: Fallback to /direct/t/new/ if Message button was not on profile
      if (!chatOpened) {
        console.log(`[Instagram] Profile Message button not found; navigating to /direct/t/new/ for @${cleanUser}...`);
        await page.goto(`https://www.instagram.com/direct/t/new/`, { timeout: 35000, waitUntil: 'domcontentloaded' });
        await browserManager.humanDelay(2500, 4000);

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
        await browserManager.humanDelay(2000, 3500);

        // Select recipient
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

        const chatBtn = await page.$('div[role="button"]:has-text("Chat"), button:has-text("Chat"), div[role="button"]:has-text("Next"), button:has-text("Next")');
        if (chatBtn && await chatBtn.isVisible()) {
          await chatBtn.click().catch(() => {});
          await browserManager.humanDelay(2000, 3500);
        }
      }

      // Step C: Locate message box and dispatch DM
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

      // Fallback click on Send button if still visible
      const sendIcon = await page.$('button:has-text("Send"), div[role="button"]:has-text("Send")');
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
