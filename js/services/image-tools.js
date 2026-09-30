/*
 * Members can pick photos up to 100 MB. Before upload each photo is redrawn onto a canvas
 * and saved as a smaller JPEG. That keeps uploads fast on store Wi-Fi and cell data, and
 * re-encoding also removes hidden metadata such as GPS location.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});

  function decode(file) {
    var tryBitmap = function (opts) {
      return window.createImageBitmap ? window.createImageBitmap(file, opts) : Promise.reject(new Error('no bitmap'));
    };
    return tryBitmap({ imageOrientation: 'from-image' })
      .catch(function () {
        return tryBitmap();
      })
      .catch(function () {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(file);
          var img = new Image();
          img.onload = function () {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error('decode failed'));
          };
          img.src = url;
        });
      });
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
  }

  async function compress(file, options) {
    var o = Object.assign({ maxDim: 1600, targetBytes: 1.4 * 1024 * 1024 }, options || {});
    var src = await decode(file);
    var w0 = src.width || src.naturalWidth;
    var h0 = src.height || src.naturalHeight;
    if (!w0 || !h0) throw new Error('empty image');

    var scale = Math.min(1, o.maxDim / Math.max(w0, h0));
    var last = null;

    for (var attempt = 0; attempt < 4; attempt++) {
      var w = Math.max(1, Math.round(w0 * scale));
      var h = Math.max(1, Math.round(h0 * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);

      var qualities = [0.82, 0.72, 0.62];
      for (var i = 0; i < qualities.length; i++) {
        var blob = await toBlob(canvas, qualities[i]);
        if (!blob) throw new Error('encode failed');
        last = { blob: blob, width: w, height: h };
        if (blob.size <= o.targetBytes) {
          if (src.close) src.close();
          return last;
        }
      }
      scale *= 0.8;
    }
    if (src.close) src.close();
    return last;
  }

  VIP.images = {
    compress: compress,
    isImage: function (file) {
      return /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
    }
  };
})();
