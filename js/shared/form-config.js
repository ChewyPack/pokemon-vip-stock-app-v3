/*
 * FORM CONFIG — the single source of truth for the sighting form.
 *
 * Mirrors the "Pokémon VIP — Report a Stock Sighting" Google Form:
 * same 12 questions, same answer options, same required flags.
 *
 * This file is loaded by the browser (window.VIP.formConfig) AND imported by the
 * server function, so the UI and the server validation can never drift apart.
 * To add, remove or rename a question or option, edit it here only.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VIP = root.VIP || {};
    root.VIP.formConfig = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function list(values) {
    return values.map(function (v) {
      return typeof v === 'string' ? { value: v, label: v } : v;
    });
  }

  var config = {
    version: 1,

    limits: {
      maxPhotos: 5,
      photoInputMaxBytes: 100 * 1024 * 1024, // members may pick files up to 100 MB
      photoUploadTargetBytes: Math.round(1.4 * 1024 * 1024), // shrunk on the phone before sending
      textMax: 100,
      notesMax: 500
    },

    // Steps group the questions. Fields are looked up by id below.
    steps: [
      {
        id: 'where',
        label: 'Where',
        title: 'Where did you see it?',
        blurb: "Only report what you've seen yourself or have permission to share.",
        fields: ['retailer', 'location']
      },
      {
        id: 'what',
        label: 'What',
        title: 'What did you find?',
        blurb: 'Pick the product, how many, and what it costs.',
        fields: ['product', 'qty', 'price', 'priceType', 'productLocated']
      },
      {
        id: 'when',
        label: 'When',
        title: 'When did you see it?',
        blurb: 'Stock moves fast, so timing matters.',
        fields: ['seenAt', 'stillThere']
      },
      {
        id: 'proof',
        label: 'Proof',
        title: 'Add photos and your name',
        blurb: 'Photos are strongly encouraged. They help the crew trust the alert.',
        fields: ['photos', 'reporter', 'notes']
      }
    ],

    fields: [
      {
        id: 'retailer',
        label: 'Retailer',
        type: 'choice',
        layout: 'tiles',
        required: true,
        options: list([
          'Walmart',
          'Target',
          'GameStop',
          'Dollar General',
          'CVS',
          'Walgreens',
          'Family Dollar',
          'Five Below',
          "Dick's Sporting Goods",
          'Pokémon Center',
          'Local Card Shop',
          'Other'
        ])
      },
      {
        id: 'location',
        label: 'Location',
        type: 'text',
        required: true,
        minLength: 2,
        maxLength: 100,
        placeholder: 'Cranston, Pocasset Ave',
        hint: 'City, town or street. Use "Online" for web orders.',
        autocomplete: 'off'
      },
      {
        id: 'product',
        label: 'Product',
        type: 'choice',
        layout: 'tiles',
        required: true,
        options: list([
          { value: 'ETB', label: 'ETB', desc: 'Elite Trainer Box' },
          'Booster Bundle',
          'Ex Boxes',
          'Tech Sticker',
          'Poster',
          '2/3 pk Blister',
          'Multiple'
        ])
      },
      {
        id: 'qty',
        label: 'Qty seen',
        type: 'choice',
        layout: 'chips',
        required: true,
        options: list(['1', '2-3', '4-10', '10+', 'Unknown'])
      },
      {
        id: 'price',
        label: 'Price',
        type: 'price',
        required: false,
        placeholder: '59.99',
        hint: 'Per item, numbers only. Leave blank if you are not sure.'
      },
      {
        id: 'priceType',
        label: 'Price type',
        type: 'choice',
        layout: 'duo',
        required: true,
        options: list([
          { value: 'MSRP', label: 'MSRP', desc: 'Regular retail price' },
          { value: 'Market', label: 'Market', desc: 'Above retail' }
        ])
      },
      {
        id: 'productLocated',
        label: 'Product located',
        type: 'choice',
        layout: 'tiles',
        required: true,
        options: list([
          { value: 'Service Desk/Behind Counter', label: 'Service Desk/Behind Counter', icon: '🛎️' },
          { value: 'On Shelf', label: 'On Shelf', icon: '📦' },
          { value: 'Display/Endcap', label: 'Display/Endcap', icon: '🏷️' },
          { value: 'Pickup/Online Order', label: 'Pickup/Online Order', icon: '🛒' }
        ])
      },
      {
        id: 'seenAt',
        label: 'When did you see it?',
        type: 'datetime',
        required: true
      },
      {
        id: 'stillThere',
        label: 'Is it still there?',
        type: 'choice',
        layout: 'duo',
        required: true,
        options: list([
          { value: 'Yes', label: 'Yes', desc: 'Still there', tone: 'good' },
          { value: 'No', label: 'No', desc: 'Sold out', tone: 'bad' }
        ])
      },
      {
        id: 'photos',
        label: 'Upload a photo',
        type: 'photos',
        required: false
      },
      {
        id: 'reporter',
        label: 'Your Facebook name',
        type: 'text',
        required: true,
        minLength: 2,
        maxLength: 60,
        placeholder: 'The name the crew knows you by',
        hint: 'Shown with your alert in the VIP Discord.',
        autocomplete: 'name'
      },
      {
        id: 'notes',
        label: 'Anything else members should know?',
        type: 'textarea',
        required: false,
        maxLength: 500,
        placeholder: 'Limits per customer, line length, when restock happens...'
      }
    ]
  };

  config.getField = function (id) {
    for (var i = 0; i < config.fields.length; i++) {
      if (config.fields[i].id === id) return config.fields[i];
    }
    return null;
  };

  config.getOption = function (fieldId, value) {
    var f = config.getField(fieldId);
    if (!f || !f.options) return null;
    for (var i = 0; i < f.options.length; i++) {
      if (f.options[i].value === value) return f.options[i];
    }
    return null;
  };

  return config;
});
