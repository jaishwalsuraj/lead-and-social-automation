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
            // Find post link
            const linkEl = unit.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
            const postUrl = linkEl ? linkEl.href.split('?')[0] : window.location.href + '#' + Math.random().toString(36).substring(7);

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
   * Comments on a Facebook post
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
      await page.goto(postUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(3000, 5000);

      // Find comment input
      const commentInput = 'div[aria-label*="Write a comment"], div[role="textbox"][contenteditable="true"]';
      await page.waitForSelector(commentInput, { timeout: 10000 });
      await browserManager.humanType(page, commentInput, commentText);
      await browserManager.humanDelay(1500, 2500);

      // Submit via Enter key
      await page.keyboard.press('Enter');
      await browserManager.humanDelay(3000, 5000);

      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment posted on Facebook!`, { postUrl, commentText });
      return { success: true };
    } catch (err) {
      LogModel.add(this.platform, 'comment_error', `Facebook comment failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close();
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

      // Click "What's on your mind?"
      const composerBtn = await page.$('span:has-text("What\'s on your mind")') || await page.$('div[role="button"]:has-text("What\'s on your mind")');
      if (composerBtn) {
        await composerBtn.click();
        await browserManager.humanDelay(2000, 3000);
      }

      const textbox = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
      await page.waitForSelector(textbox, { timeout: 8000 });
      await browserManager.humanType(page, textbox, content);
      await browserManager.humanDelay(2000, 3500);

      const postBtn = await page.$('div[role="dialog"] div[aria-label="Post"], div[role="dialog"] button:has-text("Post")');
      if (postBtn) {
        await postBtn.click();
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
      await page.close();
    }
  }
}

export const facebookAdapter = new FacebookAdapter();
