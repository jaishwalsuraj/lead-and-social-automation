/**
 * ScorecardEngine - Niche-Adaptive Digital Health Check & Growth Scorecard
 * 
 * Customizes the audit, diagnosis, AI treatment protocol, and viral hooks
 * across 10 distinct business archetypes:
 * 1. Medical & Dental Healthcare Practices
 * 2. Legal Practices & Law Firms
 * 3. Real Estate Agencies & Property Brokerages
 * 4. Luxury Salons, Spas & Aesthetic Studios
 * 5. Fitness Centers, Gyms & CrossFit Studios
 * 6. Emergency Towing, Auto Repair & Fleet Services
 * 7. Home Services & Contractors (Plumbing, HVAC, Roofing, Electrical)
 * 8. B2B Consulting, CA & Financial Advisory Firms
 * 9. Restaurants, Fine Dining & Hospitality Venues
 * 10. Local Retail, E-Commerce & Commercial Services
 */

export const NICHE_REGISTRY = {
  medical: {
    id: 'medical',
    label: 'Medical, Dental & Specialty Healthcare Clinic',
    icon: '🩺',
    badge: '℞',
    reportTitle: '℞ CLINICAL PRACTICE GROWTH PRESCRIPTION',
    reportSubtitle: 'Personal Brand Authority & Doctor AI Avatar Protocol',
    roleLabel: 'Doctor / Practice Principal',
    customerTerm: 'Patients',
    customerSingular: 'Patient',
    placeTerm: 'Clinic / Practice',
    timingLabel: 'Consultation Timings',
    feeLabel: 'Standard Consultation Fee',
    conversionTerm: 'Chairside Consultations',
    vulnerability: 'Acute Video Deficiency Syndrome (AVDS): Practice relies on static banners or word-of-mouth. Over 82% of patients research specialist demeanor and procedure explanations on Instagram Reels & YouTube before booking. Rival clinics are winning high-ticket cases simply by having a visible doctor on video.',
    avatarBenefit: 'Doctor clinic time is strictly for surgical procedures and patient care. Your AI Clone presents high-yield educational Reels on autopilot while you treat patients in clinic.',
    filePrefix: 'rx-prescription-dr',
    defaultHooks: [
      {
        title: 'The Coffee & Wine Stain Myth',
        hook: '3 things you should NEVER do right after drinking coffee (especially #2 if you care about your tooth enamel)!',
        objective: 'High virality, drives hygiene & whitening bookings.'
      },
      {
        title: 'Implant Fear Buster',
        hook: 'Does getting a dental implant actually hurt? Here is the exact truth my patients are shocked to learn chairside.',
        objective: 'Converts high-ticket ($1,000–$3,000) private implant inquiries.'
      },
      {
        title: 'Clear Aligners vs Braces at 30+',
        hook: 'Thinking about clear aligners? Here is why 60% of adults regret waiting until their 30s to fix crooked teeth.',
        objective: 'Captures aesthetic smile makeover cases.'
      }
    ]
  },
  legal: {
    id: 'legal',
    label: 'Legal Practice, Law Firm & Attorneys',
    icon: '⚖️',
    badge: '⚖️',
    reportTitle: '⚖️ LEGAL PRACTICE GROWTH BLUEPRINT & CLIENT AUDIT',
    reportSubtitle: 'Attorney Authority & AI Video Case Acquisition Engine',
    roleLabel: 'Managing Partner / Attorney / Advocate',
    customerTerm: 'High-Value Clients & Retainers',
    customerSingular: 'Client',
    placeTerm: 'Law Firm / Legal Practice',
    timingLabel: 'Court & Consultation Hours',
    feeLabel: 'Hourly / Consultation Rate',
    conversionTerm: 'Retained Cases & Legal Consultations',
    vulnerability: 'Legal Authority & Retainer Invisibility Gap: Over 78% of corporate and personal clients research an attorney\'s video explanations and case outcomes before booking a paid consultation. High-value cases are actively retaining rival firms whose partners appear regularly on short-form video.',
    avatarBenefit: 'Senior attorneys billing $300–$600/hr cannot waste billable hours setting up lights and cameras. Your AI Avatar explains complex legal clauses and case precedents on autopilot.',
    filePrefix: 'growth-blueprint-law',
    defaultHooks: [
      {
        title: 'The Hidden Clause Trap',
        hook: '3 things you must NEVER sign or agree to without an attorney reviewing clause 4 (especially in settlement agreements)!',
        objective: 'Drives high-ticket contract and litigation consultations.'
      },
      {
        title: 'The 48-Hour Mistake',
        hook: 'Injured in an accident? The critical 48-hour mistake that insurance adjusters secretly pray you make.',
        objective: 'Captures urgent, high-value personal injury retainers.'
      },
      {
        title: 'Partnership Agreement Vulnerability',
        hook: 'Starting a business with a friend? The one deadlock clause that saves 80% of founders from catastrophic lawsuits.',
        objective: 'Converts lucrative corporate and startup retainers.'
      }
    ]
  },
  real_estate: {
    id: 'real_estate',
    label: 'Real Estate Agency, Realtor & Property Brokerage',
    icon: '🏡',
    badge: '🏡',
    reportTitle: '🏡 REAL ESTATE ACQUISITION BLUEPRINT & MARKET AUDIT',
    reportSubtitle: 'Realtor Video Authority & AI Property Walkthrough Engine',
    roleLabel: 'Principal Broker / Managing Realtor / Director',
    customerTerm: 'Property Buyers, Sellers & Investors',
    customerSingular: 'Buyer / Seller',
    placeTerm: 'Real Estate Brokerage / Agency',
    timingLabel: 'Showing & Negotiation Hours',
    feeLabel: 'Average Commission / Ticket Size',
    conversionTerm: 'Exclusive Listings & Site Visits',
    vulnerability: 'Passive Listing Syndrome & Video Walkthrough Absence: 89% of high-net-worth buyers and sellers choose agents who showcase properties and market trends on Reels and YouTube Shorts. Traditional static photo listings suffer from 65% lower inquiry volume.',
    avatarBenefit: 'Top brokers spend their days in showings and closing deals—not editing video. Your AI Avatar delivers daily market updates, neighborhood spotlights, and investment advice 24/7.',
    filePrefix: 'growth-blueprint-realty',
    defaultHooks: [
      {
        title: 'The Walkthrough Red Flag',
        hook: '3 hidden red flags to look for during a property walkthrough that unvetted home inspectors always miss!',
        objective: 'Captures high-intent buyers ready to purchase.'
      },
      {
        title: 'The 10% Seller Equity Mistake',
        hook: 'Why 70% of homeowners in this neighborhood leave $30,000 to $50,000 on the table by listing the wrong way.',
        objective: 'Generates exclusive high-value seller listings.'
      },
      {
        title: 'The Off-Plan Investment Secret',
        hook: 'Thinking of investing in off-plan developments? The #1 clause in the sale deed that guarantees your capital is safe.',
        objective: 'Attracts high-net-worth real estate investors.'
      }
    ]
  },
  beauty: {
    id: 'beauty',
    label: 'Luxury Salon, Spa & Aesthetic Wellness Studio',
    icon: '✨',
    badge: '✨',
    reportTitle: '✨ SALON & SPA REVENUE ACCELERATION AUDIT',
    reportSubtitle: 'Aesthetic Video Authority & AI Client Booking Protocol',
    roleLabel: 'Salon Owner / Creative Director / Master Stylist',
    customerTerm: 'VIP Clients & Guests',
    customerSingular: 'Client',
    placeTerm: 'Salon, Spa & Aesthetic Lounge',
    timingLabel: 'Treatment Floor Hours',
    feeLabel: 'Average Service Ticket Value',
    conversionTerm: 'High-Ticket Treatment Bookings',
    vulnerability: 'Static Portfolio Syndrome & Treatment Video Void: Modern beauty clients book high-ticket services (balayage, botox, hydrafacials, extensions) only after seeing step-by-step video transformations and stylist tips. Without video proof, clients default to cheap discount chains.',
    avatarBenefit: 'Creative directors are fully booked on the floor styling clients. Your AI Avatar produces daily hair/skin education, transformation breakdowns, and seasonal promotions without interrupting your appointments.',
    filePrefix: 'growth-blueprint-salon',
    defaultHooks: [
      {
        title: 'The Color Stripping Myth',
        hook: 'The #1 shampoo mistake that strips your expensive salon color in less than 3 washes (and how to fix it)!',
        objective: 'Drives high-ticket color and treatment bookings.'
      },
      {
        title: 'HydraFacial vs Chemical Peel',
        hook: 'HydraFacial vs Medical Chemical Peel: Which one does your skin actually need before you spend $200+?',
        objective: 'Converts aesthetic skincare packages.'
      },
      {
        title: 'The Cheap Extension Trap',
        hook: 'Why booking cheap lash extensions ends up costing 3x more in damaged natural lashes and corrective work.',
        objective: 'Establishes premium salon pricing authority.'
      }
    ]
  },
  fitness: {
    id: 'fitness',
    label: 'Gym, Fitness Center & Personal Training Studio',
    icon: '🏋️',
    badge: '🏋️',
    reportTitle: '🏋️ GYM MEMBERSHIP & CLIENT ACQUISITION BLUEPRINT',
    reportSubtitle: 'Head Coach Authority & 24/7 Membership Intake Engine',
    roleLabel: 'Founder / Head Coach / Studio Director',
    customerTerm: 'Members & Training Clients',
    customerSingular: 'Member',
    placeTerm: 'Gym, Fitness Center & Studio',
    timingLabel: 'Operating & Coaching Hours',
    feeLabel: 'Monthly Membership / PT Rate',
    conversionTerm: 'New Membership Trials & PT Signups',
    vulnerability: 'Membership Churn & Local Coach Authority Deficit: Local fitness enthusiasts join gyms whose head coaches demonstrate form, debunk nutrition fads, and showcase real member PRs on Reels. Gyms posting stock photos suffer from high member turnover.',
    avatarBenefit: 'Coaches need their energy for floor coaching and programming. Your AI Avatar breaks down exercise technique, meal prep secrets, and mindset tips automatically.',
    filePrefix: 'growth-blueprint-fitness',
    defaultHooks: [
      {
        title: 'The Spine-Wrecking Exercise',
        hook: '3 gym exercises people over 30 do that secretly wreck their lower back and knees (and the safe alternatives)!',
        objective: 'Drives personal training and mobility consultations.'
      },
      {
        title: 'Protein Powder vs Real Food',
        hook: 'The honest truth about whey protein supplements vs whole food that supplement brands spend millions to hide.',
        objective: 'Builds supreme coach trust and viral reach.'
      },
      {
        title: 'The 15-Minute Fat Loss Secret',
        hook: 'Struggling to lose stubborn belly fat? The 15-minute metabolic routine that burns 2x more fat than endless cardio.',
        objective: 'Converts trial passes and transformation challenges.'
      }
    ]
  },
  towing: {
    id: 'towing',
    label: 'Emergency Towing, Auto Repair & Fleet Services',
    icon: '🚗',
    badge: '🚗',
    reportTitle: '🚗 24/7 EMERGENCY DISPATCH & FLEET BLUEPRINT',
    reportSubtitle: 'Instant Dispatch Automation & Local Maps Dominance',
    roleLabel: 'Fleet Owner / Operations Director / Dispatch Manager',
    customerTerm: 'Stranded Drivers & Commercial Fleet Accounts',
    customerSingular: 'Customer / Driver',
    placeTerm: 'Dispatch Center & Fleet Facility',
    timingLabel: '24/7 Dispatch Operations',
    feeLabel: 'Average Tow / Service Hookup Rate',
    conversionTerm: 'Emergency Dispatch Runs & Fleet Accounts',
    vulnerability: 'Missed Dispatch & Lead Ghosting: When drivers stall on the road, 94% call the first 3-pack Google Maps listing that answers immediately. If dispatch takes > 60 seconds to respond, drivers instantly call your competitor.',
    avatarBenefit: 'Operations directors are managing drivers and dispatch trucks. Your AI Avatar builds community trust with roadside safety tips, accident procedures, and commercial fleet onboarding videos on autopilot.',
    filePrefix: 'growth-blueprint-towing',
    defaultHooks: [
      {
        title: 'The Roadside Highway Rule',
        hook: 'What to do IMMEDIATELY if your car stalls on the highway at night (before calling a tow truck)!',
        objective: 'High viral safety reach; saves your phone number in their contacts.'
      },
      {
        title: 'The Insurance Invalidation Trap',
        hook: 'The 1 roadside towing mistake that insurance companies use to reject accident claims on the spot.',
        objective: 'Positions your company as the #1 trusted local operator.'
      },
      {
        title: 'Commercial Fleet Downtime',
        hook: 'Why commercial fleet managers lose $5,000+ a month by relying on unvetted third-party dispatch apps.',
        objective: 'Secures high-value recurring B2B fleet contracts.'
      }
    ]
  },
  home_services: {
    id: 'home_services',
    label: 'Home Services (Plumbing, HVAC, Roofing, Electrical)',
    icon: '🛠️',
    badge: '🛠️',
    reportTitle: '🛠️ CONTRACTOR GROWTH BLUEPRINT & DISPATCH AUDIT',
    reportSubtitle: 'Master Contractor Video Trust & 24/7 AI Estimate Dispatch',
    roleLabel: 'Owner / Master Contractor / General Manager',
    customerTerm: 'Homeowners & Property Managers',
    customerSingular: 'Homeowner',
    placeTerm: 'Contracting Company & Service Center',
    timingLabel: 'Service Dispatch & Estimate Hours',
    feeLabel: 'Average Job / Replacement Ticket',
    conversionTerm: 'Booked Estimates & Completed Service Calls',
    vulnerability: 'Contractor Lead Leakage & Review Stagnation: Homeowners terrified of contractor scams require visual proof and explanation videos before approving $3,000–$15,000 repairs. Contractors without video presence lose high-margin replacements to national franchises.',
    avatarBenefit: 'Master contractors are on jobsites or quoting estimates all day. Your AI Avatar educates homeowners on repair warning signs, maintenance tips, and estimate transparency without taking you off the tools.',
    filePrefix: 'growth-blueprint-contractor',
    defaultHooks: [
      {
        title: 'The Water Heater Warning',
        hook: 'The subtle warning sign behind your water heater that means it could burst and flood your basement this week!',
        objective: 'Drives urgent high-ticket emergency replacement calls.'
      },
      {
        title: 'The HVAC Sales Scam',
        hook: '3 sales tricks dishonest technicians use to convince homeowners they need a whole new HVAC unit when a $50 capacitor fixes it.',
        objective: 'Establishes unmatched ethical authority and trust.'
      },
      {
        title: 'The 5-Minute Roof Check',
        hook: 'Before spending $12,000 on a new roof: The 5-minute visual inspection that could save you thousands.',
        objective: 'Captures high-ticket roofing and storm restoration jobs.'
      }
    ]
  },
  b2b_consulting: {
    id: 'b2b_consulting',
    label: 'B2B Consulting, Financial Advisory & CA Practices',
    icon: '💼',
    badge: '💼',
    reportTitle: '💼 B2B REVENUE ACCELERATION & FOUNDER BLUEPRINT',
    reportSubtitle: 'Founder Authority AI Video Engine & High-Ticket Client Funnel',
    roleLabel: 'Founder / Managing Director / Principal Consultant',
    customerTerm: 'Corporate Clients & Business Owners',
    customerSingular: 'Client',
    placeTerm: 'Firm / Advisory Practice',
    timingLabel: 'Client Advisory & Strategy Hours',
    feeLabel: 'Average Retainer / Project Fee',
    conversionTerm: 'Discovery Calls & Retained Engagements',
    vulnerability: 'Founder Invisibility Trap & Passive Referral Trap: High-value corporate clients and founders hire consultants whose framework breakdowns and industry insights they consume on LinkedIn and YouTube. Relying exclusively on referrals limits growth to 5–10% annually.',
    avatarBenefit: 'Founders have zero free time to spend in studios scripting video. Your AI Avatar shares thought leadership, case study breakdowns, and tactical teardowns on autopilot.',
    filePrefix: 'growth-blueprint-b2b',
    defaultHooks: [
      {
        title: 'The Overlooked Tax Deduction',
        hook: 'The legal tax deduction that 85% of profitable business owners miss every single year (costing them $20,000+)!',
        objective: 'Drives corporate tax and financial advisory bookings.'
      },
      {
        title: 'The Proposal Closing Secret',
        hook: 'Why your B2B proposals take 3+ weeks to close (and the 1 change in your pitch deck that closes them in 48 hours).',
        objective: 'Fills discovery call pipeline with high-intent founders.'
      },
      {
        title: 'The Partnership Deadlock Clause',
        hook: '3 critical clauses every founder must include before signing any vendor or partner contract.',
        objective: 'Converts corporate consulting retainers.'
      }
    ]
  },
  hospitality: {
    id: 'hospitality',
    label: 'Restaurant, Cafe, Fine Dining & Hospitality',
    icon: '🍽️',
    badge: '🍽️',
    reportTitle: '🍽️ RESTAURANT REVENUE & GUEST ACQUISITION BLUEPRINT',
    reportSubtitle: 'Culinary Viral Reel Engine & 24/7 WhatsApp Table Booking',
    roleLabel: 'Restaurateur / Head Chef / General Manager',
    customerTerm: 'Diners & Event Guests',
    customerSingular: 'Diner',
    placeTerm: 'Restaurant, Cafe & Venue',
    timingLabel: 'Kitchen & Service Hours',
    feeLabel: 'Average Table / Cover Spend',
    conversionTerm: 'Table Reservations & Private Event Bookings',
    vulnerability: 'Static Menu Syndrome & Delivery App Commission Drain: Modern diners choose where to eat based on mouth-watering behind-the-scenes preparation Reels on Instagram. Aggregator delivery apps eat 25%–30% of your margins unless you own your customer communication.',
    avatarBenefit: 'Chefs and managers are swamped during prep and service. Your AI Avatar presents weekly signature specials, wine pairings, and chef techniques on autopilot.',
    filePrefix: 'growth-blueprint-dining',
    defaultHooks: [
      {
        title: 'The 14-Hour Braise Secret',
        hook: 'The culinary secret behind our 14-hour slow-braised signature dish that regulars obsess over!',
        objective: 'Viral foodie reach; fills weekend table reservations.'
      },
      {
        title: 'The Delivery App Tax',
        hook: 'Why third-party delivery apps cost you 30% more (and the secret VIP perk when booking a table direct).',
        objective: 'Converts app users to high-margin direct dine-in guests.'
      },
      {
        title: 'The Chef Seafood Rule',
        hook: 'Inside the kitchen: 3 ingredients top culinary chefs NEVER use when preparing fresh seafood.',
        objective: 'Positions restaurant as the peak culinary standard in the city.'
      }
    ]
  },
  general: {
    id: 'general',
    label: 'Local Retail, E-Commerce & Commercial Services',
    icon: '📈',
    badge: '📈',
    reportTitle: '📈 LOCAL BUSINESS GROWTH & REVENUE BLUEPRINT',
    reportSubtitle: 'Founder Video Authority & 24/7 AI Lead Capture Protocol',
    roleLabel: 'Business Owner / Founder / Director',
    customerTerm: 'Customers & Clients',
    customerSingular: 'Customer',
    placeTerm: 'Business / Company',
    timingLabel: 'Business Operating Hours',
    feeLabel: 'Average Customer Ticket / Order',
    conversionTerm: 'Customer Inquiries & Sales Conversions',
    vulnerability: 'Local Market Invisibility & Static Digital Footprint: 88% of local buyers check mobile video reviews and business owner explanations before making a purchase. Businesses with zero owner presence lose sales to digital-first competitors.',
    avatarBenefit: 'Owners are busy managing staff, inventory, and operations. Your AI Avatar answers customer FAQs, explains your unique value proposition, and runs daily promotions without filming.',
    filePrefix: 'growth-blueprint',
    defaultHooks: [
      {
        title: 'The Local Buyer Checklist',
        hook: '3 things smart customers check before choosing a service provider in our city!',
        objective: 'High local viral reach and brand trust.'
      },
      {
        title: 'The Google Review Secret',
        hook: 'Why 90% of buyers check Google reviews on mobile before spending money locally.',
        objective: 'Positions your company as the local market leader.'
      },
      {
        title: 'The 60-Second Customer Response',
        hook: 'The customer service automation that saves 10 hours a week and doubles repeat buyers.',
        objective: 'Captures high-value client consultations.'
      }
    ]
  }
};

