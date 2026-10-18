import { browserManager } from '../browser/browserManager.js';
import { reasoner } from '../agent/geminiReasoner.js';
import { LeadModel, LogModel, QuotaModel, SettingsModel, parsePostAge } from '../db/database.js';

export class LinkedInAdapter {
  constructor() {
    this.platform = 'linkedin';
  }

  /**
   * Scans LinkedIn content search for potential buyer requests and hiring signals
   */
  async scanLeads(keywords = null, maxPosts = 8) {
    if (!keywords || keywords.length === 0) {
      keywords = SettingsModel.getAll().search_keywords || ['looking for saas tool', 'need ecommerce automation'];
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();
    const foundLeads = [];
    const niche = SettingsModel.get('niche_target') || 'E-commerce, SaaS, and Digital Product Sales';

    try {
      LogModel.add(this.platform, 'scan_start', `Starting LinkedIn scan across all ${keywords.length} search keywords`);

      let kwIndex = 0;
      for (const keyword of keywords) {
        kwIndex++;
        // LinkedIn Content Search sorted by date posted
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&sortBy=%22date_posted%22`;
        console.log(`[LinkedIn] [${kwIndex}/${keywords.length}] Navigating to: ${searchUrl}`);
        LogModel.add(this.platform, 'navigating', `Searching keyword [${kwIndex}/${keywords.length}]: "${keyword}"`);

        await page.goto(searchUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
        await browserManager.humanDelay(3000, 5000);

        // Smooth scroll to populate results
        await browserManager.smoothScroll(page, 600);
        await browserManager.humanDelay(2000, 3500);

        const rawPosts = await page.evaluate(() => {
          const results = [];
          // LinkedIn feed post containers
          const postContainers = Array.from(document.querySelectorAll('div.feed-shared-update-v2, div[data-urn*="activity"]'));

          for (const post of postContainers) {
            const urn = post.getAttribute('data-urn') || '';
            const postUrl = urn ? `https://www.linkedin.com/feed/update/${urn}/` : window.location.href;

            // Extract text
            const textEl = post.querySelector('.feed-shared-update-v2__description, .break-words, .update-components-text');
            const postText = textEl ? textEl.innerText.trim() : '';

            // Extract author
            const authorEl = post.querySelector('.update-components-actor__title, .feed-shared-actor__title, a[href*="/in/"]');
            const authorName = authorEl ? authorEl.innerText.split('\n')[0].trim() : 'LinkedIn Member';
            const authorLink = authorEl?.closest('a')?.href || '';

            // Extract time
            const timeEl = post.querySelector('.update-components-actor__sub-description, time');
            const timeText = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText) : '';

            if (postText.length > 20) {
              results.push({
                post_url: postUrl,
                post_text: postText.slice(0, 800),
                author_name: authorName,
                author_handle: authorLink.split('/in/')[1]?.replace('/', '') || 'user',
                author_url: authorLink,
                timestamp: timeText
              });
            }
          }
          return results.slice(0, 10);
        });

        console.log(`[LinkedIn] Extracted ${rawPosts.length} posts for "${keyword}"`);

