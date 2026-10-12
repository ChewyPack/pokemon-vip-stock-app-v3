
/*
 * FORM CONFIG — single source of truth for the Pokémon VIP stock report.
 *
 * Reports are for sealed Pokémon TCG products physically found in retail stores.
 * Store branches must be verified before being added to branchDirectory.
 *
 * Loaded by the browser and the server.
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
    return values.map(function (value) {
      return typeof value === 'string'
        ? { value: value, label: value }
        : value;
    });
  }

  var retailers = list([
    'Walmart',
    'Target',
    'GameStop',
    'Dollar General',
    'CVS',
    'Walgreens',
    'Family Dollar',
    'Five Below',
    "Dick's Sporting Goods",
    'Local Card Shop',
    'Other'
  ]);

  var states = list([
    { value: 'RI', label: 'Rhode Island' },
    { value: 'MA', label: 'Massachusetts' }
  ]);

  /*
   * Add verified store branches here.
   *
   * Format:
   * branchDirectory: {
   *   RI: {
   *     Walmart: [
   *       {
   *         value: 'unique-branch-id',
   *         label: 'Cranston — 100 Example Street',
   *         town: 'Cranston',
   *         address: '100 Example Street'
   *       }
   *     ]
   *   }
   * }
   *
   * Do not add guessed or unverified addresses.
   */
  var branchDirectory = {
    RI: {},
    MA: {}
  };

  var manualBranchOption = {
    value: 'manual',
    label: 'Other / enter manually'
  };

  var config = {
    version: 2,

    limits: {
      maxPhotos: 5,
      photoInputMaxBytes: 100 * 1024 * 1024,
      photoUploadTargetBytes: Math.round(1.4 * 1024 * 1024),
      textMax: 100,
      notesMax: 500
    },

    states: states,
    retailers: retailers,
    branchDirectory: branchDirectory,

    steps: [
      {
        id: 'where',
        label: 'Where',
        title: 'Where did you find the product?',
        blurb:
          'Report sealed Pokémon TCG products you personally saw in a physical store.',
        fields: [
          'state',
          'retailer',
          'branch',
          'storeTown',
          'storeAddress'
        ]
      },
      {
        id: 'what',
        label: 'Product',
        title: 'What sealed product did you find?',
        blurb:
          'Report the product, quantity, shelf price, and MSRP when known.',
        fields: [
          'product',
          'productName',
          'qty',
          'shelfPrice',
          'msrp',
          'productLocated'
        ]
      },
      {
        id: 'when',
        label: 'Stock',
        title: 'When did you see it?',
        blurb:
          'Recent, accurate reports help members avoid wasted trips.',
        fields: ['seenAt', 'stillThere']
      },
      {
        id: 'proof',
        label: 'Proof',
        title: 'Add photos and your name',
        blurb:
          'Photos are optional but strongly encouraged. Never put yourself at risk to get a photo.',
        fields: ['photos', 'reporter', 'notes']
      }
    ],

    fields: [
      {
        id: 'state',
        label: 'State',
        type: 'select',
        required: true,
        placeholder: 'Choose a state',
        options: states,
        hint: 'Rhode Island first; Massachusetts is included for expansion.'
      },
      {
        id: 'retailer',
        label: 'Retailer',
        type: 'select',
        required: true,
        placeholder: 'Choose a retailer',
        options: retailers
      },
      {
        id: 'branch',
        label: 'Store branch',
        type: 'select',
        required: true,
        placeholder: 'Choose a store branch',
        options: [manualBranchOption],
        getOptions: function (ctx) {
          var state = ctx.get('state');
          var retailer = ctx.get('retailer');
          var stateBranches = branchDirectory[state] || {};
          var retailerBranches = stateBranches[retailer] || [];

          return retailerBranches.concat([manualBranchOption]);
        },
        hint:
          'Branch choices will show the town and street address. If your store is not listed, choose Other / enter manually.'
      },
      {
        id: 'storeTown',
        label: 'Store town / city',
        type: 'text',
        required: false,
        minLength: 2,
        maxLength: 100,
        placeholder: 'Example: Cranston',
        hint:
          'Fill this in when you selected Other / enter manually for the branch.',
        autocomplete: 'address-level2'
      },
      {
        id: 'storeAddress',
        label: 'Store street address',
        type: 'text',
        required: false,
        minLength: 3,
        maxLength: 100,
        placeholder: 'Street address of the store',
        hint:
          'Enter the physical store address when using manual branch entry.',
        autocomplete: 'street-address'
      },
      {
        id: 'product',
        label: 'Sealed product type',
        type: 'choice',
        layout: 'tiles',
        required: true,
        options: list([
          { value: 'ETB', label: 'Elite Trainer Box (ETB)' },
          { value: 'Ultra-Premium Collection', label: 'Ultra-Premium Collection' },
          { value: 'Booster Bundle', label: 'Booster Bundle' },
          { value: 'Booster Box', label: 'Booster Box' },
          { value: 'Booster Pack', label: 'Booster Pack' },
          { value: 'Tin', label: 'Tin' },
          { value: 'Collection Box', label: 'Collection Box' },
          { value: 'Blister Pack', label: 'Blister Pack' },
          { value: 'Tech Sticker Blister', label: 'Tech Sticker Blister' },
          { value: 'Battle / Theme Deck', label: 'Battle / Theme Deck' },
          { value: 'Poster Collection', label: 'Poster Collection' },
          { value: 'Other Sealed Product', label: 'Other Sealed Product' }
        ])
      },
      {
        id: 'productName',
        label: 'Product / set name',
        type: 'text',
        required: true,
        minLength: 2,
        maxLength: 100,
        placeholder: 'Example: Scarlet & Violet — set or product name',
        hint:
          'Enter the product name or set printed on the packaging.',
        autocomplete: 'off'
      },
      {
        id: 'qty',
        label: 'Quantity seen',
        type: 'choice',
        layout: 'chips',
        required: true,
        options: list(['1', '2-3', '4-10', '10+', 'Unknown'])
      },
      {
        id: 'shelfPrice',
        label: 'Shelf price per item ($)',
        type: 'price',
        required: false,
        placeholder: '49.99',
        hint:
          'Enter the price displayed in the store. Leave blank if unknown.'
      },
      {
        id: 'msrp',
        label: 'MSRP per item ($)',
        type: 'price',
        required: false,
        placeholder: '49.99',
        hint:
          'Enter the manufacturer suggested retail price if known. Do not guess.'
      },
      {
        id: 'productLocated',
        label: 'Where in the store?',
        type: 'choice',
        layout: 'tiles',
        required: true,
        options: list([
          {
            value: 'On Shelf',
            label: 'On Shelf',
            icon: '📦'
          },
          {
            value: 'Display/Endcap',
            label: 'Display / Endcap',
            icon: '🏷️'
          },
          {
            value: 'Service Desk/Behind Counter',
            label: 'Service Desk / Behind Counter',
            icon: '🛎️'
          },
          {
            value: 'Checkout Area',
            label: 'Checkout Area',
            icon: '🛒'
          },
          {
            value: 'Other Area',
            label: 'Other Area',
            icon: '📍'
          }
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
        label: 'Was it still in stock when you left?',
        type: 'choice',
        layout: 'duo',
        required: true,
        options: list([
          {
            value: 'Yes',
            label: 'Yes',
            desc: 'Still in stock',
            tone: 'good'
          },
          {
            value: 'No',
            label: 'No',
            desc: 'Sold out',
            tone: 'bad'
          }
        ])
      },
      {
        id: 'photos',
        label: 'Product / shelf photos',
        type: 'photos',
        required: false
      },
      {
        id: 'reporter',
        label: 'Your Facebook / Discord name',
        type: 'text',
        required: true,
        minLength: 2,
        maxLength: 60,
        placeholder: 'The name the crew knows you by',
        hint: 'Shown with your stock alert in the VIP Discord.',
        autocomplete: 'name'
      },
      {
        id: 'notes',
        label: 'Additional details',
        type: 'textarea',
        required: false,
        maxLength: 500,
        placeholder:
          'Purchase limits, number of units left, shelf location, or other useful details.'
      }
    ]
  };

  config.getField = function (id) {
    for (var i = 0; i < config.fields.length; i++) {
      if (config.fields[i].id === id) {
        return config.fields[i];
      }
    }
    return null;
  };

  config.getOptions = function (fieldId, ctx) {
    var field = config.getField(fieldId);
    if (!field) return [];

    if (typeof field.getOptions === 'function') {
      return field.getOptions(ctx || { get: function () { return ''; } });
    }

    return field.options || [];
  };

  config.getOption = function (fieldId, value, ctx) {
    var options = config.getOptions(fieldId, ctx);

    for (var i = 0; i < options.length; i++) {
      if (String(options[i].value) === String(value)) {
        return options[i];
      }
    }

    return null;
  };

  return config;
});
