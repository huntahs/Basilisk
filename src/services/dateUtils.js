// Shared helper for getting "today's date" (and calendar-day arithmetic) in
// Central time, regardless of what timezone the host server runs in. Used
// by the workout log streak system and its 9 PM progress check job.

function getChicagoDateStr(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Given a "YYYY-MM-DD" string, returns the previous calendar day as the
 * same format. Uses UTC internally purely for safe date arithmetic (no DST
 * concerns) - this is pure calendar math, not a timezone conversion.
 */
function getPreviousDateStr(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

module.exports = { getChicagoDateStr, getPreviousDateStr };
