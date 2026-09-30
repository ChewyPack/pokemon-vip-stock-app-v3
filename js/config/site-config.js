/*
 * SITE CONFIG — branding copy and deployment settings.
 * Edit this file to change wording, link the Discord invite, or unlock a universe.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});

  VIP.siteConfig = {
    brand: {
      name: 'Pokémon VIP',
      headline: 'Pokémon VIP',
      lead: 'See Pokémon cards in a store? Tell the crew in under a minute and the VIP Discord gets the alert.'
    },

    // Paste your Discord server invite here (e.g. 'https://discord.gg/yourcode').
    // Leave empty to hide the "Join the Discord" button.
    discordInviteUrl: '',

    // The server function that forwards reports to Discord.
    submitEndpoint: '/api/report',

    // When true, nothing is sent anywhere and the success screen still appears.
    // The hosted preview build turns this on automatically.
    demoMode: !!window.VIP_DEMO,

    legal: 'Pokémon, One Piece, Dragon Ball and related names and artwork are trademarks of their respective owners.',

    // Universes shown as collectible cards. status: 'live' unlocks the report button.
    // To go live with another universe later, set status to 'live' and add its own form and endpoint.
    universes: [
      {
        id: 'pokemon',
        name: 'Pokémon',
        status: 'live',
        blurb: 'Store sightings, restocks and drops, straight to Discord.',
        cta: 'Report a sighting'
      },
      {
        id: 'one-piece',
        name: 'One Piece',
        status: 'soon',
        blurb: 'Stock alerts for One Piece cards.'
      },
      {
        id: 'dragon-ball',
        name: 'Dragon Ball',
        status: 'soon',
        blurb: 'Stock alerts for Dragon Ball cards.'
      },
      {
        id: 'other-tcg',
        name: 'More TCG',
        status: 'soon',
        blurb: 'Other card games and collectibles as the community grows.'
      }
    ],

    howItWorks: [
      { title: 'Spot it', text: 'Find Pokémon products on a shelf, at the counter or online.', icon: '👀' },
      { title: 'Report it', text: 'A few taps: where, what and when. Add photos if you can.', icon: '📸' },
      { title: 'Crew gets pinged', text: 'Your report posts to the VIP Discord for everyone to see.', icon: '🔔' }
    ],

    notice: "A report doesn't guarantee the product is still available. Inventory changes quickly."
  };
})();
