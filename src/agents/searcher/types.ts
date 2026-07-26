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
  careersUrl: string | null;
  atsType: AtsType;
  /** ATS board token / account slug, when detectable from the URL. */
  token?: string;
  websiteUrl?: string | null;
}
