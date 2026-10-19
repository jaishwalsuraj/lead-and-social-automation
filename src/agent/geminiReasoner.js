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
      ? 'Focus angle: Contrarian pattern-interrupt hook contrasting conventional industry myths vs what actually converts.'
      : angle === 'insight'
      ? 'Focus angle: Specific tactical setup, benchmark metric, or diagnostic framework insight.'
      : angle === 'offer'
      ? 'Focus angle: Zero-pressure peer offer to share our private diagnostic breakdown or test protocol.'
      : 'Focus angle: High-signal peer practitioner value drop with an immediate pattern break.';

    const prompt = `You are Suraj Jaiswal, an elite digital growth architect, AI video authority specialist, and conversion systems engineer at The Digital Frog.
A prospective client/founder posted this on social media:
"""
${postText}
"""
Author: ${authorName || 'there'}
Context / Identified Need: ${evaluation.reason || evaluation.pain_point || 'seeking growth solution'}
${angleGuidance}

Task:
Write a SHORT, ULTRA-HIGH-CONVERTING comment reply for this post.

STRICT VIRAL HOOK & EXPERTISE GUIDELINES:
1. VIRAL PATTERN BREAK HOOK (MANDATORY): Never start with greetings, compliments, or generic filler ("Great post!", "Nice thoughts!"). The very first 3-7 words must break their scrolling pattern with a contrarian, intriguing observation directly addressing their post (e.g. "Counter-intuitive reality with [topic]:", "90% of brands burn cash here because...", "The actual bottleneck isn't [X], it's...").
2. DEMONSTRATE ELITE EXPERTISE: Showcase proven practitioner mastery in digital acquisition funnels, AI avatar video authority, high-ticket qualification, or speed-to-lead automation. Reference tactical levers, real-world benchmarks, or systems.
3. ACCORDING TO THE EXACT POST: Directly reference or quote the specific problem, tool, metric, or question in their post so it feels 100% bespoke.
4. LENGTH: Exactly 1 to 2 punchy sentences (maximum 25 to 35 words). Shorter and sharper is better!
5. ZERO PUSHINESS / NO HARD SELL: Never say "DM me", "hire us", "check my profile", or drop links. Conclude with a warm, zero-friction peer invite (e.g., "Glad to drop our diagnostic framework if helpful!" or "Happy to share what converted best!").
6. OUTPUT: Return ONLY the exact comment text. No quotes, no hashtags, no preamble.`;

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
    const prompt = `You are Suraj Jaiswal, Founder of The Digital Frog, an elite digital growth and AI automation strategist.
You are reaching out 1-on-1 via direct message (DM) on ${lead.platform || 'social media'} to this prospect who posted:
"""
${lead.post_text}
"""
Author / Handle: ${lead.author_name || lead.author_handle || 'there'}
Niche / Focus: ${cleanNiche}

Task:
Write a SHORT, HIGH-CONVERTING 1-on-1 Direct Message (strictly 30 to 45 words, 2-3 short sentences).

STRICT VIRAL HOOK & PATTERN BREAK RULES:
1. VIRAL PATTERN BREAK HOOK: Do NOT start with "Hey, saw your post", "Hope you are doing well", or standard sales pitches. Start immediately with an intriguing, pattern-breaking observation directly analyzing what they posted (e.g., "Saw your point on [specific detail from post] — 90% of people try to solve this with [common mistake], but the actual bottleneck is usually [insight]...").
2. DEMONSTRATE PRACTICAL EXPERTISE: State a specific metric or micro-framework from real experience (e.g., "When we audited similar setups, switching to [strategy] cut CAC by 35% and doubled conversion without extra ad spend").
3. VALUE-FIRST OFFER: Conclude with a zero-friction peer invitation (e.g., "Put together a private 2-min diagnostic breakdown / scorecard on how to patch this — happy to share the direct link if you'd like to inspect it?").
4. ZERO HARDSALE: No calendar links, no pricing, no aggressive pushiness.
5. OUTPUT: Return ONLY the exact message text. No surrounding quotes.`;

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
      const budgetPrefix = budget ? `At ${budget} on Meta` : 'Counter-intuitive reality with Meta ads';
      const templates = [
        `${budgetPrefix}: 80% of ad spend is burnt testing micro-audiences when the actual bottleneck is week-1 video hook fatigue. Glad to drop our rapid creative testing setup if helpful!`,
        `The biggest ROAS killer right now isn't targeting—it's having zero polarized hooks in the first 2 seconds. Tested this across similar accounts and happy to share what won!`,
        `With Meta acquisition, dialing in 3 distinct hook variations paired with CAPI conversion tracking does 90% of the heavy lifting. Glad to share our current roadmap!`
      ];
      return pickTemplate(templates);
    }

    // 2. Google Ads & PPC
    if (text.includes('google ad') || text.includes('ppc') || text.includes('adwords') || text.includes('search ad')) {
      const templates = [
        `Counter-intuitive fact on Google PPC: broad match without strict negative keyword clusters leaks 40%+ of your budget in 7 days. Happy to share our negative term checklist!`,
        `Most PPC campaigns fail on the post-click journey, not the bidding strategy. Pairing exact intent search with dedicated speed-optimized landers 2x'd our conversion recently!`,
        `The quickest ROAS unlock is auditing search term leakage before raising daily budget. Glad to drop our PPC audit framework if exploring options!`
      ];
      return pickTemplate(templates);
    }

    // 3. SEO, AEO, GEO & AI Search
    if (text.includes('seo') || text.includes('aeo') || text.includes('geo') || text.includes('rank') || text.includes('chatgpt') || text.includes('ai search')) {
      const templates = [
        `Most brands overlook this in AI search: ranking on ChatGPT & Perplexity requires authoritative entity schema, not keyword density. Glad to share our GEO optimization roadmap!`,
        `Counter-intuitive SEO shift: Google's AI Overviews prioritize direct question-answer clusters over long-form fluff. Happy to drop our entity structuring checklist!`,
        `The fastest rank lift in 2026 comes from aligning structured schema with verified local Google citations. Glad to share our agency setup guide!`
      ];
      return pickTemplate(templates);
    }

    // 4. E-commerce / Shopify / Online Store / WooCommerce
    if (text.includes('shopify') || text.includes('ecommerce') || text.includes('e-commerce') || text.includes('store') || text.includes('woocommerce') || text.includes('cart') || text.includes('checkout') || text.includes('d2c') || text.includes('dtc')) {
      const budgetPrefix = budget ? `At ${budget} scale` : 'The silent conversion killer for online stores';
      const templates = [
        `${budgetPrefix}: every 500ms of mobile load delay slashes checkout completion by 18%. Keeping checkout friction near zero beats running discounts every time!`,
        `Most e-commerce founders obsess over ad ROAS while losing 60% of buyers at checkout. Triggering 15-min automated recovery flows recaptures 20%+ of browse drop-offs!`,
        `Counter-intuitive truth: clean 1-click checkout flow and instant mobile trust badges drive 3x more revenue than adding another ad channel. Happy to share our starter stack!`
      ];
      return pickTemplate(templates);
    }

    // 5. Reels, Content, Social Media Management & Branding
    if (text.includes('reel') || text.includes('content') || text.includes('video') || text.includes('social media') || text.includes('instagram') || text.includes('branding') || text.includes('logo')) {
      const budgetPrefix = budget ? `At ${budget}` : 'Pattern break for organic reels';
      const templates = [
        `${budgetPrefix}: the first 1.5 seconds dictate 80% of retention. Testing 3 polarized hooks consistently beats high-budget production. Scaled similar accounts—happy to share our hook formula!`,
        `The biggest mistake creators make is waiting 5 seconds to deliver the payoff. Fast visual cuts + pattern interrupt in frame 1 is what compounds reach. Glad to share our batching workflow!`,
        `Visual contrast and contrarian hooks in the opening frame 2x watch time instantly. Glad to drop our high-retention reel script structure!`
      ];
      return pickTemplate(templates);
    }

    // 6. Lead Generation, B2B & Funnels
    if (text.includes('lead') || text.includes('b2b') || text.includes('funnel') || text.includes('cold email') || text.includes('client')) {
      const templates = [
        `The hidden bottleneck in high-ticket lead generation is speed-to-lead: inquiries unanswered in 15 minutes drop conversion by 70%. Automated instant routing 2x'd our booked calls!`,
        `Counter-intuitive finding: qualifying intent on the booking page weeds out tire-kickers while actually increasing show-up rates to 85%+. Happy to drop our qualification framework!`,
        `Most B2B funnels leak at the handoff between discovery and calendar booking. Streamlining the intake funnel saves 10+ hours a week. Glad to share our automated blueprint!`
      ];
      return pickTemplate(templates);
    }

    // 7. Developer, Website, App & Tech
    if (text.includes('developer') || text.includes('website') || text.includes('app') || text.includes('saas') || text.includes('build') || text.includes('software')) {
      const budgetPrefix = budget ? `For builds under ${budget}` : 'Decoupled system architecture';
      const templates = [
        `${budgetPrefix}: keeping the core MVP strictly focused on the primary conversion event prevents 90% of scope creep. Glad to share how we architect lightweight stacks!`,
        `Counter-intuitive truth on custom builds: standard webhook events and modular micro-components save months of technical debt down the road. Happy to share our boilerplate!`,
        `Building with clean API separation and lightweight frontends cuts maintenance overhead by half. Glad to share our production architecture checklist!`
      ];
      return pickTemplate(templates);
    }

    // 8. General High-Converting Short Peer Comments
    const genericTemplates = [
      `Counter-intuitive perspective on this: 90% of operators burn resources over-engineering the periphery when fixing the single high-friction bottleneck delivers 3x ROI immediately. Happy to drop our diagnostic framework!`,
      `Most people overlook this exact leverage point. Simple, automated execution paired with fast customer feedback consistently beats complex setups. Glad to share what worked best!`,
      `Pattern break: the real unlock here isn't doing more tasks, it's removing the manual handoff that causes 80% of the delays. Happy to share our operational checklist!`
    ];
    return pickTemplate(genericTemplates);
  }

  _heuristicDMGen(lead, cleanNiche) {
    const text = (lead.post_text || '').toLowerCase();
    const handle = lead.author_handle || (lead.author_name ? lead.author_name.split(' ')[0] : 'there');

    if (text.includes('ad') || text.includes('meta') || text.includes('ppc') || text.includes('marketing')) {
      return `Saw your note on paid acquisition, ${handle} — 90% of brands burn cash tweaking audience interests, but the actual bottleneck is almost always week-1 video hook fatigue. When we tested 3 polarized hooks, CAC dropped 35%. Put together a 2-min breakdown on how this works—happy to share if you want to inspect it?`;
    }

    if (text.includes('reel') || text.includes('video') || text.includes('content') || text.includes('instagram')) {
      return `Saw your point on content and video reach, ${handle} — counter-intuitive reality is that the first 1.5 seconds dictate 80% of retention. Tested high-contrast visual pattern breaks recently and watch time doubled without expensive filming. Happy to drop our hook structure if you'd like to eyeball it?`;
    }

    if (text.includes('lead') || text.includes('client') || text.includes('sales') || text.includes('growth')) {
      return `Saw what you shared regarding client acquisition, ${handle} — the hidden leak in 90% of pipelines is speed-to-lead (inquiries unanswered in 15 mins convert 70% lower). We automated instant qualification and booked calls doubled. Put together a quick diagnostic roadmap on this—glad to send the link if helpful?`;
    }

    if (text.includes('website') || text.includes('shopify') || text.includes('store') || text.includes('ecommerce')) {
      return `Saw your post on storefront conversions, ${handle} — counter-intuitive finding is that 500ms of checkout friction loses 20%+ of high-intent buyers before they even reach payment. Audited similar flows recently and happy to share our 1-page checkout optimization checklist!`;
    }

    return `Saw your observation on ${cleanNiche}, ${handle} — counter-intuitive truth is that 90% of operators over-complicate this setup when fixing the single core qualification bottleneck unlocks 2x ROI. Put together a 2-minute diagnostic audit on this—happy to share the private link if you'd like to check it out?`;
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
