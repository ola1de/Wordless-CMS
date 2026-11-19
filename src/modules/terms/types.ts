export type Taxonomy = "category" | "tag" | "nav_menu";

export interface Term {
  id: number;
  /** wp_term_taxonomy.term_taxonomy_id — the id relationships point at. */
  termTaxonomyId: number;
  name: string;
  slug: string;
  taxonomy: string;
  description: string;
  /** Parent term id (0 = top level). Only categories are hierarchical. */
  parentId: number;
  /** Number of posts assigned (maintained by the service). */
  count: number;
  children?: Term[];
}

export interface CreateTermInput {
  name: string;
  slug?: string;
  taxonomy: string;
  description?: string;
  parentId?: number;
}

export interface UpdateTermInput {
  name?: string;
  slug?: string;
  description?: string;
  parentId?: number;
}

export interface ListTermsOptions {
  parentId?: number;
  page?: number;
  perPage?: number;
}

export interface TermListResult {
  terms: Term[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
