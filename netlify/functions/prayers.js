
/**
 * Salati TV - Prayer Times Service
 * Source: https://prayers.qa
 * Netlify Serverless Function
 */

const clean = html => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function parsePrayerTimes(html) {
  const text = clean(html);

  const match = text.match(
    /(?:الأذان|اذان)\s*[:：]?\s*(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})/
  );

  if (!match) {
    throw Error("Prayer time table not recognized");
  }

  const all = [];

  for (let i = 1; i <= 11; i += 2) {
    const hh = Number(match[i]);
    const mm = Number(match[i + 1]);

    if (hh > 23 || mm > 59) {
      throw Error("Invalid prayer time");
    }

    all.push(hh * 60 + mm);
  }

 
  // Convert afternoon prayer times to 24-hour format.
  // Source order: Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha.

  function afternoon(minutes) {
    const hour = Math.floor(minutes / 60);

    // 12:xx remains 12:xx.
    // 1:xx through 11:xx becomes 13:xx through 23:xx.
    return hour >= 1 && hour <= 11
      ? minutes + 12 * 60
      : minutes;
  }

  const times = [
    all[0],             // Fajr
    all[2],             // Dhuhr
    afternoon(all[3]),  // Asr
    afternoon(all[4]),  // Maghrib
    afternoon(all[5])   // Isha
  ];


  if (times.some((n, i) => i > 0 && n <= times[i - 1])) {
    throw Error("Unexpected prayer time order");
  }

  return times;
}

function dateForQatar() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Qatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(p => [p.type, p.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

exports.handler = async function(event) {
  const date = dateForQatar();

  if (event.queryStringParameters?.date !== date) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Only today is supported"
      })
    };
  }

  const diagnostics = [];

  const urls = [
    "https://prayers.qa/iphone.php",
    "https://prayers.qa/"
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 SalatiTV/2.0"
        },
        signal: AbortSignal.timeout(9000)
      });

      if (!response.ok) {
        diagnostics.push({
          site: url,
          http: response.status
        });
        continue;
      }

      const html = await response.text();

      const parts = date.split("-");
      const day = Number(parts[2]);
      const month = Number(parts[1]);
      const year = parts[0];

      const normalized = clean(html).replace(
        /[٠-٩]/g,
        c => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))
      );

      const datePattern = new RegExp(
        "(?:^|\\D)" + day +
        "\\s+[\\p{L}\\s]+" +
        year + "(?:\\s*م)?",
        "u"
      );

      const numericPattern = new RegExp(
        "(?:^|\\D)" + day +
        "[\\/-]" + month +
        "[\\/-]" + year +
        "(?:\\D|$)"
      );

      if (
        !datePattern.test(normalized) &&
        !numericPattern.test(normalized)
      ) {
        diagnostics.push({
          site: url,
          reason: "source_date_mismatch"
        });
        continue;
      }

      const times = parsePrayerTimes(html);

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=300"
        },
        body: JSON.stringify({
          source: "prayers.qa",
          date: date,
          times: times
        })
      };

    } catch (error) {
      diagnostics.push({
        site: url,
        reason: "fetch_or_parse_failed",
        detail: String(error.message || error).slice(0, 100)
      });
    }
  }

  return {
    statusCode: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({
      error: "Prayer times unavailable or unverified",
      date: date,
      diagnostics: diagnostics
    })
  };
};
