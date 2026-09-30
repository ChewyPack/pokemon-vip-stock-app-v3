/* EFFECTS — pointer tilt on collectible cards and a one-off burst on success. All skipped under reduced motion. */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var h = VIP.h;

  function canHover() {
    return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  VIP.effects = {
    tilt: function (scope) {
      if (VIP.reducedMotion() || !canHover()) return;
      Array.prototype.forEach.call(scope.querySelectorAll('.card'), function (card) {
        card.addEventListener('pointermove', function (e) {
          var r = card.getBoundingClientRect();
          var x = (e.clientX - r.left) / r.width;
          var y = (e.clientY - r.top) / r.height;
          card.style.setProperty('--mx', Math.round(x * 100) + '%');
          card.style.setProperty('--my', Math.round(y * 100) + '%');
          card.style.setProperty('--rx', ((0.5 - y) * 10).toFixed(2) + 'deg');
          card.style.setProperty('--ry', ((x - 0.5) * 12).toFixed(2) + 'deg');
          card.classList.add('is-tilting');
        });
        card.addEventListener('pointerleave', function () {
          card.classList.remove('is-tilting');
          card.style.setProperty('--rx', '0deg');
          card.style.setProperty('--ry', '0deg');
        });
      });
    },

    burst: function (parent) {
      if (VIP.reducedMotion()) return;
      var colors = ['#FFD21F', '#1E9BFF', '#E5312B', '#2FBF4B', '#FF8A1F', '#7B4DFF'];
      var layer = h('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
      for (var i = 0; i < 28; i++) {
        var piece = h('i', { class: 'confetti' });
        piece.style.setProperty('--x', Math.round((Math.random() - 0.5) * 120) + 'vw');
        piece.style.setProperty('--y', Math.round(40 + Math.random() * 50) + 'vh');
        piece.style.setProperty('--r', Math.round(Math.random() * 720 - 360) + 'deg');
        piece.style.setProperty('--d', (Math.random() * 0.25).toFixed(2) + 's');
        piece.style.setProperty('--c', colors[i % colors.length]);
        layer.appendChild(piece);
      }
      parent.appendChild(layer);
      setTimeout(function () {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }, 2400);
    }
  };
})();
