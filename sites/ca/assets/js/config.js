/* ==========================================================================
   SITE CONFIGURATION
   --------------------------------------------------------------------------
   This is the ONLY file you need to edit to change where the booking buttons
   point. Everything else in the site reads from here.

   1. Paste your booking/calendar URL into `bookingUrl` below
      (Jane App, Owl Practice, Calendly, Google Calendar appointments…).
   2. Save. Every button marked `data-book` now points there.

   While `bookingUrl` is empty, those buttons keep the href written in the
   HTML — an email to info@cristinamagrina.ca with the subject pre-filled —
   so the site works with or without JavaScript.
   ========================================================================== */

window.SITE_CONFIG = {
  /* Full https:// URL of the external booking calendar. Leave "" to use email. */
  bookingUrl: "",

  /* Open the booking link in a new tab. */
  bookingNewTab: true,

  /* Practice email — used as the fallback and in the mailto links. */
  email: "info@cristinamagrina.ca"
};
