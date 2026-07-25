/* Sixer — Firebase config for live match sharing.
 *
 * Paste your Firebase web config below to enable "Go Live" (many phones watch
 * one match + anyone can take over scoring). These keys are safe to be public.
 *
 * How to get them (about 3 minutes, free):
 *   1. Go to https://console.firebase.google.com  ->  Add project (any name).
 *   2. In the project, open  Build > Realtime Database  ->  Create Database
 *      -> pick a location -> start in TEST MODE (or set the rules shown in the
 *      app's Settings > Live sharing note).
 *   3. Project settings (gear icon) > "Your apps" > Web (</>) -> register app.
 *   4. Copy the values from the firebaseConfig it shows into the object below.
 *
 * Until this is filled in, Sixer works fully offline on a single device.
 */
window.SIXER_FIREBASE = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  appId: ""
};
