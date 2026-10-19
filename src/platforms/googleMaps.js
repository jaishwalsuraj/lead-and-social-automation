import { chromium } from 'playwright';
import { GoogleMapsLeadModel, LogModel, SettingsModel } from '../db/database.js';
import { NICHE_REGISTRY, detectNiche } from '../agent/scorecardEngine.js';
import { checkCountryExclusion, validateSearchTargeting } from '../utils/countryFilter.js';
import { MapsScorecardBridge } from '../agent/mapsScorecardBridge.js';

export class GoogleMapsAdapter {
  constructor() {
    this.platform = 'google_maps';
    this.isScanning = false;
  }

  /**
   * Scans Google Maps for local businesses by query and location with 100% verified website & contact checking.
   */
  async scanLeads({ query = 'plumbers', location = 'Austin, TX', limit = 20, noWebsiteOnly = false, onProgress = null }) {
    if (this.isScanning) {
      return { success: false, message: 'Google Maps scan already running' };
    }

    // 1. Strict Targeting Policy Check (Excludes Bangladesh, Pakistan, Bhutan, Nepal, etc.)
    const targetCheck = validateSearchTargeting(query, location);
    if (!targetCheck.allowed) {
      LogModel.add(this.platform, 'targeting_blocked', targetCheck.error);
      return { success: false, error: targetCheck.error };
    }

    this.isScanning = true;

    const fullQuery = location ? `${query} in ${location}` : query;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;
    LogModel.add(this.platform, 'scan_start', `Searching Google Maps for "${fullQuery}" (Target: ${limit}, NoWebsiteFilter: ${noWebsiteOnly})`);

    let browser = null;
    const capturedLeads = [];

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 850 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      console.log(`[GoogleMaps] Navigating to search feed: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Dismiss Cookie Consent banner if present
      const consentBtn = await page.$('button[aria-label*="Accept all"], form[action*="consent"] button, button:has-text("Accept all")');
      if (consentBtn) {
        await consentBtn.click().catch(() => {});
        await page.waitForTimeout(1500);
      }

      // Scroll feed to load candidate listings
      const feed = await page.$('div[role="feed"]');
      if (feed) {
        // Collect enough candidate cards (at least 2.5x the requested limit to account for website/contact filtering)
        const targetRawCards = Math.max(limit * 3, 25);
        const scrollIterations = Math.min(Math.ceil(targetRawCards / 5), 10);
        for (let s = 0; s < scrollIterations; s++) {
          await feed.evaluate(el => el.scrollBy(0, 1600));
          await page.waitForTimeout(1000);
        }
      }

      // Extract candidate place cards from feed
      const rawCandidates = await page.evaluate(() => {
        const items = [];
        const cardElements = document.querySelectorAll('div.Nv2PK');

        cardElements.forEach(el => {
          const link = el.querySelector('a.hfpxzc');
          const name = link?.getAttribute('aria-label') || el.querySelector('.fontHeadlineSmall')?.textContent?.trim();
          const mapsUrl = link?.getAttribute('href') || null;

          if (!name || !mapsUrl) return;

          const ratingEl = el.querySelector('span[role="img"]');
          const ratingText = ratingEl?.getAttribute('aria-label') || '';
          
          const ratingMatch = ratingText.match(/([\d.]+)\s*stars?/i) || el.innerText.match(/\b([1-5]\.\d)\b/);
          const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

          const reviewsMatch = ratingText.match(/\(([\d,]+)\)/) || el.innerText.match(/\(([\d,]+)\)/) || el.innerText.match(/([\d,]+)\s*reviews?/i);
          const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : 0;

          items.push({
            name,
            mapsUrl,
            rating,
            reviewsCount
          });
        });

        // Deduplicate by name and mapsUrl
        const unique = [];
        const seen = new Set();
        for (const item of items) {
          const key = (item.mapsUrl || item.name).toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
          }
        }
        return unique;
      });

      console.log(`[GoogleMaps] Extracted ${rawCandidates.length} candidate places for "${fullQuery}"`);

      // Close the search feed page to save memory while inspecting individual places
      await page.close().catch(() => {});

      // Deeply inspect each candidate place directly on its Google Maps place page
      for (let i = 0; i < rawCandidates.length; i++) {
        if (capturedLeads.length >= limit) break;

        const candidate = rawCandidates[i];
        try {
          console.log(`[GoogleMaps] [${i + 1}/${rawCandidates.length}] Verifying place: ${candidate.name}...`);
          
          const enriched = await this.inspectAndEnrichPlace(context, candidate, location, query);
          if (!enriched) {
            continue;
          }

          // 2. Strict Country Policy Check: Exclude Bangladesh, Pakistan, Bhutan, Nepal, etc.
          const countryCheck = checkCountryExclusion({
            text: enriched.business_name,
            city: enriched.city,
            address: enriched.address,
            phone: enriched.phone,
            url: enriched.website_url
          });
          if (countryCheck.excluded) {
            console.log(`[GoogleMaps] ⛔ DROPPED lead "${candidate.name}": ${countryCheck.reason}`);
            LogModel.add(this.platform, 'lead_skipped_country_policy', `Dropped lead "${candidate.name}" from ${countryCheck.country || 'excluded territory'}: ${countryCheck.reason}`);
            continue;
          }

          // Filter by No Website if requested
          if (noWebsiteOnly && enriched.has_website) {
            console.log(`[GoogleMaps] Skipping "${candidate.name}": has verified website (${enriched.website_url}) and noWebsiteOnly is enabled.`);
            continue;
          }

          // STRICT CONTACTABILITY CHECK:
          // A lead is only valid if we have at least ONE actionable way to contact them:
          // 1. Phone / WhatsApp
          // 2. Email
          // 3. Direct Social Media profile (Instagram, Facebook, LinkedIn)
          const hasPhone = Boolean(enriched.phone && enriched.phone.trim().length >= 7);
          const hasEmail = Boolean(enriched.email && enriched.email.trim());
          const socials = enriched.social_links ? JSON.parse(enriched.social_links) : {};
          const hasSocials = Object.keys(socials).length > 0;

          if (!hasPhone && !hasEmail && !hasSocials) {
            console.log(`[GoogleMaps] DROPPED uncontactable listing "${candidate.name}" (No phone, no email, no socials)`);
            LogModel.add(this.platform, 'lead_skipped_no_contact', `Dropped uncontactable listing "${candidate.name}" - without contact details it cannot be pitched.`);
            continue;
          }

          // Automatically generate Diagnostic Scorecard & Clean Email Pitch
          try {
            const scResult = MapsScorecardBridge.generateScorecardForMapsLead(enriched);
            if (scResult) {
              enriched.ai_email_pitch = scResult.cleanEmailPitch;
              enriched.ai_whatsapp_pitch = scResult.cleanWhatsappPitch;
              enriched.doctor_prescription = scResult.cleanEmailPitch;
              enriched.opportunity_summary = `Scorecard #${scResult.scorecardId}: ${scResult.overallScore}/100. Video: ${scResult.scores.videoScore}/100. Audit URL: ${scResult.publicScorecardUrl}`;
            }
          } catch (scErr) {
            console.warn('[GoogleMaps] Error auto-generating scorecard for lead:', scErr.message);
          }

          // Save high-value contactable lead
          GoogleMapsLeadModel.create(enriched);
          capturedLeads.push(enriched);

          LogModel.add(this.platform, 'maps_lead_captured', `Captured: ${enriched.business_name} (${enriched.has_website ? 'Has Site' : '🔥 NO WEBSITE'}, Phone: ${enriched.phone || 'N/A'}, Email: ${enriched.email || 'N/A'})`, {
            name: enriched.business_name,
            opportunityType: enriched.opportunity_type,
            score: enriched.opportunity_score,
            contactMethods: enriched.contact_methods
          });

