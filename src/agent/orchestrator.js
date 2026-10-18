import { threadsAdapter } from '../platforms/threads.js';
import { linkedInAdapter } from '../platforms/linkedin.js';
import { facebookAdapter } from '../platforms/facebook.js';
import { instagramAdapter } from '../platforms/instagram.js';
import { LeadModel, LogModel, SettingsModel, QuotaModel } from '../db/database.js';
import { reasoner } from './geminiReasoner.js';
import { browserManager } from '../browser/browserManager.js';

export class AutomationOrchestrator {
  constructor() {
    this.isRunning = false;
    this.autopilotTimer = null;
    this.wsClients = new Set();
  }

  registerWsClient(ws) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
  }

  broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
    for (const client of this.wsClients) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    }
  }

  /**
   * Runs lead scanner ONLY across connected platforms using expanded keywords
   */
  async runLeadScan(platform = 'all', options = {}) {
    if (this.isRunning) {
      return { success: false, message: 'Scan already in progress. Please wait for the current cycle to complete.' };
    }

    this.isRunning = true;
    this.broadcast('scan_status', { status: 'started', platform });
    LogModel.add('system', 'orchestrator_scan', `Initiated lead scan for platform: ${platform}`);

    try {
      // 1. Check connected platforms FIRST
      this.broadcast('log', { platform: 'system', text: '🔍 Checking connected social channels...' });
      const platformStatuses = await browserManager.getConnectedPlatforms();
      const connectedMap = {};
      for (const p of platformStatuses) {
        connectedMap[p.platform] = !!p.loggedIn;
      }

      const connectedList = Object.keys(connectedMap).filter(k => connectedMap[k]);
      this.broadcast('log', { 
        platform: 'system', 
        text: `Active Connected Channels: ${connectedList.length > 0 ? connectedList.map(c => c.toUpperCase()).join(', ') : 'None'}` 
      });

      // 2. Validate requested platform
      if (platform !== 'all') {
        if (!connectedMap[platform]) {
          const errMsg = `⚠️ Cannot scan ${platform.toUpperCase()}: Channel is not connected. Please connect your account in Browser Profiles.`;
          this.broadcast('log', { platform, text: errMsg, error: true });
          this.broadcast('scan_status', { status: 'aborted', reason: errMsg });
          return { success: false, message: errMsg };
        }
      } else {
        if (connectedList.length === 0) {
          const errMsg = `⚠️ No social accounts are currently connected! Please connect Threads, Instagram, Facebook, or LinkedIn in Browser Profiles before scanning.`;
          this.broadcast('log', { platform: 'system', text: errMsg, error: true });
          this.broadcast('scan_status', { status: 'aborted', reason: errMsg });
          return { success: false, message: errMsg };
        }
      }

      // 3. Prepare expanded keywords
      let keywords = options.keywords || SettingsModel.getAll().search_keywords || [];
      if (typeof keywords === 'string') {
        try { keywords = JSON.parse(keywords); } catch (_) { keywords = [keywords]; }
      }
      if (!Array.isArray(keywords) || keywords.length === 0) {
        keywords = ['looking for saas', 'need ecommerce store', 'shopify developer recommendation', 'recommend an automation tool'];
      }

      // Dynamic expansion if topic provided
      const topic = options.topic || '';
      if (topic) {
        this.broadcast('log', { platform: 'ai', text: `🧠 Expanding search queries for topic: "${topic}"...` });
        const expanded = await reasoner.expandSearchKeywords(topic, SettingsModel.get('niche_target'));
        keywords = [...new Set([...keywords, ...expanded])];
      }

      this.broadcast('log', { 
        platform: 'system', 
        text: `Targeting ${keywords.length} search queries across connected platforms (${connectedList.join(', ')})...` 
      });

      const results = {};

      // 4. Run scan ONLY on confirmed CONNECTED platforms!
      if (platform === 'all' || platform === 'threads') {
        if (connectedMap.threads) {
          this.broadcast('log', { platform: 'threads', text: `🧵 Scanning Threads discussions for buyer inquiries...` });
          results.threads = await threadsAdapter.scanLeads(keywords, 8);
        } else {
          this.broadcast('log', { platform: 'threads', text: '⏭️ Skipping Threads: Channel is not connected.' });
        }
      }

      if (platform === 'all' || platform === 'instagram') {
        if (connectedMap.instagram) {
          this.broadcast('log', { platform: 'instagram', text: `📸 Scanning Instagram tags & explore content...` });
          results.instagram = await instagramAdapter.scanLeads(keywords, 8);
        } else {
          this.broadcast('log', { platform: 'instagram', text: '⏭️ Skipping Instagram: Channel is not connected.' });
        }
      }

      if (platform === 'all' || platform === 'facebook') {
        if (connectedMap.facebook) {
          this.broadcast('log', { platform: 'facebook', text: `👥 Scanning Facebook groups & search posts...` });
          results.facebook = await facebookAdapter.scanLeads(keywords, 8);
        } else {
          this.broadcast('log', { platform: 'facebook', text: '⏭️ Skipping Facebook: Channel is not connected.' });
        }
      }

      if (platform === 'all' || platform === 'linkedin') {
        if (connectedMap.linkedin) {
          this.broadcast('log', { platform: 'linkedin', text: `💼 Scanning LinkedIn Content Search for buyers & projects...` });
          results.linkedin = await linkedInAdapter.scanLeads(keywords, 8);
        } else {
          this.broadcast('log', { platform: 'linkedin', text: '⏭️ Skipping LinkedIn: Channel is not connected.' });
        }
      }

      const totalCaptured = Object.values(results).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0);
      this.broadcast('scan_status', { status: 'completed', results, totalCaptured });
      this.broadcast('leads_updated', { stats: LeadModel.getStats(), newLeadsCount: totalCaptured });
      return { success: true, results, totalCaptured };
    } catch (err) {
      console.error('[Orchestrator] Scan execution error:', err);
      this.broadcast('scan_status', { status: 'error', error: err.message });
      return { success: false, error: err.message };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Engages a specific lead with an AI-crafted comment or DM
   */
  async engageLead(leadId, customComment = null) {
    const lead = LeadModel.getById(parseInt(leadId, 10));

    if (!lead) {
      throw new Error(`Lead #${leadId} not found`);
    }

    const commentText = customComment || lead.ai_comment || 'Insightful point! Would love to connect and share notes.';
    this.broadcast('log', { 
      platform: lead.platform, 
      text: `Navigating directly to target post: ${lead.post_url} to comment specifically on this thread...` 
    });

    let result = { success: false };

    if (lead.platform === 'threads') {
      result = await threadsAdapter.commentOnPost(lead.post_url, commentText);
    } else if (lead.platform === 'linkedin') {
      result = await linkedInAdapter.commentOnPost(lead.post_url, commentText);
    } else if (lead.platform === 'facebook') {
      result = await facebookAdapter.commentOnPost(lead.post_url, commentText);
    } else if (lead.platform === 'instagram') {
      result = await instagramAdapter.commentOnPost(lead.post_url, commentText);
    }

    if (result.success) {
      const nowIso = new Date().toISOString();
      LeadModel.updateStatus(lead.id, 'engaged', { 
        ai_comment: commentText,
        reached_out_at: nowIso,
        last_comment_url: lead.post_url
      });
      this.broadcast('log', { 
        platform: lead.platform, 
        text: `✅ Comment successfully posted directly on ${lead.post_url} at ${new Date().toLocaleTimeString()}!` 
      });
      this.broadcast('leads_updated', { stats: LeadModel.getStats() });
    }

    return { ...result, post_url: lead.post_url, reached_out_at: new Date().toISOString() };
  }

  /**
   * Sends a personalized DM follow up to a lead
   */
  async sendFollowUpDM(leadId, customDM = null) {
    const lead = LeadModel.getById(parseInt(leadId, 10));

    if (!lead) throw new Error(`Lead #${leadId} not found`);

    const dmText = customDM || await reasoner.synthesizeDM(lead);
    this.broadcast('log', { platform: lead.platform, text: `Dispatching DM follow-up to @${lead.author_handle}...` });

    let result = { success: false };

    if (lead.platform === 'threads') {
      result = await threadsAdapter.sendDM(lead.author_handle, dmText);
    } else if (lead.platform === 'instagram') {
      result = await instagramAdapter.sendDM(lead.author_handle, dmText);
    } else {
      // For LinkedIn / Facebook, mark ready and log DM draft
      result = { success: true, message: 'DM synthesized and logged for delivery' };
      LogModel.add(lead.platform, 'dm_ready', `Synthesized personalized DM for @${lead.author_handle}`, { dmText });
    }

    if (result.success) {
      const nowIso = new Date().toISOString();
      LeadModel.updateStatus(lead.id, 'dm_sent', { 
        last_dm: dmText,
        reached_out_at: nowIso
      });
      this.broadcast('leads_updated', { stats: LeadModel.getStats() });
    }

    return { ...result, dmText, reached_out_at: new Date().toISOString() };
  }

  /**
   * Publishes post to specified platform
   */
  async publishPost(platform, content) {
    this.broadcast('log', { platform, text: `Publishing organic post on ${platform}...` });
    if (platform === 'threads') return await threadsAdapter.publishThread(content);
    if (platform === 'linkedin') return await linkedInAdapter.publishPost(content);
    if (platform === 'facebook') return await facebookAdapter.publishPost(content);
    throw new Error(`Unsupported publishing platform: ${platform}`);
  }
}

export const orchestrator = new AutomationOrchestrator();
