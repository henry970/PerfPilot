# PerfPilot Privacy Policy

_Last updated: November 13, 2026_

PerfPilot is a Chrome extension for load testing websites and web APIs that you own or are authorized to test. This policy explains what data the extension handles and what happens to it.

## Summary

PerfPilot does not collect, sell or share your data. It has no server, no analytics and no tracking. Everything it handles stays in your browser on your device.

## Data the extension handles

To do its job, PerfPilot processes the following data **locally in your browser only**:

- **Test plans and settings**: the URLs, headers, request bodies, variables and test data you enter or import.
- **Recorded requests**: when you press _Start recording_, the extension reads the method, URL, headers and body of requests made by the tab you are recording. It stops as soon as you stop recording. It never monitors normal browsing.
- **Login tokens and cookies**: during a test, the extension may read a session or CSRF token cookie for the site under test, so later test requests can send it back. Recorded requests may also contain login details or tokens that you typed into the site.
- **Website responses**: the extension reads the responses to its own test requests to measure timing, check results and extract values you asked for.
- **Results and history**: summaries of your last 30 test runs and the run you chose as a baseline.

## Where data goes

- Plans, settings, history and baseline are saved with Chrome's local extension storage on your device. Recording state is kept in session storage and cleared when the browser closes.
- Test requests are sent **only** to the websites listed in your own test plan, and **only** when you press _Run test_.
- Nothing is sent to the developer of PerfPilot or to any third party.
- Files such as CSV, JSON, .jmx and PDF reports are only created when you choose to export them, and they are saved to your computer.

## What we do not do

- We do not sell or transfer user data to third parties.
- We do not use user data for advertising, profiling or any purpose unrelated to load testing.
- We do not use user data to determine creditworthiness or for lending purposes.

## Removing your data

- Press **Clear** in PerfPilot to remove the current test plan.
- Press **Clear history** to remove saved test runs.
- Uninstalling the extension removes all of its stored data from your browser.

## Changes

If this policy changes, the updated version will be posted at this address with a new "Last updated" date.

## Contact

Questions about this policy: open an issue at https://github.com/henry970/PerfPilot/issues
