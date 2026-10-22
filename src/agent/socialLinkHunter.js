import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleMapsLeadModel, LogModel } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, '../../user_data/chrome_profile');

export class SocialLinkHunter {
  constructor() {
    this.isProcessing = false;
  }

  /**
   * Fast HTTP 302/301 redirect resolver for Google /goto links.
   */
  async resolveGoto(gotoUrl) {
    try {
      const full = gotoUrl.startsWith('http') ? gotoUrl : `https://www.google.com${gotoUrl}`;
      const res = await fetch(full, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        }
      });
      const loc = res.headers.get('location');
      return loc ? loc.split('?')[0].replace(/\/+$/, '') : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Sanitizes and classifies a social link.
   */
  sanitizeSocialLink(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    let url = rawUrl.trim();

    // Instagram
    if (url.includes('instagram.com/')) {
      const m = url.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._-]+)/i);
      if (m && !['p', 'reel', 'reels', 'explore', 'stories', 'direct', 'accounts', 'developer'].includes(m[1].toLowerCase())) {
        return { platform: 'instagram', url: `https://www.instagram.com/${m[1]}` };
      }
    }

    // Facebook
    if (url.includes('facebook.com/')) {
      const m = url.match(/https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9._-]+)/i);
      if (m && !['share', 'sharer', 'help', 'login', 'policies', 'privacy', 'tr', 'dialog'].includes(m[1].toLowerCase())) {
        return { platform: 'facebook', url: `https://www.facebook.com/${m[1]}` };
      }
    }

    // LinkedIn
    if (url.includes('linkedin.com/')) {
      const m = url.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9._-]+)/i);
      if (m) {
        return { platform: 'linkedin', url: `https://www.linkedin.com/company/${m[1]}` };
      }
    }

    // YouTube
    if (url.includes('youtube.com/')) {
      const m = url.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)?([a-zA-Z0-9._-]+)/i);
      if (m && !['watch', 'results', 'feed', 'embed', 'shorts'].includes(m[1].toLowerCase())) {
        return { platform: 'youtube', url: `https://www.youtube.com/@${m[1]}` };
      }
    }

    // Twitter / X
    if (url.includes('twitter.com/') || url.includes('x.com/')) {
      const m = url.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i);
      if (m && !['intent', 'share', 'home', 'search', 'privacy'].includes(m[1].toLowerCase())) {
        return { platform: 'twitter', url: `https://twitter.com/${m[1]}` };
      }
    }

    // TikTok
    if (url.includes('tiktok.com/')) {
      const m = url.match(/https?:\/\/(?:www\.)?tiktok\.com\/@?([a-zA-Z0-9._-]+)/i);
      if (m && !['foryou', 'live', 'tag', 'video'].includes(m[1].toLowerCase())) {
        return { platform: 'tiktok', url: `https://www.tiktok.com/@${m[1]}` };
      }
    }

    return null;
  }

  /**
   * Scrapes website DOM (links, schema.org JSON-LD sameAs, footer) for social profiles.
   */
  async extractWebsiteSocials(websiteUrl, existingContext = null) {
    const socials = {};
    if (!websiteUrl) return socials;

    let context = existingContext;
    let localContextCreated = false;

    try {
      if (!context) {
        context = await chromium.launchPersistentContext(USER_DATA_DIR, {
          headless: true,
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
        });
        localContextCreated = true;
      }

      const page = await context.newPage();
      try {
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
        await page.waitForTimeout(1500);

        const extracted = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
          
          // Schema.org JSON-LD sameAs array
          const sameAs = [];
          document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
            try {
              const data = JSON.parse(s.innerText);
              if (data.sameAs) {
                if (Array.isArray(data.sameAs)) sameAs.push(...data.sameAs);
                else if (typeof data.sameAs === 'string') sameAs.push(data.sameAs);
              }
              if (data['@graph'] && Array.isArray(data['@graph'])) {
                data['@graph'].forEach(g => {
                  if (g.sameAs) {
                    if (Array.isArray(g.sameAs)) sameAs.push(...g.sameAs);
                    else if (typeof g.sameAs === 'string') sameAs.push(g.sameAs);
                  }
                });
              }
            } catch (_) {}
          });

          return [...links, ...sameAs];
        });

        for (const raw of extracted) {
          const s = this.sanitizeSocialLink(raw);
          if (s && !socials[s.platform]) {
            socials[s.platform] = s.url;
          }
        }
      } catch (pageErr) {
        // Fallback: fast regex scan on raw text
        try {
          const res = await fetch(websiteUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(4000)
          });
          if (res.ok) {
            const html = await res.text();
            const matches = html.match(/https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com|linkedin\.com|youtube\.com)\/[a-zA-Z0-9._/-]+/gi) || [];
            for (const m of matches) {
              const s = this.sanitizeSocialLink(m);
              if (s && !socials[s.platform]) socials[s.platform] = s.url;
            }
          }
        } catch (_) {}
      } finally {
        await page.close().catch(() => {});
      }
    } catch (_) {
    } finally {
      if (localContextCreated && context) {
        await context.close().catch(() => {});
      }
    }

    return socials;
  }

  /**
   * Performs an anti-detection stealth Google Search and extracts canonical destination links.
   */
  async searchSocialsGoogle(businessName, city = '', category = '', existingContext = null) {
    const socials = {};
    if (!businessName) return socials;

    let context = existingContext;
    let localContextCreated = false;

    try {
      if (!context) {
        context = await chromium.launchPersistentContext(USER_DATA_DIR, {
          headless: true,
          viewport: { width: 1366, height: 850 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
        });
        localContextCreated = true;
      }

      const page = await context.newPage();
      try {
        const query = `"${businessName}" ${city || ''} (instagram OR facebook OR linkedin)`;
        console.log(`[SocialHunter] Searching Google for: ${query}`);
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);

        // 1. Extract /goto?url= redirect URLs from organic results
        const gotoLinks = await page.evaluate(() => {
          const list = [];
          document.querySelectorAll('#rso a[href*="/goto?url="]').forEach(a => {
            const h = a.getAttribute('href');
            if (h && !list.includes(h)) list.push(h);
          });
          return list;
        });

        for (const g of gotoLinks.slice(0, 10)) {
          const target = await this.resolveGoto(g);
          if (target) {
            const s = this.sanitizeSocialLink(target);
            if (s && !socials[s.platform]) {
              socials[s.platform] = s.url;
            }
          }
        }

        // 2. Extract directly from snippet handles (e.g. "Instagram · atxfamilydental" or "@atxfamilydental")
        if (!socials.instagram || !socials.facebook) {
          const snippets = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#rso div.g, #rso div.MjjYud')).map(el => el.innerText || '');
          });

          for (const text of snippets) {
            if (!socials.instagram && (text.includes('Instagram') || text.includes('instagram.com'))) {
              const m = text.match(/Instagram\s*[·•-]\s*([a-zA-Z0-9._-]+)/i) || 
                        text.match(/@([a-zA-Z0-9._-]+)/i) ||
                        text.match(/instagram\.com\/([a-zA-Z0-9._-]+)/i);
              if (m && !['p', 'reel', 'reels', 'explore', 'stories'].includes(m[1].toLowerCase())) {
                socials.instagram = `https://www.instagram.com/${m[1]}`;
              }
            }

            if (!socials.facebook && (text.includes('Facebook') || text.includes('facebook.com'))) {
              const m = text.match(/Facebook\s*[·•-]\s*([a-zA-Z0-9._-]+)/i) ||
                        text.match(/facebook\.com\/([a-zA-Z0-9._-]+)/i);
              if (m && !['share', 'sharer', 'help', 'login', 'policies'].includes(m[1].toLowerCase())) {
                socials.facebook = `https://www.facebook.com/${m[1]}`;
              }
            }
          }
        }
      } finally {
        await page.close().catch(() => {});
      }
    } catch (err) {
      console.warn(`[SocialHunter] Google search notice for "${businessName}":`, err.message);
    } finally {
      if (localContextCreated && context) {
        await context.close().catch(() => {});
      }
    }

    return socials;
  }

  /**
   * Enriches a single Google Maps lead by hunting socials across website DOM and Google Search.
   */
  async enrichLead(leadId) {
    const lead = GoogleMapsLeadModel.getById(leadId);
    if (!lead) throw new Error(`Lead #${leadId} not found`);

    let existingSocials = {};
    try {
      existingSocials = lead.social_links ? (typeof lead.social_links === 'string' ? JSON.parse(lead.social_links) : lead.social_links) : {};
    } catch (_) {}

    console.log(`[SocialHunter] Hunting socials for Lead #${lead.id}: "${lead.business_name}" (${lead.city || 'Local'})...`);

    // Step 1: Extract from website if website exists
    let siteSocials = {};
    if (lead.has_website && lead.website_url) {
      siteSocials = await this.extractWebsiteSocials(lead.website_url);
    }

    // Step 2: If Instagram or Facebook still missing, run Google Search Hunter
    let searchSocials = {};
    const mergedSoFar = { ...existingSocials, ...siteSocials };
    if (!mergedSoFar.instagram || !mergedSoFar.facebook) {
      searchSocials = await this.searchSocialsGoogle(lead.business_name, lead.city, lead.category);
    }

    const finalSocials = { ...existingSocials, ...siteSocials, ...searchSocials };

    // Update contact methods array
    let contactMethods = [];
    try {
      contactMethods = lead.contact_methods ? (typeof lead.contact_methods === 'string' ? JSON.parse(lead.contact_methods) : lead.contact_methods) : [];
    } catch (_) {}

    if (lead.phone) contactMethods.push('phone', 'whatsapp');
    if (lead.email) contactMethods.push('email');
    if (finalSocials.instagram) contactMethods.push('instagram');
    if (finalSocials.facebook) contactMethods.push('facebook');
    if (finalSocials.linkedin) contactMethods.push('linkedin');

    contactMethods = Array.from(new Set(contactMethods));

    // Update SQLite database
    GoogleMapsLeadModel.updateContactDetails(lead.id, {
      social_links: JSON.stringify(finalSocials),
      contact_methods: JSON.stringify(contactMethods),
      contact_status: contactMethods.length > 0 ? 'verified' : lead.contact_status
    });

    const newlyAdded = Object.keys(finalSocials).filter(k => !existingSocials[k]);
    if (newlyAdded.length > 0) {
      LogModel.add('google_maps', 'social_links_enriched', `Enriched social links for "${lead.business_name}": Found ${newlyAdded.join(', ')}`, {
        leadId: lead.id,
        businessName: lead.business_name,
        socials: finalSocials
      });
    }

    return {
      success: true,
      leadId: lead.id,
      businessName: lead.business_name,
      socials: finalSocials,
      newlyAdded
    };
  }

  /**
   * Bulk enrich all leads or a targeted subset.
   */
  async enrichBatchLeads({ limit = 15, onProgress = null } = {}) {
    if (this.isProcessing) {
      return { success: false, message: 'Social media enrichment is already in progress' };
    }

    this.isProcessing = true;
    try {
      const allLeads = GoogleMapsLeadModel.getAll({ limit: 100 });
      
      // Filter for leads that are missing Instagram or Facebook
      const targetLeads = allLeads.filter(l => {
        let s = {};
        try { s = l.social_links ? (typeof l.social_links === 'string' ? JSON.parse(l.social_links) : l.social_links) : {}; } catch (_) {}
        return !s.instagram || !s.facebook;
      }).slice(0, limit);

      LogModel.add('google_maps', 'social_enrich_start', `Starting social link hunt for ${targetLeads.length} Google Maps leads`);

      const results = [];
      let context = null;

      try {
        context = await chromium.launchPersistentContext(USER_DATA_DIR, {
          headless: true,
          viewport: { width: 1366, height: 850 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
        });

        for (let i = 0; i < targetLeads.length; i++) {
          const lead = targetLeads[i];
          try {
            console.log(`[SocialHunter] [${i + 1}/${targetLeads.length}] Hunting for: ${lead.business_name}`);
            
            // Site socials
            let siteSocials = {};
            if (lead.has_website && lead.website_url) {
              siteSocials = await this.extractWebsiteSocials(lead.website_url, context);
            }

            // Google Search socials
            let searchSocials = {};
            let existing = {};
            try { existing = lead.social_links ? JSON.parse(lead.social_links) : {}; } catch (_) {}
            
            const combined = { ...existing, ...siteSocials };
            if (!combined.instagram || !combined.facebook) {
              searchSocials = await this.searchSocialsGoogle(lead.business_name, lead.city, lead.category, context);
            }

            const finalSocials = { ...existing, ...siteSocials, ...searchSocials };

            // Update contact methods
            let contactMethods = [];
            try { contactMethods = lead.contact_methods ? JSON.parse(lead.contact_methods) : []; } catch (_) {}
            if (lead.phone) contactMethods.push('phone', 'whatsapp');
            if (lead.email) contactMethods.push('email');
            if (finalSocials.instagram) contactMethods.push('instagram');
            if (finalSocials.facebook) contactMethods.push('facebook');
            if (finalSocials.linkedin) contactMethods.push('linkedin');
            contactMethods = Array.from(new Set(contactMethods));

            GoogleMapsLeadModel.updateContactDetails(lead.id, {
              social_links: JSON.stringify(finalSocials),
              contact_methods: JSON.stringify(contactMethods),
              contact_status: contactMethods.length > 0 ? 'verified' : lead.contact_status
            });

            const newlyAdded = Object.keys(finalSocials).filter(k => !existing[k]);
            results.push({
              id: lead.id,
              name: lead.business_name,
              socials: finalSocials,
              newlyAdded
            });

            if (onProgress) {
              onProgress({
                current: i + 1,
                total: targetLeads.length,
                lead: lead.business_name,
                socials: finalSocials
              });
            }

            // Human delay cooldown between searches
            await new Promise(r => setTimeout(r, 1200));

          } catch (leadErr) {
            console.error(`[SocialHunter] Error on lead ${lead.business_name}:`, leadErr.message);
          }
        }
      } finally {
        if (context) await context.close().catch(() => {});
      }

      LogModel.add('google_maps', 'social_enrich_complete', `Social link hunt complete: Enriched ${results.length} Google Maps leads with social links`);
      return { success: true, count: results.length, results };

    } finally {
      this.isProcessing = false;
    }
  }
}

export const socialLinkHunter = new SocialLinkHunter();
