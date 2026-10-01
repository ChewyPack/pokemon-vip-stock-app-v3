/*
 * DISCORD MESSAGE BUILDER
 *
 * Pure functions: a cleaned report goes in, a Discord webhook payload comes out.
 * Change how alerts look here without touching the form or the endpoint.
 */

const GREEN = 0x2fbf4b;
const RED = 0xe5312b;

// Strip control characters, links and markdown so member text can't format or spam the channel.
export function sanitize(text, max = 200) {
  let s = String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/https?:\/\/\S+/gi, '[link removed]')
    .replace(/([\\*_~`|>])/g, '\\$1')
    .replace(/@/g, '@\u200b')
    .trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

export function isInStock(report) {
  return report.stillThere === 'Yes';
}

export function buildAlert(report, { roleId = '', photoNames = [] } = {}) {
  const inStock = isInStock(report);
  const ts = Math.floor(Date.parse(report.seenAt) / 1000);
  const priceText = report.price ? `$${report.price}` : 'Not given';

  const fields = [
    { name: 'Status', value: inStock ? '🟢 In stock when reported' : '🔴 Sold out', inline: true },
    { name: 'Quantity seen', value: sanitize(report.qty, 20), inline: true },
    { name: 'Price', value: `${priceText} (${sanitize(report.priceType, 20)})`, inline: true },
    { name: 'Where in store', value: sanitize(report.productLocated, 60), inline: true },
    { name: 'Seen', value: `<t:${ts}:R> (<t:${ts}:t>)`, inline: true }
  ];

  if (report.notes) {
    fields.push({ name: 'Notes', value: sanitize(report.notes, 500), inline: false });
  }

  const embed = {
    title: `${inStock ? '🟢' : '🔴'} ${sanitize(report.product, 60)} at ${sanitize(report.retailer, 60)}`,
    description: `📍 **${sanitize(report.location, 100)}**`,
    color: inStock ? GREEN : RED,
    fields,
    footer: {
      text: `Reported by ${sanitize(report.reporter, 60)}. Inventory changes fast, so verify before you travel.`
    },
    timestamp: new Date(ts * 1000).toISOString()
  };

  if (photoNames.length) {
    embed.image = { url: `attachment://${photoNames[0]}` };
  }

  const payload = {
    username: 'Pokémon VIP Stock Alerts',
    embeds: [embed],
    allowed_mentions: { parse: [] }
  };

  if (inStock && /^\d{5,25}$/.test(roleId)) {
    payload.content = `<@&${roleId}>`;
    payload.allowed_mentions = { parse: [], roles: [roleId] };
  }

  if (photoNames.length) {
    payload.attachments = photoNames.map((filename, id) => ({ id, filename }));
  }

  return { payload, inStock };
}
