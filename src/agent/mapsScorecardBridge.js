import { ScorecardEngine, detectNiche, NICHE_REGISTRY } from './scorecardEngine.js';
import { ScorecardLeadModel, GoogleMapsLeadModel, db } from '../db/database.js';

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://crm.thedigitalfrog.com';
const TOPMATE_URL = process.env.TOPMATE_URL || 'https://topmate.io/isurajjaiswal';
const FOUNDER_NAME = process.env.FOUNDER_NAME || 'Suraj Jaiswal';
const AGENCY_NAME = process.env.AGENCY_NAME || 'The Digital Frog';

export class MapsScorecardBridge {
  /**
   * Generates or retrieves a Scorecard assessment for a Google Maps lead.
   * Produces a clean public scorecard link and polished, human-written cold email & social pitches.
   */
  static generateScorecardForMapsLead(lead) {
    if (!lead || !lead.business_name) return null;

    const rawCategory = lead.category || '';
    const nicheKey = detectNiche(`${rawCategory} ${lead.business_name}`);
    const niche = NICHE_REGISTRY[nicheKey] || NICHE_REGISTRY.general;
    const isMedical = nicheKey === 'medical';

    // Parse social links to assess video & social authority
    let socials = {};
    try {
      socials = lead.social_links ? (typeof lead.social_links === 'string' ? JSON.parse(lead.social_links) : lead.social_links) : {};
    } catch (_) {}

    const hasInstagram = !!socials.instagram;
    const hasYouTube = !!socials.youtube;
    const hasFacebook = !!socials.facebook;
    const hasWebsite = !!lead.has_website;
    const rating = parseFloat(lead.rating) || 0;
    const reviewsCount = parseInt(lead.reviews_count, 10) || 0;

    // Determine Doctor / Contact Person name
    let contactPerson = lead.contact_person || '';
    if (!contactPerson) {
      if (isMedical) {
        contactPerson = `Clinic Director at ${lead.business_name}`;
      } else {
        contactPerson = `${lead.business_name} Team`;
      }
    }

    // 1. Calculate Diagnostic Pillar Scores
    // Video Score (0-100): If no IG/YT, score is severely low (20-35)
    let videoScore = 25;
    if (hasInstagram && hasYouTube) videoScore = 48;
    else if (hasInstagram || hasYouTube) videoScore = 38;

    // Discovery Score (0-100): Influenced by Google reviews, rating, and website
    let discoveryScore = 40;
    if (hasWebsite) discoveryScore += 20;
    if (rating >= 4.5) discoveryScore += 20;
    if (reviewsCount > 50) discoveryScore += 15;
    discoveryScore = Math.min(discoveryScore, 95);

    // Conversion Score (0-100): Speed to lead, WhatsApp, instant appointment booking
    let conversionScore = 35;
    if (lead.phone) conversionScore += 15;
    if (lead.whatsapp_url) conversionScore += 20;
    conversionScore = Math.min(conversionScore, 85);

    // Weighted Overall Score
    const overallScore = Math.round((videoScore * 0.45) + (discoveryScore * 0.30) + (conversionScore * 0.25));

    const scores = {
      overallScore,
      videoScore,
      discoveryScore,
      conversionScore,
      grade: overallScore >= 80 ? 'A' : overallScore >= 65 ? 'B' : overallScore >= 45 ? 'C' : 'D',
      statusSummary: overallScore < 50 ? 'Critical Video Growth Deficiency' : 'High Patient Growth Potential'
    };

    // 2. Synthesize Tailored Prescription & Viral Video Hooks
    const rxResult = ScorecardEngine.generatePrescription({
      businessName: lead.business_name,
      contactPerson,
      businessType: lead.category || niche.label,
      city: lead.city || 'your area',
      scores,
      topmateUrl: TOPMATE_URL,
      agencyName: AGENCY_NAME,
      founderName: FOUNDER_NAME
    });

    // 3. Save / Update in scorecard_leads table
    let scorecardId = null;
    try {
      scorecardId = ScorecardLeadModel.create({
        business_name: lead.business_name,
        contact_person: contactPerson,
        phone: lead.phone || null,
        email: lead.email || null,
        business_type: lead.category || niche.label,
        city: lead.city || null,
        overall_score: scores.overallScore,
        video_score: scores.videoScore,
        discovery_score: scores.discoveryScore,
        conversion_score: scores.conversionScore,
        answers: {
          niche: nicheKey,
          rating,
          reviews_count: reviewsCount,
          has_website: hasWebsite,
          has_socials: hasInstagram || hasFacebook || hasYouTube,
          maps_url: lead.maps_url
        },
        prescription_text: rxResult.reportText,
        prescription_data: rxResult,
        status: 'new',
        notes: `Auto-generated from Google Maps Hunter (Rating: ${rating}⭐, ${reviewsCount} reviews)`
      });
    } catch (scErr) {
      console.warn('[MapsScorecardBridge] Scorecard record warning:', scErr.message);
    }

    // 4. Construct Public Scorecard URL
    const publicScorecardUrl = scorecardId 
      ? `${PUBLIC_URL}/scorecard?report=${scorecardId}`
      : `${PUBLIC_URL}/scorecard?business=${encodeURIComponent(lead.business_name)}&city=${encodeURIComponent(lead.city || '')}`;

    // 5. Generate CLEAN, High-Converting Cold Email Pitch (NO raw JSON, NO ASCII clutter!)
    const cleanSubject = isMedical
      ? `Quick question regarding ${lead.business_name} (${lead.city || 'patient acquisition'})`
      : `Digital audit & video inquiry for ${lead.business_name}`;

    const salutation = isMedical
      ? (contactPerson.toLowerCase().startsWith('dr') ? contactPerson : `Dr. / Clinic Director at ${lead.business_name}`)
      : `${lead.business_name} Team`;

    const cleanEmailPitch = `Hi ${salutation},

I came across ${lead.business_name} on Google Maps while reviewing local healthcare practices in ${lead.city || 'your area'}. With ${rating > 0 ? `${rating}⭐ across ${reviewsCount} reviews` : 'your stellar local presence'}, your reputation is impressive.

I put together a private, 2-minute Digital Growth Audit & AI Video Roadmap specifically for ${lead.business_name}:

👉 View Your Custom Practice Scorecard & Video Audit:
${publicScorecardUrl}

It breaks down 3 key opportunities (including how competing clinics in ${lead.city || 'your area'} are winning high-ticket private cases through short-form educational video) along with 3 viral video concepts tailored for your practice.

Would you be open to a brief 5-minute chat this week on how we can implement this for you on autopilot?

Feel free to pick a convenient briefing time here:
${TOPMATE_URL}

Best regards,

${FOUNDER_NAME}
Founder, ${AGENCY_NAME} | Medical AI & Patient Growth Engine
WhatsApp: +1 (512) 717-3147 | hello@surajjaiswal.com`;

    // 6. Clean WhatsApp Direct Message
    const cleanWhatsappPitch = `Hello ${salutation}! I reviewed ${lead.business_name} on Google Maps in ${lead.city || 'your area'} (${rating}⭐). We prepared a complimentary 2-min Digital Patient Acquisition & Video Audit for your clinic: ${publicScorecardUrl} — Would love to share a 3-min AI Avatar demo if you are open to it!`;

    // 7. Clean Social DM Pitch
    const cleanDMPitch = `Hey ${lead.business_name} team! Saw your profile here in ${lead.city || 'your area'}. We put together a confidential 2-minute Digital Health & Short-Form Video Audit for your practice: ${publicScorecardUrl} — Happy to share a quick preview of your doctor's AI avatar if you'd like to check it out!`;

    return {
      scorecardId,
      publicScorecardUrl,
      overallScore: scores.overallScore,
      scores,
      cleanSubject,
      cleanEmailPitch,
      cleanWhatsappPitch,
      cleanDMPitch,
      rxResult
    };
  }

