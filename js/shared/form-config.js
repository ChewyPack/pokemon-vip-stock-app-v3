
/*
 * POKEMON VIP REPORT FORM CONFIGURATION
 *
 * Rhode Island store directory starter list.
 * Massachusetts can be populated later.
 *
 * Branch values are stable IDs; labels are shown to members.
 * "manual" lets members enter a store not listed in the directory.
 */
(function (root, factory) {
  var config = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = config;
  } else {
    root.VIP = root.VIP || {};
    root.VIP.formConfig = config;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  var retailers = [
    'Walmart',
    'Target',
    'GameStop',
    'Best Buy',
    'Barnes & Noble',
    'Costco',
    "Sam's Club",
    "BJ's Wholesale Club",
    'Meijer',
    'Kroger',
    'Dollar General',
    'Dollar Tree',
    'Family Dollar',
    'Five Below',
    'CVS',
    'Walgreens',
    "Dick's Sporting Goods",
    'Books-A-Million',
    'Local Card Shop',
    'Other / independent retailer'
  ];

  var products = [
    'Elite Trainer Box (ETB)',
    'Ultra-Premium Collection',
    'Booster Bundle',
    'Booster Box',
    'Booster Pack',
    'Tin',
    'Collection Box',
    'Blister Pack',
    'Tech Sticker Blister',
    'Battle / Theme Deck',
    'Poster Collection',
    'Other Sealed Product'
  ];

  var branchDirectory = {
    RI: {
      Walmart: [
        { value: 'walmart-coventry', label: 'Coventry — 650 Centre of New England Blvd' },
        { value: 'walmart-cranston', label: 'Cranston — 1776 Plainfield Pike' },
        { value: 'walmart-north-kingstown', label: 'North Kingstown — 1031 Ten Rod Rd' },
        { value: 'walmart-north-smithfield', label: 'North Smithfield — 7 Dowling Village Blvd' },
        { value: 'walmart-providence', label: 'Providence — 51 Silver Spring St' },
        { value: 'walmart-warwick-bald-hill', label: 'Warwick — 650 Bald Hill Rd' },
        { value: 'walmart-warwick-post', label: 'Warwick — 840 Post Rd' },
        { value: 'walmart-westerly', label: 'Westerly — 258 Post Rd' }
      ],

      Target: [
        { value: 'target-warwick-bald-hill', label: 'Warwick — 1245 Bald Hill Rd' },
        { value: 'target-smithfield', label: 'Smithfield — 371 Putnam Pike, Ste A-250' },
        { value: 'target-lincoln', label: 'Lincoln — 620 George Washington Hwy' },
        { value: 'target-warwick-400', label: 'Warwick — 400 Bald Hill Rd' }
      ],

      'Five Below': [
        { value: 'five-below-cranston', label: 'Cranston — 252 Garfield Ave' },
        { value: 'five-below-east-providence', label: 'East Providence — 1925 Pawtucket Ave, Ste 4' },
        { value: 'five-below-providence', label: 'Providence — 1 Providence Place, Unit 4180' },
        { value: 'five-below-warwick', label: 'Warwick — 300 Quaker Ln, B1' },
        { value: 'five-below-north-providence', label: 'North Providence — 25 Smithfield Rd' },
        { value: 'five-below-lincoln', label: 'Lincoln — 620 George Washington Hwy, Unit 32' },
        { value: 'five-below-smithfield', label: 'Smithfield — 371 Putnam Pike' }
      ],

      CVS: [
        { value: 'cvs-cranston-reservoir', label: 'Cranston — 681 Reservoir Ave' },
        { value: 'cvs-cranston-pontiac', label: 'Cranston — 1188 Pontiac Ave' },
        { value: 'cvs-cranston-oaklawn', label: 'Cranston — 1195 Oaklawn Ave' },
        { value: 'cvs-cranston-atwood', label: 'Cranston — 205 Atwood Ave' },
        { value: 'cvs-cranston-broad', label: 'Cranston — 1776 Broad St' },
        { value: 'cvs-providence-admiral', label: 'Providence — 400 Admiral St' },
        { value: 'cvs-providence-hope', label: 'Providence — 799 Hope St' },
        { value: 'cvs-providence-webster', label: 'Providence — 131 Webster Ave' },
        { value: 'cvs-providence-angell', label: 'Providence — 481 Angell St' },
        { value: 'cvs-providence-thayer', label: 'Providence — 291 Thayer St' },
        { value: 'cvs-providence-place', label: 'Providence — Providence Place Mall, 39 Providence Pl' },
        { value: 'cvs-providence-manton', label: 'Providence — 935 Manton Ave' },
        { value: 'cvs-providence-broad', label: 'Providence — 960 Broad St' },
        { value: 'cvs-east-providence-taunton', label: 'East Providence — 583 Taunton Ave' },
        { value: 'cvs-east-providence-warren', label: 'East Providence — 640 Warren Ave' },
        { value: 'cvs-east-greenwich-main', label: 'East Greenwich — 507 Main St' },
        { value: 'cvs-east-greenwich-turnpike', label: 'East Greenwich — 2250 New London Turnpike' },
        { value: 'cvs-east-greenwich-county', label: 'East Greenwich — 1285 S County Trail' },
        { value: 'cvs-johnston-plainfield', label: 'Johnston — 1993 Plainfield Pike' },
        { value: 'cvs-johnston-hartford', label: 'Johnston — 1400 Hartford Ave' },
        { value: 'cvs-johnston-putnam', label: 'Johnston — 26 Putnam Pike' },
        { value: 'cvs-pawtucket-smithfield', label: 'Pawtucket — 601 Smithfield Ave' },
        { value: 'cvs-pawtucket-newport', label: 'Pawtucket — 835 Newport Ave' },
        { value: 'cvs-pawtucket-east', label: 'Pawtucket — 425 East Ave' },
        { value: 'cvs-cumberland-mendon', label: 'Cumberland — 1998 Mendon Rd' },
        { value: 'cvs-cumberland-broad', label: 'Cumberland — 315 Broad St' },
        { value: 'cvs-cumberland-diamond', label: 'Cumberland — 2125 Diamond Hill Rd' },
        { value: 'cvs-north-kingstown-post', label: 'North Kingstown — 6495 Post Rd' },
        { value: 'cvs-north-kingstown-quaker', label: 'North Kingstown — 4255 Quaker Ln' },
        { value: 'cvs-west-warwick-main-1270', label: 'West Warwick — 1270 Main St' },
        { value: 'cvs-west-warwick-main-1734', label: 'West Warwick — 1734 Main St' },
        { value: 'cvs-west-warwick-providence', label: 'West Warwick — 834 Providence St' }
      ],

      'Family Dollar': [
        { value: 'family-dollar-cranston-pontiac', label: 'Cranston — 570 Pontiac Ave' },
        { value: 'family-dollar-cranston-atwood', label: 'Cranston — 480 Atwood Ave' },
        { value: 'family-dollar-providence-broad-1280', label: 'Providence — 1280 Broad St' },
        { value: 'family-dollar-providence-broad-1515', label: 'Providence — 1515 Broad St' },
        { value: 'family-dollar-providence-branch', label: 'Providence — 1039 Branch Ave' },
        { value: 'family-dollar-providence-broad-711', label: 'Providence — 711 Broad St' }
      ],

      'Dollar General': [
        { value: 'dollar-general-cranston-dyer', label: 'Cranston — 550 Dyer Ave' },
        { value: 'dollar-general-cranston-park', label: 'Cranston — 1315 Park Ave' },
        { value: 'dollar-general-cranston-broad', label: 'Cranston — 1548 Broad St' },
        { value: 'dollar-general-east-providence-pawtucket', label: 'East Providence — 2715 Pawtucket Ave' },
        { value: 'dollar-general-east-providence-newport', label: 'East Providence — 52 Newport Ave' },
        { value: 'dollar-general-warwick', label: 'Warwick — 2680 W Shore Rd' },
        { value: 'dollar-general-pawtucket', label: 'Pawtucket — 295 Armistice Blvd' },
        { value: 'dollar-general-warren', label: 'Warren — 470 Metacom Ave' },
        { value: 'dollar-general-wyoming', label: 'Wyoming — 1209 Main St' }
      ],

      Walgreens: [
        { value: 'walgreens-providence-elmwood', label: 'Providence — 533 Elmwood Ave' },
        { value: 'walgreens-providence-pocasset', label: 'Providence — 1 Pocasset Ave' },
        { value: 'walgreens-johnston-plainfield', label: 'Johnston — 1387 Plainfield St' },
        { value: 'walgreens-warwick-1560', label: 'Warwick — 1560 Warwick Ave' },
        { value: 'walgreens-providence-academy', label: 'Providence — 295 Academy Ave' },
        { value: 'walgreens-providence-pitman', label: 'Providence — 135 Pitman St' },
        { value: 'walgreens-east-providence', label: 'East Providence — 655 Warren Ave' },
        { value: 'walgreens-johnston-atwood', label: 'Johnston — 1583 Atwood Ave' },
        { value: 'walgreens-north-providence-smith', label: 'North Providence — 1510 Smith St' },
        { value: 'walgreens-warwick-2399', label: 'Warwick — 2399 Warwick Ave' },
        { value: 'walgreens-riverside', label: 'Riverside — 1086 Willett Ave' },
        { value: 'walgreens-providence-main', label: 'Providence — 1140 N Main St' },
        { value: 'walgreens-warwick-bald-hill', label: 'Warwick — 1080 Bald Hill Rd' },
        { value: 'walgreens-warwick-post', label: 'Warwick — 3336 Post Rd' },
        { value: 'walgreens-north-providence-mineral-1665', label: 'North Providence — 1665 Mineral Spring Ave' },
        { value: 'walgreens-north-providence-mineral-1074', label: 'North Providence — 1074 Mineral Spring Ave' },
        { value: 'walgreens-rumford', label: 'Rumford — 220 Newport Ave' },
        { value: 'walgreens-pawtucket-broad', label: 'Pawtucket — 100 Broad St' },
        { value: 'walgreens-pawtucket-cottage', label: 'Pawtucket — 385 Cottage St' }
      ],

      GameStop: [
        { value: 'gamestop-cranston-parkade', label: 'Cranston — 286 Garfield Ave, Ste 18' },
        { value: 'gamestop-warwick-cowesett', label: 'Warwick — 300 Quaker Ln, Ste C17' },
        { value: 'gamestop-providence-place', label: 'Providence — 45 Providence Place' }
      ],

      "Dick's Sporting Goods": [
        { value: 'dicks-smithfield', label: 'Smithfield — 371 Putnam Pike, Suite 300' },
        { value: 'dicks-warwick', label: 'Warwick — 650 Bald Hill Rd' }
      ],

      'Local Card Shop': [
        { value: 'card-shop-courtside', label: 'Courtside Card Shop — 2244 Plainfield Pike, Ste 1, Cranston' },
        { value: 'card-shop-trading-card-market', label: 'The Trading Card Market — 310 Atwood Ave, Cranston' },
        { value: 'card-shop-401-tcg', label: '401 TCG Supply — 755 Main St, West Warwick' },
        { value: 'card-shop-reality-a-games', label: 'Reality A Games — 297 Providence St, West Warwick' }
      ],

      Other: []
    },

    MA: {}
  };

  var config = {
    version: 2,

    limits: {
      maxPhotos: 5,
      textMax: 120,
      notesMax: 1000,
      photoInputMaxBytes: 100 * 1024 * 1024,
      photoUploadTargetBytes: 1500 * 1024
    },

    states: [
      { value: 'RI', label: 'Rhode Island' },
      { value: 'MA', label: 'Massachusetts' }
    ],

    retailers: retailers,
    products: products,
    branchDirectory: branchDirectory,

    steps: [
      {
        id: 'where',
        title: 'Where did you find it?',
        label: 'Store location',
        description: 'Choose the state, retailer, and exact store branch.',
        blurb: 'Choose the state, retailer, and exact store branch.',
        fields: [
          'state',
          'retailer',
          'branch',
          'storeTown',
          'storeAddress'
        ]
      },
      {
        id: 'product',
        title: 'What product did you find?',
        label: 'Product details',
        description: 'Report sealed Pokémon TCG products only.',
        blurb: 'Report sealed Pokémon TCG products only.',
        fields: [
          'product',
          'productName'
        ]
      },
      {
        id: 'stock',
        title: 'What was on the shelf?',
        label: 'Stock details',
        description: 'Separate shelf price from MSRP and tell us what you saw.',
        blurb: 'Separate shelf price from MSRP and tell us what you saw.',
        fields: [
          'qty',
          'shelfPrice',
          'msrp',
          'productLocated',
          'stillThere',
          'seenAt'
        ]
      },
      {
        id: 'proof',
        title: 'Add details',
        label: 'Additional details',
        description: 'Photos help other collectors verify the report.',
        blurb: 'Photos help other collectors verify the report.',
        fields: [
          'photos',
          'reporter',
          'notes'
        ]
      }
    ],

    fields: [
      {
        id: 'state',
        type: 'select',
        label: 'State',
        required: true,
        options: [
          { value: 'CT', label: 'Connecticut' },
          { value: 'ME', label: 'Maine' },
          { value: 'MA', label: 'Massachusetts' },
          { value: 'NH', label: 'New Hampshire' },
          { value: 'RI', label: 'Rhode Island' },
          { value: 'VT', label: 'Vermont' }
        ]
      },
      {
        id: 'retailer',
        type: 'select',
        label: 'Retailer',
        required: true,
        options: retailers.map(function (name) {
          return { value: name, label: name };
        })
      },
      {
        id: 'branch',
        type: 'select',
        label: 'Store branch',
        required: true,
        placeholder: 'Choose a store',
        getOptions: function (ctx) {
          var state = ctx && ctx.get ? ctx.get('state') : '';
          var retailer = ctx && ctx.get ? ctx.get('retailer') : '';
          var list =
            branchDirectory[state] &&
            branchDirectory[state][retailer]
              ? branchDirectory[state][retailer]
              : [];

          return list.concat([
            { value: 'manual', label: 'Other / enter store manually' }
          ]);
        }
      },
      {
        id: 'storeTown',
        type: 'text',
        label: 'Store town or city',
        required: false,
        maxLength: 80,
        placeholder: 'Enter the town or city'
      },
      {
        id: 'storeAddress',
        type: 'text',
        label: 'Store street address',
        required: false,
        maxLength: 180,
        placeholder: 'Enter the street address'
      },
      {
        id: 'product',
        type: 'select',
        label: 'Sealed product type',
        required: true,
        options: products.map(function (name) {
          return { value: name, label: name };
        })
      },
      {
        id: 'productName',
        type: 'text',
        label: 'Set or product name',
        required: true,
        minLength: 2,
        maxLength: 120,
        placeholder: 'Example: Mega Evolution ETB'
      },
      {
        id: 'qty',
        type: 'select',
        label: 'Quantity seen',
        required: true,
        options: [
          { value: '1', label: '1' },
          { value: '2-3', label: '2–3' },
          { value: '4-10', label: '4–10' },
          { value: '10+', label: '10+' },
          { value: 'Unknown', label: 'Unknown' }
        ]
      },
      {
        id: 'shelfPrice',
        type: 'price',
        label: 'Shelf price',
        required: false,
        placeholder: 'Example: 54.99'
      },
      {
        id: 'msrp',
        type: 'price',
        label: 'MSRP',
        required: false,
        placeholder: 'Example: 49.99'
      },
      {
        id: 'productLocated',
        type: 'select',
        label: 'Where in the store?',
        required: true,
        options: [
          { value: 'Main Trading Card Section', label: 'Main trading card section' },
          { value: 'Front Registers', label: 'Front registers' },
          { value: 'Checkout Lanes', label: 'Checkout lanes' },
          { value: 'Customer Service', label: 'Customer service' },
          { value: 'Behind Counter', label: 'Behind counter' },
          { value: 'End Cap', label: 'End cap' },
          { value: 'Toy Aisle', label: 'Toy aisle' },
          { value: 'Other', label: 'Other location' },
          { value: 'Unknown', label: 'Not sure' }
        ]
      },
      {
        id: 'stillThere',
        type: 'select',
        label: 'Was it still in stock when you reported it?',
        required: true,
        options: [
          { value: 'Yes', label: 'Yes — still in stock' },
          { value: 'No', label: 'No — sold out or gone' },
          { value: 'Unknown', label: 'Not sure' }
        ]
      },
      {
        id: 'seenAt',
        type: 'datetime',
        label: 'When did you see it?',
        required: true
      },
      {
        id: 'photos',
        type: 'photos',
        label: 'Photos',
        required: false
      },
      {
        id: 'reporter',
        type: 'text',
        label: 'Your name or Discord username',
        required: true,
        minLength: 2,
        maxLength: 60,
        placeholder: 'Your Discord name'
      },
      {
        id: 'notes',
        type: 'textarea',
        label: 'Additional notes',
        required: false,
        maxLength: 1000,
        placeholder: 'Optional: limits, display details, or other useful information'
      }
    ],

    getField: function (fieldId) {
      return this.fields.find(function (field) {
        return field.id === fieldId;
      }) || null;
    },

    getOptions: function (fieldId, ctx) {
      var field = this.getField(fieldId);
      if (!field) return [];

      if (typeof field.getOptions === 'function') {
        return field.getOptions(ctx || {
          get: function () {
            return '';
          }
        });
      }

      return field.options || [];
    },

    getOption: function (fieldId, value, ctx) {
      var options = this.getOptions(fieldId, ctx);

      return options.find(function (option) {
        return String(option.value) === String(value);
      }) || null;
    }
  };

  return config;
});
