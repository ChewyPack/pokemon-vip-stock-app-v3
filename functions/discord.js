
/*
 * DISCORD STOCK ALERTS
 *
 * Formats reports from the Pokémon VIP stock-report form.
 * Preserves in-stock role pings and photo attachments.
 */

const GREEN = 0x2fbf4b;
const RED = 0xe5312b;

export function sanitize(text, max = 200) {
  let s = String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/https?:\/\/\S+/gi, '[link removed]')
    .replace(/([\\*_~`|>])/g, '\\$1')
    .replace(/@/g, '@\u200b')
    .trim();

  if (s.length > max) {
    s = s.slice(0, max - 1) + '…';
  }

  return s;
}

export function isInStock(report) {
  return report.stillThere === 'Yes';
}

function price(value) {
  if (value === '' || value === null || value === undefined) {
    return 'Not provided';
  }

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 'Not provided';
  }

  return '$' + n.toFixed(2);
}

function seenTimestamp(value) {
  const time = Date.parse(value || '');

  if (Number.isNaN(time)) {
    return null;
  }

  return Math.floor(time / 1000);
}

export function buildAlert(
  report,
  { roleId = '', photoNames = [] } = {}
) {
  const inStock = isInStock(report);
  const ts = seenTimestamp(report.seenAt);

  const retailer = sanitize(report.retailer || 'Unknown retailer', 80);
  const productType = sanitize(report.product || 'Sealed Pokémon product', 80);
  const productName = sanitize(report.productName || '', 100);
  const branchLabel = sanitize(report.branchLabel || '', 150);
  const town = sanitize(report.storeTown || '', 80);
  const address = sanitize(report.storeAddress || '', 150);
  const location = sanitize(report.location || '', 200);

  const productTitle = productName
    ? productType + ' — ' + productName
    : productType;

  const fields = [
    {
      name: 'Stock status',
      value: inStock
        ? '🟢 Still in stock when reported'
        : report.stillThere === 'No'
          ? '🔴 Sold out or gone'
          : '⚪ Stock status unknown',
      inline: false
    },
    {
      name: 'Quantity seen',
      value: sanitize(report.qty || 'Unknown', 30),
      inline: true
    },
    {
      name: 'Shelf price',
      value: price(report.shelfPrice),
      inline: true
    },
    {
      name: 'MSRP',
      value: price(report.msrp),
      inline: true
    },
    {
      name: 'Where in store',
      value: sanitize(report.productLocated || 'Not specified', 100),
      inline: true
    }
  ];

  if (branchLabel) {
    fields.push({
      name: 'Store branch',
      value: branchLabel,
      inline: false
    });
  }

  if (town) {
    fields.push({
      name: 'Town / city',
      value: town,
      inline: true
    });
  }

  if (address) {
    fields.push({
      name: 'Street address',
      value: address,
      inline: true
    });
  }

  if (!branchLabel && location) {
    fields.push({
      name: 'Store location',
      value: location,
      inline: false
    });
  }

  if (report.state) {
    fields.push({
      name: 'State',
      value: sanitize(report.state, 10),
      inline: true
    });
  }

  if (ts !== null) {
    fields.push({
      name: 'Seen',
      value: '<t:' + ts + ':R> (<t:' + ts + ':t>)',
      inline: true
    });
  } else {
    fields.push({
      name: 'Seen',
      value: 'Time not available',
      inline: true
    });
  }

  if (report.notes) {
    fields.push({
      name: 'Notes',
      value: sanitize(report.notes, 1000),
      inline: false
    });
  }

  const embed = {
    title: (inStock ? '🟢 ' : '🔴 ') + productTitle,
    description: '🏪 **' + retailer + '**',
    color: inStock ? GREEN : RED,
    fields,
    footer: {
      text:
        'Reported by ' +
        sanitize(report.submittedByUsername ? '@' + report.submittedByUsername : (report.reporter || 'VIP member'), 60) +
        '. Inventory changes fast — verify before traveling.'
    }
  };

  if (ts !== null) {
    embed.timestamp = new Date(ts * 1000).toISOString();
  }

  if (photoNames.length) {
    embed.image = {
      url: 'attachment://' + photoNames[0]
    };
  }

  const payload = {
    username: 'Pokémon VIP Stock Alerts',
    embeds: [embed],
    allowed_mentions: {
      parse: []
    }
  };

  // Only ping the configured role for reports marked still in stock.
  if (inStock && /^\d{5,25}$/.test(roleId)) {
    payload.content = '<@&' + roleId + '>';
    payload.allowed_mentions = {
      parse: [],
      roles: [roleId]
    };
  }

  if (photoNames.length) {
    payload.attachments = photoNames.map(function (filename, id) {
      return {
        id,
        filename
      };
    });
  }

  return {
    payload,
    inStock
  };
}