  /**
   * Backfills and creates clean scorecards for ALL Google Maps leads in the database.
   */
  static syncAllMapsLeadsScorecards() {
    console.log('[MapsScorecardBridge] Syncing scorecards for all Google Maps leads...');
    const leads = db.prepare('SELECT * FROM google_maps_leads').all();
    let updatedCount = 0;

    const updateStmt = db.prepare(`
      UPDATE google_maps_leads SET
        ai_email_pitch = @ai_email_pitch,
        ai_whatsapp_pitch = @ai_whatsapp_pitch,
        doctor_prescription = @doctor_prescription,
        opportunity_summary = @opportunity_summary,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);

    for (const lead of leads) {
      try {
        const result = this.generateScorecardForMapsLead(lead);
        if (!result) continue;

        updateStmt.run({
          id: lead.id,
          ai_email_pitch: result.cleanEmailPitch,
          ai_whatsapp_pitch: result.cleanWhatsappPitch,
          doctor_prescription: result.cleanEmailPitch, // Store the clean email pitch instead of raw JSON!
          opportunity_summary: `Scorecard #${result.scorecardId || 'ready'}: Overall ${result.overallScore}/100. Video: ${result.scores.videoScore}/100. Audit URL: ${result.publicScorecardUrl}`
        });
        updatedCount++;
      } catch (err) {
        console.warn(`[MapsScorecardBridge] Error updating lead #${lead.id}:`, err.message);
      }
    }

    console.log(`[MapsScorecardBridge] ✅ Successfully generated scorecards & clean emails for ${updatedCount} Google Maps leads.`);
    return { total: leads.length, updated: updatedCount };
  }
}
