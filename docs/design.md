# SHARE Equipment Borrowing Log: design

Date: 2026-10-15.
Status: accepted, not implemented.

## 1. Understanding summary

- The app is the SHARE Equipment Borrowing Log.
- The app records each item that goes out of the unit and each item that comes back.
- Any person who borrows unit equipment uses the app.
- Unit staff read the Google Sheet to see the log.
- The borrower signs out equipment with a name, an email, a department, and a contact number.
- The borrower signs the equipment back in with the same email.
- A daily Apps Script job sends a reminder from `share@spmcdvo.net` to each borrower with overdue items.
- The page is a dark cyberpunk 3D parallax landing page with an animated background and the SHARE, SPMC, and SKTI logos.

## 2. Non-goals

- No staff page.
- No staff confirmation of a return.
- No password, PIN, or Google sign-in.
- No QR tags.
- No daily digest to the unit.
- No email at borrow time.

## 3. Assumptions

- A1: One borrow form can hold more than one item. A return can be partial, one item at a time.
- A2: The return form has an optional condition (Good, Damaged, Missing parts) and an optional note.
- A3: The reminder job runs at 8:00 AM Asia/Manila and sends one email per borrower.
- A4: `spmcdvo.net` is a Google Workspace domain with a limit of 1,500 emails per day.
- A4 scale: fewer than 50 catalog items and fewer than 30 loans per day.
- A5: The Sheet stays private. The public repository holds the `/exec` address only, not the Sheet ID.
- A6: The return lookup shows item names and dates only. It never shows a contact number.
- A6 accepted risk: a person who types a borrower email can see the open items of that borrower.
- A7: `LockService` prevents two borrowers from taking the same item at the same time.
- A8: The project folder is `D:\al projects\share-equipment-log`, in a new public repository under `almanalaysay93-gif`.
- A8 deploy: the Sheet and the script are in the `share@spmcdvo.net` Drive, and the user clicks Deploy.
- A9: The palette is neon cyan and magenta on near-black, with SHARE green as an accent.
- A10: The borrow form shows the email in large text before submit, because a wrong email blocks reminders.
- Q1 default: the agent seeds sample catalog rows, and the user replaces them.

## 4. Architecture

1. A static site (`index.html`, `css/`, `js/`) on GitHub Pages, with no build step.
2. An Apps Script web app (`apps-script/Code.gs`) that runs as `share@spmcdvo.net` with access Anyone.
3. A Google Sheet "SHARE Equipment Log" bound to the script.

### 4.1 Sheet tabs

| Tab | Columns |
|---|---|
| Equipment | ItemID, Name, Category, Active (Y/N), Notes |
| Loans | LoanID, ItemID, ItemName, BorrowerName, Email, Department, Contact, BorrowedAt, DueDate, ReturnedAt, Condition, ReturnNote, Status (OUT/RETURNED), LastReminderAt, ReminderCount |
| Log | Timestamp, Action (BORROW/RETURN/REMINDER/ERROR), LoanID, Email, Detail |

- Each Loans row holds one item.
- A multi-item borrow writes one row per item, and the rows share a batch prefix in `LoanID`.
- An item is out when a Loans row has its `ItemID` and `Status` OUT.
- The app does not keep a stock counter column.
- The Log tab is an append-only audit trail.

### 4.2 API

| Method | Action | Result |
|---|---|---|
| GET | `catalog` | Items with an `available` flag |
| POST | `borrow` | Loan IDs, or error `ITEM_OUT` or `INVALID` |
| POST | `lookup` | Open loans for one email |
| POST | `return` | Closes the chosen loan IDs |

- The page posts JSON as `text/plain` to avoid a CORS preflight.
- `LockService` wraps borrow and return.
- Borrow checks availability again inside the lock.
- The server validates the email format.
- The server accepts a due date from today (Asia/Manila) up to 90 days ahead.
- The server limits the length of name, department, contact, and note.
- The server accepts only active items for a borrow.

### 4.3 Daily reminder job

- A time trigger runs the job at 8:00 AM Asia/Manila.
- The job groups OUT rows with `DueDate` before today by email.
- The job sends one `MailApp` email for each borrower.
- The job updates `LastReminderAt` and `ReminderCount` and writes a Log row.
- The job skips a row that already has a reminder today, so a second trigger run sends nothing.

## 5. Page and flows

### 5.1 Page structure

1. Hero: the SHARE logo on a near layer, the SPMC and SKTI logos in the header, the title, and Borrow and Return buttons.
2. Status strip: the count of items out and items available.
3. Borrow panel: a glass card with a cyan edge.
4. Return panel: a glass card with a magenta edge.
5. How it works: three steps and a note about the daily reminder.
6. Footer: the logos and the `share@spmcdvo.net` contact.

