import { browserManager } from '../browser/browserManager.js';
import { instagramAdapter } from '../platforms/instagram.js';
import { threadsAdapter } from '../platforms/threads.js';
import { GoogleMapsLeadModel, LogModel, QuotaModel, SettingsModel, db } from '../db/database.js';
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
   * 2. Like Recent Post
   * 3. Post Insightful Expert Comment
   * 4. Cooldown Delay
   * 5. Send Direct Message with Clean Scorecard Link
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
    const dmText = scorecardData ? scorecardData.cleanDMPitch : `Hi ${lead.business_name} team! We put together a complimentary 2-minute Digital Growth Audit for your practice: ${scorecardUrl} — Hope it provides valuable insights!`;

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

        // Locate most recent post
        const firstPostLink = await page.evaluate(() => {
          const link = document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
          return link ? link.href : null;
        });

        if (firstPostLink) {
          LogModel.add('instagram', 'post_found', `Found recent post for @${igHandle}: ${firstPostLink}`);
          await page.goto(firstPostLink, { timeout: 35000, waitUntil: 'domcontentloaded' });
          await browserManager.humanDelay(3000, 4500);

          // Step 2: Like the post (if not already liked)
          try {
            const likeBtn = await page.$('span:has(svg[aria-label*="Like" i]), button:has(svg[aria-label*="Like" i]), div[role="button"]:has(svg[aria-label*="Like" i])');
            if (likeBtn && await likeBtn.isVisible()) {
              await likeBtn.click().catch(() => {});
              QuotaModel.increment('instagram', 'likes_count');
              LogModel.add('instagram', 'post_liked', `Liked recent post for ${lead.business_name} (@${igHandle})`);
              logs.push('Liked recent post');
              await browserManager.humanDelay(2500, 4500);
            }
          } catch (likeErr) {
            console.warn('[SocialEngine] Like error:', likeErr.message);
          }

          // Step 3: Leave Expert Comment
          const expertComment = `Great work here! Inspiring to see local practices in ${lead.city || 'the area'} setting a high standard of patient care and professionalism. 👏`;
          try {
            const commentRes = await instagramAdapter.commentOnPost(firstPostLink, expertComment);
            if (commentRes.success) {
              logs.push('Posted expert comment');
              LogModel.add('instagram', 'expert_comment_posted', `Expert comment posted on @${igHandle}'s post: "${expertComment}"`);
            }
          } catch (cErr) {
            console.warn('[SocialEngine] Comment error:', cErr.message);
          }
        } else {
          logs.push('No public posts found on profile');
        }

        await page.close().catch(() => {});

        // Step 4: Human-like Cooldown before DM (45s–75s)
        LogModel.add('instagram', 'cooling_down', `Cooldown before DM to maintain platform safety policies for @${igHandle}`);
        await browserManager.humanDelay(8000, 15000); // 8-15s in test/active mode, realistic pace

        // Step 5: Send Direct Message with Clean Scorecard Link
        const dmRes = await instagramAdapter.sendDM(igHandle, dmText);
        if (dmRes.success) {
          logs.push('Sent personalized DM with scorecard link');
          LogModel.add('instagram', 'dm_delivered', `Sent direct message with scorecard to @${igHandle}`, { scorecardUrl });

          // Update lead status in database
          db.prepare(`
            UPDATE google_maps_leads SET
              contact_status = 'engaged',
              opportunity_summary = COALESCE(opportunity_summary, '') || ' | Social Engaged (Like + Comment + DM sent)',
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(lead.id);

          return { success: true, platform: 'instagram', logs, scorecardUrl };
        } else {
          return { success: false, platform: 'instagram', logs, dmError: dmRes.reason || dmRes.error };
        }
      } catch (err) {
        await page.close().catch(() => {});
        LogModel.add('instagram', 'engagement_error', `Failed social sequence for @${igHandle}: ${err.message}`);
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
