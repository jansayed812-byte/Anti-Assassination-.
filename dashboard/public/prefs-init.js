/* Applies the saved language, direction and theme before the app paints (external file: CSP forbids inline scripts). */
try {
  var p = JSON.parse(localStorage.getItem('ops.prefs') || '{}');
  var l = p.lang === 'ps' || p.lang === 'en' ? p.lang : 'dr';
  document.documentElement.lang = l === 'en' ? 'en' : l === 'ps' ? 'ps-AF' : 'fa-AF';
  document.documentElement.dir = l === 'en' ? 'ltr' : 'rtl';
  document.documentElement.dataset.theme = p.theme === 'light' ? 'light' : 'dark';
} catch (e) { /* storage unavailable */ }
