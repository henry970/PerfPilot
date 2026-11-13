// PerfPilot per-user session helpers: how each virtual user binds to its own variables and
// test-data row, and whether cookie-based sessions can be isolated. Pure, unit-tested.
(function (root) {
  // The private variable set for one virtual user. Extracted tokens/ids land here, so they
  // can never leak between users.
  function newUser(base, n) { return Object.assign({}, base, { __userId: n + 1 }); }
  // Binds one CSV row to a user. mode 'peruser' pins each user to its own row (one identity
  // for the whole run); mode 'rotate' walks the rows across all users (JMeter shareMode=all).
  function bindRow(vars, rows, n, loop, mode, threads) {
    const list = rows || [];
    if (!list.length) return vars;
    const idx = mode === 'peruser' ? (n % list.length) : ((n + loop * Math.max(1, threads || 1)) % list.length);
    return Object.assign(vars, list[idx]);
  }
  // The browser shares ONE cookie jar across every fetch, so cookie-based sessions cannot be
  // made independent. Returns an explanation when that would silently happen.
  function cookieWarning(plan) {
    const threads = (plan && plan.threads) || 1;
    if (!plan || !plan.cookies || threads <= 1) return '';
    return `Heads up: all ${threads} users share this browser's cookie jar, so cookie-based logins overwrite each other and you are really testing one session. Send an Authorization token instead for true per-user sessions, or export the .jmx (it now includes a Cookie Manager) and run it in JMeter, where every thread gets its own cookies.`;
  }

  root.newUser = newUser;
  root.bindRow = bindRow;
  root.cookieWarning = cookieWarning;
  if (typeof module !== 'undefined') module.exports = { newUser, bindRow, cookieWarning };
})(typeof window !== 'undefined' ? window : globalThis);