import type { SiteContent } from '@sceptre/shared'

/**
 * The public site is a read-only facade: it owns no table, no migration and no
 * write path. Its seven sibling files in this repository are the convention for
 * a domain module; a facade only needs these four, and adding an empty schema or
 * repository to satisfy the shape would be noise.
 */
export interface SiteResponse {
  content: SiteContent
}
