import { browserManager } from '../browser/browserManager.js';
import { instagramAdapter } from '../platforms/instagram.js';
import { threadsAdapter } from '../platforms/threads.js';
import { reasoner } from './geminiReasoner.js';
import { GoogleMapsLeadModel, LogModel, QuotaModel, SettingsModel, SocialEngagementModel, db } from '../db/database.js';
import { MapsScorecardBridge } from './mapsScorecardBridge.js';
import { checkCountryExclusion } from '../utils/countryFilter.js';

export class SocialEngagementEngine {
  constructor() {
    this.isProcessing = false;
    this.lastRunTimes = {};
  }

  /**
   * Executes full safe engagement pipeline on a single Google Maps lead:
   * 1. Check Rate Limits & Country Policy
   * 2. Like Recent Post strictly (NEVER Repost or Share)
   * 3. Post Bespoke Dynamic AI Comment (customized to the post's text & message + 1 line demonstrating expertise)
   * 4. Human Cooldown Delay
   * 5. Send Direct Message with Personalized Audit Report / Scorecard Link
   */
  async engageLeadSocial(leadId) {
    const lead = GoogleMapsLeadModel.getById(leadId);
    if (!lead) throw new Error(`Lead #${leadId} not found`);

    // Strict country check
    const countryCheck = checkCountryExclusion({
      text: lead.business_name,
      city: lead.city,
      address: lead.address,
      phone: lead.phone,
      url: lead.website_url
    });
    if (countryCheck.excluded) {
      LogModel.add('security', 'targeting_blocked', `Social engagement blocked for ${lead.business_name}: ${countryCheck.reason}`);
      return { success: false, reason: countryCheck.reason };
    }

    // Parse socials
    let socials = {};
    try {
      socials = lead.social_links ? (typeof lead.social_links === 'string' ? JSON.parse(lead.social_links) : lead.social_links) : {};
    } catch (_) {}

    const igUrl = socials.instagram;
    const threadsUrl = socials.threads;

    if (!igUrl && !threadsUrl) {
      return { success: false, reason: 'No supported social profile (Instagram / Threads) found for this lead' };
    }

    // Ensure scorecard exists and obtain clean public URL
    const scorecardData = MapsScorecardBridge.generateScorecardForMapsLead(lead);
    const scorecardUrl = scorecardData ? scorecardData.publicScorecardUrl : 'https://crm.thedigitalfrog.com/scorecard';
    const dmText = scorecardData ? scorecardData.cleanDMPitch : `Hi ${lead.business_name} team! We put together a complimentary 2-minute Digital Growth Audit for your practice: ${scorecardUrl} — Hope it provides valuable insights! — Suraj @ The Digital Frog`;

    const logs = [];

    // Prioritize Instagram
    if (igUrl) {
      const igHandle = igUrl.match(/instagram\.com\/([a-zA-Z0-9._-]+)/i)?.[1];
      if (!igHandle) return { success: false, reason: 'Invalid Instagram profile URL' };

      // 1. Quota Check for Instagram
      const quota = QuotaModel.getToday('instagram');
      const maxLikes = parseInt(SettingsModel.get('daily_max_likes') || '25', 10);
      const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '15', 10);
      const maxDMs = parseInt(SettingsModel.get('daily_max_dms') || '10', 10);

      if (quota.dms_count >= maxDMs || quota.comments_count >= maxComments) {
        const msg = `Daily platform safety limits reached on Instagram (${quota.comments_count}/${maxComments} comments, ${quota.dms_count}/${maxDMs} DMs). Halting to preserve account policy intact.`;
        LogModel.add('instagram', 'quota_guard', msg);
        return { success: false, reason: msg };
      }

      LogModel.add('instagram', 'engagement_start', `Starting automated safe engagement sequence for ${lead.business_name} (@${igHandle})`);

      const context = await browserManager.getContext();
      const page = await context.newPage();

      try {
        // Step 1: Navigate to Instagram Profile
        await page.goto(`https://www.instagram.com/${igHandle}/`, { timeout: 35000, waitUntil: 'domcontentloaded' });
        await browserManager.humanDelay(3000, 5000);

        // Dismiss common popups
        try {
          const cancelBtn = await page.$('button:has-text("Not Now"), button:has-text("Cancel")');
          if (cancelBtn) await cancelBtn.click().catch(() => {});
        } catch (_) {}

        // Locate visible post links
        const candidatePostLinks = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
          return links.map(l => l.href);
        });