/**
 * Intelligently detects the niche archetype from any string input.
 */
export function detectNiche(str = '') {
  const s = String(str || '').toLowerCase().trim();
  if (!s) return 'general';

  if (s.includes('dent') || s.includes('oral') || s.includes('implant') || s.includes('smile') ||
      s.includes('derma') || s.includes('skin') || s.includes('doctor') || s.includes('clinic') || 
      s.includes('ortho') || s.includes('eye') || s.includes('hospital') || s.includes('medic') || 
      s.includes('pediatric') || s.includes('physio') || s.includes('health') || s.includes('pharma') ||
      s.includes('chiro') || s.includes('surgeon')) {
    return 'medical';
  }
  if (s.includes('law') || s.includes('attorney') || s.includes('legal') || s.includes('advocate') || 
      s.includes('solicitor') || s.includes('barrister') || s.includes('court') || s.includes('litigat') ||
      s.includes('counsel')) {
    return 'legal';
  }
  if (s.includes('real estate') || s.includes('realt') || s.includes('property') || s.includes('estate') || 
      s.includes('brokerage') || s.includes('housing') || s.includes('builder') || s.includes('developer') ||
      s.includes('commercial realty')) {
    return 'real_estate';
  }
  if (s.includes('salon') || s.includes('spa') || s.includes('beauty') || s.includes('hair') || 
      s.includes('aesthetic') || s.includes('nail') || s.includes('makeup') || s.includes('barber') ||
      s.includes('cosmetolog') || s.includes('skincare')) {
    return 'beauty';
  }
  if (s.includes('gym') || s.includes('fitness') || s.includes('crossfit') || s.includes('yoga') || 
      s.includes('pilates') || s.includes('workout') || s.includes('trainer') || s.includes('coach') ||
      s.includes('martial art') || s.includes('boxing')) {
    return 'fitness';
  }
  if (s.includes('tow') || s.includes('roadside') || s.includes('wrecker') || s.includes('recovery') || 
      s.includes('auto repair') || s.includes('mechanic') || s.includes('garage') || s.includes('tire') ||
      s.includes('collision') || s.includes('auto body')) {
    return 'towing';
  }
  if (s.includes('plumb') || s.includes('hvac') || s.includes('roof') || s.includes('electric') || 
      s.includes('contractor') || s.includes('pest') || s.includes('solar') || s.includes('clean') ||
      s.includes('handyman') || s.includes('paint') || s.includes('home improvement') || s.includes('landscap')) {
    return 'home_services';
  }
  if (s.includes('consult') || s.includes('account') || s.includes('tax') || s.includes('financial') || 
      s.includes('wealth') || s.includes('cpa') || s.includes('chartered') || s.includes('agency') || 
      s.includes('marketing') || s.includes('software') || s.includes('b2b') || s.includes('advisory')) {
    return 'b2b_consulting';
  }
  if (s.includes('restaurant') || s.includes('cafe') || s.includes('bistro') || s.includes('dining') || 
      s.includes('food') || s.includes('bakery') || s.includes('bar') || s.includes('catering') ||
      s.includes('hospitality') || s.includes('pizzeria')) {
    return 'hospitality';
  }
  return 'general';
}

