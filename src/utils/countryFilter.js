/**
 * CountryFilter - Strict Targeting & Currency Policy Enforcement
 * 
 * Policy:
 * Under NO circumstances do we target or ingest leads from low-currency or
 * excluded territories:
 * - Bangladesh (+880, .bd)
 * - Pakistan (+92, .pk)
 * - Bhutan (+975, .bt)
 * - Nepal (+977, .np)
 * - Sri Lanka (+94, .lk)
 * - Afghanistan (+93, .af)
 */

export const EXCLUDED_COUNTRIES = [
  { name: 'Bangladesh', code: 'BD', dial: '+880', tld: '.bd', cities: ['dhaka', 'chittagong', 'sylhet', 'khulna', 'rajshahi'] },
  { name: 'Pakistan', code: 'PK', dial: '+92', tld: '.pk', cities: ['karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad', 'peshawar', 'quetta', 'multan'] },
  { name: 'Bhutan', code: 'BT', dial: '+975', tld: '.bt', cities: ['thimphu', 'phuntsholing', 'paro', 'punakha'] },
  { name: 'Nepal', code: 'NP', dial: '+977', tld: '.np', cities: ['kathmandu', 'pokhara', 'lalitpur', 'biratnagar', 'bharatpur'] },
  { name: 'Sri Lanka', code: 'LK', dial: '+94', tld: '.lk', cities: ['colombo', 'kandy', 'galle', 'jaffna', 'negombo'] },
  { name: 'Afghanistan', code: 'AF', dial: '+93', tld: '.af', cities: ['kabul', 'kandahar', 'herat', 'mazar'] }
];

const EXCLUDED_NAMES = EXCLUDED_COUNTRIES.map(c => c.name.toLowerCase());
const EXCLUDED_DIALS = EXCLUDED_COUNTRIES.map(c => c.dial);
const EXCLUDED_TLDS = EXCLUDED_COUNTRIES.map(c => c.tld.toLowerCase());
const EXCLUDED_CITIES = EXCLUDED_COUNTRIES.flatMap(c => c.cities);

/**
 * Checks if a string, phone, city, address, or URL matches any blacklisted country.
 * Returns { excluded: boolean, reason: string|null, country: string|null }
 */
export function checkCountryExclusion({ text = '', phone = '', address = '', city = '', url = '' } = {}) {
  const combinedText = `${text} ${address} ${city}`.toLowerCase();
  const cleanPhone = (phone || '').replace(/[\s\-\(\)]/g, '');
  const cleanUrl = (url || '').toLowerCase();

  // 1. Check dial code
  for (const c of EXCLUDED_COUNTRIES) {
    if (cleanPhone.startsWith(c.dial) || cleanPhone.startsWith(c.dial.replace('+', '00')) || cleanPhone.startsWith(c.dial.replace('+', ''))) {
      return { excluded: true, reason: `Excluded country dial code (${c.dial} - ${c.name})`, country: c.name };
    }
  }

  // 2. Check country name in address or text
  for (const c of EXCLUDED_COUNTRIES) {
    const regex = new RegExp(`\\b${c.name.toLowerCase()}\\b`, 'i');
    if (regex.test(combinedText)) {
      return { excluded: true, reason: `Targeting policy excludes ${c.name}`, country: c.name };
    }
  }

  // 3. Check major blacklisted cities
  for (const cityName of EXCLUDED_CITIES) {
    const cityRegex = new RegExp(`\\b${cityName}\\b`, 'i');
    if (cityRegex.test(combinedText)) {
      const matchCountry = EXCLUDED_COUNTRIES.find(c => c.cities.includes(cityName))?.name || 'Excluded Region';
      return { excluded: true, reason: `Targeting policy excludes city ${cityName} (${matchCountry})`, country: matchCountry };
    }
  }

  // 4. Check domain TLD
  for (const tld of EXCLUDED_TLDS) {
    if (cleanUrl.includes(tld + '/') || cleanUrl.endsWith(tld)) {
      const matchCountry = EXCLUDED_COUNTRIES.find(c => c.tld.toLowerCase() === tld)?.name || 'Excluded Region';
      return { excluded: true, reason: `Targeting policy excludes domain extension ${tld} (${matchCountry})`, country: matchCountry };
    }
  }

  return { excluded: false, reason: null, country: null };
}

/**
 * Validates a search query and location to ensure targeting policy is respected.
 */
export function validateSearchTargeting(query = '', location = '') {
  const check = checkCountryExclusion({ text: `${query} ${location}`, city: location });
  if (check.excluded) {
    return {
      allowed: false,
      error: `⛔ Targeting Restricted: ${check.reason}. We exclusively target tier-1 high-value markets (US, UK, Canada, Australia, UAE, Europe, India).`
    };
  }
  return { allowed: true };
}
