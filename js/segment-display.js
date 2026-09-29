/** קבוצות תצוגה בלבד. ה-IDs ברשומות ובמקטע ״כללי״ נשארים כפי שהם. */
export function segmentGroups(segments) {
  const places = segments.filter(s => s.kind !== 'general');
  const general = segments.filter(s => s.kind === 'general');
  if (places.length === 1) {
    return [{ segment: places[0], ids: [places[0].id, ...general.map(s => s.id)] }];
  }
  return segments.map(segment => ({ segment, ids: [segment.id] }));
}

export function displaySegmentTotals(groups, totals) {
  return groups.map(({ segment, ids }) => {
    const rows = totals.filter(row => ids.includes(row.id));
    const amount = Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
    const allocation = Math.round(rows.reduce((sum, row) => sum + row.allocation, 0) * 100) / 100;
    return { ...segment, amount, allocation, remaining: Math.round((allocation - amount) * 100) / 100,
      over: allocation > 0 && amount > allocation, ids };
  });
}
