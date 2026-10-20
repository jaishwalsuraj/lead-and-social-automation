import { ScorecardEngine, detectNiche, NICHE_REGISTRY } from './scorecardEngine.js';
import { ScorecardLeadModel, GoogleMapsLeadModel, db } from '../db/database.js';
import { ScorecardPdfGenerator } from './pdfGenerator.js';

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
        prescription_text: rxResult.prescriptionText,
        prescription_data: rxResult,
        status: 'new',
        notes: `Auto-generated from Google Maps Hunter (Rating: ${rating}⭐, ${reviewsCount} reviews)`
      });

      // Asynchronously ensure PDF exists
      if (scorecardId) {
        ScorecardPdfGenerator.generatePrescriptionPdf({
          leadId: scorecardId,
          businessName: lead.business_name,
          contactPerson,
          businessType: lead.category || niche.label,
          city: lead.city || 'your area',
          scores,
          prescriptionText: rxResult.prescriptionText,
          prescriptionData: rxResult,
          topmateUrl: TOPMATE_URL,
          agencyName: AGENCY_NAME,
          founderName: FOUNDER_NAME,
          email: lead.email
        }).then(pdfRes => {
          if (pdfRes && pdfRes.filePath) {
            ScorecardLeadModel.updatePdf(scorecardId, pdfRes.filePath, pdfRes.publicUrl);
          }
        }).catch(err => {
          console.warn('[MapsScorecardBridge] Async PDF generation note:', err.message);
        });
      }
    } catch (scErr) {
      console.warn('[MapsScorecardBridge] Scorecard record warning:', scErr.message);
    }

    // 4. Construct Public Scorecard URL
    const publicScorecardUrl = scorecardId 
      ? `${PUBLIC_URL}/scorecard?report=${scorecardId}`
      : `${PUBLIC_URL}/scorecard?business=${encodeURIComponent(lead.business_name)}&city=${encodeURIComponent(lead.city || '')}`;

    // 5. Generate CLEAN, High-Converting Cold Email Pitch (NO raw JSON, NO ASCII clutter!)
    const cleanSubject = isMedical
      ? `Quick question regarding ${lead.business_name} (${lead.city || 'patient video authority'})`
      : `Digital audit & video inquiry for ${lead.business_name}`;

    let cleanName = (contactPerson || '').replace(/^(?:dr\.?\s*|doctor\s*)+/i, '').trim();
    const isGeneric = !cleanName || /^clinic director/i.test(cleanName) || /team$/i.test(cleanName) || cleanName.toLowerCase() === 'director';
    const salutation = isMedical 
      ? (isGeneric ? `Doctor & Practice Principal` : `Dr. ${cleanName}`) 
      : (isGeneric ? `${lead.business_name} Team` : cleanName);

    const cleanEmailPitch = `Hello ${salutation},

Quick question: why is a ${lead.category || 'practice'} with ${rating > 0 ? `${rating}⭐ across ${reviewsCount} reviews` : 'your stellar reputation'} in ${lead.city || 'your area'} completely absent from local patient video feeds?

While researching local specialists in ${lead.city || 'your area'}, I noticed a significant discrepancy between your offline clinical reputation and your video presence. Competing practices are actively winning high-ticket private consultations simply because their doctors appear regularly on Instagram Reels and YouTube.

We put together a private, confidential Rx Growth Prescription specifically for ${lead.business_name}:

👉 View Your Official Practice Scorecard & Video Audit:
${publicScorecardUrl}

It diagnoses 3 critical patient leakage points and maps out 3 viral educational Reel hooks tailored specifically for your practice.

We also designed an AI Doctor Avatar protocol where we clone your likeness and voice from a single 2-minute phone recording to produce 15 educational Reels a month on autopilot—without taking 1 minute away from your patient hours.

Would you be open to a 30-second preview of what your AI Avatar looks like?

Feel free to pick a convenient 10-minute briefing time on Topmate:
${TOPMATE_URL}

Best regards,

${FOUNDER_NAME}
Founder, ${AGENCY_NAME} | Medical AI & Patient Growth Engine
Calendar: ${TOPMATE_URL}
Email: hello@surajjaiswal.com`;

    // 6. Pattern-Breaking Cold WhatsApp Outreach
    const cleanWhatsappPitch = `Hello ${salutation}, quick question: why is a practice with ${rating > 0 ? `${rating}⭐ (${reviewsCount} reviews)` : 'top clinical ratings'} in ${lead.city || 'your area'} completely absent from local patient video feeds?\n\nWe put together a private, confidential Rx Growth Prescription for ${lead.business_name}: ${publicScorecardUrl}\n\nInside, we diagnosed 3 patient leakage points and scripted 3 viral educational Reel concepts for your clinic. We also have a 40-second sample showing what your AI Doctor Avatar looks and sounds like.\n\nOpen to seeing that 40-second preview right here? — Suraj Jaiswal, Founder @ The Digital Frog`;

    // 7. Clean Social DM Pitch
    const cleanDMPitch = `Hey ${salutation}! Noticed your stellar reputation in ${lead.city || 'your area'}. Competing clinics are winning high-ticket cases simply by having doctors on Reels. We generated a private Rx Video Audit for you: ${publicScorecardUrl} — Happy to share a 30-second sample of your AI Video Clone if you'd like to check it out! — Suraj @ The Digital Frog`;

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
          doctor_prescription: result.rxResult ? result.rxResult.prescriptionText : result.cleanEmailPitch,
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