        for (const post of rawPosts) {
          try {
            // 1. Check 7-day age constraint
            const postAge = parsePostAge(post.post_text, post.timestamp);
            if (!postAge.is_within_7_days) {
              console.log(`[LinkedIn] Skipping post older than 7 days (${postAge.post_time_text}): ${post.post_url}`);
              continue;
            }

            // 2. Learning Filter: skip blocked authors or disqualified patterns
            const skipCheck = LeadModel.shouldSkipPost(post.author_handle, post.post_text);
            if (skipCheck.skip) {
              console.log(`[LinkedIn] ⛔ Skipping post (learned filter): ${skipCheck.reason} — @${post.author_handle}`);
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
              LogModel.add(this.platform, 'lead_discovered', `LinkedIn Lead (${evaluation.score}%, ${postAge.post_time_text}): ${post.author_name}`, { url: post.post_url, score: evaluation.score });
            }
          } catch (evalErr) {
            console.error('[LinkedIn] Evaluation error:', evalErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[LinkedIn] Scan failed:', err.message);
      LogModel.add(this.platform, 'error', `Scan failed: ${err.message}`);
    } finally {
      await page.close();
    }

    return foundLeads;
  }

  /**
   * Posts an AI contextual comment on LinkedIn
   */
  async commentOnPost(postUrl, commentText) {
    const quota = QuotaModel.getToday(this.platform);
    const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '20', 10);

    if (quota.comments_count >= maxComments) {
      LogModel.add(this.platform, 'quota_reached', `Daily comment limit (${maxComments}) reached on LinkedIn.`);
      return { success: false, reason: 'Daily quota exceeded' };
    }

    if (postUrl.includes('/demo') || postUrl.includes('urn:li:activity:demo') || postUrl.includes('example.com')) {
      LogModel.add(this.platform, 'comment_attempt', `Targeting LinkedIn post: ${postUrl}`);
      await browserManager.humanDelay(1000, 2000);
      QuotaModel.increment(this.platform, 'comments_count');
      LogModel.add(this.platform, 'comment_posted', `Comment posted on LinkedIn post ${postUrl}!`, { postUrl, commentText });
      return { success: true, post_url: postUrl };
    }

    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'comment_attempt', `Attempting to comment on LinkedIn post: ${postUrl}`);
      await page.goto(postUrl, { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(3000, 5000);

      // Click "Comment" button
      const commentBtn = await page.$('button[aria-label*="Comment"]') || await page.$('span:has-text("Comment")');
      if (commentBtn) {
        await commentBtn.click();
        await browserManager.humanDelay(1500, 2500);
      }

      // Enter comment in editor
      const editorSelector = '.ql-editor, div[role="textbox"][contenteditable="true"]';
      await page.waitForSelector(editorSelector, { timeout: 10000 });
      await browserManager.humanType(page, editorSelector, commentText);
      await browserManager.humanDelay(2000, 3500);

      // Submit comment
      const submitBtn = await page.$('button.comments-comment-box__submit-button, button:has-text("Post")');
      if (submitBtn) {
        await submitBtn.click();
        await browserManager.humanDelay(3000, 5000);
        QuotaModel.increment(this.platform, 'comments_count');
        LogModel.add(this.platform, 'comment_posted', `Comment posted on LinkedIn!`, { postUrl, commentText });
        return { success: true };
      }
      throw new Error('Comment submit button not found');
    } catch (err) {
      console.error('[LinkedIn] Commenting error:', err.message);
      LogModel.add(this.platform, 'comment_error', `Failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      await page.close();
    }
  }

  /**
   * Publishes a post to LinkedIn feed
   */
  async publishPost(content) {
    const context = await browserManager.getContext();
    const page = await context.newPage();

    try {
      LogModel.add(this.platform, 'publish_attempt', `Publishing new LinkedIn update`);
      await page.goto('https://www.linkedin.com/feed/', { timeout: 35000, waitUntil: 'domcontentloaded' });
      await browserManager.humanDelay(2500, 4500);

      // Click "Start a post"
      const startPostBtn = await page.$('button:has-text("Start a post")') || await page.$('.share-box-feed-entry__trigger');
      if (startPostBtn) {
        await startPostBtn.click();
        await browserManager.humanDelay(2000, 3000);
      }

      const editor = '.ql-editor, div[role="textbox"][contenteditable="true"]';
      await page.waitForSelector(editor, { timeout: 8000 });
      await browserManager.humanType(page, editor, content);
      await browserManager.humanDelay(2000, 3500);

      const postBtn = await page.$('button.share-actions__primary-action, button:has-text("Post")');
      if (postBtn) {
        await postBtn.click();
        await browserManager.humanDelay(4000, 6000);
        QuotaModel.increment(this.platform, 'posts_count');
        LogModel.add(this.platform, 'post_published', `LinkedIn post successfully published!`);
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

export const linkedInAdapter = new LinkedInAdapter();
