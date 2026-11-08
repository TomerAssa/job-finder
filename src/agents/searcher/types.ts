export type AtsType =
  | 'greenhouse'
  | 'lever'
  | 'workable'
  | 'comeet'
  | 'ashby'
  | 'smartrecruiters'
  | 'recruitee'
  | 'bamboohr'
  | 'jsonld'
  | 'generic'
  | 'unknown';

export interface FoundPosition {
  title: string;
  location?: string;
  url?: string;
  description?: string;
}

export interface Resolved {
  /**
   * Set when the company's own domain now serves another organisation's brand.
   * The caller records the acquisition instead of "no careers page found".
   */
  acquiredBy?: string | null;
  /** The brand string that said so. */
  sawBrand?: string | null;
  careersUrl: string | null;
  atsType: AtsType;
  /** ATS board token / account slug, when detectable from the URL. */
  token?: string;
  websiteUrl?: string | null;
}
