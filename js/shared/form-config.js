
/*
 * POKEMON VIP REPORT FORM CONFIGURATION
 *
 * Rhode Island store directory starter list.
 * New England state directory. Use the manual branch option when a location is not listed.
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

    CT: {
      Walmart: [
        { value: 'walmart-ct-brooklyn', label: 'Brooklyn — 450 Providence Rd, CT 06234' },
        { value: 'walmart-ct-hartford', label: 'Hartford — 495 Flatbush Ave, CT 06106' }
      ],
      Target: [
        { value: 'target-ct-ansonia-20-w-main-st', label: 'Ansonia — 20 W Main St, CT' },
        { value: 'target-ct-bethel-7-stony-hill-rd', label: 'Bethel — 7 Stony Hill Rd, CT' },
        { value: 'target-ct-danbury-7-backus-ave', label: 'Danbury — 7 Backus Ave, CT' },
        { value: 'target-ct-dayville-2177-killingly-commons', label: 'Dayville — 2177 Killingly Commons, CT' },
        { value: 'target-ct-enfield-94-elm-st-ste-1', label: 'Enfield — 94 Elm St, Ste 1, CT' },
        { value: 'target-ct-guilford-900-boston-post-rd', label: 'Guilford — 900 Boston Post Rd, CT' },
        { value: 'target-ct-lisbon-195-river-rd', label: 'Lisbon — 195 River Rd, CT' },
        { value: 'target-ct-manchester-125-buckland-hills-dr', label: 'Manchester — 125 Buckland Hills Dr, CT' },
        { value: 'target-ct-meriden-474-chamberlain-hwy', label: 'Meriden — 474 Chamberlain Hwy, CT' },
        { value: 'target-ct-milford-1191-boston-post-rd', label: 'Milford — 1191 Boston Post Rd, CT' },
        { value: 'target-ct-new-britain-475-hartford-rd', label: 'New Britain — 475 Hartford Rd, CT' },
        { value: 'target-ct-newington-3265-berlin-turnpike', label: 'Newington — 3265 Berlin Turnpike, CT' },
        { value: 'target-ct-north-haven-200-universal-dr-n', label: 'North Haven — 200 Universal Dr N, CT' },
        { value: 'target-ct-norwalk-680-connecticut-ave', label: 'Norwalk — 680 Connecticut Ave, CT' },
        { value: 'target-ct-orange-25-boston-post-rd', label: 'Orange — 25 Boston Post Rd, CT' },
        { value: 'target-ct-southington-600-executive-blvd', label: 'Southington — 600 Executive Blvd, CT' },
        { value: 'target-ct-stamford-21-broad-st', label: 'Stamford — 21 Broad St, CT' },
        { value: 'target-ct-torrington-1922-e-main-st', label: 'Torrington — 1922 E Main St, CT' },
        { value: 'target-ct-trumbull-5065-main-st', label: 'Trumbull — 5065 Main St, CT' },
        { value: 'target-ct-trumbull-120-hawley-ln', label: 'Trumbull — 120 Hawley Ln, CT' },
        { value: 'target-ct-waterbury-300-chase-ave', label: 'Waterbury — 300 Chase Ave, CT' },
        { value: 'target-ct-waterford-900-hartford-tpke', label: 'Waterford — 900 Hartford Tpke, CT' },
        { value: 'target-ct-west-hartford-333-n-main-st-ste-10', label: 'West Hartford — 333 N Main St, Ste 10, CT' },
        { value: 'target-ct-windsor-1075-kennedy-rd', label: 'Windsor — 1075 Kennedy Rd, CT' }
      ]
    },

    ME: {
      Walmart: [
        { value: 'walmart-me-bangor', label: 'Bangor — 900 Stillwater Ave, ME 04401' },
        { value: 'walmart-me-brewer', label: 'Brewer — 24 Walton Dr, ME 04412' },
        { value: 'walmart-me-calais', label: 'Calais — 379 South St, ME 04619' },
        { value: 'walmart-me-ellsworth', label: 'Ellsworth — 17 Myrick St, ME 04605' },
        { value: 'walmart-me-farmington', label: 'Farmington — 615 Wilton Rd, ME 04938' },
        { value: 'walmart-me-mexico', label: 'Mexico — 258 River Rd, ME 04257' },
        { value: 'walmart-me-oxford', label: 'Oxford — 1240 Main St, ME 04270' },
        { value: 'walmart-me-palmyra', label: 'Palmyra — 1573 Main St, ME 04965' },
        { value: 'walmart-me-presque-isle', label: 'Presque Isle — 781 Main St, ME 04769' },
        { value: 'walmart-me-sanford', label: 'Sanford — 1930 Main St, ME 04073' },
        { value: 'walmart-me-scarborough', label: 'Scarborough — 500 Gallery Blvd, ME 04074' }
      ],
      Target: [
        { value: 'target-me-auburn-603-center-st', label: 'Auburn — 603 Center St, ME' },
        { value: 'target-me-augusta-119-crossing-way', label: 'Augusta — 119 Crossing Way, ME' },
        { value: 'target-me-bangor-60-longview-dr', label: 'Bangor — 60 Longview Dr, ME' },
        { value: 'target-me-biddeford-430-mariner-way', label: 'Biddeford — 430 Mariner Way, ME' },
        { value: 'target-me-south-portland-200-running-hill-rd', label: 'South Portland — 200 Running Hill Rd, ME' },
        { value: 'target-me-topsham-125-topsham-fair-mall-rd', label: 'Topsham — 125 Topsham Fair Mall Rd, ME' }
      ]
    },

    MA: {
      Walmart: [
        { value: 'walmart-ma-abington', label: 'Abington — 777 Brockton Ave, MA 02351' },
        { value: 'walmart-ma-avon', label: 'Avon — 30 Memorial Dr, MA 02322' },
        { value: 'walmart-ma-brockton', label: 'Brockton — 700 Oak St, MA 02301' },
        { value: 'walmart-ma-chelmsford', label: 'Chelmsford — 66 Parkhurst Rd, MA 01824' },
        { value: 'walmart-ma-framingham', label: 'Framingham — 121 Worcester Rd, MA 01701' },
        { value: 'walmart-ma-leominster', label: 'Leominster — 11 Jungle Rd, MA 01453' },
        { value: 'walmart-ma-methuen', label: 'Methuen — 70 Pleasant Valley St, MA 01844' },
        { value: 'walmart-ma-north-attleboro', label: 'North Attleboro — 1470 S Washington St, MA 02760' },
        { value: 'walmart-ma-northborough', label: 'Northborough — 200 Otis St, MA 01532' },
        { value: 'walmart-ma-plymouth', label: 'Plymouth — 300 Colony Place Rd, MA 02360' },
        { value: 'walmart-ma-quincy', label: 'Quincy — 301 Falls Blvd, MA 02169' },
        { value: 'walmart-ma-raynham', label: 'Raynham — 36 Paramount Dr, MA 02767' },
        { value: 'walmart-ma-seekonk', label: 'Seekonk — 1180 Fall River Ave, MA 02771' },
        { value: 'walmart-ma-swansea', label: 'Swansea — 54 Cousineau Dr, MA 02777' },
        { value: 'walmart-ma-tewksbury', label: 'Tewksbury — 333 Main St, MA 01876' },
        { value: 'walmart-ma-walpole', label: 'Walpole — 550 Providence Hwy, MA 02081' },
        { value: 'walmart-ma-wareham', label: 'Wareham — 15 Tobey Rd, MA 02571' },
        { value: 'walmart-ma-weymouth', label: 'Weymouth — 740 Middle St, MA 02188' },
        { value: 'walmart-ma-whitinsville', label: 'Whitinsville — 100 Valley Pkwy, MA 01588' },
        { value: 'walmart-ma-west-boylston', label: 'West Boylston — 137 W Boylston St, MA 01583' },
        { value: 'walmart-ma-worcester', label: 'Worcester — 25 Tobias Boland Way, MA 01607' },
        { value: 'walmart-ma-north-dartmouth', label: 'North Dartmouth — 506 State Rd, MA 02747' },
        { value: 'walmart-ma-fall-river', label: 'Fall River — 638 Quequechan St, MA 02721' },
        { value: 'walmart-ma-hudson', label: 'Hudson — 254 Lowell Rd, NH 03051' },
        { value: 'walmart-ma-north-oxford', label: 'North Oxford — 742 Main St, MA 01537' },
        { value: 'walmart-ma-lunenburg', label: 'Lunenburg — 301 Massachusetts Ave, MA 01462' }
      ],
      Target: [
        { value: 'target-ma-abington-385-centre-ave', label: 'Abington — 385 Centre Ave, MA' },
        { value: 'target-ma-boston-860-commonwealth-ave', label: 'Boston — 860 Commonwealth Ave, MA' },
        { value: 'target-ma-boston-100-cambridge-st-ste-2', label: 'Boston — 100 Cambridge St, Ste 2, MA' },
        { value: 'target-ma-boston-1341-boylston-st', label: 'Boston — 1341 Boylston St, MA' },
        { value: 'target-ma-braintree-250-granite-st', label: 'Braintree — 250 Granite St, MA' },
        { value: 'target-ma-burlington-34-cambridge-st-ste-145', label: 'Burlington — 34 Cambridge St, Ste 145, MA' },
        { value: 'target-ma-cambridge-822-somerville-ave', label: 'Cambridge — 822 Somerville Ave, MA' },
        { value: 'target-ma-cambridge-564-massachusetts-ave', label: 'Cambridge — 564 Massachusetts Ave, MA' },
        { value: 'target-ma-danvers-240-independence-way', label: 'Danvers — 240 Independence Way, MA' },
        { value: 'target-ma-dorchester-500-geneva-ave', label: 'Dorchester — 500 Geneva Ave, MA' },
        { value: 'target-ma-dorchester-7-allstate-rd', label: 'Dorchester — 7 Allstate Rd, MA' },
        { value: 'target-ma-everett-1-mystic-view-rd', label: 'Everett — 1 Mystic View Rd, MA' },
        { value: 'target-ma-framingham-400-cochituate-rd', label: 'Framingham — 400 Cochituate Rd, MA' },
        { value: 'target-ma-hadley-367-russell-st', label: 'Hadley — 367 Russell St, MA' },
        { value: 'target-ma-hanover-1167-washington-st', label: 'Hanover — 1167 Washington St, MA' },
        { value: 'target-ma-haverhill-35-computer-dr', label: 'Haverhill — 35 Computer Dr, MA' },
        { value: 'target-ma-holyoke-50-holyoke-st', label: 'Holyoke — 50 Holyoke St, MA' },
        { value: 'target-ma-hyannis-793-iyannough-rd', label: 'Hyannis — 793 Iyannough Rd, MA' },
        { value: 'target-ma-kingston-101-independence-mall-way', label: 'Kingston — 101 Independence Mall Way, MA' },
        { value: 'target-ma-lanesborough-655-cheshire-rd', label: 'Lanesborough — 655 Cheshire Rd, MA' },
        { value: 'target-ma-leominster-86-orchard-hill-park-dr', label: 'Leominster — 86 Orchard Hill Park Dr, MA' },
        { value: 'target-ma-lowell-181-plain-st', label: 'Lowell — 181 Plain St, MA' },
        { value: 'target-ma-marlborough-605-boston-post-rd-e', label: 'Marlborough — 605 Boston Post Rd E, MA' },
        { value: 'target-ma-marlborough-423-donald-lynch-blvd', label: 'Marlborough — 423 Donald Lynch Blvd, MA' },
        { value: 'target-ma-medford-471-salem-st', label: 'Medford — 471 Salem St, MA' },
        { value: 'target-ma-methuen-67-pleasant-valley-st', label: 'Methuen — 67 Pleasant Valley St, MA' },
        { value: 'target-ma-milford-250-fortune-blvd', label: 'Milford — 250 Fortune Blvd, MA' },
        { value: 'target-ma-millbury-70-worcester-providence-tpke-100', label: 'Millbury — 70 Worcester Providence Tpke #100, MA' },
        { value: 'target-ma-north-attleboro-1205-s-washington-st', label: 'North Attleboro — 1205 S Washington St, MA' },
        { value: 'target-ma-north-dartmouth-479-state-rd', label: 'North Dartmouth — 479 State Rd, MA' },
        { value: 'target-ma-plainville-91-taunton-st', label: 'Plainville — 91 Taunton St, MA' },
        { value: 'target-ma-quincy-289-hancock-st', label: 'Quincy — 289 Hancock St, MA' },
        { value: 'target-ma-revere-36-furlong-dr', label: 'Revere — 36 Furlong Dr, MA' },
        { value: 'target-ma-roslindale-4165-washington-st', label: 'Roslindale — 4165 Washington St, MA' },
        { value: 'target-ma-salem-227-highland-ave', label: 'Salem — 227 Highland Ave, MA' },
        { value: 'target-ma-saugus-400-lynn-fells-pkwy', label: 'Saugus — 400 Lynn Fells Pkwy, MA' },
        { value: 'target-ma-seekonk-79-commerce-way', label: 'Seekonk — 79 Commerce Way, MA' },
        { value: 'target-ma-somerville-180-somerville-ave', label: 'Somerville — 180 Somerville Ave, MA' },
        { value: 'target-ma-south-easton-41-robert-dr', label: 'South Easton — 41 Robert Dr, MA' },
        { value: 'target-ma-stoneham-113-main-st', label: 'Stoneham — 113 Main St, MA' },
        { value: 'target-ma-stoughton-1-hawes-way', label: 'Stoughton — 1 Hawes Way, MA' },
        { value: 'target-ma-swansea-579-gar-hwy', label: 'Swansea — 579 GAR Hwy, MA' },
        { value: 'target-ma-taunton-81-taunton-depot-dr', label: 'Taunton — 81 Taunton Depot Dr, MA' },
        { value: 'target-ma-wareham-2421-cranberry-hwy', label: 'Wareham — 2421 Cranberry Hwy, MA' },
        { value: 'target-ma-watertown-550-arsenal-st', label: 'Watertown — 550 Arsenal St, MA' },
        { value: 'target-ma-westborough-330-turnpike-rd', label: 'Westborough — 330 Turnpike Rd, MA' },
        { value: 'target-ma-westwood-221-university-ave', label: 'Westwood — 221 University Ave, MA' },
        { value: 'target-ma-wilmington-210-ballardvale-st', label: 'Wilmington — 210 Ballardvale St, MA' },
        { value: 'target-ma-woburn-101-commerce-way', label: 'Woburn — 101 Commerce Way, MA' },
        { value: 'target-ma-worcester-529-lincoln-st', label: 'Worcester — 529 Lincoln St, MA' }
      ]
    },

    NH: {
      Walmart: [
        { value: 'walmart-nh-amherst', label: 'Amherst — 85 State Route 101A, NH 03031' },
        { value: 'walmart-nh-concord', label: 'Concord — 344 Loudon Rd, NH 03301' },
        { value: 'walmart-nh-derry', label: 'Derry — 11 Ashleigh Dr, NH 03038' },
        { value: 'walmart-nh-epping', label: 'Epping — 35 Fresh River Rd, NH 03042' },
        { value: 'walmart-nh-keene', label: 'Keene — 350 Winchester St, NH 03431' },
        { value: 'walmart-nh-manchester', label: 'Manchester — 725 Gold St, NH 03103' },
        { value: 'walmart-nh-rochester', label: 'Rochester — 116 Farmington Rd, NH 03867' },
        { value: 'walmart-nh-salem', label: 'Salem — 326 N Broadway, NH 03079' },
        { value: 'walmart-nh-west-lebanon', label: 'West Lebanon — 285 Plainfield Rd, NH 03784' }
      ],
      Target: [
        { value: 'target-nh-bedford-220-s-river-rd', label: 'Bedford — 220 S River Rd, NH' },
        { value: 'target-nh-concord-80-damante-dr', label: 'Concord — 80 Damante Dr, NH' },
        { value: 'target-nh-greenland-1450-greenland-rd', label: 'Greenland — 1450 Greenland Rd, NH' },
        { value: 'target-nh-hooksett-100-quality-dr', label: 'Hooksett — 100 Quality Dr, NH' },
        { value: 'target-nh-keene-46-ash-brook-rd', label: 'Keene — 46 Ash Brook Rd, NH' },
        { value: 'target-nh-nashua-600-amherst-st', label: 'Nashua — 600 Amherst St, NH' },
        { value: 'target-nh-nashua-310-daniel-webster-hwy', label: 'Nashua — 310 Daniel Webster Hwy, NH' },
        { value: 'target-nh-salem-203-s-broadway', label: 'Salem — 203 S Broadway, NH' },
        { value: 'target-nh-somersworth-11-andrews-rd', label: 'Somersworth — 11 Andrews Rd, NH' },
        { value: 'target-nh-west-lebanon-200-s-main-st-unit-24', label: 'West Lebanon — 200 S Main St, Unit 24, NH' }
      ]
    },

    VT: {
      Target: [
        { value: 'target-vt-south-burlington-155-dorset-st', label: 'South Burlington — 155 Dorset St, VT' }
      ]
    }
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
      { value: 'CT', label: 'Connecticut' },
      { value: 'ME', label: 'Maine' },
      { value: 'MA', label: 'Massachusetts' },
      { value: 'NH', label: 'New Hampshire' },
      { value: 'RI', label: 'Rhode Island' },
      { value: 'VT', label: 'Vermont' }
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
