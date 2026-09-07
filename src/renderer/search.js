(function exposeWaveDeckSearch(root) {
  const SEARCH_FIELDS = ["name", "group", "subgroup", "country", "description", "url"];

  function normalizeSearchText(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .trim();
  }

  function stationMatchesQuery(station, query) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    return SEARCH_FIELDS.some((field) => (
      normalizeSearchText(station?.[field]).includes(normalizedQuery)
    ));
  }

  const api = { SEARCH_FIELDS, normalizeSearchText, stationMatchesQuery };
  if (root) root.WaveDeckSearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : null));
