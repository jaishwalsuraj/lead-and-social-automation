import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { NICHE_REGISTRY, detectNiche } from './scorecardEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ScorecardPdfGenerator {
  /**
   * Generates a clean URL and filesystem-safe slug for the prescription/blueprint.
   * e.g. "Dr. Vikram Malhotra" -> "rx-prescription-dr-vikram-malhotra.pdf"
   * e.g. "Quick Towing Dispatch" -> "growth-blueprint-towing-quick-towing-dispatch.pdf"
   */
  static getPrescriptionFileName(contactPerson, businessName, leadId, businessType = '') {
    const nicheKey = detectNiche(businessType || businessName);
    const profile = NICHE_REGISTRY[nicheKey] || NICHE_REGISTRY.general;

    let name = (contactPerson || '').trim();
    if (!name || name.toLowerCase() === 'director' || name.toLowerCase() === 'doctor') {
      name = (businessName || '').trim();
    }
    // Remove credentials / degrees / parenthetical notes
    name = name.replace(/\s*\([^)]*\)/g, '');
    name = name.replace(/,\s*(?:bds|mds|mbbs|md|ms|dnb|fdr|phd|mch|fics|esq|jd|cpa).*$/i, '');

    if (nicheKey === 'medical') {
      if (!name.match(/^(?:dr\.?|doctor)\b/i)) {
        name = 'dr ' + name;
      }
    }

    let slug = name
      .toLowerCase()
      .replace(/^doctor\b/i, 'dr')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) {
      slug = leadId ? `client-${leadId}` : 'client';
    }

    return `${profile.filePrefix}-${slug}.pdf`;
  }

  /**
   * Generates a high-resolution, vector-quality A4 PDF tailored to the business niche.
   */
  static async generatePrescriptionPdf(data) {
    const leadId = data.leadId || Date.now();
    const rawType = data.businessType || data.category || data.prescriptionData?.niche || '';
    const nicheKey = detectNiche(rawType || data.businessName);
    const profile = NICHE_REGISTRY[nicheKey] || NICHE_REGISTRY.general;
    const isMed = (nicheKey === 'medical');

    const fileName = data.fileName || ScorecardPdfGenerator.getPrescriptionFileName(data.contactPerson, data.businessName, leadId, rawType);
    const outputDir = path.join(__dirname, '../../public/prescriptions');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.join(outputDir, fileName);
    const publicUrl = `/prescriptions/${fileName}`;

    let cleanPerson = (data.contactPerson || '').trim();
    if (!cleanPerson || cleanPerson.toLowerCase() === 'director' || cleanPerson.toLowerCase() === 'doctor') {
      cleanPerson = profile.roleLabel;
    }
    if (isMed && !cleanPerson.match(/^(?:dr\.?|doctor)\b/i)) {
      cleanPerson = `Dr. ${cleanPerson}`;
    }

    const clinic = data.businessName || 'Business Organization';
    const city = data.city || 'Local Area';
    const specialty = data.businessType || profile.label;
    const overallScore = data.scores?.overallScore || data.scores?.overall || 26;
    const videoScore = data.scores?.videoScore || data.scores?.video || 12;
    const discoveryScore = data.scores?.discoveryScore || data.scores?.discovery || 20;
    const conversionScore = data.scores?.conversionScore || data.scores?.conversion || 50;
    const topmateUrl = data.topmateUrl || 'https://topmate.io/isurajjaiswal';
    const founderName = data.founderName || 'Suraj Jaiswal';
    const agencyName = data.agencyName || 'The Digital Frog';
    const consultationFee = data.consultationFee || 'Standard Service Rate';
    const workTiming = data.workTiming || 'Regular Operating Hours';

    // Status grade styling
    let gradeLabel = 'CRITICAL — ACUTE VIDEO DEFICIENCY';
    let gradeColor = '#ef4444';
    let gradeBg = '#fee2e2';
    if (overallScore >= 65) {
      gradeLabel = 'HEALTHY DIGITAL FOOTPRINT';
      gradeColor = '#10b981';
      gradeBg = '#d1fae5';
    } else if (overallScore >= 40) {
      gradeLabel = 'MODERATE LEAKAGE — NEEDS ATTENTION';
      gradeColor = '#f59e0b';
      gradeBg = '#fef3c7';
    }

    const reelHooks = data.prescriptionData?.reelHooks || data.prescriptionData?.sampleReelHooks || profile.defaultHooks;

    const todayStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const caseBadgeText = `CASE REF: #${profile.badge.replace(/[^a-zA-Z0-9]/g, '') || 'AUDIT'}-2026-${leadId}`;

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${profile.reportTitle} - ${cleanPerson}</title>
  <style>
    @page {
      size: A4;
      margin: 12mm 14mm 14mm 14mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      line-height: 1.42;
      font-size: 11pt;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #0284c7;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .logo-area h1 {
      font-size: 15pt;
      font-weight: 800;
      color: #0369a1;
      letter-spacing: -0.5px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .logo-area .sub {
      font-size: 8.5pt;
      color: #64748b;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
    .meta-box {
      text-align: right;
      font-size: 8.5pt;
      color: #475569;
    }
    .case-badge {
      display: inline-block;
      background: #f1f5f9;
      color: #0369a1;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      margin-bottom: 3px;
      font-size: 8pt;
      border: 1px solid #cbd5e1;
    }

    /* Demographics Strip */
    .demographics {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 9px 12px;
      margin-bottom: 12px;
      font-size: 9pt;
    }
    .demographics strong {
      color: #1e293b;
    }
    .demo-item {
      margin-bottom: 3px;
    }

    /* Vital Signs Strip */
    .vitals-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr 1fr;
      gap: 8px;
      margin-bottom: 14px;
    }
    .vital-card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px;
      text-align: center;
      background: #ffffff;
    }
    .vital-card.primary {
      background: #f0fdf4;
      border-color: #86efac;
    }
    .vital-score {
      font-size: 17pt;
      font-weight: 900;
      color: #0284c7;
      line-height: 1.1;
    }
    .vital-label {
      font-size: 7.5pt;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      margin-top: 2px;
    }
    .grade-pill {
      display: inline-block;
      font-size: 7.5pt;
      font-weight: 800;
      color: ${gradeColor};
      background: ${gradeBg};
      padding: 2px 6px;
      border-radius: 4px;
      margin-top: 4px;
      border: 1px solid ${gradeColor}44;
    }

    /* Prescription Pad Main */
    .rx-box {
      border: 1.5px solid #0284c7;
      border-radius: 8px;
      padding: 12px 14px;
      position: relative;
      background: #fdfdfd;
      margin-bottom: 12px;
    }
    .rx-watermark {
      position: absolute;
      top: 10px;
      right: 18px;
      font-size: 52pt;
      font-weight: 900;
      color: rgba(2, 132, 199, 0.08);
      font-family: Georgia, serif;
      pointer-events: none;
    }
    .rx-sec-title {
      font-size: 9pt;
      font-weight: 800;
      color: #0369a1;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      border-bottom: 1px dashed #cbd5e1;
      padding-bottom: 3px;
    }
    .rx-text {
      font-size: 8.5pt;
      color: #334155;
      margin-bottom: 8px;
      line-height: 1.45;
    }
    .rx-protocol-list {
      margin-left: 14px;
      margin-bottom: 8px;
      font-size: 8.5pt;
      color: #1e293b;
    }
    .rx-protocol-list li {
      margin-bottom: 4px;
    }

    /* Hooks Box */
    .hooks-section {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 9px 12px;
      margin-bottom: 12px;
    }
    .hook-row {
      margin-bottom: 6px;
      padding-left: 8px;
      border-left: 3px solid #0284c7;
      font-size: 8pt;
    }
    .hook-row strong {
      color: #0f172a;
      display: block;
    }
    .hook-row em {
      color: #475569;
    }

    /* Action Footer / Booking */
    .action-footer {
      background: #0f172a;
      color: #ffffff;
      border-radius: 6px;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
    }
    .action-text h4 {
      font-size: 9.5pt;
      color: #38bdf8;
      margin-bottom: 2px;
      font-weight: 800;
    }
    .action-text p {
      font-size: 7.5pt;
      color: #cbd5e1;
    }
    .booking-box {
      text-align: right;
    }
    .booking-link {
      display: inline-block;
      background: #0284c7;
      color: #ffffff;
      text-decoration: none;
      font-weight: 800;
      font-size: 8pt;
      padding: 6px 12px;
      border-radius: 4px;
      letter-spacing: 0.2px;
    }
    .sign-off {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 7.5pt;
      color: #64748b;
    }
    .signature-block {
      text-align: right;
    }
    .signature-name {
      font-weight: 800;
      color: #1e293b;
      font-size: 8.5pt;
    }
  </style>
</head>
<body>

  <!-- Top Header / Letterhead -->
  <div class="header">
    <div class="logo-area">
      <h1>${agencyName}</h1>
      <div class="sub">${agencyName.toUpperCase()} • ${isMed ? 'CLINICAL PRACTICE GROWTH LAB • DOCTOR AI AVATAR PROTOCOL' : 'REVENUE ACCELERATION LAB • FOUNDER AI AVATAR PROTOCOL'}</div>
    </div>
    <div class="meta-box">
      <div class="case-badge">${caseBadgeText}</div>
      <div><strong>Date:</strong> ${todayStr}</div>
      <div><strong>Classification:</strong> Confidential ${profile.label} Audit</div>
    </div>
  </div>

  <!-- Demographics & Practice Profile -->
  <div class="demographics">
    <div>
      <div class="demo-item"><strong>${profile.roleLabel}:</strong> ${cleanPerson}</div>
      <div class="demo-item"><strong>${profile.placeTerm}:</strong> ${clinic} (${city})</div>
      <div class="demo-item"><strong>Industry Niche:</strong> ${specialty}</div>
    </div>
    <div>
      <div class="demo-item"><strong>${profile.feeLabel} Noted:</strong> ${consultationFee}</div>
      <div class="demo-item"><strong>${profile.timingLabel}:</strong> ${workTiming}</div>
      <div class="demo-item"><strong>Audit Version:</strong> v2.5 (Niche-Adaptive AI Engine)</div>
    </div>
  </div>

  <!-- Vitals Strip -->
  <div class="vitals-grid">
    <div class="vital-card primary">
      <div class="vital-score" style="color: ${gradeColor};">${overallScore}<span style="font-size: 11pt; font-weight: 500;">/100</span></div>
      <div class="vital-label">Digital Health Score</div>
      <div class="grade-pill">${gradeLabel}</div>
    </div>
    <div class="vital-card">
      <div class="vital-score">${videoScore}<span style="font-size: 9pt; font-weight: 400;">/100</span></div>
      <div class="vital-label">Video Authority & Reels</div>
    </div>
    <div class="vital-card">
      <div class="vital-score">${discoveryScore}<span style="font-size: 9pt; font-weight: 400;">/100</span></div>
      <div class="vital-label">Google Maps 3-Pack</div>
    </div>
    <div class="vital-card">
      <div class="vital-score">${conversionScore}<span style="font-size: 9pt; font-weight: 400;">/100</span></div>
      <div class="vital-label">Speed-to-Lead Response</div>
    </div>
  </div>

  <!-- Prescription Pad Main -->
  <div class="rx-box">
    <div class="rx-watermark">${profile.badge}</div>
    
    <div class="rx-sec-title">1. Diagnostic Finding & ${isMed ? 'Clinical Practice' : 'Revenue'} Vulnerability</div>
    <div class="rx-text">
      <strong>Primary Finding:</strong> ${data.prescriptionData?.diagnosticSymptom || profile.vulnerability}
    </div>

    <div class="rx-sec-title">2. Prescribed AI Avatar & Video Authority Protocol</div>
    <ol class="rx-protocol-list">
      <li><strong>Phase I — Single 10-Minute Capture:</strong> ${isMed ? 'Doctor' : 'Owner / Founder'} records a single 2-minute video on an iPhone. Our AI engine clones the exact likeness, facial expressions, and vocal cadence. Zero studio filming required.</li>
      <li><strong>Phase II — Autonomous 15 Educational Reels/Month:</strong> AI synthesizes 15 high-authority ${profile.customerSingular} education Reels answering common procedural and pricing questions in your authentic voice, preserving 100% of your operating hours.</li>
      <li><strong>Phase III — 24/7 WhatsApp AI ${isMed ? 'Patient Intake' : 'Lead Conversion'} Bot:</strong> Automatically responds to comments and mobile inquiries within 60 seconds, scheduling private ${profile.conversionTerm.toLowerCase()} on calendar.</li>
    </ol>

    <div class="rx-sec-title">3. Expected 60-Day Outcome & ROI Forecast</div>
    <div class="rx-text">
      Resolution of ${profile.customerTerm.toLowerCase()} inquiry leakage, elevation of local authority in ${city}, and an estimated <strong>+15 to +35 qualified high-value ${profile.conversionTerm.toLowerCase()}</strong> per month.
    </div>
  </div>

  <!-- Prescribed Viral Reel Hooks -->
  <div class="hooks-section">
    <div class="rx-sec-title" style="margin-bottom: 6px;">Prescribed Custom Educational Reel Hooks for ${clinic}</div>
    ${reelHooks.map((h, i) => `
      <div class="hook-row">
        <strong>Hook #${i + 1}: "${h.title || 'Authority Topic'}"</strong>
        <em>"${h.hook || ''}"</em>
        <span style="font-size: 7pt; color: #0284c7; display: block; margin-top: 1px;">Strategic Impact: ${h.objective || 'High conversion'}</span>
      </div>
    `).join('')}
  </div>

  <!-- Action Footer / Topmate Booking -->
  <div class="action-footer">
    <div class="action-text">
      <h4>Ready to Preview Your ${isMed ? 'Doctor' : 'Founder'} AI Avatar Sample?</h4>
      <p>Your time is strictly for running operations and serving ${profile.customerTerm.toLowerCase()}. Book a confidential 10-minute AI Strategy Briefing with <strong>${founderName}</strong> on Topmate to preview your pre-rendered voice & face clone demo.</p>
    </div>
    <div class="booking-box">
      <a href="${topmateUrl}" class="booking-link">📅 Book Strategy Session on Topmate</a>
      <div style="font-size: 6.5pt; color: #94a3b8; margin-top: 3px;">Direct Link: ${topmateUrl}</div>
    </div>
  </div>

  <!-- Sign-off Strip -->
  <div class="sign-off">
    <div>
      <div>${agencyName} • AI Local Growth Engine & Digital Authority Architecture</div>
      <div>Official Audit dispatched to: <strong>${data.email || 'Verified Practice Email'}</strong></div>
    </div>
    <div class="signature-block">
      <div class="signature-name">${founderName}</div>
      <div>Practice Growth Strategist & Founder</div>
    </div>
  </div>

</body>
</html>`;

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'load' });
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          bottom: '10mm',
          left: '12mm',
          right: '12mm'
        }
      });

      fs.writeFileSync(filePath, pdfBuffer);
      await browser.close();

      return {
        filePath,
        publicUrl,
        buffer: pdfBuffer
      };
    } catch (err) {
      if (browser) await browser.close();
      console.error('[ScorecardPdfGenerator] Error rendering PDF:', err);
      throw err;
    }
  }
}
