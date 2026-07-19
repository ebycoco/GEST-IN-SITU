export interface QualityFilters {
  nom?: string;       // LIKE sur noms + prenoms (combiné)
  contact?: string;   // LIKE partiel sur contact
  ddn?: string;       // Égalité exacte sur date_de_naissance (YYYY-MM-DD)
  lieu?: string;      // LIKE sur lieu_de_naissance
}
