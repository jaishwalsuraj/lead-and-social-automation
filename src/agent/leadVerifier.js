import { LeadModel, LogModel } from '../db/database.js';
import { browserManager } from '../browser/browserManager.js';

const DEAD_PHRASES = [
  'not all who wander are lost',
  'page is gone',
  "link's not working",
  "sorry, this page isn't available",
  "this content isn't available right now",
  'user not found',
  'account suspended',
  'this account has been terminated',
  "this page isn't available",
  'barcelonauncaughterrorfallback',
  'the link you followed may be broken',
  'profile isn’t available',
  'profile is not available',
  'content has been removed'
];

export class LeadVerifier {
  constructor() {
    this.isVerifying = false;
  }

  /**
   * Fast verification of a URL via fetch + DOM inspection
   */
  async checkUrlAlive(url, platform = 'threads') {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return { alive: false, reason: 'Invalid or missing URL' };
    }

    // 1. Fast HTTP request with modern browser user-agent
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.status === 404 || res.status === 410) {
        return { alive: false, reason: `HTTP ${res.status}: Page not found` };
      }

      const html = (await res.text()).toLowerCase();

      // Check if dead phrase is present in static HTML response
      for (const phrase of DEAD_PHRASES) {
        if (html.includes(phrase)) {
          return { alive: false, reason: `Platform reported deleted or missing content: "${phrase}"` };
        }
      }
    } catch (fetchErr) {
      // If network failed, we proceed to browser verification below if needed
    }

    // 2. For social platforms (SPA rendering like Threads/Instagram), verify inside browser context
    try {
      const context = await browserManager.getContext();
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(2000);

        const pageText = (await page.innerText('body')).toLowerCase();
        await page.close();

        for (const phrase of DEAD_PHRASES) {
          if (pageText.includes(phrase)) {
            return { alive: false, reason: `Account or post is deleted / disabled: "${phrase}"` };
          }
        }

        return { alive: true };
      } catch (pageErr) {
        await page.close().catch(() => {});
        return { alive: true }; // Don't falsely disqualify on slight navigation timeout
      }
    } catch (_) {
      // If browser context unavailable, default to true if HTTP didn't 404
      return { alive: true };
    }
  }

  /**
   * Verifies a single lead record (checking post_url and author profile)
   */
  async verifyLead(lead) {
    if (typeof lead === 'number' || typeof lead === 'string') {
      lead = LeadModel.getById(parseInt(lead, 10));
    }
    if (!lead) throw new Error('Lead not found');

    // If demo / mock lead, keep verified
    if (lead.post_url && lead.post_url.includes('demo')) {
      LeadModel.verifyLead(lead.id, 'verified', 'Demo verified lead');
      return { valid: true, lead: LeadModel.getById(lead.id) };
    }

    // Check post URL
    const postCheck = await this.checkUrlAlive(lead.post_url, lead.platform);
    if (!postCheck.alive) {
      LeadModel.markDead(lead.id, postCheck.reason);
      LogModel.add(lead.platform || 'system', 'lead_purged', `Disqualified dead lead #${lead.id} (@${lead.author_handle}): ${postCheck.reason}`);
      return { valid: false, reason: postCheck.reason, lead: LeadModel.getById(lead.id) };
    }

    // Check author profile URL if present
    if (lead.author_url) {
      const authorCheck = await this.checkUrlAlive(lead.author_url, lead.platform);
      if (!authorCheck.alive) {
        LeadModel.markDead(lead.id, authorCheck.reason);
        LogModel.add(lead.platform || 'system', 'lead_purged', `Disqualified lead with deleted account #${lead.id} (@${lead.author_handle}): ${authorCheck.reason}`);
        return { valid: false, reason: authorCheck.reason, lead: LeadModel.getById(lead.id) };
      }
    }

    // Live and confirmed
    LeadModel.verifyLead(lead.id, 'verified', 'Confirmed active profile and post');
    return { valid: true, lead: LeadModel.getById(lead.id) };
  }

  /**
   * Runs verification across all active leads in the system
   */
  async verifyAllActiveLeads(onProgress = null) {
    if (this.isVerifying) {
      return { success: false, message: 'Verification already in progress' };
    }
    this.isVerifying = true;

    try {
      const activeLeads = LeadModel.getAll({ maxDays: 'all' }).filter(l => l.status !== 'disqualified');
      let verifiedCount = 0;
      let deadCount = 0;

      for (let i = 0; i < activeLeads.length; i++) {
        const lead = activeLeads[i];
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: activeLeads.length,
            leadId: lead.id,
            author: lead.author_handle,
            verified: verifiedCount,
            dead: deadCount
          });
        }

        const res = await this.verifyLead(lead);
        if (res.valid) {
          verifiedCount++;
        } else {
          deadCount++;
        }
      }

      return {
        success: true,
        totalChecked: activeLeads.length,
        verifiedCount,
        deadCount,
        stats: LeadModel.getStats()
      };
    } finally {
      this.isVerifying = false;
    }
  }
}

export const leadVerifier = new LeadVerifier();
