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
   * Generates a hyper-contextual, high-value, short and attractive comment.
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

    const firstName = lead.author_name ? lead.author_name.split(' ')[0] : 'there';
    return `Hey ${firstName}, saw your post on ${lead.platform}! We help brands streamline ${cleanNiche}. Happy to share a quick checklist or blueprint if you're exploring options—no pitch, just glad to help!`;
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
   - 0-19: Spam, self-promotion, selling their own service, or irrelevant meme.
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
    const angleGuidance = angle === 'hook'
      ? 'Focus angle: Strong pattern-interrupt hook contrasting conventional approaches vs what actually works.'
      : angle === 'insight'
      ? 'Focus angle: Specific tactical setup, metric, or framework insight.'
      : angle === 'offer'
      ? 'Focus angle: Warm, zero-pressure offer to share our test blueprint or checklist.'
      : 'Focus angle: Sharp, natural peer practitioner value drop.';

    const prompt = `You are an elite practitioner and specialist in ${cleanNiche}.
A prospective buyer/client posted on social media:
"""
${postText}
"""
Author: ${authorName}
Context / Identified Need: ${evaluation.reason || evaluation.pain_point || 'seeking solution'}
${angleGuidance}

Task:
Write a SHORT, ATTRACTIVE comment reply for this post.

STRICT REQUIREMENTS:
1. LENGTH: Exactly 1 to 2 sentences (strictly MAXIMUM 25 to 35 words). Shorter is better!
2. VALUE DROP: Immediately share 1 sharp, high-signal practitioner insight or tactical best practice that directly addresses their specific question, requirement, or budget.
3. ATTRACTIVE & PEER-TO-PEER: Make it punchy, engaging, and authoritative so that both the author AND anyone reading the thread think "this person really knows their stuff".
4. NO FLUFF / NO SALES PITCH: Never say "DM me", "hire us", "we are an agency", or "check out our website". No hashtags.
5. CLOSING: Conclude with a warm, zero-friction peer invite (e.g., "Happy to share our test framework!" or "Glad to drop our checklist if helpful!").
6. OUTPUT: Return ONLY the exact comment text. No surrounding quotes or preamble.`;

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
    const prompt = `You are reaching out 1-on-1 to a prospective client on social media.
Lead post: "${lead.post_text}"
Author: ${lead.author_name}
Target Domain: ${cleanNiche}

Task:
Write a short, friendly, personalized direct message (DM).
Rules:
- Strictly under 40-50 words (2-3 short sentences).
- Reference their specific post context naturally.
- Offer a concrete, helpful asset (e.g. quick checklist, test structure, or workflow).
- Zero pushiness, zero aggressive sales talk.
- Return ONLY the message text.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
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
    const lower = text.toLowerCase();
    let score = 30;
    let stage = 'General Inquiry';
    let pain = 'General discussion';
    let angle = 'Offer helpful perspective';

    // High intent buying signals
    const highSignals = ['looking for', 'need a', 'recommend', 'recommendation', 'any suggestions for', 'hiring', 'budget', 'anyone know a good', 'best tool', 'alternative to'];
    const mediumSignals = ['struggling with', 'how do i', 'problem with', 'can anyone help', 'trying to set up', 'shopify app', 'saas software'];
    const negativeSignals = ['we are hiring', 'check out our', 'promo code', 'discount', 'free webinar', 'link in bio'];

    const hasNegative = negativeSignals.some(s => lower.includes(s));
    if (hasNegative) {
      return {
        score: 15,
        is_lead: false,
        reason: 'Filtered: Identified as self-promotional or non-buyer post.',
        pain_point: 'Self-promotion',
        recommended_angle: 'Skip'
      };
    }

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
    
    // Check specific high-frequency service domains
    if (combined.includes('meta ad') || combined.includes('facebook ad') || combined.includes('fb ad') || combined.includes('media buyer')) {
      return 'Meta Ads & Paid Acquisition';
    }
    if (combined.includes('google ad') || combined.includes('ppc') || combined.includes('adwords')) {
      return 'Google Ads & Paid Search';
    }
    if (combined.includes('seo') || combined.includes('aeo') || combined.includes('geo') || combined.includes('rank') || combined.includes('chatgpt')) {
      return 'SEO & AI Search Optimization';
    }
    if (combined.includes('reel') || combined.includes('content') || combined.includes('creator') || combined.includes('video editor')) {
      return 'Content Strategy & Reels';
    }
    if (combined.includes('shopify') || combined.includes('ecommerce') || combined.includes('online store') || combined.includes('d2c')) {
      return 'E-commerce & D2C Growth';
    }
    if (combined.includes('lead gen') || combined.includes('funnel') || combined.includes('cold email') || combined.includes('b2b')) {
      return 'B2B Lead Generation & Funnels';
    }
    if (combined.includes('whatsapp') || combined.includes('email marketing')) {
      return 'WhatsApp & Retention Marketing';
    }
    if (combined.includes('automation') || combined.includes('saas') || combined.includes('app') || combined.includes('developer')) {
      return 'SaaS & Development';
    }
    return 'Digital Marketing & Growth';
  }

  _heuristicCommentGen(postText, authorName, evaluation, cleanNiche, angle = null) {
    const text = (postText || '').toLowerCase();
    
    // Extract budget if mentioned (e.g., $2,000, $5k, ₹50k, $300)
    const budgetMatch = (postText || '').match(/((?:USD|\$|₹|INR|£|EUR|€)\s?[\d,]+(?:\s?[kKmM])?)/i) ||
                        (postText || '').match(/(?:budget\s*(?:is|of|around|:)?\s*)((?:USD|\$|₹|INR|£|EUR|€)?\s*[\d,]+(?:\s?[kKmM])?)/i);
    const budget = budgetMatch ? (budgetMatch[1] || budgetMatch[0]).trim() : null;

    const pickTemplate = (list) => {
      if (angle === 'hook' && list[0]) return list[0];
      if (angle === 'insight' && list[1]) return list[1];
      if (angle === 'offer' && list[2]) return list[2];
      return list[Math.floor(Math.random() * list.length)];
    };

    // 1. Meta / Facebook Ads & Paid Social
    if (text.includes('meta ad') || text.includes('facebook ad') || text.includes('fb ad') || text.includes('media buyer') || text.includes('performance market') || text.includes('run ad') || text.includes('ad expert')) {
      const budgetPrefix = budget ? `At a ${budget} budget on Meta` : 'On Meta right now';
      const templates = [
        `${budgetPrefix}, rapid creative testing with broad targeting consistently outperforms tight interest stacks. Handled similar ad scale recently—happy to drop our test structure!`,
        `For Meta acquisition, testing 3 distinct video hooks in week 1 gives you the fastest CPA validation. Dropped a quick note with our current testing framework!`,
        `With Meta ads, dialing in high-retention creative angles and proper CAPI tracking does 90% of the heavy lifting. Glad to share what's converting best!`
      ];
      return pickTemplate(templates);
    }

    // 2. Google Ads & PPC
    if (text.includes('google ad') || text.includes('ppc') || text.includes('adwords') || text.includes('search ad')) {
      const templates = [
        `For Google Ads, phrase match paired with tight negative keyword lists usually cuts wasted spend by 40% in week one. Happy to share our audit checklist!`,
        `High-intent search terms with dedicated landing pages give you the quickest ROAS. Handled similar campaigns recently—glad to share our structure!`,
        `Structuring granular negative lists before scaling spend protects 30%+ of ad budget. Happy to share our Google Ads launch checklist!`
      ];
      return pickTemplate(templates);
    }

    // 3. SEO, AEO, GEO & AI Search
    if (text.includes('seo') || text.includes('aeo') || text.includes('geo') || text.includes('rank') || text.includes('chatgpt') || text.includes('ai search')) {
      const templates = [
        `For AI search & GEO ranking, structuring your entity schema and authoritative niche citations moves the needle fastest. Happy to share a quick checklist!`,
        `The quickest SEO win right now is structuring high-intent topic clusters with clean technical schema. Glad to share our current roadmap!`,
        `Ranking in AI overviews requires authoritative structured entity proof and direct question answers. Happy to share our optimization guide!`
      ];
      return pickTemplate(templates);
    }

    // 4. E-commerce / Shopify / Online Store / WooCommerce
    if (text.includes('shopify') || text.includes('ecommerce') || text.includes('e-commerce') || text.includes('store') || text.includes('woocommerce') || text.includes('cart') || text.includes('checkout') || text.includes('d2c') || text.includes('dtc')) {
      const budgetPrefix = budget ? `For an online store under ${budget}` : 'For online store growth';
      const templates = [
        `${budgetPrefix}, a clean lightweight setup with zero checkout friction gives you the fastest launch. Happy to share our starter tech stack!`,
        `Keeping checkout friction near zero and page load under 1.5s drives the fastest conversion lift. Glad to share our starter architecture!`,
        `Triggering automated recovery flows within 15 mins usually recaptures 18-24% of abandoned buyers without heavy discounts. Happy to share the blueprint!`
      ];
      return pickTemplate(templates);
    }

    // 5. Reels, Content, Social Media Management & Branding
    if (text.includes('reel') || text.includes('content') || text.includes('video') || text.includes('social media') || text.includes('instagram') || text.includes('branding') || text.includes('logo')) {
      const budgetPrefix = budget ? `At ${budget}` : 'For organic growth';
      const templates = [
        `The 3-second hook and high-retention pacing make or break organic reels right now. Scaled similar accounts recently—glad to share our hook structure!`,
        `${budgetPrefix}, consistency plus 3 distinct content angles per week is what really compounds reach. Happy to share our batching workflow!`,
        `Focusing on clean visual identity and strong initial contrast gives the sharpest brand perception. Glad to share a few recent references!`
      ];
      return pickTemplate(templates);
    }

    // 6. Lead Generation, B2B & Funnels
    if (text.includes('lead') || text.includes('b2b') || text.includes('funnel') || text.includes('cold email') || text.includes('client')) {
      const templates = [
        `The biggest lever for lead funnels is qualifying intent right before the booking step to keep lead quality high. Glad to share our funnel framework!`,
        `Streamlining the qualification trigger can easily 2x your booked calls without extra spend. Happy to share our automated workflow!`,
        `Automated lead qualification before routing to calendar prevents 80% of no-shows. Glad to share our high-ticket funnel architecture!`
      ];
      return pickTemplate(templates);
    }

    // 7. Developer, Website, App & Tech
    if (text.includes('developer') || text.includes('website') || text.includes('app') || text.includes('saas') || text.includes('build') || text.includes('software')) {
      const budgetPrefix = budget ? `At ${budget}` : 'For custom builds';
      const templates = [
        `${budgetPrefix}, keeping the initial build focused strictly on core user flow saves weeks of scope creep. Glad to share how we structure it!`,
        `Building with modular components and clean API integrations makes future scaling seamless. Happy to share our starter stack!`,
        `Decoupled architectures with standard webhooks prevent 90% of technical debt down the road. Glad to share our setup guide!`
      ];
      return pickTemplate(templates);
    }

    // 8. General High-Converting Short Peer Comments
    const genericTemplates = [
      `Solid point! Keeping the core workflow streamlined and decoupled avoids 90% of downstream bottlenecks. Happy to share our breakdown if you're exploring options!`,
      `Great initiative! Focusing on the primary high-leverage friction point first delivers the fastest ROI. Glad to share what worked best for us!`,
      `Most people overlook this exact leverage point. Simple, direct execution consistently beats over-complicated setups. Happy to drop our checklist!`
    ];
    return pickTemplate(genericTemplates);
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
