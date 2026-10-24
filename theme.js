/* Apparence uniquement : thème (auto/dark/light) et transparence glass. */
(function () {
  var THEME_KEY = 'simuz-theme';
  var ALPHA_KEY = 'simuz-glass-alpha';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }
  function validTheme(v) { return v === 'auto' || v === 'dark' || v === 'light' ? v : 'auto'; }
  function validAlpha(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return 80;
    return Math.min(95, Math.max(60, n));
  }

  var mode = validTheme(read(THEME_KEY));

  function applyTheme() {
    var t = mode === 'auto' ? (mq && !mq.matches ? 'light' : 'dark') : mode;
    root.setAttribute('data-theme', t);
  }
  function applyAlpha(pct) {
    root.style.setProperty('--glass-alpha', String(pct / 100));
  }

  applyTheme();
  applyAlpha(validAlpha(read(ALPHA_KEY)));

  if (mq) {
    var onChange = function () { if (mode === 'auto') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var radios = document.querySelectorAll('input[name="theme"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = radios[i].value === mode;
      radios[i].addEventListener('change', function (e) {
        if (!e.target.checked) return;
        mode = validTheme(e.target.value);
        write(THEME_KEY, mode);
        applyTheme();
      });
    }
    var slider = document.getElementById('glassAlpha');
    var out = document.getElementById('glassAlphaValue');
    if (slider) {
      var v = validAlpha(read(ALPHA_KEY));
      slider.value = v;
      if (out) out.textContent = v + '%';
      slider.addEventListener('input', function () {
        var n = validAlpha(slider.value);
        if (out) out.textContent = n + '%';
        write(ALPHA_KEY, String(n));
        applyAlpha(n);
      });
    }
  });
})();
