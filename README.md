# KORA W BAS · match updater

A small job that runs on GitHub every 15 minutes (free) and keeps the app's daily football data fresh in Firebase:

- saves yesterday's, today's and tomorrow's matches and live scores (`matches`)
- scores players' predictions once matches finish (`predictions` → `predictionScores`)
- builds the daily quiz from recent results (`dailyQuiz`)

It only calls the football data API when something might have changed (a match is live or about to start, or it is the first run of the day), so it stays far below the free limits.

Data comes from [football-data.org](https://www.football-data.org). The free plan covers the main European leagues, the Champions League and major tournaments, with delayed scores. To add other leagues later, add another provider next to `src/providers/footballData.js` that returns the same match shape, and call it from `src/run.js`.

## One-time setup

1. **Football data key.** Create a free account at football-data.org and copy your API token. Check their terms: the free plan may be limited to non-commercial use, which matters once the app is in the stores.
2. **Firebase service account.** Firebase console → Project settings → Service accounts → Generate new private key. This downloads a JSON file. Keep it private: never commit it or share it.
3. **GitHub repository.** Create a new repository for this folder (public repositories get unlimited free Actions minutes; no secrets are stored in the code). Push this folder to it.
4. **Repository secrets.** In the repository: Settings → Secrets and variables → Actions → New repository secret:
   - `FOOTBALL_DATA_TOKEN` = your football-data.org token
   - `FIREBASE_SERVICE_ACCOUNT` = the full contents of the downloaded JSON file
5. **Run it.** Actions tab → "Update matches" → Run workflow. After a minute, `matches` should appear in Firestore.

GitHub pauses scheduled workflows in repositories with no activity for 60 days. If matches stop updating, open the Actions tab and re-enable the workflow.

## Tests

```bash
npm test
```
