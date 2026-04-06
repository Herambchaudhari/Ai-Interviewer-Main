/**
 * Company sectors and companies for onboarding target selection.
 * Used in OnboardingPage, SettingsPage, DashboardPage, and ReportPage.
 */

export const COMPANY_SECTORS = [
  {
    id: 'it_services',
    label: 'IT Services',
    icon: '🖥️',
    color: '#5b5ef6',
    colorLight: 'rgba(91,94,246,0.08)',
    colorBorder: 'rgba(91,94,246,0.25)',
    description: 'Mass recruiters — TCS, Infosys, Wipro, HCL',
    companies: ['TCS', 'Infosys', 'Wipro', 'HCL', 'Tech Mahindra', 'Cognizant', 'Capgemini', 'Accenture', 'Mphasis', 'LTIMindtree'],
  },
  {
    id: 'product_maang',
    label: 'Product / MAANG',
    icon: '🚀',
    color: '#06b6d4',
    colorLight: 'rgba(6,182,212,0.08)',
    colorBorder: 'rgba(6,182,212,0.25)',
    description: 'Top product companies — Google, Microsoft, Amazon',
    companies: ['Google', 'Microsoft', 'Amazon', 'Meta', 'Adobe', 'Salesforce', 'Apple', 'Netflix', 'Atlassian', 'Intuit'],
  },
  {
    id: 'startups',
    label: 'Startups',
    icon: '⚡',
    color: '#f59e0b',
    colorLight: 'rgba(245,158,11,0.08)',
    colorBorder: 'rgba(245,158,11,0.25)',
    description: 'High-growth Indian & global startups',
    companies: ['Razorpay', 'Zepto', 'CRED', 'PhonePe', 'Swiggy', 'Zomato', 'Meesho', 'Groww', 'Ola', 'Paytm', 'Dunzo', 'Slice'],
  },
  {
    id: 'psu_govt',
    label: 'PSU / Government',
    icon: '🏛️',
    color: '#10b981',
    colorLight: 'rgba(16,185,129,0.08)',
    colorBorder: 'rgba(16,185,129,0.25)',
    description: 'Public sector & government organisations',
    companies: ['ISRO', 'DRDO', 'BHEL', 'ONGC', 'NTPC', 'BEL', 'BSNL', 'HAL', 'IOCL', 'GAIL'],
  },
  {
    id: 'bfsi_fintech',
    label: 'BFSI / Fintech',
    icon: '💳',
    color: '#ec4899',
    colorLight: 'rgba(236,72,153,0.08)',
    colorBorder: 'rgba(236,72,153,0.25)',
    description: 'Banking, finance & fintech companies',
    companies: ['Goldman Sachs', 'JPMorgan', 'Barclays', 'Deutsche Bank', 'BNY Mellon', 'Fidelity', 'Visa', 'Mastercard', 'Morgan Stanley', 'Citi'],
  },
  {
    id: 'consulting',
    label: 'Consulting',
    icon: '📊',
    color: '#8b5cf6',
    colorLight: 'rgba(139,92,246,0.08)',
    colorBorder: 'rgba(139,92,246,0.25)',
    description: 'Top consulting & advisory firms',
    companies: ['Deloitte', 'EY', 'KPMG', 'PwC', 'McKinsey', 'BCG', 'Bain', 'Accenture Strategy', 'ZS Associates', 'Mu Sigma'],
  },
]

/** Flat map: company name → sector id (for reverse lookup) */
export const COMPANY_TO_SECTOR = COMPANY_SECTORS.reduce((acc, sector) => {
  sector.companies.forEach(c => { acc[c] = sector.id })
  return acc
}, {})

/** Returns the sector object for a given sector id */
export function getSector(id) {
  return COMPANY_SECTORS.find(s => s.id === id) || null
}

/** Returns all companies across the given sector ids */
export function getCompaniesForSectors(sectorIds) {
  return COMPANY_SECTORS
    .filter(s => sectorIds.includes(s.id))
    .flatMap(s => s.companies)
}

/**
 * CGPA → readiness multiplier per sector type.
 * Used in the Report's "Company Readiness" section.
 */
export const SECTOR_CGPA_WEIGHT = {
  it_services:   0.7,   // Less CGPA-strict
  product_maang: 1.0,   // Most CGPA-sensitive
  startups:      0.85,
  psu_govt:      0.9,   // CGPA matters a lot for PSU
  bfsi_fintech:  0.85,
  consulting:    0.9,
}
