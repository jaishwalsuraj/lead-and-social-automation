import { db, GoogleMapsLeadModel, LogModel } from '../db/database.js';
import { checkCountryExclusion } from '../utils/countryFilter.js';
import { MapsScorecardBridge } from './mapsScorecardBridge.js';

export class BulkLeadImporter {
  /**
   * Parse CSV text into array of lead objects
   */
  static parseCsv(csvText) {
    if (!csvText || typeof csvText !== 'string') return [];
    const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];

    // Parse header line
    const headerLine = lines[0];
    const headers = this.parseCsvRow(headerLine).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvRow(lines[i]);
      if (values.length === 0 || (values.length === 1 && !values[0])) continue;

      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = values[idx] ? values[idx].trim() : '';
      });
      rows.push(obj);
    }

    return rows;
  }

  static parseCsvRow(rowText) {
    const result = [];
    let insideQuote = false;
    let current = '';

    for (let i = 0; i < rowText.length; i++) {
      const char = rowText[i];
      if (char === '"' || char === "'") {
        if (insideQuote && rowText[i + 1] === char) {
          current += char;
          i++;
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Normalize an imported raw row into standard Lead fields
   */
  static normalizeRow(row) {
    const getVal = (...keys) => {
      for (const k of keys) {
        for (const rowKey of Object.keys(row)) {
          if (rowKey === k || rowKey.includes(k)) {
            if (row[rowKey]) return row[rowKey];
          }
        }
      }
      return '';
    };

    const business_name = getVal('business_name', 'company', 'name', 'title', 'practice', 'clinic');
    const phone = getVal('phone', 'tel', 'mobile', 'contact_number');
    const email = getVal('email', 'mail', 'contact_email');
    const website_url = getVal('website', 'site', 'domain', 'url', 'web');
    const city = getVal('city', 'location', 'town', 'area');
    const state = getVal('state', 'region', 'province');
    const category = getVal('category', 'niche', 'industry', 'specialty', 'type') || 'Local Business';
    const address = getVal('address', 'street', 'full_address');
    const rating = parseFloat(getVal('rating', 'score', 'stars')) || 4.8;
    const reviews_count = parseInt(getVal('reviews', 'review_count', 'reviews_count', 'total_reviews'), 10) || 25;

    return {
      business_name,
      phone,
      email,
      website_url,
      has_website: website_url && website_url.length > 4 ? 1 : 0,
      city,
      state,
      category,
      address,
      rating,
      reviews_count
    };
  }

  /**
   * Ingest and enrich bulk leads
   */
  static async importAndEnrich(rawRecords) {
    let imported = 0;
    let droppedCountry = 0;
    let duplicates = 0;
    let deadLeads = 0;

    for (const raw of rawRecords) {
      const lead = this.normalizeRow(raw);
      if (!lead.business_name) continue;

      // 1. Strict Country Exclusion check
      const countryCheck = checkCountryExclusion({
        text: `${lead.business_name} ${lead.category}`,
        phone: lead.phone,
        city: lead.city,
        address: lead.address,
        url: lead.website_url
      });

      if (countryCheck.excluded) {
        droppedCountry++;
        continue;
      }

      // 2. Check if lead has zero contact methods (dead lead)
      const hasContact = Boolean(
        (lead.email && lead.email.includes('@')) ||
        (lead.phone && lead.phone.replace(/[^\d]/g, '').length >= 7)
      );

      const contactStatus = hasContact ? 'verified' : 'uncontactable';
      if (!hasContact) deadLeads++;

      // 3. Insert or update in GoogleMapsLeadModel
      const res = GoogleMapsLeadModel.create({
        ...lead,
        contact_status: contactStatus,
        status: hasContact ? 'discovered' : 'dead',
        search_query: 'Bulk Uploaded Leads',
        location_searched: lead.city || 'Uploaded List'
      });

      if (res.isExcluded) {
        droppedCountry++;
        continue;
      }

      const leadId = res.lastInsertRowid || res.id;
      if (!leadId) {
        duplicates++;
        continue;
      }

      // 4. Automatically generate diagnostic Scorecard & clean email pitch
      try {
        const fullLead = db.prepare('SELECT * FROM google_maps_leads WHERE id = ?').get(leadId);
        if (fullLead) {
          MapsScorecardBridge.generateScorecardForMapsLead(fullLead);
        }
      } catch (scErr) {
        console.warn(`[BulkLeadImporter] Scorecard generation note for lead #${leadId}:`, scErr.message);
      }

      imported++;
    }

    LogModel.add('system', 'bulk_import_complete', `Imported ${imported} leads (${droppedCountry} country blocked, ${duplicates} duplicates, ${deadLeads} uncontactable)`);

    return {
      totalSubmitted: rawRecords.length,
      imported,
      droppedCountry,
      duplicates,
      deadLeads
    };
  }

  /**
   * Purge all dead leads (uncontactable or unverified leads with zero response channels)
   */
  static purgeDeadLeads() {
    const mapsDeadResult = db.prepare(`
      DELETE FROM google_maps_leads 
      WHERE (contact_status = 'uncontactable' OR status = 'dead')
         OR ((email IS NULL OR email = '') AND (phone IS NULL OR phone = ''))
    `).run();

    const socialDeadResult = db.prepare(`
      DELETE FROM leads 
      WHERE feedback = 'incorrect' OR status = 'archived'
    `).run();

    LogModel.add('system', 'dead_leads_purged', `Purged ${mapsDeadResult.changes} dead Maps leads and ${socialDeadResult.changes} disqualified social leads.`);

    return {
      mapsPurged: mapsDeadResult.changes,
      socialPurged: socialDeadResult.changes,
      totalPurged: mapsDeadResult.changes + socialDeadResult.changes
    };
  }
}
