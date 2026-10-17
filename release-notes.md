# GEST-IN-SITU — Prochaine version (non publiée)

### 🛠️ Corrections & Fiabilité

- **Import CSV : un numéro de sécurité sociale invalide ou un statut inconnu ne fait plus échouer l'import** — un fichier dont la colonne « NUM SECU » avait été abîmée par Excel (notation scientifique du type « 3,84E+11 ») affichait « Toutes les lignes ont été rejetées (706/704) » alors que les cartes étaient bien créées. Ces deux anomalies, non bloquantes, ne sont plus comptées comme des lignes rejetées : la carte est créée sans numéro (ou en « EN STOCK » pour un statut inconnu) et le bilan ajoute un avertissement clair (« N numéro(s) de sécu invalide(s) ignoré(s) : cartes créées sans numéro, à compléter dans l'application », « N statut(s) inconnu(s) ramené(s) à EN STOCK : à vérifier »). La tuile « Anomalies Signalées » affiche le total réel des anomalies enregistrées. Seules les vraies lignes rejetées (date de naissance invalide) restent comptées comme rejets.
