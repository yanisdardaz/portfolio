# Vitrine — Plateforme de petites annonces

Ouvre `annonces/index.html` dans un navigateur (ou via GitHub Pages : `/annonces/`).

## Fonctionnalités
- Dépôt d'annonces (photos, prix, ville, catégorie, coordonnées, lien de paiement)
- Recherche, filtres (catégorie, ville, prix max) et tri
- Page annonce : galerie, coordonnées (téléphone, e-mail, WhatsApp), bouton « Payer »
- Notes ★ et avis avec répartition des notes
- **VIP** à la journée (1, 3 ou 7 jours) : annonce en tête de tous les résultats, badge doré, compte à rebours
- « Mes annonces » : statistiques, boost VIP, suppression

## Activer les vrais paiements VIP
Voir `config.js` : crée des Stripe Payment Links et colle-les dans `stripeLink`.
Sans lien, le paiement est en **mode démo** (carte test 4242 4242 4242 4242).

## Limite actuelle
Les données sont stockées dans le navigateur (localStorage) : chaque visiteur voit
ses propres annonces + les annonces de démonstration. Pour que tout le monde voie les
annonces de tout le monde, il faut brancher une base de données (ex. Supabase / Firebase)
et un webhook Stripe pour valider les paiements côté serveur.
