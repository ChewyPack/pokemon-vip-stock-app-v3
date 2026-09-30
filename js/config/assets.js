/*
 * ASSET MANIFEST — every image the app uses is referenced here and nowhere else.
 *
 * To use approved artwork:
 *   1. Drop the file in the matching folder (assets/pokemon, assets/one-piece, ...).
 *   2. Change the `src` below. Nothing else in the app needs to change.
 *
 * Until individual artwork is added, the universe cards show a crop of the
 * branding collage. `size` and `position` control that crop (CSS background rules).
 * For a normal card illustration use size: 'cover' and position: '50% 30%'.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var COLLAGE = 'assets/backgrounds/vip-collage.jpg';

  VIP.assets = {
    // The hero poster on the landing page.
    heroPoster: { src: COLLAGE, alt: 'Pokémon, One Piece and Dragon Ball Z characters in a comic-panel collage' },

    // Card art per universe. `src: null` renders the generic card back.
    universeArt: {
      pokemon: { src: COLLAGE, size: 'auto 100%', position: '0% 50%' },
      'one-piece': { src: COLLAGE, size: 'auto 100%', position: '50% 50%' },
      'dragon-ball': { src: COLLAGE, size: 'auto 100%', position: '100% 50%' },
      'other-tcg': { src: null }
    },

    // Optional logos (leave null to use the text wordmark).
    logos: {
      vip: null
    }
  };
})();
