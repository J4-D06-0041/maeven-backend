// The business runs in the Philippines (UTC+8, no DST). A "business day" is a
// Manila calendar day, so SQL day filters must be bounded at Manila midnight,
// not at the database session's (usually UTC) midnight.
const BUSINESS_TZ = 'Asia/Manila';

// orders.created_at and payments.payment_date are `timestamp without time
// zone` in production (see SCHEMA-DRIFT.md): they hold a bare clock reading
// with no zone. The app writes them in UTC (the POS sends toISOString(), and
// now() runs in a UTC session on Render). Override if the database session
// is ever configured otherwise.
const NAIVE_TIMESTAMP_TZ = process.env.DB_NAIVE_TIMESTAMP_TZ || 'UTC';

// Manila midnight for the date in `param` (e.g. '$2'), expressed to match the
// column type: timestamptz columns compare against an instant; naive columns
// compare against the clock reading that instant has in NAIVE_TIMESTAMP_TZ.
function manilaMidnight(param, { naive, plusDays = 0 }) {
  const instant = `((${param}::date + ${plusDays})::timestamp AT TIME ZONE '${BUSINESS_TZ}')`;
  return naive ? `(${instant} AT TIME ZONE '${NAIVE_TIMESTAMP_TZ}')` : instant;
}

/**
 * SQL predicate: `column` falls on the Manila business day(s) from
 * `startParam` to `endParam` inclusive (both are date placeholders such as
 * '$1'). Pass the same placeholder twice for a single day.
 */
function dayRange(column, startParam, endParam, { naive = false } = {}) {
  return `${column} >= ${manilaMidnight(startParam, { naive })} `
    + `AND ${column} < ${manilaMidnight(endParam, { naive, plusDays: 1 })}`;
}

// Today's business date (YYYY-MM-DD) in Manila.
function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

module.exports = { BUSINESS_TZ, dayRange, businessDate };