export const scorecardQuestions = [
  {
    id: 'business_type',
    category: 'profile',
    title: '1. What is the nature and niche of your business or practice?',
    subtitle: 'This customizes your industry benchmarks, diagnostic vulnerability report, and niche-specific AI Reel hooks.',
    options: [
      { id: 'medical', label: 'Doctor / Medical, Dental & Specialty Healthcare Clinic', icon: '🩺', niche: 'medical' },
      { id: 'legal', label: 'Legal Practice, Law Firm & Attorneys', icon: '⚖️', niche: 'legal' },
      { id: 'real_estate', label: 'Real Estate Agency, Realtor & Property Brokerage', icon: '🏡', niche: 'real_estate' },
      { id: 'beauty', label: 'Luxury Salon, Spa & Aesthetic Wellness Studio', icon: '✨', niche: 'beauty' },
      { id: 'fitness', label: 'Gym, Fitness Center & Personal Training Studio', icon: '🏋️', niche: 'fitness' },
      { id: 'towing', label: 'Emergency Towing, Auto Repair & Fleet Services', icon: '🚗', niche: 'towing' },
      { id: 'home_services', label: 'Home Services (Plumbing, HVAC, Roofing, Electrician)', icon: '🛠️', niche: 'home_services' },
      { id: 'b2b_consulting', label: 'B2B Consulting, Chartered Accountant & Financial Advisory', icon: '💼', niche: 'b2b_consulting' },
      { id: 'hospitality', label: 'Restaurant, Cafe, Fine Dining & Hospitality', icon: '🍽️', niche: 'hospitality' },
      { id: 'general', label: 'Local Retail, E-Commerce & Commercial Services', icon: '📈', niche: 'general' }
    ]
  },
  {
    id: 'discovery_source',
    category: 'discovery',
    title: '2. How do 80%+ of your new clients, patients, or customers currently find you?',
    subtitle: 'Diagnoses your referral vulnerability and reliance on third-party aggregator commissions.',
    options: [
      { id: 'word_of_mouth', label: 'Word of mouth and walk-ins only (No digital customer acquisition engine)', points: 20, icon: '🗣️' },
      { id: 'practo_broker', label: 'Heavy reliance on aggregator directories (Justdial, Practo, Zillow, Angi, etc. taking commissions)', points: 35, icon: '🏷️' },
      { id: 'maps_unclaimed', label: 'Google Maps, but few reviews (< 30) or unoptimized local 3-pack ranking', points: 45, icon: '📍' },
      { id: 'maps_active', label: 'Established Google Maps (50+ reviews, 4.5★+), but zero founder video trust engine', points: 70, icon: '⭐' },
      { id: 'omnichannel', label: 'Omni-channel: Dominant Google Maps, founder video brand authority & active referral loops', points: 95, icon: '🚀' }
    ]
  },
  {
    id: 'video_presence',
    category: 'video',
    title: '3. How frequently does the Business Owner, Doctor, or Principal publish face-to-camera educational video Reels?',
    subtitle: 'Video is the #1 trust factor. Over 82% of prospective buyers research the owner\'s demeanor and service explanations before buying.',
    options: [
      { id: 'never_static_only', label: 'Never. We only post static flyers, holiday banners, or stock photos', points: 10, icon: '🚫', diagnosis: 'Severe Static Graphic Syndrome' },
      { id: 'rarely', label: 'Attempted 1–2 times, but scriptwriting, lighting, and busy hours caused immediate burnout', points: 30, icon: '⏳', diagnosis: 'Acute Video Filming Burnout' },
      { id: 'irregular', label: 'Irregularly on smartphone whenever there is free time, but frequency & quality are inconsistent', points: 55, icon: '🎥', diagnosis: 'Inconsistent Video Cadence' },
      { id: 'weekly_reels', label: 'Consistently publishing 3–4 high-definition educational video Reels every single week', points: 95, icon: '🔥', diagnosis: 'Dominant Video Footprint' }
    ]
  },
  {
    id: 'maps_dominance',
    category: 'discovery',
    title: '4. When local prospects search for your service on Google Maps, where do you rank?',
    subtitle: 'Measures local intent capture vs. competitor leakage in your immediate city.',
    options: [
      { id: 'outside_top3', label: 'Hidden below competitors or outside the top 3 Google Maps pack', points: 25, icon: '📉' },
      { id: 'top3_declining', label: 'Ranked in the top 3, but newer competitors are surging ahead with fresh weekly reviews', points: 60, icon: '⚠️' },
      { id: 'dominant_top3', label: 'Firmly #1 in the local 3-pack with 100+ 5-star reviews and weekly photo updates', points: 95, icon: '👑' }
    ]
  },
  {
    id: 'lead_response_speed',
    category: 'conversion',
    title: '5. When a prospective lead inquires on WhatsApp or Instagram after operating hours (7 PM–10 PM), what happens?',
    subtitle: '84% of mobile inquiries convert with whoever responds and confirms details within 5 minutes.',
    options: [
      { id: 'slow_manual', label: 'Inquiries sit unattended until the next morning (prospect reaches out to a competitor)', points: 20, icon: '🐌', diagnosis: 'Severe After-Hours Lead Leakage' },
      { id: 'receptionist_hours', label: 'Staff replies manually during business hours only (after-hours inquiries leak)', points: 45, icon: '📞', diagnosis: 'Business-Hours Conversion Blindspot' },
      { id: 'quick_manual', label: 'Team responds within 20–30 minutes during normal operating hours', points: 70, icon: '⚡', diagnosis: 'Semi-Automated Intake' },
      { id: 'instant_ai_bot', label: 'Instant 24/7 AI WhatsApp bot answers service questions & books appointments immediately', points: 98, icon: '🤖', diagnosis: 'Zero Lead Leakage' }
    ]
  },
  {
    id: 'patient_recall',
    category: 'conversion',
    title: '6. What is your system for customer retention, Google review velocity, and repeat business?',
    subtitle: 'Evaluates customer lifetime value (LTV) and organic reputation velocity.',
    options: [
      { id: 'no_system', label: 'No structured system. Customers complete their service and rarely return unless reminded', points: 25, icon: '❌' },
      { id: 'manual_staff', label: 'Staff occasionally calls or sends manual WhatsApp reminder texts', points: 55, icon: '📋' },
      { id: 'automated_recall', label: 'Automated WhatsApp retention sequences driving 5-star Google reviews and routine repeat bookings', points: 95, icon: '🔄' }
    ]
  },
  {
    id: 'ai_avatar_interest',
    category: 'avatar',
    title: '7. Would you implement a Cloned Founder/Owner AI Avatar to publish 15+ educational Reels/month with ZERO filming time?',
    subtitle: 'Our AI clones your face and voice from one 2-minute phone recording. You never need to stand in front of a camera again.',
    options: [
      { id: 'urgent_yes', label: 'Crucial need! Our time is strictly for running operations and servicing clients—we must have video without filming', fitScore: 100, icon: '🚀' },
      { id: 'interested_sample', label: 'Very interested—I want to preview a pre-rendered 45-second AI avatar sample in my voice first', fitScore: 90, icon: '💡' },
      { id: 'exploring', label: 'Curious to understand how AI avatar voice cloning works and builds local client trust', fitScore: 75, icon: '🤔' }
    ]
  },
  {
    id: 'growth_target',
    category: 'growth',
    title: '8. What is your target for new high-ticket clients, patients, or customer acquisitions every month?',
    subtitle: 'Calibrates your business ROI forecast and service delivery capacity.',
    options: [
      { id: 'target_10', label: '+10 to 15 new high-ticket clients / month (Steady Business Growth)', icon: '🌱' },
      { id: 'target_30', label: '+25 to 40 new high-ticket clients / month (Rapid Revenue Scaling)', icon: '📈' },
      { id: 'target_50', label: '+50+ high-value customer acquisitions / month (Regional Market Dominance)', icon: '👑' }
    ]
  }
];

