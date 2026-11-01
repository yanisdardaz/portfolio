/* ============================================================
   VITRINE — Configuration
   ------------------------------------------------------------
   PAIEMENTS RÉELS (Stripe Payment Links, sans serveur) :
   1. Crée un compte sur https://dashboard.stripe.com
   2. Produits > crée 3 produits "VIP 1 jour", "VIP 3 jours", "VIP 7 jours"
   3. Pour chacun : "Créer un lien de paiement"
      - Après paiement > "Rediriger vers ton site" :
        https://TON-SITE/annonces/#/vip-ok
   4. Colle les liens ci-dessous (stripeLink).
   Tant qu'un lien est vide, le site utilise un paiement de DÉMO
   (carte test 4242 4242 4242 4242) : aucun argent n'est débité.
   ============================================================ */
window.VITRINE_CONFIG = {
  siteName: "Vitrine",
  currency: "EUR",
  vipPlans: [
    { id: "vip1", days: 1, price: 2.99, label: "VIP 1 jour",  stripeLink: "" },
    { id: "vip3", days: 3, price: 6.99, label: "VIP 3 jours", stripeLink: "", popular: true },
    { id: "vip7", days: 7, price: 12.99, label: "VIP 7 jours", stripeLink: "" },
  ],
};
