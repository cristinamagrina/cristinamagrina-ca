/* ==========================================================================
   SITE CONFIGURATION (cristinamagrina.es)
   --------------------------------------------------------------------------
   Controls where the booking buttons point. Every button marked `data-book`
   reads from here.

   1. Paste your booking/calendar URL into `bookingUrl` below.
   2. Save and rebuild.

   While `bookingUrl` is empty, those buttons keep the href written in the
   HTML (an email to the practice address with the subject pre-filled), so the
   site works with or without JavaScript.

   NOTE: keep `email` in sync with "email" in sites/es/site.json.
   ========================================================================== */

window.SITE_CONFIG = {
  /* Full https:// URL of the external booking calendar. Leave "" to use email. */
  bookingUrl: "",

  /* Open the booking link in a new tab. */
  bookingNewTab: true,

  /* Practice email used as the fallback. TO CONFIRM: this address is a placeholder. */
  email: "info@cristinamagrina.es"
};