export class ScorecardEngine {
  /**
   * Calculates diagnostic scores from submitted questionnaire answers.
   */
  static calculateScores(answers = {}) {
    // 1. Video & Reels Score (40% weight)
    const videoAns = answers.video_presence;
    let videoScore = 20;
    if (videoAns === 'never_static_only') videoScore = 12;
    else if (videoAns === 'rarely') videoScore = 30;
    else if (videoAns === 'irregular') videoScore = 55;
    else if (videoAns === 'weekly_reels') videoScore = 95;

    // 2. Local Discovery & Google Maps Score (30% weight)
    const discAns = answers.discovery_source;
    let discoveryScore = 30;
    if (discAns === 'word_of_mouth') discoveryScore = 20;
    else if (discAns === 'practo_broker') discoveryScore = 35;
    else if (discAns === 'maps_unclaimed') discoveryScore = 45;
    else if (discAns === 'maps_active') discoveryScore = 70;
    else if (discAns === 'omnichannel') discoveryScore = 95;

    const mapsAns = answers.maps_dominance;
    if (mapsAns === 'outside_top3') discoveryScore = Math.min(discoveryScore, 40);
    else if (mapsAns === 'dominant_top3') discoveryScore = Math.max(discoveryScore, 85);

    // 3. Lead Conversion & Response Speed Score (30% weight)
    const respAns = answers.lead_response_speed;
    let conversionScore = 35;
    if (respAns === 'slow_manual') conversionScore = 20;
    else if (respAns === 'receptionist_hours') conversionScore = 45;
    else if (respAns === 'quick_manual') conversionScore = 70;
    else if (respAns === 'instant_ai_bot') conversionScore = 98;

    const recallAns = answers.patient_recall;
    if (recallAns === 'automated_recall') conversionScore = Math.min(100, conversionScore + 10);
    else if (recallAns === 'no_system') conversionScore = Math.max(15, conversionScore - 10);

    // Overall Weighted Score (0 - 100)
    const overallScore = Math.round((videoScore * 0.40) + (discoveryScore * 0.30) + (conversionScore * 0.30));

    let grade = 'C';
    let statusSummary = 'Moderate Risk';
    if (overallScore < 35) {
      grade = 'Critical';
      statusSummary = 'Acute Customer Leakage & Invisible Video Presence';
    } else if (overallScore < 55) {
      grade = 'Needs Immediate Attention';
      statusSummary = 'Static Graphic Syndrome & High Competitor Vulnerability';
    } else if (overallScore < 75) {
      grade = 'Developing';
      statusSummary = 'Good Local Base, Missing AI Video Scaling Engine';
    } else {
      grade = 'Optimized';
      statusSummary = 'Strong Digital Engine, Ready for AI Avatar Scale';
    }

    return {
      overallScore,
      videoScore,
      discoveryScore,
      conversionScore,
      grade,
      statusSummary
    };
  }

