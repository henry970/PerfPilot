# PerfPilot

PDF reports use the performance-test artwork in `assets/report-cover.png` as their first page and the completed-test summary artwork in `assets/report-ending.png` as their final page; detailed performance results appear between them. The first page shows the target domain, run date and time, website URL, and PerfPilot as the test tool. The final page shows the target domain, average response time, virtual users, success rate, total requests, and successful, failed, and timed-out request counts from that run.

## Importing requests

In **Full plan**, press **Import cURL / HAR**:

- **cURL**: in DevTools > Network, right-click a request > *Copy as cURL (bash)* or *(cmd)* and paste it. *Copy all as cURL* works too; each command becomes one request.
- **HAR**: paste the JSON or press **Open .har file** (DevTools > Network > *Save all as HAR*). Scripts, styles, images, CORS preflights, analytics and duplicates are skipped by default.

Imported requests are replayed as-is (no invented assertions), and login tokens are linked the same way as with recording.

## Comparing runs

In **Test history**, press **Baseline** on a good run. Every later run, or any run you view, then shows a *Compared with baseline* table with the change in average, P95, error rate and throughput, plus per-request averages. Changes under 5% (or 0.5 points for the error rate) count as no real change.

## Publishing

```
npm test
npm run pack
```

`npm run pack` writes `dist/perfpilot-<version>.zip` with `manifest.json` at the zip root, ready for the Chrome Web Store. Bump `version` in `manifest.json` before each upload.
