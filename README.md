# SHARE Equipment Borrowing Log

A public page where a borrower signs SHARE unit equipment out and back in.
A Google Sheet stores the log.
An Apps Script web app reads and writes the Sheet.
The same script sends a daily reminder to each borrower with overdue items.

Live page: https://almanalaysay93-gif.github.io/share-equipment-log/

The accepted design is in [docs/design.md](docs/design.md).

## Parts

| Path | Purpose |
|---|---|
| `index.html`, `css/`, `js/` | The static page, served by GitHub Pages. No build step. |
| `js/config.js` | The `/exec` address of the web app. Empty means demo mode. |
| `apps-script/Code.gs` | The web app and the daily reminder job. |
| `apps-script/appsscript.json` | The script manifest (time zone Asia/Manila). |
| `media/` | The background loop video (WebM, MP4, poster). |
| `videos/bg-loop`, `videos/bg-loop-portrait` | The HyperFrames sources of the background loop. |
| `tests/` | Unit tests of `Code.gs` against an in-memory Sheet. |

## Set up the Sheet and the script

Do these steps signed in as `share@spmcdvo.net`.
The reminder email comes from the account that owns the script.

1. Create a Google Sheet named "SHARE Equipment Log".
2. Open Extensions > Apps Script.
3. Replace `Code.gs` with `apps-script/Code.gs`.
4. Open Project Settings and select "Show appsscript.json manifest file in editor".
5. Replace `appsscript.json` with `apps-script/appsscript.json`.
6. Select the function `setup` and select Run. Accept the permissions.
7. Check that the tabs Equipment, Loans, and Log exist.
8. Select Deploy > New deployment > Web app.
9. Set "Execute as" to Me and "Who has access" to Anyone.
10. Copy the `/exec` address into `js/config.js` and push.

`setup` adds eight sample items and one daily trigger for `sendOverdueReminders` at 8:00 AM Asia/Manila.
Run `setup` again only to reinstall the trigger. It does not add the sample items a second time.

## Keep the equipment list

Staff edit the Equipment tab directly.

- `ItemID` must be unique, for example `EQ-009`.
- Set `Active` to `Y` to list an item, or `N` to stop new loans of it.
- An inactive item that is out can still be returned.

Do not edit the Loans tab by hand, except to fix a wrong email.
The Log tab is an audit trail.

## Rules

- A borrower can take 1 to 10 items in one form.
- The return date is from today up to 90 days ahead, by the Manila date.
- An item that is out cannot be borrowed until it is returned.
- A return needs the same email that the borrower used.
- Reminders start the day after the return date and repeat once a day until the return.

## Test

```
node --test tests/code.test.mjs
```

Run the test file by its path. A folder path does not find the tests.

## Change the background loop

1. Edit `videos/bg-loop/index.html`. Copy the change to `videos/bg-loop-portrait/index.html`.
2. In each folder, run `npx --yes hyperframes@0.8.149 render --fps 30`.
3. Encode the render to `media/<name>.webm`, `media/<name>.mp4`, and `media/<name>.jpg` with FFmpeg.
