import { SettingsModel, LogModel, db } from '../db/database.js';
import { MapsScorecardBridge } from './mapsScorecardBridge.js';

export class ReachInboxClient {
  static getBaseUrl() {
    return 'https://api.reachinbox.ai/api/v1';
  }

  static getCredentials() {
    const apiKey = SettingsModel.get('reachinbox_api_key') || process.env.REACHINBOX_API_KEY || '';
    const campaignId = SettingsModel.get('reachinbox_campaign_id') || process.env.REACHINBOX_CAMPAIGN_ID || '';
    return { apiKey, campaignId };
  }

  /**
   * Tests connection with ReachInbox API using provided or stored key
   */
  static async testConnection(apiKeyOverride = null) {
    const apiKey = apiKeyOverride || this.getCredentials().apiKey;
    if (!apiKey) {
      return { success: false, error: 'No ReachInbox API key configured. Please enter your API key in Settings.' };
    }

    try {
      const res = await fetch(`${this.getBaseUrl()}/campaigns`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        LogModel.add('reachinbox', 'test_success', 'ReachInbox API connection verified successfully');
        return { success: true, message: 'Connected to ReachInbox successfully!', data };
      } else {
        const errText = await res.text().catch(() => res.statusText);
        return { success: false, status: res.status, error: `ReachInbox error (${res.status}): ${errText}` };
      }
    } catch (err) {
      return { success: false, error: `Network error reaching ReachInbox: ${err.message}` };
    }
  }

  /**
   * Pushes an array of Google Maps leads into a ReachInbox campaign
   */
  static async syncLeadsToCampaign({ leads, campaignIdOverride = null, apiKeyOverride = null }) {
    const { apiKey: storedKey, campaignId: storedCampaignId } = this.getCredentials();
    const apiKey = apiKeyOverride || storedKey;
    const campaignId = campaignIdOverride || storedCampaignId;

    if (!apiKey) {
      throw new Error('ReachInbox API key is missing. Please set it in Settings.');
    }
    if (!campaignId) {
      throw new Error('ReachInbox Campaign ID is missing. Please specify a campaign ID.');
    }

    // Format leads with clean scorecard links and custom variables
    const formattedEmails = [];
    for (const lead of leads) {
      if (!lead.email) continue;

      // Ensure clean scorecard link exists
      const scorecardData = MapsScorecardBridge.generateScorecardForMapsLead(lead);
      const scorecardUrl = scorecardData ? scorecardData.publicScorecardUrl : 'https://crm.thedigitalfrog.com/scorecard';

      // Parse doctor/contact name
      let firstName = (lead.contact_person || '').split(' ')[0] || 'Doctor';
      let lastName = (lead.contact_person || '').split(' ').slice(1).join(' ') || 'Director';
      if (lead.is_medical && !firstName.toLowerCase().startsWith('dr')) {
        firstName = `Dr. ${firstName}`;
      }

      formattedEmails.push({
        email: lead.email.trim().toLowerCase(),
        firstName,
        lastName,
        company: lead.business_name,
        phone: lead.phone || '',
        city: lead.city || '',
        scorecard_url: scorecardUrl,
        customVariables: {
          scorecard_url: scorecardUrl,
          city: lead.city || '',
          rating: lead.rating ? `${lead.rating}⭐` : '',
          reviews_count: lead.reviews_count || 0,
          topmate_url: process.env.TOPMATE_URL || 'https://topmate.io/isurajjaiswal',
          clean_pitch: scorecardData ? scorecardData.cleanEmailPitch : ''
        }
      });
    }

    if (formattedEmails.length === 0) {
      return { success: false, message: 'No valid leads with email addresses found to sync.' };
    }

    LogModel.add('reachinbox', 'sync_start', `Syncing ${formattedEmails.length} leads to ReachInbox campaign: ${campaignId}`);

    // Call ReachInbox API: POST /campaigns/add-email
    const response = await fetch(`${this.getBaseUrl()}/campaigns/add-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        campaignId,
        emails: formattedEmails
      })
    });

    const resBody = await response.json().catch(() => ({}));

    if (response.ok) {
      LogModel.add('reachinbox', 'sync_success', `Synced ${formattedEmails.length} leads to ReachInbox campaign ${campaignId}`);
      return {
        success: true,
        count: formattedEmails.length,
        response: resBody
      };
    } else {
      LogModel.add('reachinbox', 'sync_error', `Failed to sync leads to ReachInbox: ${JSON.stringify(resBody)}`);
      throw new Error(`ReachInbox API error (${response.status}): ${JSON.stringify(resBody)}`);
    }
  }

  /**
   * Generates CSV string specially formatted for ReachInbox manual or bulk campaign upload
   */
  static generateReachInboxCsv(leads) {
    const headers = [
      'Email',
      'First Name',
      'Last Name',
      'Company Name',
      'Phone',
      'City',
      'Scorecard URL',
      'Topmate URL',
      'Google Rating',
      'Reviews Count',
      'Clean Cold Email Pitch'
    ];

    const rows = leads.filter(l => l.email).map(lead => {
      const scorecardData = MapsScorecardBridge.generateScorecardForMapsLead(lead);
      const scorecardUrl = scorecardData ? scorecardData.publicScorecardUrl : 'https://crm.thedigitalfrog.com/scorecard';
      const cleanPitch = scorecardData ? scorecardData.cleanEmailPitch : (lead.ai_email_pitch || '');

      let firstName = (lead.contact_person || '').split(' ')[0] || 'Doctor';
      let lastName = (lead.contact_person || '').split(' ').slice(1).join(' ') || 'Director';
      if (lead.is_medical && !firstName.toLowerCase().startsWith('dr')) {
        firstName = `Dr. ${firstName}`;
      }

      const escape = (val) => `"${String(val || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

      return [
        escape(lead.email),
        escape(firstName),
        escape(lastName),
        escape(lead.business_name),
        escape(lead.phone),
        escape(lead.city),
        escape(scorecardUrl),
        escape(process.env.TOPMATE_URL || 'https://topmate.io/isurajjaiswal'),
        escape(lead.rating ? `${lead.rating}⭐` : ''),
        escape(lead.reviews_count || 0),
        escape(cleanPitch)
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }
}