        // Filter out posts already engaged in database
        let targetPostLink = null;
        for (const pl of candidatePostLinks) {
          if (!SocialEngagementModel.hasEngagedPost(pl, 'comment')) {
            targetPostLink = pl;
            break;
          }
        }

        let dynamicComment = '';

        if (targetPostLink) {
          LogModel.add('instagram', 'post_found', `Found unengaged post for @${igHandle}: ${targetPostLink}`);
          await page.goto(targetPostLink, { timeout: 35000, waitUntil: 'domcontentloaded' });
          await browserManager.humanDelay(3000, 4500);

          // Step 2: Like the post strictly (NEVER REPOST OR SHARE)
          try {
            const likeRes = await instagramAdapter.likePost(page);
            if (likeRes.success) {
              if (likeRes.alreadyLiked) {
                logs.push('Post was already liked');
              } else {
                logs.push('Liked recent post');
                LogModel.add('instagram', 'post_liked', `Liked recent post for ${lead.business_name} (@${igHandle})`);
              }
            } else {
              console.warn('[SocialEngine] Like note:', likeRes.reason);
            }
          } catch (likeErr) {
            console.warn('[SocialEngine] Like error:', likeErr.message);
          }

          // Step 3: Extract post caption / message cleanly (Strip Instagram metadata headers like "123 likes, 75 comments...")
          const postText = await page.evaluate(() => {
            const rawMeta = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                            document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            
            let cleanMeta = '';
            if (rawMeta) {
              const match = rawMeta.match(/^[0-9,kKmM.]+\s+likes?,\s+[0-9,kKmM.]+\s+comments?\s+-\s+[^:]+:\s*"?([\s\S]*)/i);
              if (match && match[1]) {
                cleanMeta = match[1].replace(/"?\s*$/, '').trim();
              } else {
                cleanMeta = rawMeta;
              }
            }

            const article = document.querySelector('article') || document.querySelector('div[role="dialog"]') || document.body;
            const h1Text = article.querySelector('h1')?.innerText?.trim() || '';

            const spans = Array.from(article.querySelectorAll('span, div[dir="auto"]'));
            const goodSpans = spans.map(s => (s.innerText || '').trim())
              .filter(t => t.length > 20 &&
                !/^\d+[smhdwmy]$/i.test(t) &&
                !t.includes('Like') &&
                !t.includes('Follow') &&
                !t.includes('Reply') &&
                !t.includes('View all') &&
                !t.includes('See translation') &&
                !t.includes('Original audio') &&
                !t.includes('comments') &&
                !t.includes('likes')
              )
              .sort((a, b) => b.length - a.length);

            return cleanMeta || h1Text || goodSpans[0] || '';
          });

          // Step 4: Synthesize authentic, observational comment (ZERO agency pitches, ZERO "At The Digital Frog")
          dynamicComment = await reasoner.synthesizeSocialEngagementComment({
            postText,
            businessName: lead.business_name,
            category: lead.category,
            city: lead.city,
            platform: 'instagram'
          });

          // Step 5: Post the comment safely on the post
          try {
            const commentRes = await instagramAdapter.commentOnPost(page, dynamicComment);
            if (commentRes.success) {
              if (commentRes.alreadyCommented) {
                logs.push('Post already had our comment (duplicate prevented)');
              } else {
                logs.push(`Posted bespoke comment: "${dynamicComment}"`);
                LogModel.add('instagram', 'expert_comment_posted', `Bespoke comment posted on @${igHandle}'s post: "${dynamicComment}"`);
              }

              // IMMEDIATELY record engagement in database to guarantee no duplicates on re-runs
              SocialEngagementModel.record({
                leadId: lead.id,
                platform: 'instagram',
                profileHandle: igHandle,
                postUrl: targetPostLink,
                commentText: dynamicComment,
                actionType: 'comment',
                status: 'success'
              });

              db.prepare(`
                UPDATE google_maps_leads SET
                  contact_status = 'engaged',
                  last_engaged_post_url = ?,
                  social_engaged_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(targetPostLink, lead.id);
            }
          } catch (cErr) {
            console.warn('[SocialEngine] Comment error:', cErr.message);
          }
        } else if (candidatePostLinks.length > 0) {
          logs.push('All recent posts already engaged on Instagram (duplicate prevented)');
          LogModel.add('instagram', 'already_engaged', `All visible posts for @${igHandle} were already engaged; skipping duplicate comment.`);
        } else {
          logs.push('No public posts found on profile');
        }

        await page.close().catch(() => {});

        // Step 6: Human-like Cooldown before DM (8s–15s)
        LogModel.add('instagram', 'cooling_down', `Cooldown before DM to maintain platform safety policies for @${igHandle}`);
        await browserManager.humanDelay(8000, 15000);

        // Step 7: Send Direct Message with Clean Personalized Scorecard / Audit Link
        const dmRes = await instagramAdapter.sendDM(igHandle, dmText);
        if (dmRes.success) {
          logs.push('Sent personalized DM with audit report link');
          LogModel.add('instagram', 'dm_delivered', `Sent direct message with scorecard to @${igHandle}`, { scorecardUrl });

          // Update opportunity summary
          db.prepare(`
            UPDATE google_maps_leads SET
              contact_status = 'engaged',
              opportunity_summary = COALESCE(opportunity_summary, '') || ' | Social Engaged (Liked + Dynamic Comment + Audit DM sent)',
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(lead.id);

          return { success: true, platform: 'instagram', logs, scorecardUrl, dynamicComment };
        } else {
          return { success: false, platform: 'instagram', logs, dmError: dmRes.reason || dmRes.error, dynamicComment };
        }
      } catch (err) {
        await page.close().catch(() => {});
        LogModel.add('instagram', 'engagement_error', `Failed social sequence for @${igHandle}: ${err.message}`);
        return { success: false, error: err.message, logs };
      }
    }

    // Threads Flow (if Threads profile exists and no Instagram)
    if (threadsUrl) {
      const threadsHandle = threadsUrl.match(/threads\.(?:net|com)\/@?([a-zA-Z0-9._-]+)/i)?.[1];
      if (!threadsHandle) return { success: false, reason: 'Invalid Threads profile URL' };

      const quota = QuotaModel.getToday('threads');
      const maxLikes = parseInt(SettingsModel.get('daily_max_likes') || '25', 10);
      const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '15', 10);
      const maxDMs = parseInt(SettingsModel.get('daily_max_dms') || '10', 10);

      if (quota.dms_count >= maxDMs || quota.comments_count >= maxComments) {
        const msg = `Daily platform safety limits reached on Threads (${quota.comments_count}/${maxComments} comments, ${quota.dms_count}/${maxDMs} DMs). Halting to preserve account policy intact.`;
        LogModel.add('threads', 'quota_guard', msg);
        return { success: false, reason: msg };
      }

      LogModel.add('threads', 'engagement_start', `Starting automated safe engagement sequence on Threads for ${lead.business_name} (@${threadsHandle})`);

      const context = await browserManager.getContext();
      const page = await context.newPage();

      try {
        await page.goto(`https://www.threads.com/@${threadsHandle}`, { timeout: 35000, waitUntil: 'domcontentloaded' });
        await browserManager.humanDelay(3000, 5000);

        // Locate visible Threads post links
        const candidateThreadsLinks = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
          return links.map(l => l.href);
        });

        let targetPostLink = null;
        for (const pl of candidateThreadsLinks) {
          if (!SocialEngagementModel.hasEngagedPost(pl, 'comment')) {
            targetPostLink = pl;
            break;
          }
        }

        let dynamicComment = '';

        if (targetPostLink) {
          LogModel.add('threads', 'post_found', `Found unengaged Threads post for @${threadsHandle}: ${targetPostLink}`);
          await page.goto(targetPostLink, { timeout: 35000, waitUntil: 'domcontentloaded' });
          await browserManager.humanDelay(3000, 4500);

          // Step A: Like the post (NEVER repost/quote)
          try {
            const likeRes = await threadsAdapter.likePost(page);
            if (likeRes.success) {
              if (likeRes.alreadyLiked) {
                logs.push('Post was already liked');
              } else {
                logs.push('Liked recent Threads post');
                LogModel.add('threads', 'post_liked', `Liked recent post for ${lead.business_name} (@${threadsHandle})`);
              }
            }
          } catch (likeErr) {
            console.warn('[SocialEngine] Threads like error:', likeErr.message);
          }

          // Step B: Extract post text
          const postText = await page.evaluate(() => {
            const article = document.querySelector('div[role="article"]') || document.body;
            return (article?.innerText || '').slice(0, 800);
          });

          // Step C: Generate dynamic comment
          dynamicComment = await reasoner.synthesizeSocialEngagementComment({
            postText,
            businessName: lead.business_name,
            category: lead.category,
            city: lead.city,
            platform: 'threads'
          });

          // Step D: Post comment
          try {
            const commentRes = await threadsAdapter.commentOnPost(page, dynamicComment);
            if (commentRes.success) {
              logs.push(`Posted bespoke comment on Threads: "${dynamicComment}"`);
              LogModel.add('threads', 'expert_comment_posted', `Bespoke comment posted on @${threadsHandle}'s post: "${dynamicComment}"`);

              // Record in DB immediately
              SocialEngagementModel.record({
                leadId: lead.id,
                platform: 'threads',
                profileHandle: threadsHandle,
                postUrl: targetPostLink,
                commentText: dynamicComment,
                actionType: 'comment',
                status: 'success'
              });

              db.prepare(`
                UPDATE google_maps_leads SET
                  contact_status = 'engaged',
                  last_engaged_post_url = ?,
                  social_engaged_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(targetPostLink, lead.id);
            }
          } catch (cErr) {
            console.warn('[SocialEngine] Threads comment error:', cErr.message);
          }
        } else if (candidateThreadsLinks.length > 0) {
          logs.push('All recent Threads posts already engaged (duplicate prevented)');
        } else {
          logs.push('No public posts found on Threads profile');
        }

        await page.close().catch(() => {});

        // Step E: Cooldown before DM
        await browserManager.humanDelay(8000, 15000);

        // Step F: Send DM with audit report link
        const dmRes = await threadsAdapter.sendDM(threadsHandle, dmText);
        if (dmRes.success) {
          logs.push('Sent personalized Threads DM with audit report link');
          LogModel.add('threads', 'dm_delivered', `Sent direct message with scorecard to @${threadsHandle}`, { scorecardUrl });

          db.prepare(`
            UPDATE google_maps_leads SET
              contact_status = 'engaged',
              opportunity_summary = COALESCE(opportunity_summary, '') || ' | Threads Engaged (Liked + Dynamic Comment + Audit DM sent)',
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(lead.id);

          return { success: true, platform: 'threads', logs, scorecardUrl, dynamicComment };
        } else {
          return { success: false, platform: 'threads', logs, dmError: dmRes.reason || dmRes.error, dynamicComment };
        }
      } catch (err) {
        await page.close().catch(() => {});
        LogModel.add('threads', 'engagement_error', `Failed Threads sequence for @${threadsHandle}: ${err.message}`);
        return { success: false, error: err.message, logs };
      }
    }

    return { success: false, reason: 'Social platform currently not supported' };
  }


  /**
   * Runs safe batch automation on uncontacted Google Maps leads with social links.
   * Keeps social platform daily limits and warming policies 100% intact.
   */
  async runAutomatedEngagementBatch(batchLimit = 5) {
    if (this.isProcessing) {
      return { success: false, message: 'Engagement automation is already running' };
    }

    this.isProcessing = true;
    LogModel.add('system', 'auto_engage_batch_start', `Starting automated fixed-time engagement batch (limit: ${batchLimit})`);

    try {
      // Find leads with social links that haven't been contacted or engaged yet
      const candidateLeads = db.prepare(`
        SELECT * FROM google_maps_leads
        WHERE social_links IS NOT NULL 
          AND social_links != '{}' 
          AND social_links != '[]'
          AND (contact_status IS NULL OR contact_status = 'verified' OR contact_status = 'discovered')
        ORDER BY rating DESC, reviews_count DESC
        LIMIT ?
      `).all(batchLimit);

      console.log(`[SocialEngagementEngine] Found ${candidateLeads.length} candidate leads for automated engagement`);

      const results = [];
      for (const lead of candidateLeads) {
        // Enforce daily quota checks
        const quota = QuotaModel.getToday('instagram');
        const maxDMs = parseInt(SettingsModel.get('daily_max_dms') || '10', 10);
        if (quota.dms_count >= maxDMs) {
          LogModel.add('system', 'quota_guard', `Batch halted: Daily Instagram DM quota reached (${quota.dms_count}/${maxDMs}). Platform policy protected.`);
          break;
        }

        const res = await this.engageLeadSocial(lead.id);
        results.push({ leadId: lead.id, businessName: lead.business_name, ...res });

        // Safe delay between leads (15 to 30 seconds)
        await browserManager.humanDelay(15000, 30000);
      }

      LogModel.add('system', 'auto_engage_batch_complete', `Completed automated engagement batch: ${results.filter(r => r.success).length}/${results.length} leads engaged successfully`);
      return { success: true, processed: results.length, results };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Fixed-time automation scheduler: checks every minute if it is time to run
   * Default fixed times: 10:00 AM and 03:00 PM (15:00)
   */
  startFixedTimeScheduler() {
    console.log('[SocialEngagementEngine] Starting fixed-time automation scheduler (Active windows: 10:00 AM and 3:00 PM)...');

    setInterval(async () => {
      try {
        const enabled = SettingsModel.get('auto_engage_enabled') !== 'false'; // default enabled
        if (!enabled) return;

        const now = new Date();
        const currentHour = String(now.getHours()).padStart(2, '0');
        const currentMinute = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${currentHour}:${currentMinute}`;
        const todayStr = now.toISOString().split('T')[0];

        // Fixed schedule times (e.g. 10:00 and 15:00)
        const scheduledTimes = (SettingsModel.get('auto_engage_times') || '10:00,15:00').split(',').map(s => s.trim());

        for (const targetTime of scheduledTimes) {
          const runKey = `${todayStr}_${targetTime}`;
          if (currentTimeStr === targetTime && !this.lastRunTimes[runKey]) {
            this.lastRunTimes[runKey] = true;
            LogModel.add('system', 'schedule_triggered', `⏰ Fixed-time social engagement automation triggered at ${targetTime}`);
            console.log(`[SocialEngagementEngine] ⏰ Fixed-time trigger fired at ${targetTime}!`);
            await this.runAutomatedEngagementBatch(5);
          }
        }
      } catch (err) {
        console.error('[SocialEngagementEngine] Scheduler error:', err.message);
      }
    }, 60 * 1000); // Check every minute
  }
}

export const socialEngagementEngine = new SocialEngagementEngine();