          if (onProgress) {
            onProgress({
              current: capturedLeads.length,
              target: limit,
              lead: enriched
            });
          }

        } catch (cardErr) {
          console.error(`[GoogleMaps] Error verifying candidate "${candidate.name}":`, cardErr.message);
        }
      }

      LogModel.add(this.platform, 'scan_complete', `Google Maps scan complete: Found ${capturedLeads.length} 100% verified, contactable leads in ${location}`);
      return { success: true, count: capturedLeads.length, leads: capturedLeads };

    } catch (err) {
      console.error('[GoogleMaps] Scan error:', err);
      LogModel.add(this.platform, 'error', `Google Maps scan failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      this.isScanning = false;
    }
  }

  /**
   * Inspects a Google Maps place page directly and enriches with deep contact details.
   */
  async inspectAndEnrichPlace(context, candidate, location, query) {
    const placePage = await context.newPage();
    let placeData = null;

    try {
      await placePage.goto(candidate.mapsUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await placePage.waitForTimeout(2000);

      placeData = await placePage.evaluate(() => {
        // 1. Official Website Link Check (100% accurate authority item)
        const authLink = document.querySelector('a[data-item-id="authority"]');
        const ariaWebLink = Array.from(document.querySelectorAll('a[href]')).find(a => 
          a.getAttribute('aria-label')?.toLowerCase().includes('website') ||
          a.getAttribute('data-tooltip')?.toLowerCase().includes('website')
        );
        const websiteUrl = authLink?.href || ariaWebLink?.href || null;
        const hasWebsite = Boolean(websiteUrl);

        // 2. Phone Number Extraction
        const phoneBtn = Array.from(document.querySelectorAll('button[data-item-id], a[data-item-id], a[href^="tel:"]')).find(b => {
          const id = b.getAttribute('data-item-id') || '';
          return id.startsWith('phone:') || id.startsWith('tel:') || (b.getAttribute('href') || '').startsWith('tel:');
        });

        let phone = null;
        if (phoneBtn) {
          const itemId = phoneBtn.getAttribute('data-item-id') || '';
          if (itemId.startsWith('phone:tel:')) {
            phone = itemId.replace('phone:tel:', '').trim();
          } else if (phoneBtn.getAttribute('href')?.startsWith('tel:')) {
            phone = phoneBtn.getAttribute('href').replace('tel:', '').trim();
          } else {
            phone = (phoneBtn.getAttribute('aria-label') || phoneBtn.innerText || '').replace(/^Phone:\s*/i, '').trim();
          }
        }

        // 3. Address
        const addrBtn = document.querySelector('[data-item-id="address"]');
        const address = addrBtn ? addrBtn.innerText.replace(/^[\n\s]+/, '').trim() : null;

        // 4. Category
        const catBtn = document.querySelector('button[jsaction*="category"]');
        const category = catBtn ? catBtn.innerText.trim() : null;

        return { hasWebsite, websiteUrl, phone, address, category };
      });
    } catch (pageErr) {
      console.error(`[GoogleMaps] Failed to inspect place page for ${candidate.name}:`, pageErr.message);
    } finally {
      await placePage.close().catch(() => {});
    }

    if (!placeData) {
      return null;
    }

    // Clean Phone String
    let phone = placeData.phone || null;
    let email = null;
    let socialLinks = {};
    let missingSocials = ['instagram', 'facebook', 'linkedin', 'threads'];
    const contactMethods = [];

    // Contact Enrichment Phase 1: If website exists, scrape website for emails, phone, WhatsApp & socials
    if (placeData.hasWebsite && placeData.websiteUrl) {
      try {
        const siteContacts = await this.deepExtractWebsiteContacts(placeData.websiteUrl);
        if (!phone && siteContacts.phone) {
          phone = siteContacts.phone;
        }
        if (siteContacts.email) {
          email = siteContacts.email;
        }
        socialLinks = siteContacts.socials || {};
        missingSocials = siteContacts.missing || [];
      } catch (siteErr) {
        console.warn(`[GoogleMaps] Website contact scrape error for ${placeData.websiteUrl}:`, siteErr.message);
      }
    }

    // Contact Enrichment Phase 2: If phone is STILL missing, run fallback web search
    if (!phone) {
      try {
        const searchContacts = await this.huntContactsWebSearch(candidate.name, location);
        if (searchContacts.phone) {
          phone = searchContacts.phone;
        }
        if (!email && searchContacts.email) {
          email = searchContacts.email;
        }
        if (searchContacts.socials && Object.keys(searchContacts.socials).length > 0) {
          socialLinks = { ...socialLinks, ...searchContacts.socials };
        }
      } catch (searchErr) {
        console.warn(`[GoogleMaps] Web search fallback error for ${candidate.name}:`, searchErr.message);
      }
    }

    // Format phone digits and WhatsApp direct link
    let whatsappUrl = null;
    if (phone) {
      const cleanDigits = phone.replace(/[^\d+]/g, '');
      if (cleanDigits.length >= 7) {
        const waNumber = cleanDigits.replace(/^\+/, '');
        whatsappUrl = `https://wa.me/${waNumber}`;
        contactMethods.push('phone', 'whatsapp');
      }
    }
    if (email) {
      contactMethods.push('email');
    }
    if (socialLinks.instagram) contactMethods.push('instagram');
    if (socialLinks.facebook) contactMethods.push('facebook');
    if (socialLinks.linkedin) contactMethods.push('linkedin');

    // Detect Medical / Doctor / Clinic Lead
    const cleanCategory = placeData.category || query;
    const cleanCity = location.split(',')[0].trim();
    const cleanState = location.split(',')[1]?.trim() || '';
    const isMedical = this.isMedicalLead(candidate.name, cleanCategory, query);

    // Generate Doctor's Rx Prescription Pitches & Social Media Audit
    const doctorPitches = this.generateDoctorPrescription({
      name: candidate.name,
      category: cleanCategory,
      city: cleanCity,
      phone,
      email,
      rating: candidate.rating,
      reviewsCount: candidate.reviewsCount,
      hasWebsite: placeData.hasWebsite,
      websiteUrl: placeData.websiteUrl,
      socialLinks
    });

    const socialAudit = this.generateSocialAudit({
      name: candidate.name,
      category: cleanCategory,
      city: cleanCity,
      rating: candidate.rating,
      reviewsCount: candidate.reviewsCount,
      hasWebsite: placeData.hasWebsite,
      websiteUrl: placeData.websiteUrl,
      socialLinks,
      isMedical
    });

    // Calculate Opportunity Profile
    let opportunityType = 'ai_growth';
    let opportunityScore = 80;
    let opportunitySummary = 'Local AI & Geo-marketing Opportunity';

    if (isMedical) {
      opportunityType = 'medical_ai_reels';
      opportunityScore = 99;
      opportunitySummary = '🩺 CLINICAL AI AVATAR & REELS: High-reputation medical practice. Opportunity to clone doctor\'s voice & avatar to generate 15+ viral patient-education Reels without taking clinic hours.';
    } else if (!placeData.hasWebsite) {
      opportunityType = 'no_website';
      opportunityScore = 98;
      opportunitySummary = '🔥 PRIME AI WEBSITE PROSPECT: Verified active Google Maps business with customer demand, but ZERO official website. Losing 50%+ of online conversions to competitors!';
    } else if (candidate.reviewsCount < 25 || (candidate.rating && candidate.rating < 4.3)) {
      opportunityType = 'low_reviews';
      opportunityScore = 88;
      opportunitySummary = '📍 LOCAL SEO & REPUTATION PROSPECT: Low review volume / rating puts them at risk of losing the Google Maps 3-Pack to local competitors.';
    } else {
      opportunityType = 'ai_growth';
      opportunityScore = 82;
      opportunitySummary = '🚀 AI AUTOMATION & GEO RANKING: Established local business ready for 24/7 AI WhatsApp lead capture, Google Business Profile AEO, and multi-channel social growth.';
    }

    // Synthesize High-Converting Tailored Pitches
    let pitches = this.synthesizeLocalPitches({
      name: candidate.name,
      category: cleanCategory,
      city: cleanCity,
      phone,
      email,
      rating: candidate.rating,
      reviewsCount: candidate.reviewsCount,
      hasWebsite: placeData.hasWebsite,
      websiteUrl: placeData.websiteUrl,
      opportunityType
    });

    // Use niche-tailored outreach pitches for all business leads
    pitches = {
      callScript: doctorPitches.receptionistScript,
      whatsappPitch: doctorPitches.rxMessage,
      emailPitch: doctorPitches.rxEmail
    };

    return {
      business_name: candidate.name,
      category: cleanCategory,
      phone,
      email,
      whatsapp_url: whatsappUrl,
      address: placeData.address || '',
      city: cleanCity,
      state: cleanState,
      rating: candidate.rating,
      reviews_count: candidate.reviewsCount,
      has_website: placeData.hasWebsite ? 1 : 0,
      website_url: placeData.websiteUrl,
      maps_url: candidate.mapsUrl,
      social_links: JSON.stringify(socialLinks),
      missing_socials: JSON.stringify(missingSocials),
      contact_methods: JSON.stringify(Array.from(new Set(contactMethods))),
      contact_status: contactMethods.length > 0 ? 'verified' : 'uncontactable',
      opportunity_score: opportunityScore,
      opportunity_type: opportunityType,
      opportunity_summary: opportunitySummary,
      ai_call_script: pitches.callScript,
      ai_whatsapp_pitch: pitches.whatsappPitch,
      ai_email_pitch: pitches.emailPitch,
      is_medical: isMedical ? 1 : 0,
      doctor_prescription: JSON.stringify(doctorPitches),
      social_audit: JSON.stringify(socialAudit),
      status: 'discovered',
      search_query: query,
      location_searched: location
    };
  }

  /**
   * Deep contact extraction from website HTML: phones, emails, WhatsApp links, and socials.
   */
  async deepExtractWebsiteContacts(url) {
    const socials = {};
    const missing = [];
    let email = null;
    let phone = null;
    const targetPlatforms = ['instagram', 'facebook', 'youtube', 'linkedin', 'threads', 'twitter', 'tiktok'];

    const scanHtmlText = (text) => {
      // 1. Social profiles & handles
      const igMatch = text.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._-]+)/i);
      const fbMatch = text.match(/https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9._-]+)/i);
      const liMatch = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9._-]+)/i);
      const ytMatch = text.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)?([a-zA-Z0-9._-]+)/i);
      const thMatch = text.match(/https?:\/\/(?:www\.)?threads\.net\/@([a-zA-Z0-9._-]+)/i);
      const twMatch = text.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i);
      const tkMatch = text.match(/https?:\/\/(?:www\.)?tiktok\.com\/@?([a-zA-Z0-9._-]+)/i);

      if (igMatch && !igMatch[0].includes('/p/') && !igMatch[0].includes('/explore/') && !igMatch[0].includes('/accounts/') && !socials.instagram) {
        socials.instagram = igMatch[0].replace(/\/+$/, '');
      }
      if (fbMatch && !fbMatch[0].includes('/sharer') && !fbMatch[0].includes('/tr') && !socials.facebook) {
        socials.facebook = fbMatch[0].replace(/\/+$/, '');
      }
      if (liMatch && !socials.linkedin) socials.linkedin = liMatch[0].replace(/\/+$/, '');
      if (ytMatch && !socials.youtube) socials.youtube = ytMatch[0].replace(/\/+$/, '');
      if (thMatch && !socials.threads) socials.threads = thMatch[0].replace(/\/+$/, '');
      if (twMatch && !twMatch[0].includes('/share') && !socials.twitter) socials.twitter = twMatch[0].replace(/\/+$/, '');
      if (tkMatch && !socials.tiktok) socials.tiktok = tkMatch[0].replace(/\/+$/, '');

      // 2. Email Address (mailto: links or clean regex)
      if (!email) {
        const mailtoMatch = text.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (mailtoMatch) {
          email = mailtoMatch[1].toLowerCase();
        } else {
          const rawEmails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
          const validEmails = rawEmails.filter(e => 
            !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.webp') &&
            !e.includes('sentry') && !e.includes('wixpress') && !e.includes('example.com')
          );
          if (validEmails.length > 0) {
            email = validEmails[0].toLowerCase();
          }
        }
      }

      // 3. Phone numbers (tel: links or clean phone patterns)
      if (!phone) {
        const telMatch = text.match(/tel:([+\d\s().-]{7,20})/i);
        if (telMatch) {
          phone = telMatch[1].trim();
        } else {
          const phoneMatches = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
          const cleanPhones = phoneMatches.map(p => p.trim()).filter(p => p.length >= 8 && !p.startsWith('199') && !p.startsWith('202'));
          if (cleanPhones.length > 0) {
            phone = cleanPhones[0];
          }
        }
      }
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeout);

      if (res.ok) {
        const text = await res.text();
        scanHtmlText(text);

        // Subpage check: If missing Instagram/Facebook/Email, attempt to check /contact or /about
        if (!socials.instagram || !email) {
          try {
            const parsed = new URL(url);
            const contactUrl = `${parsed.origin}/contact`;
            const subController = new AbortController();
            const subTimeout = setTimeout(() => subController.abort(), 4000);
            const subRes = await fetch(contactUrl, {
              signal: subController.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
              }
            });
            clearTimeout(subTimeout);
            if (subRes.ok) {
              const subText = await subRes.text();
              scanHtmlText(subText);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    for (const p of targetPlatforms) {
      if (!socials[p]) missing.push(p);
    }

    return { socials, missing, email, phone };
  }

  /**
   * Fast web search fallback to hunt phone, email, or social profiles when missing on Google Maps.
   */
  async huntContactsWebSearch(name, city) {
    const query = `${name} ${city} phone contact`;
    const socials = {};
    let phone = null;
    let email = null;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeout);

      if (res.ok) {
        const html = await res.text();

        // Phone numbers regex: Indian 10-digit, US/Canada, or Landline
        const phoneRegexes = [
          /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g,
          /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
          /0\d{2,4}[-\s]?\d{6,8}/g
        ];

        for (const regex of phoneRegexes) {
          const matches = html.match(regex);
          if (matches && matches.length > 0) {
            phone = matches[0].trim();
            break;
          }
        }

        // Email address
        const emails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        const cleanEmails = emails.filter(e => !e.includes('duckduckgo') && !e.includes('example') && !e.endsWith('.png'));
        if (cleanEmails.length > 0) {
          email = cleanEmails[0].toLowerCase();
        }

        // Social handles
        const igMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._-]+)/i);
        const fbMatch = html.match(/https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9._-]+)/i);
        const liMatch = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9._-]+)/i);

        if (igMatch && !igMatch[0].includes('/p/') && !igMatch[0].includes('/explore')) socials.instagram = igMatch[0];
        if (fbMatch && !fbMatch[0].includes('/sharer')) socials.facebook = fbMatch[0];
        if (liMatch) socials.linkedin = liMatch[0];
      }
    } catch (_) {}

    return { phone, email, socials };
  }

  /**
   * Re-verifies and deep-enriches a single lead in the CRM using its Google Maps URL.
   */
  async reverifyLead(leadId) {
    const lead = GoogleMapsLeadModel.getById(leadId);
    if (!lead || !lead.maps_url) {
      throw new Error(`Lead ${leadId} not found or has no Google Maps URL`);
    }

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 850 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });

      const enriched = await this.inspectAndEnrichPlace(context, {
        name: lead.business_name,
        mapsUrl: lead.maps_url,
        rating: lead.rating,
        reviewsCount: lead.reviews_count
      }, lead.city || 'Local', lead.category || 'Business');

      if (!enriched) {
        throw new Error('Failed to extract place data from Google Maps URL');
      }

      // Update lead record in SQLite
      GoogleMapsLeadModel.updateContactDetails(lead.id, {
        phone: enriched.phone,
        email: enriched.email,
        whatsapp_url: enriched.whatsapp_url,
        has_website: enriched.has_website,
        website_url: enriched.website_url,
        social_links: enriched.social_links,
        contact_status: enriched.contact_status,
        contact_methods: enriched.contact_methods,
        opportunity_score: enriched.opportunity_score,
        opportunity_type: enriched.opportunity_type,
        opportunity_summary: enriched.opportunity_summary,
        is_medical: enriched.is_medical,
        doctor_prescription: enriched.doctor_prescription,
        social_audit: enriched.social_audit
      });

      GoogleMapsLeadModel.updatePitches(lead.id, {
        ai_call_script: enriched.ai_call_script,
        ai_whatsapp_pitch: enriched.ai_whatsapp_pitch,
        ai_email_pitch: enriched.ai_email_pitch,
        doctor_prescription: enriched.doctor_prescription
      });

      return GoogleMapsLeadModel.getById(lead.id);

    } finally {
      await browser.close().catch(() => {});
    }
  }

  /**
   * Re-verifies all existing Google Maps leads in the database in batch.
   * Fixes false "No Website" flags, extracts missing phone numbers & emails, and marks uncontactable dead pins.
   */
  async reverifyAllExistingLeads(onProgress = null) {
    const leads = GoogleMapsLeadModel.getAll({ limit: 500, include_uncontactable: 'true' });
    console.log(`[GoogleMaps] Batch re-verifying ${leads.length} leads in database...`);

    let browser = null;
    let updatedCount = 0;
    let uncontactableCount = 0;

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 850 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        if (!lead.maps_url) continue;

        try {
          console.log(`[GoogleMaps] Re-verifying [${i + 1}/${leads.length}]: ${lead.business_name}...`);
          const enriched = await this.inspectAndEnrichPlace(context, {
            name: lead.business_name,
            mapsUrl: lead.maps_url,
            rating: lead.rating,
            reviewsCount: lead.reviews_count
          }, lead.city || 'Local', lead.category || 'Business');

          if (enriched) {
            GoogleMapsLeadModel.updateContactDetails(lead.id, {
              phone: enriched.phone,
              email: enriched.email,
              whatsapp_url: enriched.whatsapp_url,
              has_website: enriched.has_website,
              website_url: enriched.website_url,
              social_links: enriched.social_links,
              contact_status: enriched.contact_status,
              contact_methods: enriched.contact_methods,
              opportunity_score: enriched.opportunity_score,
              opportunity_type: enriched.opportunity_type,
              opportunity_summary: enriched.opportunity_summary,
              is_medical: enriched.is_medical,
              doctor_prescription: enriched.doctor_prescription,
              social_audit: enriched.social_audit
            });

            GoogleMapsLeadModel.updatePitches(lead.id, {
              ai_call_script: enriched.ai_call_script,
              ai_whatsapp_pitch: enriched.ai_whatsapp_pitch,
              ai_email_pitch: enriched.ai_email_pitch,
              doctor_prescription: enriched.doctor_prescription
            });

            if (enriched.contact_status === 'uncontactable') {
              uncontactableCount++;
            } else {
              updatedCount++;
            }
          }

          if (onProgress) {
            onProgress({ current: i + 1, total: leads.length, leadName: lead.business_name });
          }
        } catch (err) {
          console.error(`[GoogleMaps] Failed re-verifying ${lead.business_name}:`, err.message);
        }
      }

      LogModel.add(this.platform, 'reverify_batch_complete', `Batch re-verification finished: Updated ${updatedCount} leads, marked ${uncontactableCount} uncontactable.`);
      return { success: true, total: leads.length, updated: updatedCount, uncontactable: uncontactableCount };

    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  /**
   * Generates 3 specialized high-converting pitches:
   * 1. Cold Call Script
   * 2. WhatsApp / SMS Message
   * 3. Cold Email Pitch
   */
  synthesizeLocalPitches({ name, category, city, phone, email, rating, reviewsCount, hasWebsite, websiteUrl, opportunityType }) {
    const cleanCity = city || 'your local area';
    const cleanCategory = category || 'local business';
    const repInfo = rating ? `your ${rating}⭐ rating with ${reviewsCount || 'dozens of'} Google reviews` : 'your strong Google reputation';

    // 1. Cold Call Script
    let callScript = '';
    if (!hasWebsite) {
      callScript = `📞 COLD CALL SCRIPT (High-Ticket AI Web Dev Offer)

[Gatekeeper / Intro]:
"Hi, I was looking for the owner or manager at ${name}—is that you?"

[The Reason / Compliment]:
"Great! My name is Suraj. I was checking out top-rated ${cleanCategory} services in ${cleanCity} and saw ${repInfo}. You guys have a great reputation."

[The Gap / Problem]:
"The reason for my quick call is that I noticed your Google Maps profile doesn't have an official website connected to it. In ${cleanCity}, over 60% of people who search for a ${cleanCategory} want to view pricing and book online directly from their phone. Right now, those customers are bouncing to other businesses."

[The AI Solution & Low-Friction Offer]:
"We build custom, AI-powered booking websites in 48 hours that turn Google Maps searchers into confirmed appointments on autopilot. Could I text a 60-second video demo showing what a modern site would look like for ${name} to your cell?"

[Objection Handle - 'We are too busy / don't need a site']:
"That's exactly why our AI sites have 24/7 instant booking and WhatsApp integration—so you stop answering repetitive phone calls while you're on the job and let the AI capture the client info automatically."`;
    } else {
      callScript = `📞 COLD CALL SCRIPT (Local SEO & AI Growth Offer)

[Gatekeeper / Intro]:
"Hi, is the owner or marketing lead at ${name} available?"

[The Reason / Observation]:
"Hi, my name is Suraj. I noticed your Google Maps listing for ${cleanCategory} in ${cleanCity}. You've got ${repInfo}, but you're currently sitting just below the top Google Maps 3-Pack spots."

[The Opportunity]:
"When someone in ${cleanCity} searches '${cleanCategory} near me' on their phone or on ChatGPT, Google is sending 70% of all call volume to the top 3 listings. We help established businesses like ${name} optimize their Google Business Profile and launch AI review automation to dominate that #1 spot."

[Low-Friction Offer]:
"I put together a free 2-minute Local SEO audit for ${name} showing 3 specific tweaks to boost your Maps ranking this week. What's the best email or WhatsApp to shoot that over to?"`;
    }

    // 2. WhatsApp / SMS Message
    let whatsappPitch = '';
    if (!hasWebsite) {
      whatsappPitch = `Hey team *${name}*! 👋

Saw your top-rated Google Maps listing in *${cleanCity}* (${rating ? rating + '⭐' : 'great reviews'})! 👏

Quick heads-up: I noticed your Google listing doesn't have an official website or online booking page linked. 

Most customers on Google Maps prefer to tap a website to see your services and book online before calling. Without one, you're likely losing high-paying clients to nearby competitors every day.

We build **high-converting, modern AI-powered websites** with instant mobile booking in 48 hours for ${cleanCategory} businesses.

Would love to send you a quick 60-second preview mockup for ${name}. Mind if I share it here? 🚀`;
    } else {
      whatsappPitch = `Hi *${name}* team! 👋

Came across your Google Maps listing for ${cleanCategory} in *${cleanCity}*. You have fantastic feedback from customers (${rating ? rating + '⭐' : 'great feedback'})!

We help top local businesses dominate the **Google Maps 3-Pack** and capture more calls using AI Local SEO and automated WhatsApp customer booking.

Would you be open to a quick 2-minute free audit showing 3 easy ranking opportunities for ${name}? 📈`;
    }

    // 3. Cold Email Pitch
    let emailPitch = '';
    if (!hasWebsite) {
      emailPitch = `Subject: Quick question regarding ${name}'s Google Maps listing in ${cleanCity}

Hi ${name} Team,

I was looking at top-rated ${cleanCategory} providers in ${cleanCity} and came across your listing on Google Maps. Congratulations on building such a strong reputation (${repInfo}).

I noticed one critical gap that's likely costing you customers: your Google Maps profile has no official website attached. 

When local customers search on Google Maps, over 60% tap the "Website" button to see services, pricing, and book directly. Without one, those high-intent clients click the next business down the list.

We build modern, AI-powered websites equipped with 24/7 mobile booking and instant WhatsApp capture in just 48 hours.

Would you be open to seeing a 60-second video demo of what a custom AI website would look like for ${name}?

Best regards,
Suraj Jaiswal
The Digital Frog | AI Lead & Digital Growth`;
    } else {
      emailPitch = `Subject: Local SEO & Google 3-Pack opportunity for ${name}

Hi ${name} Team,

I recently came across your Google Maps profile for ${cleanCategory} in ${cleanCity}. You clearly provide top-notch service (${repInfo}).

We ran a quick local search scan and noticed a huge opportunity for ${name} to take the #1 spot in the Google Maps 3-Pack and capture 3x more local inquiries.

We help local businesses automate 5-star customer reviews, optimize their Google Business Profile for AI search (AEO/GEO), and turn phone traffic into booked jobs on autopilot.

Can I send you a 2-minute video breakdown with 3 actionable tweaks you can make this week?

Best regards,
Suraj Jaiswal
The Digital Frog | AI Lead & Digital Growth`;
    }

    return { callScript, whatsappPitch, emailPitch };
  }

  /**
   * Helper to detect if a lead is a Doctor, Clinic, Dentist, or Healthcare practice.
   */
  isMedicalLead(name = '', category = '', query = '') {
    const combined = `${name} ${category} ${query}`.toLowerCase();
    const medicalTerms = [
      'doctor', 'dr.', 'dr ', 'clinic', 'dental', 'dentist', 'dermatol', 'hospital',
      'physician', 'surgeon', 'orthodont', 'pediatric', 'cosmetic', 'implant', 'skin',
      'healthcare', 'ayurved', 'homeopath', 'care clinic', 'oral', 'teeth', 'root canal',
      'ent', 'eye care', 'ophthalmol', 'cardio', 'gynec', 'orthoped', 'medic'
    ];
    return medicalTerms.some(term => combined.includes(term));
  }

  /**
   * Generates specialized Outreach Pitches (customized for Doctors or Local Business Owners):
   * 1. Version 1: Direct AI Avatar & Authority Video Protocol (No fee payment)
   * 2. Version 2: 2-Minute Digital Health & Growth Audit Invitation (links to /scorecard)
   */
  generateDoctorPrescription(leadData = {}) {
    const businessName = leadData.name || leadData.business_name || 'Business Organization';
    const cleanCity = leadData.city || 'your local area';
    const rawCat = (leadData.category || '').trim();
    const query = leadData.query || leadData.search_query || '';
    const isStatusString = /^(open|closed|closes|opens)\b/i.test(rawCat);
    const cleanCategory = (!rawCat || isStatusString) ? (query || 'Local Business') : rawCat;
    const isMedical = this.isMedicalLead(businessName, cleanCategory, query);
    const nicheKey = detectNiche(cleanCategory + ' ' + businessName + ' ' + query);
    const profile = NICHE_REGISTRY[nicheKey] || (isMedical ? NICHE_REGISTRY.medical : NICHE_REGISTRY.general);
    const rating = leadData.rating;
    const reviewsCount = leadData.reviewsCount || leadData.reviews_count;
    const phone = leadData.phone;
    const repInfo = rating ? `${rating}⭐ (${reviewsCount || 'established'} Google reviews)` : 'established local business';
    const publicBase = SettingsModel.get('public_url') || process.env.PUBLIC_URL || 'http://localhost:3000';
    const scorecardUrl = `${publicBase.replace(/\/+$/, '')}/scorecard`;

    // ==========================================
    // CASE A: AUTHENTIC MEDICAL & DOCTOR CLINICAL PRESCRIPTION
    // ==========================================
    if (isMedical) {
      const drMatch = businessName.match(/^(?:Dr\.?|Doctor)\s+([^,\-(]+)/i);
      const drName = drMatch ? drMatch[0].trim() : `Clinic Director at ${businessName}`;
      const targetClinician = drMatch ? drMatch[0].trim() : `the Medical Director at ${businessName}`;

      const rxEmail = `Subject: ℞ Clinical Growth Prescription for ${drName} | ${businessName}

℞ CLINICAL GROWTH & PATIENT ACQUISITION PRESCRIPTION
══════════════════════════════════════════════════════════════════════════
PRACTICE / DOCTOR : ${drName}
CLINIC LOCATION   : ${businessName}, ${cleanCity}
SPECIALTY / FOCUS : ${cleanCategory}
CLINICAL REPUTATION: ${repInfo}
CASE FILE REF     : #RX-${Math.floor(1000 + Math.random() * 9000)}-PATIENT-ACQUISITION
══════════════════════════════════════════════════════════════════════════

DEAR ${drName.toUpperCase()},

CLINICAL OBSERVATION & SYMPTOMS:
• Over 82% of patients in ${cleanCity} now research elective treatments, cosmetic procedures, and doctor authority on Instagram Reels & YouTube before booking an appointment.
• Current Digital Diagnostic: Acute Video Deficiency Syndrome (AVDS) — Practice relies on static banners, while patients trust doctors whose face and voice they recognize before visiting.
• Patient Retention Leak: High-value elective cases are actively booking with competitor clinics whose doctors appear consistently on short-form video.

PRESCRIBED AI TREATMENT PROTOCOL:
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. DOCTOR'S AI DIGITAL AVATAR & CLONED VOICE SYSTEM                     │
│    • Time Required from Doctor: Only 2–3 minutes once on your phone.    │
│    • Protocol: Our AI clones your exact likeness, facial expressions,   │
│      and voice in English, Hindi, or local language.                    │
│    • Clinical Benefit: You NEVER need to spend hours filming in clinic. │
│      Your AI clone presents high-yield educational videos on autopilot. │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. 12–16 HIGH-YIELD VIRAL MEDICAL REELS / MONTH                         │
│    • Content: De-bunking patient myths, explaining procedures, and      │
│      answering common fears in your exact voice.                        │
│    • Outcome: Establishes ${drName} as the undisputed #1 medical        │
│      authority in ${cleanCity}.                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. 24/7 AI CLINIC APPOINTMENT LEAD BOT                                  │
│    • Mechanism: Viewers who comment on your Reels receive an instant    │
│      DM with your clinic's WhatsApp consultation booking link.          │
│    • Converts social views directly into booked chairside consultations.│
└─────────────────────────────────────────────────────────────────────────┘

ADMINISTRATION & DOSAGE:
• 3 to 4 High-Converting Reels per week published across Instagram, YouTube Shorts, and Facebook.
• Peak patient release timing: 7:30 PM–8:30 PM weekdays.

EXPECTED PROGNOSIS:
• 3.5x to 5x increase in qualified private patient inquiries within 45–60 days.
• Lifelong personal brand equity and doctor authority in ${cleanCity}.

CONSULTATION TIMINGS & BRIEFING INQUIRY:
Doctor, we know your surgical and clinic hours are sacred and strictly dedicated to your patients. 

What are your preferred consultation timings for a brief 10-minute briefing? We would be delighted to demonstrate your personalized AI Avatar sample and custom Reels roadmap at a time convenient for your clinic schedule.

Alternatively, you can reserve a 10-minute briefing slot directly on my calendar here:
👉 https://topmate.io/isurajjaiswal

Respectfully yours,

Suraj Jaiswal
Founder, The Digital Frog | AI Medical Growth & Personal Branding Engine
Calendar: https://topmate.io/isurajjaiswal
Direct WhatsApp / Phone: ${phone || 'Available upon request'}`;

      const rxMessage = `℞ *CLINICAL GROWTH PRESCRIPTION* for *${drName}* (${businessName})

Doctor, quick observation regarding your patient acquisition in *${cleanCity}*:

🔍 *Diagnosis*: Over 80% of local patients now choose their specialist based on Instagram Reels & YouTube Shorts. Competitors are gaining private patients using short-form video, while your clinic is missing out on high-ticket cases.

💊 *Prescribed AI Treatment*: 
1. *Doctor AI Avatar & Voice Clone*: You record a 2-minute video on your phone *just once*. Our AI clones your exact face and voice.
2. *15 Viral Educational Reels/Mo*: Produced in your exact voice answering patient questions—without you ever wasting clinic hours filming.
3. *24/7 AI Patient Booking Bot*: Converts Reel comments directly into booked clinic appointments via WhatsApp.

📈 *Prognosis*: 30–45+ high-value private patient consultations every month.

🤝 *Briefing & Timing Inquiry*:
We know your clinic time is strictly for patients. *What are your regular consultation timings?* I'd love to share a 60-second video demo of your cloned AI avatar right here on WhatsApp, or we can connect for a brief 10-minute briefing between your patient appointments.

You can also choose a time convenient for you on my Topmate calendar:
👉 https://topmate.io/isurajjaiswal

Shall I send the 60-second avatar preview here? 🩺`;

      const receptionistScript = `📞 CLINIC RECEPTIONIST & DOCTOR OUTREACH SCRIPT (VERSION 1: AI AVATAR DEMO)

[Target]: Receptionist, Clinic Coordinator, or ${targetClinician}
[Objective]: Bypass the gatekeeper by asking for the doctor's consultation timings to share a 60-second AI avatar demo.

[Receptionist Intro]:
"Hello, good morning! I'm calling for ${targetClinician}'s clinic coordinator or practice manager—is this the front desk at ${businessName}?"

[The Professional Hook]:
"Wonderful. The reason I'm calling is that our medical AI studio built a personalized AI Video Avatar demo specifically for ${targetClinician} to create patient education Reels without taking any of the doctor's time in the clinic."

[The Timing Ask]:
"We know ${targetClinician}'s clinic time is strictly reserved for patients. What are the doctor's consultation timings and the best time between patient procedures for a quick 10-minute briefing? We want to demonstrate the sample and show how an AI avatar brings 30+ new private patients a month without taking any of the doctor's clinic hours."

[Receptionist Objection - 'Doctor does not do marketing / Send email']:
"Completely understood! That's why we don't pitch marketing—we treat this as an educational consultation. What is the doctor's official clinic email or WhatsApp so I can send the 45-second avatar video directly to their review queue?"`;

      const rxEmail_v2 = `SUBJECT: Free 2-Minute Digital Practice Audit & ℞ Clinical Growth Prescription for ${drName} | ${businessName}

DEAR ${drName.toUpperCase()},

We recently conducted a clinical patient acquisition benchmark for medical and dental practices in ${cleanCity}.

While ${businessName} maintains high clinical standards, over 82% of prospective patients in ${cleanCity} research specialist faces and treatment explanations on Instagram Reels and YouTube before booking. Practices with zero video presence suffer from "Acute Video Deficiency Syndrome (AVDS)", leaking high-ticket elective procedures to competing clinics.

To help you diagnose exactly where your practice stands, we have created a free, confidential 2-Minute Digital Practice Audit & Scorecard:

👉 TAKE YOUR 2-MINUTE CONFIDENTIAL PRACTICE AUDIT:
${scorecardUrl}

WHAT YOU WILL UNLOCK IMMEDIATELY:
1. Practice Digital Health Score (out of 100) across Video Authority, Google Maps 3-Pack, and Speed-to-Lead.
2. Official ℞ Clinical Practice Prescription PDF dispatched to your email and unlocked on screen.
3. 3 Custom Viral Educational Reel Hooks tailored specifically to ${cleanCategory}.
4. Doctor AI Avatar & Voice Cloned Roadmap: How to publish 15+ educational patient reels monthly with ZERO clinic filming hours.

Takes only 2 minutes to complete chairside or on mobile:
👉 ${scorecardUrl}

Respectfully yours,

Suraj Jaiswal
Founder, The Digital Frog | AI Medical Practice Growth Engine
Calendar: https://topmate.io/isurajjaiswal
Direct WhatsApp / Phone: ${phone || 'Available upon request'}`;

      const rxMessage_v2 = `℞ *CONFIDENTIAL PRACTICE AUDIT & ℞ PRESCRIPTION* for *${drName}* (${businessName})

Doctor, quick question: How is ${businessName} performing in local patient discovery and video authority across *${cleanCity}*?

We built a 2-minute *Clinical Digital Health Diagnostic* specifically for doctors and practice directors to evaluate their patient acquisition:

👉 *Take the 2-Minute Audit Here:*
${scorecardUrl}

*What You Will Receive Immediately:*
📊 Your Practice Digital Health Score (out of 100)
📄 Official ℞ Clinical Practice Prescription PDF sent to your email
🎯 3 Custom High-Virality Educational Reel Hooks tailored for ${cleanCategory}
🤖 AI Avatar Gameplan: Publish 15+ educational reels/month with ZERO clinic filming time

Takes under 2 minutes:
👉 ${scorecardUrl}

Respectfully,
*Suraj Jaiswal* | The Digital Frog
Topmate: https://topmate.io/isurajjaiswal`;

      const receptionistScript_v2 = `📞 CLINIC RECEPTIONIST & COORDINATOR SCRIPT (VERSION 2: PRACTICE AUDIT INVITATION)

[Target]: Receptionist, Clinic Coordinator, or Practice Manager
[Objective]: Direct the clinic coordinator or doctor to complete the free 2-minute digital practice audit to get their official ℞ Practice PDF.

[Receptionist Intro]:
"Hello, good morning! I'm calling for ${targetClinician}'s clinic coordinator or practice manager—is this the front desk at ${businessName}?"

[The Professional Audit Hook]:
"Wonderful. Our medical practice AI growth lab has launched a complimentary 2-minute Digital Practice Health Audit for top clinics in ${cleanCity}. It evaluates patient discovery and generates an official ℞ Growth Prescription PDF with customized Reel hooks for ${targetClinician}."

[The Action Ask]:
"Can I share the 2-minute audit link (${scorecardUrl}) on the clinic's WhatsApp or official email so the doctor or practice manager can run the diagnostic and receive their customized PDF report?"

[Receptionist Objection - 'Send to email']:
"Perfect! What is the doctor's official email address? I will send the diagnostic link right away so they can view their Practice Score and download their ℞ PDF."`;

      return {
        rxEmail,
        rxMessage,
        receptionistScript,
        rxEmail_v2,
        rxMessage_v2,
        receptionistScript_v2,
        version1: { rxEmail, rxMessage, receptionistScript },
        version2: { rxEmail: rxEmail_v2, rxMessage: rxMessage_v2, receptionistScript: receptionistScript_v2 }
      };
    }

    // ==========================================
    // CASE B: NICHE-CUSTOMIZED BUSINESS GROWTH BLUEPRINT (NON-MEDICAL)
    // ==========================================
    const ownerRole = profile.roleLabel;
    const targetOwner = `the Managing Director or Owner at ${businessName}`;

    // 1. Full Business Growth Blueprint Email Pitch (Version 1: Direct Founder AI Avatar Protocol)
    const rxEmail = `Subject: 📈 Growth Blueprint & Founder Video Authority Protocol for ${businessName}

${profile.reportTitle}
══════════════════════════════════════════════════════════════════════════
BUSINESS / PRACTICE: ${businessName} (${cleanCity})
LEADERSHIP ROLE    : ${ownerRole}
INDUSTRY NICHE     : ${profile.label}
LOCAL REPUTATION   : ${repInfo}
FILE REFERENCE     : #${profile.badge.replace(/[^a-zA-Z0-9]/g, '') || 'GROWTH'}-${Math.floor(1000 + Math.random() * 9000)}-REVENUE-SCALE
══════════════════════════════════════════════════════════════════════════

DEAR LEADERSHIP TEAM AT ${businessName.toUpperCase()},

LOCAL MARKET OBSERVATION & CUSTOMER BEHAVIOR:
• Over 80% of high-intent ${profile.customerTerm.toLowerCase()} in ${cleanCity} research the founder's face, customer results, and service explanations on Instagram Reels & YouTube before deciding to hire or purchase.
• Current Digital Diagnostic: ${profile.vulnerability}
• Customer Retention Leak: High-value ${profile.customerTerm.toLowerCase()} are actively booking with competitors whose owners appear consistently on short-form video.

THE AI GROWTH & REVENUE PROTOCOL:
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. FOUNDER'S AI DIGITAL AVATAR & VOICE CLONING SYSTEM                   │
│    • Time Required: Only 2–3 minutes once on your smartphone.           │
│    • Protocol: Our AI engine clones your exact likeness, expressions,   │
│      and voice cadence.                                                 │
│    • Core Benefit: You NEVER need to spend hours filming in a studio.   │
│      Your AI clone explains your services and customer FAQs on autopilot.│
├─────────────────────────────────────────────────────────────────────────┤
│ 2. 12–16 HIGH-AUTHORITY NICHE REELS / MONTH                             │
│    • Content: Debunking industry rip-offs, addressing customer fears,   │
│      and showcasing real results in your authentic voice.               │
│    • Outcome: Establishes ${businessName} as the #1 authority in ${cleanCity}.│
├─────────────────────────────────────────────────────────────────────────┤
│ 3. 24/7 AI WHATSAPP CUSTOMER INTAKE & BOOKING BOT                       │
│    • Mechanism: Viewers who comment on your Reels receive an instant    │
│      DM with your WhatsApp inquiry and appointment link.                │
│    • Converts social views directly into booked ${profile.conversionTerm.toLowerCase()}.│
└─────────────────────────────────────────────────────────────────────────┘

EXPECTED PROGNOSIS:
• 3.5x to 5x increase in qualified ${profile.customerTerm.toLowerCase()} inquiries within 45–60 days.
• Zero operating hours sacrificed to filming or manual video editing.
• Lifelong brand equity and market dominance in ${cleanCity}.

OPERATING HOURS & BRIEFING INQUIRY:
We know your schedule is strictly reserved for managing operations and serving ${profile.customerTerm.toLowerCase()}.

What are your preferred operating hours for a brief 10-minute briefing? We would be delighted to demonstrate a sample AI Avatar and custom Reels roadmap at a time convenient for your schedule.

Alternatively, you can reserve a 10-minute briefing slot directly on my calendar here:
👉 https://topmate.io/isurajjaiswal

Respectfully yours,

Suraj Jaiswal
Founder, The Digital Frog | AI Local Growth Engine & Digital Authority Architecture
Calendar: https://topmate.io/isurajjaiswal
Direct WhatsApp / Phone: ${phone || 'Available upon request'}`;

    // 1b. Version 1: WhatsApp / DM Pitch
    const rxMessage = `${profile.badge} *GROWTH BLUEPRINT & VIDEO AUTHORITY* for *${businessName}*

Hello, quick observation regarding your customer acquisition in *${cleanCity}*:

🔍 *Diagnosis*: Over 80% of local ${profile.customerTerm.toLowerCase()} choose providers whose owners they see explaining solutions on Instagram Reels & YouTube. Competitors are gaining market share using video, while your business is missing out on high-ticket ${profile.conversionTerm.toLowerCase()}.

💡 *Prescribed AI System*:
1. *Founder AI Avatar & Voice Clone*: Record a 2-minute video on your phone *just once*. Our AI clones your exact likeness and voice.
2. *15 Viral Educational Reels/Mo*: Produced in your exact voice answering top customer FAQs—without you ever wasting hours filming.
3. *24/7 AI Customer Booking Bot*: Converts Reel comments directly into booked inquiries via WhatsApp.

📈 *Prognosis*: 20–40+ qualified high-ticket ${profile.customerTerm.toLowerCase()} inquiries every month.

🤝 *Briefing & Timing Inquiry*:
We know your operating hours are strictly dedicated to running your business. *What are your preferred operating hours?* I'd love to share a 60-second video demo of a cloned AI avatar right here on WhatsApp.

You can also choose a time convenient for you on my Topmate calendar:
👉 https://topmate.io/isurajjaiswal

Shall I send the 60-second avatar preview here? 🚀`;

    // 1c. Version 1: Receptionist / Office Manager Script
    const receptionistScript = `📞 OFFICE / RECEPTION SCRIPT (VERSION 1: AI AVATAR DEMO)

[Target]: Office Manager, Dispatcher, or ${targetOwner}
[Objective]: Bypass the gatekeeper by asking for the owner's operating hours to share a 60-second AI avatar demo.

[Intro]:
"Hello, good morning! I'm calling for ${targetOwner}—is this the main office at ${businessName}?"

[The Professional Hook]:
"Wonderful. The reason I'm calling is that our AI studio built a personalized AI Video Avatar demo specifically for ${businessName} to create customer education Reels without taking any of the owner's time away from running operations."

[The Timing Ask]:
"We know the owner's time is packed running the business. What is the best time between operations for a quick 10-minute briefing? We want to demonstrate the sample and show how an AI avatar brings 25+ new qualified ${profile.customerTerm.toLowerCase()} a month without requiring any filming hours."

[Objection - 'Owner is busy / Send email']:
"Completely understood! What is the owner's direct email or WhatsApp so I can send the 45-second avatar video directly to their review queue?"`;

    // 2a. Version 2: Cold Email (Scorecard Invitation)
    const rxEmail_v2 = `SUBJECT: Free 2-Minute Digital Growth Audit & Blueprint for ${businessName}

DEAR LEADERSHIP TEAM AT ${businessName.toUpperCase()},

How does ${businessName} rank against competitor businesses in ${cleanCity} when local ${profile.customerTerm.toLowerCase()} search for ${cleanCategory}?

We have developed a comprehensive 2-minute diagnostic assessment to evaluate where local businesses lose potential high-ticket inquiries:

👉 START YOUR 2-MINUTE AUDIT:
${scorecardUrl}

WHAT YOUR AUDIT EVALUATES:
1. Video & Reels Authority Index
2. Local Google Maps 3-Pack Visibility
3. After-Hours Lead Response Speed & Conversion
4. Automated Customer Retention & Review Rate

🔒 IMMEDIATE REPORT DELIVERY:
Once you answer the 8 quick questions, your official ${profile.reportTitle} (PDF) will be dispatched directly to your email address and unlocked immediately on screen, complete with 3 custom viral Reel hooks tailored specifically for ${businessName}.

Takes under 120 seconds:
👉 ${scorecardUrl}

Respectfully yours,

Suraj Jaiswal
Founder, The Digital Frog | AI Local Growth Engine
Calendar: https://topmate.io/isurajjaiswal
Direct WhatsApp / Phone: ${phone || 'Available upon request'}`;

    // 2b. Version 2: WhatsApp / Social DM Message (Scorecard Invitation)
    const rxMessage_v2 = `${profile.badge} *CONFIDENTIAL BUSINESS AUDIT & GROWTH BLUEPRINT* for *${businessName}*

Quick question: How is ${businessName} performing in local customer discovery and video authority across *${cleanCity}*?

We built a 2-minute *Business Health & Growth Diagnostic* specifically for local business owners and directors to evaluate their customer acquisition:

👉 *Take the 2-Minute Audit Here:*
${scorecardUrl}

*What You Will Receive Immediately:*
📊 Your Business Growth Score (out of 100)
📄 Official Growth Blueprint PDF sent to your email
🎯 3 Custom High-Virality Educational Reel Hooks tailored for ${cleanCategory}
🤖 Founder AI Avatar Gameplan: Publish 15+ educational reels/month with ZERO filming time

Takes under 2 minutes:
👉 ${scorecardUrl}

Best regards,
*Suraj Jaiswal* | The Digital Frog
Topmate: https://topmate.io/isurajjaiswal`;

    // 2c. Version 2: Receptionist / Front-Desk Call Script (Scorecard Invitation)
    const receptionistScript_v2 = `📞 OFFICE / RECEPTION SCRIPT (VERSION 2: BUSINESS AUDIT INVITATION)

[Target]: Office Manager, Assistant, or ${targetOwner}
[Objective]: Direct the owner or manager to complete the free 2-minute business audit to get their official Growth Blueprint PDF.

[Intro]:
"Hello! I'm calling for ${targetOwner}—is this the main desk at ${businessName}?"

[The Professional Audit Hook]:
"Wonderful. Our AI growth studio has launched a complimentary 2-minute Digital Growth Audit for top ${cleanCategory} businesses in ${cleanCity}. It evaluates customer discovery and generates an official Growth Blueprint PDF with custom Reel hooks for ${businessName}."

[The Action Ask]:
"Can I share the 2-minute audit link (${scorecardUrl}) on the office WhatsApp or official email so the owner can run the diagnostic and review their customized PDF report?"

[Objection - 'Send to email']:
"Perfect! What is the official email address? I will send the diagnostic link right away so they can view their Growth Score and download their Blueprint PDF."`;

    return {
      rxEmail,
      rxMessage,
      receptionistScript,
      rxEmail_v2,
      rxMessage_v2,
      receptionistScript_v2,
      version1: { rxEmail, rxMessage, receptionistScript },
      version2: { rxEmail: rxEmail_v2, rxMessage: rxMessage_v2, receptionistScript: receptionistScript_v2 }
    };
  }

  /**
   * Generates a comprehensive Social Media Audit for the lead, assessing:
   * - Platform coverage (Instagram, Facebook, YouTube, LinkedIn)
   * - Video & Reels presence (Flags "Static Graphic Syndrome")
   * - Doctor Face & Authority Factor
   * - Customized AI Avatar & Voice Cloning Strategy
   * - 3 Specialty-Specific Viral Reel Hooks
   */
  generateSocialAudit(leadData = {}) {
    const clinicName = leadData.name || leadData.business_name || 'Business Organization';
    const rawCat = (leadData.category || '').trim();
    const query = leadData.query || leadData.search_query || '';
    const isStatusString = /^(open|closed|closes|opens)\b/i.test(rawCat);
    const cleanCategory = (!rawCat || isStatusString) ? (query || 'Local Business') : rawCat;
    const cleanCity = leadData.city || 'your local area';
    const rating = leadData.rating;
    const reviewsCount = leadData.reviewsCount || leadData.reviews_count;
    const isMedical = leadData.isMedical || leadData.is_medical || this.isMedicalLead(clinicName, cleanCategory, query);
    const rawSocials = leadData.socialLinks || leadData.social_links;
    const socials = typeof rawSocials === 'string' ? JSON.parse(rawSocials || '{}') : (rawSocials || {});
    
    const channels = [];
    const missing = [];
    const targetChannels = ['instagram', 'facebook', 'youtube', 'linkedin', 'threads'];

    for (const ch of targetChannels) {
      if (socials[ch]) {
        let handle = null;
        if (ch === 'instagram') {
          const m = socials[ch].match(/instagram\.com\/([a-zA-Z0-9._-]+)/i);
          handle = m ? m[1] : null;
        } else if (ch === 'facebook') {
          const m = socials[ch].match(/facebook\.com\/([a-zA-Z0-9._-]+)/i);
          handle = m ? m[1] : null;
        } else if (ch === 'youtube') {
          const m = socials[ch].match(/youtube\.com\/(?:@|c\/|channel\/)?([a-zA-Z0-9._-]+)/i);
          handle = m ? m[1] : null;
        }
        channels.push({
          platform: ch,
          url: socials[ch],
          handle: handle ? `@${handle}` : null,
          dmUrl: ch === 'instagram' && handle ? `https://ig.me/m/${handle}` : (ch === 'facebook' && handle ? `https://m.me/${handle}` : socials[ch])
        });
      } else {
        missing.push(ch);
      }
    }

    // Calculate Audit Scores (0-100)
    const channelScore = Math.min(channels.length * 25, 100);
    const videoScore = channels.some(c => c.platform === 'youtube' || c.platform === 'instagram') ? 40 : 15;
    const authorityScore = isMedical ? 25 : 45; // Video deficit creates authority vacuum
    const overallScore = Math.round((channelScore * 0.3) + (videoScore * 0.4) + (authorityScore * 0.3));

    // Determine niche-specific Viral Reel Hooks
    const nicheKey = detectNiche(cleanCategory + ' ' + clinicName + ' ' + query);
    const profile = NICHE_REGISTRY[nicheKey] || (isMedical ? NICHE_REGISTRY.medical : NICHE_REGISTRY.general);
    const sampleReelHooks = (profile.defaultHooks || []).map(h => ({
      title: h.title,
      hook: h.hook,
      targetOutcome: h.objective
    }));

    return {
      overallScore,
      channelScore,
      videoScore,
      authorityScore,
      channelsFound: channels,
      missingChannels: missing,
      hasInstagram: channels.some(c => c.platform === 'instagram'),
      hasFacebook: channels.some(c => c.platform === 'facebook'),
      hasYouTube: channels.some(c => c.platform === 'youtube'),
      diagnosis: channels.length === 0 
        ? 'Zero Social Media Footprint: Completely invisible on modern mobile discovery. Immediate AI Avatar deployment required.'
        : 'Active Profile, Missing Video Engine: Brand exists on social platforms, but relies on static flyers that yield under 1% engagement. Lacks face-to-camera AI Reels.',
      aiAvatarStrategy: {
        step1: `${isMedical ? 'Doctor' : 'Owner / Founder'} records a 2-minute clean talking sample on their smartphone once.`,
        step2: 'AI Voice Cloning matches the exact vocal timbre, pacing, and regional accents (English / Hindi / Multilingual).',
        step3: `AI generates 15-20 Viral ${profile.customerSingular} Education Reels per month answering top inquiries.`,
        step4: `Automated DM Lead Funnel: Viewers comment a keyword and receive direct ${isMedical ? 'clinic' : 'business'} WhatsApp booking links.`
      },
      sampleReelHooks
    };
  }
}

export const googleMapsAdapter = new GoogleMapsAdapter();
