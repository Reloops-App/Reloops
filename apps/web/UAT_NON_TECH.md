# Reloops Web App — Manual UAT (Non‑Technical)

Base URL: your local or self-hosted Reloops OSS app, usually `http://127.0.0.1:6173/`.

Use this checklist to verify the app works end-to-end. You don’t need any developer tools.

## Before You Start

- Recommended browser: Chrome (latest)
- You need a test login provided by your team.
- If you’re asked to test “sharing”, you may need a second browser window (Incognito/Private mode).
- When you find a problem, capture:
  - What you clicked + what you expected + what happened
  - A screenshot (or short screen recording)
  - The page URL from the address bar
  - Time + browser used

## Sign In / Sign Out

1. Open `/auth` on your Reloops OSS app.
2. Sign in with your test account.
3. Expected: you land in the main app (usually a Workspaces screen).
4. Open the user menu (top-right or bottom-left user card) and click “Log out”.
5. Expected: you return to the sign-in page and you are no longer inside the app.
6. Try going “Back” in the browser.
7. Expected: you should NOT be able to access private pages; you should be sent back to sign-in.

## Workspaces

1. After signing in, confirm you can see a list of workspaces.
2. Click a workspace to enter it.
3. Expected: you see the workspace area (projects/assets).

### Create Workspace (if enabled for your account)

1. Click “Create workspace”.
2. Choose an organization (if asked) and enter a name like `UAT - <your name> - <today>`.
3. Submit.
4. Expected: the new workspace appears in the list and can be opened.

## Stale Tab / Navigation Reliability

This checks a common issue where the URL changes but the page stays “stuck loading”.

1. Open the app and leave the tab open for ~10–30 minutes (or put your laptop to sleep and wake it up).
2. Come back to the tab.
3. Click a few sidebar items (Projects → Collections → Teams → Settings).
4. Expected: each page shows its content within a few seconds (no endless spinners).
5. If anything is stuck, refresh the page once.
6. Expected after refresh: content loads and the app behaves normally.

## Projects & Assets

1. Enter a workspace.
2. Open a project from the list.
3. Open an asset (image or video) to reach the review screen.
4. Expected: the asset loads and you can see comments/annotations panel.

## Folder and Uploads

- Create a folder
- Upload a folder
- Upload two files
- Download
- Verify

## Comments / Annotations (Review Screen)

On the review screen for an asset:

1. Add a new comment (or annotation) and submit it.
2. Expected: the comment appears in the list immediately.
3. Edit the comment text and save.
4. Expected: the edited text shows up.
5. Mark the comment as completed (if there is a “complete” toggle).
6. Expected: the comment visually changes to “completed”.
7. Delete the comment.
8. Expected: the comment disappears or is shown as deleted (depending on UI).

## Share Link (External Access)

1. On the review screen, click “Share” (or “Share link”).
2. Create a share link (leave defaults unless instructed otherwise).
3. Copy the share link.
4. Open a new Incognito/Private window.
5. Paste the share link in the address bar and open it.
6. Expected: you can view the shared asset page.
7. Optional: if comments are allowed, add a comment as a guest.
8. Expected: the comment submits successfully.
9. Go back to your normal signed-in window and revoke the share link (if revoke exists).
10. Refresh the share link page in Incognito.
11. Expected: access is blocked / not found.

## Teams / Members (If You Have Access)

1. In the app sidebar, go to “Teams” / “Manage Team”.
2. Expected: you can see a list of members.
3. Invite a teammate (use a test email if your org supports it).
4. Expected: a success message appears.
5. If role editing is available, change a member’s role.
6. Expected: role updates and persists after refresh.

## Workspace Settings (If You Have Access)

1. Go to “Settings”.
2. Change workspace name (add ` - UAT` to the end) and save.
3. Refresh the page.
4. Expected: the name change remains.

## API Keys (If You Have Access)

1. In Settings, find “API keys”.
2. Create a new API key named `UAT Key`.
3. Expected: you see the key value once and the key appears in the list.
4. Copy the key to a safe place if your team requests it (you may not be able to view it again).

## Final Report Template

Copy/paste this and fill it out:

- Tester:
- Date/time:
- Browser/device:
- Account used:
- Passed sections:
- Failed sections (with links + screenshots):
- Notes / suggestions:
