# Offer Finder

A mobile-first static app for Sri Lankan credit and debit card offers. Requires Node.js 22 or newer for the local server and data importer. There are no package dependencies or API credentials.

## Run locally

From this folder in PowerShell:

```powershell
npm.cmd run dev
```

Open http://127.0.0.1:4173. A verified bank snapshot is included in `dist/offers.json`. Run `npm.cmd run refresh` to fetch the latest data and `npm.cmd test` to test dates and calendar export.

## Bank sources

- [Sampath Bank](https://www.sampath.lk/sampath-cards/credit-card-offer) uses its public English listing and category APIs. The importer keeps the bank’s category labels and checks all pages of each enabled category.
- [Bank of Ceylon](https://www.boc.lk/personal-banking/card-offers) imports the main listing and linked category pages. The app offers category, card type, search, expiry/validity date range, and name/date sorting for BOC.

The bank links in each offer contain the full eligibility and terms. Offers with no clear card type remain visible under All cards. The calendar uses published offer days when they can be parsed. If the bank publishes an expiry date alone, the calendar shows an expiry reminder. Offers with unclear date restrictions may appear in the offer list only. The device calendar option provides an all-day `.ics` file for the user to review and save. Google Calendar opens a prefilled event. Calendar imports depend on the browser and device calendar app.

## GitHub Pages

Push this folder to a GitHub repository with `main` as its default branch. In **Settings → Pages**, select **GitHub Actions** as the source, then run **Refresh and publish offers** from the Actions tab. The included workflow publishes `dist/` and refreshes it daily at 06:13 Sri Lanka time. If a source is temporarily unavailable or changes its format, the job uses the last successful snapshot for that bank and preserves its original update date.

The `dist/` directory can also be deployed directly to a static host such as Cloudflare Pages or Vercel. On those hosts, refresh the snapshot and redeploy through your chosen build or scheduled workflow.