  /**
   * Synthesizes an authentic Growth Prescription / Blueprint customized by business niche.
   */
  static generatePrescription({
    businessName,
    contactPerson,
    businessType,
    city,
    consultationFee,
    workTiming,
    scores,
    answers = {},
    topmateUrl = 'https://topmate.io/isurajjaiswal',
    agencyName = 'The Digital Frog',
    founderName = 'Suraj Jaiswal'
  }) {
    const cleanCity = city || 'your local area';
    const cleanBusiness = businessName || 'Your Business';
    const rawType = answers.business_type || businessType || '';
    const nicheKey = detectNiche(rawType || cleanBusiness);
    const profile = NICHE_REGISTRY[nicheKey] || NICHE_REGISTRY.general;

    // Contact person formatting
    let cleanPerson = (contactPerson || '').trim();
    if (!cleanPerson || cleanPerson.toLowerCase() === 'director' || cleanPerson.toLowerCase() === 'doctor') {
      cleanPerson = profile.roleLabel;
    }
    if (nicheKey === 'medical' && !cleanPerson.match(/^(?:dr\.?|doctor)\b/i)) {
      cleanPerson = `Dr. ${cleanPerson}`;
    }

    // Tailored Diagnosis
    let diagnosticSymptom = '';
    if (scores.videoScore <= 35) {
      diagnosticSymptom = profile.vulnerability;
    } else if (scores.conversionScore <= 50) {
      diagnosticSymptom = `Speed-to-Lead Vulnerability: Inquiries take over 30 minutes to receive an answer. Modern ${profile.customerTerm.toLowerCase()} browse 3 local competitors simultaneously on mobile—the first provider to answer via instant WhatsApp wins 70%+ of the business.`;
    } else {
      diagnosticSymptom = `Production Burnout Syndrome: You recognize the power of short-form video, but recording and editing content takes hours away from revenue-generating operations.`;
    }

    // Tailored Hooks
    const reelHooks = profile.defaultHooks;

    // Format Report Text
    const isMed = (nicheKey === 'medical');
    const headerTitle = profile.reportTitle;
    const caseRef = `#${profile.badge.replace(/[^a-zA-Z0-9]/g, '') || 'AUDIT'}-${Math.floor(1000 + Math.random() * 9000)}-${nicheKey.toUpperCase()}`;

    const reportText = `Subject: ${isMed ? '℞ Clinical Growth Prescription' : '📈 Growth Blueprint & Audit'} for ${cleanPerson} | ${cleanBusiness}

${headerTitle}
══════════════════════════════════════════════════════════════════════════
${isMed ? 'DOCTOR / DIRECTOR' : 'PRINCIPAL / OWNER'}: ${cleanPerson}
${isMed ? 'CLINIC / PRACTICE' : 'BUSINESS / FIRM'} : ${cleanBusiness} (${cleanCity})
INDUSTRY NICHE    : ${profile.label}
DIGITAL HEALTH    : ${scores.overallScore}/100 (${scores.grade.toUpperCase()} - ${scores.statusSummary})
DIAGNOSTIC CASE REF: ${caseRef}
══════════════════════════════════════════════════════════════════════════

DEAR ${cleanPerson.toUpperCase()},

Thank you for completing your 2-minute Digital Health Diagnostic. Based on your business profile, here is your customized growth diagnosis and AI treatment protocol:

1. DIAGNOSTIC FINDING & LOCAL VULNERABILITY:
• Overall Health Score: ${scores.overallScore}/100
  - Video & Reels Authority: ${scores.videoScore}/100
  - Local Discovery & Maps : ${scores.discoveryScore}/100
  - Lead Response Speed    : ${scores.conversionScore}/100
• Primary Diagnosis: ${diagnosticSymptom}

2. PRESCRIBED AI TREATMENT PROTOCOL:
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 1: ${isMed ? 'DOCTOR\'S' : 'FOUNDER\'S'} AI DIGITAL AVATAR & VOICE CLONING                  │
│ • Requirement: Record a 2-minute reference video on your phone ONCE.    │
│ • Execution: We clone your likeness, cadence, and vocal expressions.    │
│ • Benefit: ${profile.avatarBenefit.slice(0, 70)}... │
├─────────────────────────────────────────────────────────────────────────┤
│ STEP 2: 12–16 VIRAL ${profile.customerSingular.toUpperCase()} EDUCATION REELS / MONTH                  │
│ • Scripting: Debunking industry myths, addressing fears, and pricing.   │
│ • Channels: Optimized for Instagram Reels, YouTube Shorts, and Facebook.│
│ • Target: Establish ${cleanPerson} as the undisputed #1 authority.      │
├─────────────────────────────────────────────────────────────────────────┤
│ STEP 3: 24/7 AI ${isMed ? 'CLINIC' : 'BUSINESS'} WHATSAPP LEAD CAPTURE ENGINE                 │
│ • When viewers comment on your Reels, AI instantly sends your booking   │
│   link and confirms qualified appointments day or night.                │
└─────────────────────────────────────────────────────────────────────────┘

3. SAMPLE REEL HOOKS PRESCRIBED FOR ${cleanBusiness.toUpperCase()}:
• Hook #1: "${reelHooks[0].hook}" (${reelHooks[0].objective})
• Hook #2: "${reelHooks[1].hook}" (${reelHooks[1].objective})
• Hook #3: "${reelHooks[2].hook}" (${reelHooks[2].objective})

4. EXPECTED 60-DAY PROGNOSIS:
• 3.5x to 5x increase in qualified ${profile.customerTerm.toLowerCase()} inquiries.
• Zero operating hours sacrificed to filming or manual video editing.
• Lifelong digital brand equity and local authority in ${cleanCity}.

5. NEXT STEP & CALENDAR BRIEFING:
We know your schedule is strictly reserved for running your business and serving ${profile.customerTerm.toLowerCase()}.
We have reserved slots for a 10-minute AI Avatar Demonstration & Strategy Session.

📅 Book your 1-on-1 Growth Diagnostic Call on Topmate:
👉 ${topmateUrl}

${profile.timingLabel} Noted: ${workTiming || 'Regular Business Hours'}
${profile.feeLabel} Noted   : ${consultationFee || 'Standard Service Rate'}

Prepared by:
${founderName}
Founder & AI Growth Strategist | ${agencyName}`;

    return {
      niche: nicheKey,
      nicheProfile: profile,
      scores,
      prescriptionText: reportText,
      diagnosticSymptom,
      reelHooks,
      topmateUrl,
      agencyName,
      founderName
    };
  }
}
