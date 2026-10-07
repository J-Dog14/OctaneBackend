/*
 * Pitch Intelligence embed shim (ours, not Ryan's). Loaded by athletes.html
 * before Ryan's athletes-v2.js.
 *
 * - Points his data calls at this app's adapter instead of his Google Sheet.
 * - ?athlete=<athlete_uuid> opens that athlete's profile directly.
 */
(function () {
  var API = "/api/dashboard/pitch-intel/legacy";
  try {
    localStorage.setItem("8ctane_script_url", API);
  } catch (e) {
    /* storage blocked: handled below */
  }

  window.addEventListener("DOMContentLoaded", function () {
    // If storage was blocked, athletes-v2.js started without a URL; set it and load.
    // eslint-disable-next-line no-undef
    if (typeof SCRIPT_URL !== "undefined" && !SCRIPT_URL) {
      // eslint-disable-next-line no-undef
      SCRIPT_URL = API;
      // eslint-disable-next-line no-undef
      if (typeof loadRoster === "function") loadRoster();
    }
    var athleteId = new URLSearchParams(location.search).get("athlete");
    if (athleteId && typeof window.openProfile === "function") {
      // After Ryan's own DOMContentLoaded handler has wired up the tabs.
      setTimeout(function () {
        window.openProfile(athleteId);
      }, 0);
    }
  });
})();
