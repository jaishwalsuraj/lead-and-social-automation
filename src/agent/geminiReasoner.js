import { SettingsModel } from '../db/database.js';

/**
 * Intelligent Reasoning & Natural Language Generation Engine
 * Powered by Gemini reasoning with graceful local intelligence fallback.
 */

export class GeminiReasoner {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || SettingsModel.get('gemini_api_key') || '';
  }

  getApiKey() {
    return process.env.GEMINI_API_KEY || SettingsModel.get('gemini_api_key') || this.apiKey;
  }

  /**
   * Cleans raw social post content by removing timestamps, counters, pagination, and noise.
   */
  _cleanPostText(rawText) {
    if (!rawText) return '';
    return rawText
      .split('\n')
      .map(l => l.trim())
      // Filter out social metadata like "19h", "4h", "220", "416", "1 / 2", counters
      .filter(l => {
        if (!l) return false;
        if (/^\d+[smhdwmy]$/i.test(l)) return false; // timestamp like 19h, 4m
        if (/^\d+$/.test(l)) return false; // pure counter numbers
        if (/^\d+\s*[\/|\\]\s*\d+$/.test(l)) return false; // "1 / 2"
        if (/^first\s+thread/i.test(l)) return false;
        return true;
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Deeply extracts entities, budgets, locations, industry, and core dilemma from the post.
   */
  _extractEntities(cleanText, rawText = '') {
    const text = (cleanText || '').toLowerCase();
    const raw = rawText || cleanText;

    // Extract budget if reasonable (e.g. $400, ₹50k, $150, £120–£160, $2k) - reject $83 million or lonely commas
    let budget = null;
    const budgetMatch = raw.match(/((?:USD|\$|₹|INR|£|EUR|€)\s?\d[\d,]*(?:\s?[-–—to]+\s?(?:USD|\$|₹|INR|£|EUR|€)?\s?\d[\d,]*)?(?:\s?[kKmM])?)/i) ||
                        raw.match(/(?:budget\s*(?:is|of|around|:)?\s*)((?:USD|\$|₹|INR|£|EUR|€)?\s?\d[\d,]*(?:\s?[-–—to]+\s?\d[\d,]*)?(?:\s?[kKmM])?)/i);
    if (budgetMatch) {
      const candidate = (budgetMatch[1] || budgetMatch[0]).trim();
      if (!candidate.toLowerCase().includes('million') && !candidate.toLowerCase().includes('billion')) {
        budget = candidate;
      }
    }

    // Extract location if present (e.g. in Indore, in London, in Chicago)
    let location = null;
    const locMatch = raw.match(/(?:in|at|near|around)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
    if (locMatch && !['A', 'The', 'An', 'Our', 'My', 'Your', 'This', 'Threads', 'Instagram', 'Figma', 'Shopify', 'WordPress', 'Remote', 'Florida', 'UK', 'US'].includes(locMatch[1])) {
      location = locMatch[1];
    }

    // Extract local brick & mortar business entity if present (strictly food, retail, healthcare, hospitality)
    let businessEntity = null;
    const localEntities = ['bakery', 'restaurant', 'cafe', 'dental clinic', 'dentist', 'clinic', 'salon', 'gym', 'clothing brand', 'fashion store', 'furniture', 'real estate', 'hotel'];
    for (const ent of localEntities) {
      if (text.includes(ent)) {
        businessEntity = ent;
        break;
      }
    }

    return { budget, location, businessEntity, text };
  }

  /**
   * Evaluates post text to detect high-intent buying signals, service/tool requests, and pain points.
   */
  async evaluateLeadIntent(postText, niche = 'E-commerce / SaaS / Product Sales', keyword = '') {
    const key = this.getApiKey();

    if (key) {
      try {
        return await this._callGeminiEvaluation(postText, niche, keyword, key);
      } catch (err) {
        console.warn('[GeminiReasoner] Gemini API call failed, using intelligent reasoning fallback:', err.message);
      }
    }

    // Intelligent reasoning heuristics fallback (works 100% offline without API key)
    return this._heuristicEvaluation(postText, niche, keyword);
  }

  /**
   * Generates a hyper-contextual, high-value, relatable comment with one line showing expertise.
   */
  async synthesizeComment(postText, authorName, evaluation, niche = 'Digital Marketing & Growth', angle = null) {
    const cleanNiche = this._extractCleanNiche(niche, postText);
    const key = this.getApiKey();

    if (key) {
      try {
        return await this._callGeminiCommentGen(postText, authorName, evaluation, cleanNiche, key, angle);
      } catch (err) {
        console.warn('[GeminiReasoner] Gemini comment generation failed, falling back to contextual generator:', err.message);
      }
    }

    return this._heuristicCommentGen(postText, authorName, evaluation, cleanNiche, angle);
  }

  /**
   * Generates consultative 1-on-1 DM for lead nurturing.
   */
  async synthesizeDM(lead, history = [], niche = 'Digital Marketing & Growth') {
    const cleanNiche = this._extractCleanNiche(niche, lead.post_text || '');
    const key = this.getApiKey();

    if (key) {
      try {
        return await this._callGeminiDMGen(lead, history, cleanNiche, key);
      } catch (err) {
        console.warn('[GeminiReasoner] Gemini DM generation failed, falling back to contextual generator:', err.message);
      }
    }

    return this._heuristicDMGen(lead, cleanNiche);
  }

  /**
   * Generates organic social media post tailored for each platform.
   */
  async generateSocialContent(platform, topic = '', niche = 'E-commerce / SaaS / Product Sales') {
    const key = this.getApiKey();

    if (key) {
      try {
        return await this._callGeminiContentGen(platform, topic, niche, key);
      } catch (err) {
        console.warn('[GeminiReasoner] Gemini content gen failed, using creative generator:', err.message);
      }
    }

    return this._heuristicContentGen(platform, topic, niche);
  }

  /**
   * Expands a search topic/niche into a rich set of high-converting search queries
   */
  async expandSearchKeywords(topic = '', niche = 'E-commerce, SaaS, and Digital Product Sales') {
    const key = this.getApiKey();
    if (key) {
      try {
        const prompt = `You are a growth lead generation expert.
Generate 15 high-intent, natural search queries for social media (Threads, LinkedIn, Facebook, Instagram) to find prospective buyers, clients, or founders seeking services/tools in:
Niche: "${niche}"
Focus Topic: "${topic || 'All high-intent services'}"

Guidelines:
- Return queries that real buyers type when asking for recommendations, software tools, agencies, or solving pain points.
- Include phrases like: "looking for...", "recommend an automation for...", "need developer for...", "anyone using software for...", "best tool to fix...", "switching from...".
- Return ONLY a raw JSON array of strings, without markdown wrappers.`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 }
          })
        });

        if (res.ok) {
          const data = await res.json();
          let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map(k => String(k).toLowerCase().trim());
          }
        }
      } catch (err) {
        console.warn('[GeminiReasoner] Gemini keyword expansion failed, using heuristic expander:', err.message);
      }
    }

    return this._heuristicKeywordExpander(topic, niche);
  }

  _heuristicKeywordExpander(topic = '', niche = '') {
    const cleanTopic = (topic || '').trim().toLowerCase();

    // High-intent templates across key client-acquisition categories
    if (!cleanTopic || cleanTopic.includes('web') || cleanTopic.includes('site') || cleanTopic.includes('dev')) {
      return [
        'need someone to build a website',
        'looking for website developer',
        'recommend a web designer',
        'need modern website for my business',
        'who can build an AI website',
        'looking to redesign my website',
        'need ecommerce store developer',
        'shopify developer recommendation',
        'wordpress developer needed',
        'switching web design agency',
        'fired my web developer need new one',
        'need landing page designer'
      ];
    }

    if (cleanTopic.includes('seo') || cleanTopic.includes('local') || cleanTopic.includes('map') || cleanTopic.includes('geo')) {
      return [
        'need local SEO for my business',
        'how to rank on Google Maps',
        'looking for local SEO expert',
        'Google Business Profile optimization',
        'get my business in Google 3 pack',
        'need GEO expert for AI search',
        'looking for AEO agency',
        'how to rank in ChatGPT Overviews',
        'recommend local SEO agency',
        'struggling with Google Maps rank'
      ];
    }

    if (cleanTopic.includes('lead') || cleanTopic.includes('market') || cleanTopic.includes('growth') || cleanTopic.includes('agency')) {
      return [
        'need more leads for my business',
        'looking for digital marketing agency',
        'recommend a marketing agency',
        'need someone to manage my instagram',
        'who can run meta ads',
        'looking for performance marketer',
        'need WhatsApp marketing setup',
        'looking for lead generation agency',
        'my ads are not converting help',
        'looking for fractional CMO'
      ];
    }

    // Default dynamic topic expansion
    const subject = cleanTopic;
    return [
      `looking for ${subject}`,
      `recommend a ${subject}`,
      `need someone for ${subject}`,
      `best ${subject} recommendation`,
      `anyone know a good ${subject}`,
      `hiring specialist for ${subject}`,
      `struggling with ${subject}`,
      `alternative to ${subject}`,
      `switching agency for ${subject}`,
      `need help with ${subject}`,
      `looking to hire for ${subject}`,
      `budget for ${subject}`
    ];
  }

  // ==================== Gemini API Implementations ====================

  async _callGeminiEvaluation(postText, niche, keyword, apiKey) {
    const prompt = `You are an elite B2B and SaaS Lead Qualification Agent.
Evaluate this social media post to determine if the author is a prospective client or buyer seeking solutions in: "${niche}".
Target query/context: "${keyword}"

Post Content:
"""
${postText}
"""

Rules:
1. Score from 0 to 100 based on BUYING INTENT:
   - 80-100: Explicitly asking for software, tool recommendation, agency, developer, or ready to purchase.
   - 50-79: Expressing a clear pain point, friction in their store/product/workflow, or asking "how to" do something commercial.
   - 20-49: General discussion or neutral mention.
   - 0-19: Spam, self-promotion, competitor selling services, political news, or irrelevant meme.
2. Return strictly valid JSON with no markdown wrapping:
{
  "score": number,
  "is_lead": boolean,
  "intent_stage": "Ready to Buy" | "Evaluating Options" | "Problem Aware" | "Not a Lead",
  "pain_point": "brief summary of their problem or request",
  "recommended_angle": "how to approach them with genuine value"
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed = {};
    try {
      parsed = JSON.parse(cleanJson || '{}');
    } catch (_) {
      return this._heuristicEvaluation(postText, niche, keyword);
    }

    return {
      score: parsed.score || 50,
      is_lead: parsed.is_lead ?? (parsed.score >= 50),
      reason: `${parsed.intent_stage || 'Inquiry'}: ${parsed.pain_point || 'general question'}. Angle: ${parsed.recommended_angle || 'offer value'}`,
      pain_point: parsed.pain_point || '',
      recommended_angle: parsed.recommended_angle || ''
    };
  }

  async _callGeminiCommentGen(postText, authorName, evaluation, cleanNiche, apiKey, angle = null) {
    const cleanPost = this._cleanPostText(postText);
    const angleGuidance = angle === 'hook'
      ? 'Focus angle: Contrarian pattern-interrupt contrast or myth-buster addressing their exact scenario.'
      : angle === 'insight'
      ? 'Focus angle: Specific tactical diagnostic observation, benchmark metric, or architecture takeaway.'
      : angle === 'offer'
      ? 'Focus angle: Zero-pressure peer offer to share our scoping checklist or diagnostic audit.'
      : 'Focus angle: Natural peer practitioner insight directly addressing their specific dilemma with deep empathy.';

    const prompt = `You are Suraj Jaiswal, Senior Growth Architect and Conversion Systems Engineer at The Digital Frog.
A prospective client, founder, or peer posted this on social media:
"""
${cleanPost}
"""
Author / Handle: ${authorName || 'there'}
Context: ${evaluation.reason || evaluation.pain_point || cleanNiche}
${angleGuidance}

TASK:
Write a SHORT, RELATABLE, HIGH-CONVERTING social media comment reply (strictly 2 punchy sentences, 30-45 words).

CRITICAL VIRAL HOOK & EXPERTISE INSTRUCTIONS:
1. READ & RELATE DIRECTLY TO THE POST (Sentence 1):
   - You MUST read the post carefully and speak directly to what the author wrote, their specific scenario, industry, location, budget, or dilemma (e.g. if they fired a dev, need online ordering for a bakery with UPI, have a $150 or $400 budget, suffered an ad ROAS drop, or are hiring an assistant).
   - Relatable human peer tone: NO generic greetings ("Hey there", "Great post!"), NO corporate buzzwords ("Decoupled system architecture", "At scale"). Talk like a smart, empathetic peer who genuinely read their post.
2. SHOW MY EXPERTISE (Sentence 2):
   - Add exactly one clear line showcasing your hands-on practitioner track record at The Digital Frog (e.g. "We've built and rescued 40+ web & ecom systems at The Digital Frog...", "We've engineered high-volume local ordering systems handling seamless UPI...", "We manage multi-six-figure growth funnels at The Digital Frog...").
   - Conclude with a zero-friction, non-pushy peer takeaway (e.g. "happy to share our scoping checklist so your next dev doesn't get stuck!", "glad to point out common payment traps if helpful!").
3. ZERO HARDSALE / ZERO SPAM:
   - Never say "DM me", "hire us", "check my profile/link", and never include phone numbers or URLs.
4. OUTPUT: Return ONLY the exact comment text. No quotes, no markdown wrappers.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 120
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.replace(/^["']|["']$/g, '') || '';
  }

  async _callGeminiDMGen(lead, history, cleanNiche, apiKey) {
    const cleanPost = this._cleanPostText(lead.post_text || '');
    const handle = lead.author_handle || (lead.author_name ? lead.author_name.split(' ')[0] : 'there');

    const prompt = `You are Suraj Jaiswal, Founder & Senior Growth Architect at The Digital Frog.
You are reaching out 1-on-1 via direct message (DM) on ${lead.platform || 'social media'} to this prospect who posted:
"""
${cleanPost}
"""
Author / Handle: @${handle}
Context / Need: ${lead.keyword_matched || cleanNiche}

TASK:
Write a SHORT, BESPOKE, HIGH-CONVERTING 1-on-1 Direct Message (strictly 30 to 45 words, 2-3 short sentences).

STRICT RULES:
1. DIRECTLY RELATE TO THEIR POST: Start by acknowledging their specific post situation (e.g. replacing an unreliable dev, setting up online ordering for a local bakery with UPI, launching an online store under $400, or hiring a designer). Do NOT use generic sales openings like "Hope you are well" or "Saw your post on ${lead.platform}".
2. SHOW MY EXPERTISE: Share one concrete metric or framework from real practitioner experience at The Digital Frog (e.g. "We've stepped in to salvage 20+ web handovers", "We've engineered multiple local ordering systems with instant UPI").
3. ZERO-FRICTION VALUE OFFER: Offer to share a 1-page scoping checklist, transition audit, or architecture blueprint.
4. ZERO HARDSALE: No calendar links, no pricing, no pushiness, no phone numbers.
5. OUTPUT: Return ONLY the exact message text. No quotes.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 140
        }
      })
    });

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.replace(/^["']|["']$/g, '') || '';
  }

  async _callGeminiContentGen(platform, topic, niche, apiKey) {
    const prompt = `You are a top social media strategist for ${niche}.
Platform: ${platform}
Topic: ${topic || 'Scaling e-commerce conversion rates & modern SaaS automations'}

Task:
Generate:
1. High-performing social media post copy formatted specifically for ${platform} (use line breaks, hook, clear takeaways, and engagement question at the end).
2. A descriptive image generation prompt to generate an accompanying high-converting aesthetic visual asset.

Return strictly valid JSON:
{
  "content": "post text with emojis and formatting",
  "image_prompt": "detailed visual prompt for generating graphic or photo",
  "hashtags": ["tag1", "tag2"]
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleanJson || '{}');
    } catch (_) {
      return this._heuristicContentGen(platform, topic, niche);
    }
  }

  // ==================== Heuristic Fallbacks ====================

  _heuristicEvaluation(text, niche, keyword) {
    const lower = (text || '').toLowerCase();
    let score = 30;
    let stage = 'General Inquiry';
    let pain = 'General discussion';
    let angle = 'Offer helpful perspective';

    // Negative signals: Filter out competitors selling services, spam, and political debates
    const negativeSignals = [
      'we are hiring', 'check out our', 'promo code', 'discount', 'free webinar', 'link in bio',
      'we offer', 'our services', 'dm me to start', 'contact us at', 'whatsapp: +', 'email: ',
      'caucus', 'gop', 'democrat', 'endorsement', 'senate', 'legislation', 'cabinet approved'
    ];

    const hasNegative = negativeSignals.some(s => lower.includes(s));
    if (hasNegative) {
      return {
        score: 15,
        is_lead: false,
        reason: 'Filtered: Identified as self-promotional, competitor agency, or civic/political discussion.',
        pain_point: 'Self-promotion or Non-commercial',
        recommended_angle: 'Skip'
      };
    }

    // High intent buying signals
    const highSignals = [
      'looking for', 'need a', 'recommend', 'recommendation', 'any suggestions for',
      'anyone know a good', 'best tool', 'alternative to', 'budget around', 'need someone to build',
      'fired my', 'who can build', 'recommendations welcome'
    ];
    const mediumSignals = [
      'struggling with', 'how do i', 'problem with', 'can anyone help', 'trying to set up',
      'shopify app', 'saas software', 'looking for a cofounder', 'building an online ordering'
    ];

    const matchesHigh = highSignals.filter(s => lower.includes(s));
    const matchesMed = mediumSignals.filter(s => lower.includes(s));

    if (matchesHigh.length > 0) {
      score = 80 + Math.min(matchesHigh.length * 5, 15);
      stage = 'Ready to Buy / Active Search';
      pain = `Explicit request matching: ${matchesHigh.join(', ')}`;
      angle = 'Directly address their requirements with tailored case study or solution.';
    } else if (matchesMed.length > 0) {
      score = 65 + Math.min(matchesMed.length * 5, 10);
      stage = 'Evaluating Options / Problem Aware';
      pain = `Workflow friction matching: ${matchesMed.join(', ')}`;
      angle = 'Provide an architectural or step-by-step fix to build credibility.';
    }

    return {
      score,
      is_lead: score >= 60,
      reason: `${stage} - ${pain}. Angle: ${angle}`,
      pain_point: pain,
      recommended_angle: angle
    };
  }

  _extractCleanNiche(niche = '', postText = '') {
    const combined = `${niche} ${postText || ''}`.toLowerCase();
    
    // Check specific high-frequency service domains with strict word boundaries
    if (/\b(meta ads?|facebook ads?|fb ads?|media buyer|ad spend|roas)\b/i.test(combined)) {
      return 'Meta Ads & Paid Acquisition';
    }
    if (/\b(google ads?|ppc|adwords|search ads?)\b/i.test(combined)) {
      return 'Google Ads & Paid Search';
    }
    if (/\b(seo|aeo|geo|rank|google maps|gbp|chatgpt search)\b/i.test(combined)) {
      return 'SEO & AI Search Optimization';
    }
    if (/\b(reels?|video editor|short form|creator|youtube editor)\b/i.test(combined)) {
      return 'Content Strategy & Reels';
    }
    if (/\b(shopify|ecommerce|e-commerce|online store|woocommerce|d2c)\b/i.test(combined)) {
      return 'E-commerce & D2C Growth';
    }
    if (/\b(lead gen|funnel|cold email|b2b leads?|speed to lead)\b/i.test(combined)) {
      return 'B2B Lead Generation & Funnels';
    }
    if (/\b(whatsapp marketing|email marketing|klaviyo)\b/i.test(combined)) {
      return 'WhatsApp & Retention Marketing';
    }
    if (/\b(saas|web app|software|developer|website|mvp|cofounder)\b/i.test(combined)) {
      return 'SaaS & Development';
    }
    return 'Digital Marketing & Growth';
  }

  _heuristicCommentGen(postText, authorName, evaluation, cleanNiche, angle = null) {
    const clean = this._cleanPostText(postText);
    const { budget, location, businessEntity, text } = this._extractEntities(clean, postText);

    // 0. Non-commercial / Political or Civic Discussion
    if (text.includes('caucus') || text.includes('gop') || text.includes('democrat') || text.includes('opponent') || text.includes('cabinet approved') || text.includes('political committee')) {
      return `An impactful civic discussion—transparency in public allocations and governance matters tremendously. Wishing you the best in your community initiatives!`;
    }

    // 1. Fired Developer / Unreliable Freelancer / Bad Code Handover
    if (text.includes('fired') || (text.includes('bad') && text.includes('dev')) || text.includes('disappeared') || text.includes('ghosted') || text.includes('scammed') || text.includes('replacement developer') || (text.includes('previous') && (text.includes('developer') || text.includes('dev') || text.includes('guy')))) {
      if (angle === 'hook') {
        return `The hidden trap when replacing a web developer isn't writing new code—it's paying someone to spend 3 weeks figuring out what the previous dev didn't document. We've stepped in to salvage 20+ derailed builds at The Digital Frog—glad to share our transition checklist!`;
      }
      if (angle === 'insight') {
        return `Replacing a developer mid-flight is always painful—90% of the roadblock usually comes from untangling undocumented code and broken API keys. We've stepped in to finish 20+ abandoned web builds at The Digital Frog—happy to run a quick 10-point audit so your next developer doesn't get stuck!`;
      }
      if (angle === 'offer') {
        return `If you're bringing on a new developer after parting ways with the last one, having a clean architectural spec saves weeks of friction. At The Digital Frog, we specialize in rescuing derailed web builds—happy to drop our 1-page developer onboarding template if helpful!`;
      }
      return `Replacing a developer mid-flight is always a headache—most of the friction comes from untangling undocumented code or messy repo handovers. We've stepped in to rescue 20+ web and ecom stacks at The Digital Frog—happy to audit your repo or point out any landmines if helpful!`;
    }

    // 2. Local Business Ordering & Payment Setup (Bakery, Cafe, Clinic, Salon, etc. with UPI/online orders)
    if (businessEntity && (text.includes('ordering') || text.includes('upi') || text.includes('website') || text.includes('developer') || text.includes('build'))) {
      const locSnippet = location ? ` in ${location}` : '';
      const budgetSnippet = budget ? ` within ${budget}` : '';
      if (angle === 'hook') {
        return `Most local food and retail stores lose 40% of online orders by redirecting customers through clunky payment forms instead of native UPI. We've built high-converting local ordering systems at The Digital Frog—glad to share our streamlined checkout flow!`;
      }
      return `For a ${businessEntity}${locSnippet} doing online orders, having instant UPI QR checkout paired with automated WhatsApp order confirmation is what stops customers from dropping off mid-cart. At The Digital Frog, we've engineered several high-volume local ordering systems${budgetSnippet}—glad to share our lightweight architecture checklist if helpful!`;
    }

    // 3. UPI / Local Payment Gateway specific
    if (text.includes('upi') || text.includes('razorpay') || text.includes('cashfree') || text.includes('paytm')) {
      const budgetSnippet = budget ? ` on a ${budget} budget` : '';
      return `The biggest challenge with UPI checkout flows is handling intermittent gateway drops without losing the order state. We've built high-converting checkout flows handling thousands of daily UPI transactions at The Digital Frog${budgetSnippet}—happy to share our fail-safe webhook setup!`;
    }

    // 4. Tight / Micro Budget Website ($100-$300 or ₹10k-₹25k)
    if (budget && (
      text.includes('$150') || text.includes('$100') || text.includes('$200') || text.includes('$250') || text.includes('$300') ||
      text.includes('₹10k') || text.includes('₹15k') || text.includes('₹20k') || text.includes('₹25k') ||
      /\b150\b/.test(text) || /\b100\b/.test(text) || /\b200\b/.test(text)
    )) {
      if (angle === 'hook') {
        return `A common mistake on a tight budget is trying to build a 5-page website when a razor-sharp 1-page lander converts 3x better. We build high-converting web funnels at The Digital Frog—glad to share our 1-page framework!`;
      }
      return `At a ${budget} budget, your highest-converting move is a clean 1-page site on Carrd or Framer focused strictly on a single call-to-action rather than an expensive multi-page custom build. We've built and optimized dozens of high-speed conversion landing pages at The Digital Frog—glad to point you in the right direction!`;
    }

    // 5. Online Store / E-commerce / Shopify / WooCommerce (e.g. Under $400-$1000)
    if (text.includes('online store') || text.includes('shopify') || text.includes('ecommerce') || text.includes('e-commerce') || text.includes('woocommerce') || (text.includes('store') && text.includes('website'))) {
      if (budget) {
        return `At ${budget} for an online store, definitely skip custom coding from scratch—setting up a clean Shopify or WooCommerce starter with 1-click mobile checkout gets you selling in 48 hours without burning cash. We've launched 30+ conversion-focused e-commerce storefronts at The Digital Frog—happy to share our lean launch stack so you don't overspend!`;
      }
      if (angle === 'hook') {
        return `The fastest way to burn an e-commerce launch budget is paying for custom development before validating product demand. We've launched 30+ high-converting storefronts at The Digital Frog—glad to share our rapid MVP launch blueprint!`;
      }
      return `Most online stores lose 65%+ of potential buyers right at mobile checkout due to hidden shipping surprises or clumsy field validation. We optimize end-to-end checkout funnels at The Digital Frog and typically recover 15-20% of abandoned carts with automated triggers—glad to share our teardown framework!`;
    }

    // 6. White-label Dev Partnership / Agency Handoff
    if (text.includes('your agency manages') || text.includes('white label') || text.includes('white-label') || text.includes('development work according to') || text.includes('long-term relationships with agencies')) {
      return `Love seeing dedicated white-label engineering partners in the agency space—reliable milestone tracking and clean repo handovers are what make agency partnerships thrive. We operate full-stack conversion systems at The Digital Frog—wishing you great agency collaborations!`;
    }

    // 7. Interior Design / 3D Visualization / Architecture
    if (text.includes('interior design') || text.includes('3d visualization') || text.includes('shopdrawings') || text.includes('horeca')) {
      return `3D visualization and CAD accuracy make all the difference in modern architectural execution—especially with detailed shop drawings. We build automated client acquisition and showroom funnels for high-ticket design firms at The Digital Frog—wishing you the best candidate for the role!`;
    }

    // 8. SaaS / Indie Hacker / Seeking Co-founder / Tech Creator
    if (text.includes('cofounder') || text.includes('co-founder') || text.includes('indie hacker') || text.includes('solo founder') || text.includes('tech creator') || text.includes('building startups') || (text.includes('saas') && (text.includes('build') || text.includes('together') || text.includes('startup') || text.includes('creator')))) {
      if (angle === 'hook') {
        return `The biggest bottleneck for early SaaS teams isn't writing code—it's building features before validating someone will actually pull out their card to pay. We architect full-stack automation and SaaS engines at The Digital Frog—glad to connect and share notes!`;
      }
      return `Finding the right tech and growth cofounder is all about complementary execution velocity—one validating distribution and user feedback while the other ships MVPs. We build and architect full-stack automation and SaaS growth engines at The Digital Frog—always excited to connect with fellow founders and swap notes!`;
    }

    // 9. Hiring Design Assistant / Graphic Designer / Banner Designer
    if (text.includes('design assistant') || text.includes('graphic designer') || text.includes('banners') || text.includes('advertising graphics') || (text.includes('designer') && text.includes('budget'))) {
      const budgetSnippet = budget ? ` for ${budget}` : '';
      return `Creative bottlenecks get intense when project turnarounds pile up—having standardized Figma design components and clear batching briefs cuts revision rounds in half. We manage high-output creative systems and design workflows at The Digital Frog—wishing you great candidates for the project${budgetSnippet}!`;
    }

    // 10. Video Editing / Reels / Short Form Video
    if (text.includes('video editor') || text.includes('reels editor') || text.includes('short form') || text.includes('reels') || text.includes('youtube editor')) {
      return `In short-form video right now, the first 1.5 seconds dictate 80% of retention—high-contrast visual pattern interrupts consistently beat expensive production. We engineer AI video authority systems driving hundreds of thousands of organic views at The Digital Frog—glad to share our retention framework!`;
    }

    // 11. Meta Ads / Facebook Ads / Google Ads / ROAS Drop (strictly word-boundary checked)
    if (/\b(meta ads?|facebook ads?|fb ads?|google ads?|ppc|roas|cpc|media buyer|ad spend)\b/i.test(text)) {
      if (angle === 'hook') {
        return `Tweaking audience targeting when ROAS drops is like rearranging deck chairs—80% of ad performance lives in the first 2 seconds of your video creative. We run performance funnels at The Digital Frog—glad to share what hooks are converting best right now!`;
      }
      return `Sudden ROAS dropoffs usually come down to creative fatigue in your top ad set or audience saturation rather than the bidding algorithm. We manage multi-six-figure growth funnels at The Digital Frog and test 3 polarized hook angles weekly to keep CAC stable—glad to share our testing framework if exploring fixes!`;
    }

    // 12. Local SEO / Google Maps / GBP / AI Search
    if (text.includes('google maps') || text.includes('seo') || text.includes('gbp') || text.includes('local seo') || text.includes('3 pack') || text.includes('geo') || text.includes('aeo') || text.includes('rank')) {
      if (angle === 'hook') {
        return `Most businesses fail to rank on Google Maps because their secondary GBP categories and citation NAP data are fragmented across directories. We optimize local search and AI Overviews at The Digital Frog—glad to share our ranking framework!`;
      }
      return `For Google Maps 3-pack and AI search rankings, verified local geo-citations and authoritative structured entity schema move the needle 5x faster than keyword stuffing. We specialize in local search optimization and GEO authority at The Digital Frog—happy to drop our GBP ranking checklist if helpful!`;
    }

    // 13. Peer Agency / Freelancer Selling (e.g. HSINGH, Mushtaq, ThinkBigJames)
    if (text.includes('we offer') || text.includes('dm me to start') || text.includes('our agency') || text.includes('web studio') || text.includes('whatsapp:') || text.includes('brand identity & design') || text.includes('transparent pricing here')) {
      return `Great to see fellow builders delivering modern web and branding solutions—transparent packages and fast turnarounds are always in high demand. We engineer high-converting digital stacks at The Digital Frog—wishing your team continued momentum and great client wins!`;
    }

    // 14. General Website / Developer Recommendation Request
    if (text.includes('website') || text.includes('developer') || text.includes('web design') || text.includes('need someone to build') || text.includes('redesign')) {
      const budgetSnippet = budget ? ` within ${budget}` : '';
      return `The biggest pitfall when commissioning a new website is developers over-engineering the backend before the core conversion funnel and mobile speed are locked in. We've engineered 40+ high-converting digital platforms and web stacks at The Digital Frog${budgetSnippet}—glad to share our scoping checklist so you avoid scope creep!`;
    }

    // 15. General Solopreneur / Lean Digital Business
    if (text.includes('online business') || text.includes('gumroad') || text.includes('claude') || text.includes('paypal') || text.includes('10k+/month')) {
      return `Keeping the stack lean with direct distribution is the single highest-leverage decision when scaling an online business. We've architected dozens of automated digital delivery and growth pipelines at The Digital Frog—love this simple, high-margin model!`;
    }

    // 16. Default Intelligent Fallback
    return `The most effective way to solve this is diagnosing the single highest-friction bottleneck before committing time or budget to over-complicated tools. We engineer automated conversion and acquisition engines at The Digital Frog—glad to share our diagnostic framework if helpful!`;
  }

  _heuristicDMGen(lead, cleanNiche) {
    const clean = this._cleanPostText(lead.post_text || '');
    const { budget, location, businessEntity, text } = this._extractEntities(clean, lead.post_text);
    const handle = lead.author_handle || (lead.author_name ? lead.author_name.split(' ')[0] : 'there');

    // 1. Fired Developer / Unreliable Freelancer
    if (text.includes('fired') || (text.includes('bad') && text.includes('dev')) || text.includes('disappeared') || text.includes('ghosted') || text.includes('scammed') || text.includes('replacement developer')) {
      return `Saw your note on replacing your web developer, @${handle} — mid-project handovers are notoriously tricky because 90% of the friction comes from undocumented code or broken repo branches. We've stepped in to salvage and finish 20+ stalled builds at The Digital Frog. Put together a 10-point code transition checklist—happy to drop the link if you want to inspect it?`;
    }

    // 2. Local Business with Online Ordering & UPI
    if (businessEntity && (text.includes('ordering') || text.includes('upi') || text.includes('bakery') || text.includes('restaurant'))) {
      const locSnippet = location ? ` in ${location}` : '';
      return `Saw your post about the online ordering site for your ${businessEntity}${locSnippet}, @${handle} — pairing UPI QR checkout with automated WhatsApp dispatch cuts cart drop-offs by 40%. We've engineered several high-volume local ordering stacks handling instant UPI at The Digital Frog. Glad to share our architecture checklist if helpful!`;
    }

    // 3. Online Store / E-commerce (under budget or general)
    if (text.includes('online store') || text.includes('shopify') || text.includes('ecommerce') || text.includes('woocommerce')) {
      const budgetSnippet = budget ? ` under ${budget}` : '';
      return `Saw your post on launching an online store${budgetSnippet}, @${handle} — at this stage, setting up a streamlined Shopify or WooCommerce template with 1-click mobile checkout gets you live in 48 hours without burning cash on custom dev. We've built 30+ conversion storefronts at The Digital Frog—happy to share our lean launch stack if you'd like to check it out!`;
    }

    // 4. Micro-budget website
    if (budget && (text.includes('$150') || text.includes('$100') || text.includes('$200') || text.includes('₹15k') || /\b150\b/.test(text))) {
      return `Saw your note on needing a website for ${budget}, @${handle} — at that budget, a fast 1-page lander on Carrd or Framer focused strictly on a single call-to-action converts 3x better than an expensive multi-page site. We optimize high-speed conversion pages at The Digital Frog—glad to point you to our favorite starter layouts if helpful!`;
    }

    // 5. Paid Ads / ROAS
    if (/\b(meta ads?|facebook ads?|fb ads?|google ads?|ppc|roas|cpc)\b/i.test(text)) {
      return `Saw your note on paid acquisition, @${handle} — 90% of brands burn cash tweaking audience interests when the actual bottleneck is week-1 video hook fatigue. When we tested 3 polarized hooks, CAC dropped 35%. Put together a 2-min breakdown on how this works—happy to share if you want to inspect it?`;
    }

    // 6. Video / Reels
    if (text.includes('reel') || text.includes('video') || text.includes('short form')) {
      return `Saw your point on content and video reach, @${handle} — counter-intuitive reality is that the first 1.5 seconds dictate 80% of retention. Tested high-contrast visual pattern breaks recently and watch time doubled without expensive filming. Happy to drop our hook structure if you'd like to eyeball it?`;
    }

    // 7. SaaS / Indie Hacker / Co-founder / Tech Creator
    if (text.includes('cofounder') || text.includes('co-founder') || text.includes('saas') || text.includes('indie hacker') || text.includes('solo founder') || text.includes('building startups') || text.includes('tech creator')) {
      return `Saw your note on building in public and shipping products, @${handle} — execution speed is everything when validating early demand before building heavy features. We architect full-stack automation and SaaS growth engines at The Digital Frog. Always excited to connect with fellow founders—wishing you great traction on the builds!`;
    }

    // 8. Solopreneur / Lean Digital Business
    if (text.includes('online business') || text.includes('gumroad') || text.includes('claude') || text.includes('paypal') || text.includes('10k+/month')) {
      return `Loved your breakdown on keeping the stack lean, @${handle} — pairing direct distribution with automated digital product delivery is easily the highest-margin model online. We engineer automated delivery workflows at The Digital Frog—great to see this simple, high-leverage blueprint shared!`;
    }

    // 9. General Developer / Website Build
    if (text.includes('website') || text.includes('developer') || text.includes('web design')) {
      return `Saw your post regarding the website build, @${handle} — the key to keeping dev costs down is locking in the core conversion funnel before developers start coding. We've built and audited 40+ web stacks at The Digital Frog. Glad to share our scoping template so you avoid scope creep!`;
    }

    // 10. Default DM
    return `Saw your observation on ${cleanNiche}, @${handle} — counter-intuitive truth is that 90% of operators over-complicate this setup when fixing the single core qualification bottleneck unlocks 2x ROI. Put together a 2-minute diagnostic audit on this—happy to share the private link if you'd like to check it out?`;
  }

  _heuristicContentGen(platform, topic, niche) {
    if (platform === 'linkedin') {
      return {
        content: `Most ${niche} founders spend 80% of their time on manual operations that could be automated in 1 click.\n\nHere are 3 high-leverage systems we put on autopilot this quarter:\n\n1. Automated Customer Win-back sequences (triggered on abandoned browse intent)\n2. Real-time Multi-channel Inventory Sync across storefronts\n3. Instant Lead Qualification & CRM Routing\n\nThe result? 3.4x faster response times and zero missed opportunities.\n\nWhich operational bottleneck is currently slowing down your growth? Drop it below 👇`,
        image_prompt: 'A sleek modern dark-mode dashboard displaying e-commerce revenue growth charts, neon teal and violet accents, minimal 3D glassmorphic UI, 8k resolution',
        hashtags: ['Ecommerce', 'SaaS', 'Automation', 'GrowthStrategy', 'Tech']
      };
    }

    return {
      content: `The secret to scaling ${niche} in 2026 isn't more ad spend—it's automated responsiveness.\n\nWhen a customer has high intent, every minute of delay cuts conversion in half.\n\nAre you automating your customer touchpoints yet?`,
      image_prompt: 'Futuristic digital commerce concept, glowing geometric analytics, clean aesthetic, dark backdrop',
      hashtags: ['automation', 'saas', 'growth', 'business']
    };
  }
}

export const reasoner = new GeminiReasoner();