### 5.2 Borrow flow

1. The borrower enters full name, email, department, and contact number.
2. The borrower selects items in a searchable list. An item that is out shows "Out" and is disabled.
3. The borrower selects the expected return date.
4. The page shows the email in large text for a check.
5. The borrower submits.
6. The page shows the loan IDs, the items, and the due date.

- On `ITEM_OUT`, the page refreshes the list, marks the item, and keeps the other form values.

### 5.3 Return flow

1. The borrower enters the email and selects Find.
2. The page lists the open loans with one checkbox each.
3. The borrower selects the returned items and an optional condition and note.
4. The borrower submits.
5. The page lists the returned items and the items that are still out.

- When no open loan exists, the page shows a plain message.

### 5.4 3D and motion

- The stage uses `perspective: 1200px`.
- The layers from far to near are the video background, a tilted neon grid, the logo and title, and the form cards.
- Pointer tilt is at most 6 degrees.
- Scroll parallax applies to the hero only.
- A form card has no transform while one of its fields has focus.
- With reduced motion, a static poster replaces the video and tilt is off.
- The background is a HyperFrames loop in WebM and MP4, landscape and portrait.
- A canvas grid is the fallback when autoplay fails or the video does not load.

### 5.5 Visual

- Background `#05070d`, cyan `#00f0ff`, magenta `#ff2bd6`, accent `#3ddc84`.
- Text contrast is at least 4.5:1.
- Headings use Orbitron. Form and body text use Inter.
- Glitch and scanline effects apply to headings only.

### 5.6 Accessibility

- Each field has a label.
- Each touch target is at least 44 px.
- The full flow works with a keyboard.
- The focus ring is visible.
- Errors are in an `aria-live` region.

## 6. Reminder email

- Sender: `share@spmcdvo.net`.
- Subject: "Overdue equipment: please return to SHARE".
- Body: the borrower name, a table of overdue items (item, borrowed, due, days overdue), the page link, and the unit contact.
- The email has an HTML part and a plain text part.

## 7. Error handling

- When the `/exec` address is not reachable, the page shows "Cannot reach log. Try again." and keeps the form data.
- The server returns `{ok:false, code, message}` on error.
- Error codes: `INVALID`, `ITEM_OUT`, `NOT_FOUND`, `BUSY` (lock wait over 10 s), `SERVER`.
- The server writes a Log row with action ERROR for each server error.
- When the mail quota is used up, the job stops, writes an ERROR row, and continues the next day.

## 8. Edge cases

- E1: Two borrowers take the same item in the same second. The lock and the second check return `ITEM_OUT` to one of them.
- E2: A borrower returns a loan that is already returned. The server skips it and reports "already returned".
- E3: Emails differ in case or spaces. The server stores and matches the email in lowercase with no outer spaces.
- E4: An item becomes inactive while it is out. The item stays returnable and is not borrowable.
- E5: A client clock is wrong. The server uses the Asia/Manila date for all date checks.
- E6: A value starts with `=`, `+`, `-`, or `@`. The server adds a leading `'` to prevent formula injection.
- E7: A borrower types a wrong email. The large email check before submit reduces this risk.

## 9. Testing

- Unit tests in `tests/*.test.mjs` with `node:test` cover validation, overdue grouping, Asia/Manila date math, and the injection escape.
- Each new test is mutation-checked.
- A stub-Sheet probe runs `Code.gs` without Google.
- After deploy, a live run covers borrow, `ITEM_OUT`, return, partial return, and one manual reminder run with a past-due test row.
- Chrome checks at 1440 px, 390 px, and 320 px confirm no page overflow, no console errors, and the reduced-motion path.

## 10. Decision log

| ID | Decision | Alternatives | Reason |
|---|---|---|---|
| D1 | Daily email to borrowers with overdue items only | Unit digest, all borrowers | Least noise and a clear action |
| D2 | Fixed catalog in the Sheet | QR tags, free text | Availability check and clean return match |
| D3 | Name, email, department, contact, no password | PIN, Google sign-in | Any person can borrow with low friction |
| D4 | Borrower sets the due date, reminders start after it | No due date, fixed period | Reminders go to true overdue loans only |
| D5 | Self-service return, staff read the Sheet | Staff page, staff confirm | User choice and the smallest scope |
| D6 | GitHub Pages and Apps Script `/exec` | Apps Script page only, Vercel | Design freedom and a proven pattern |
| D7 | SHARE is the primary brand | SKTI, SPMC, all equal | Matches the sender account |
| D8 | CSS 3D, HyperFrames loop, canvas fallback | Three.js, canvas only | Fast on phones and the form comes first |
| D9 | One Loans row per item, status from rows | Stock counter column | No count drift |
