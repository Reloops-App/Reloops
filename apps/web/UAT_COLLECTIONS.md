# Collections Feature UAT (Non-Technical)

Base URL: your local or self-hosted Reloops OSS app, usually `http://127.0.0.1:6173/`.

This checklist is for a non-technical tester. It is written to verify the full Collections experience, including dynamic source behavior, filtering, sorting, sharing, guest access, and downloads.

You do not need developer tools.

## Before You Start

- Use Chrome if possible.
- Sign in with a test account that has access to a workspace with real assets.
- Use a workspace that has:
  - at least 1 project
  - at least 1 folder with multiple assets
  - a mix of images, videos, or PDFs if possible
- For share-link tests, open a second window in Incognito/Private mode.
- If possible, have permission to upload at least one new file into the source folder during testing.

When something fails, capture:
- what you clicked
- what you expected
- what happened instead
- a screenshot or short recording
- the page URL

---

## 1. Open Collections

- Sign in.
- Open a workspace.
- Click **Collections** in the sidebar.
- ✅ The Collections page loads.
- ✅ Existing collections are visible.

---

## 2. Create a Collection

- Click **New Collection**.
- Name it something obvious such as `UAT Collection - <your name>`.
- Save it.
- ✅ The collection appears in the list.
- Open it.
- ✅ The collection detail page loads without errors.

---

## 3. Choose a Source

- Inside the collection, click **Source Folder**.
- Choose a project folder or workspace folder that already contains assets.
- Apply the selection.
- ✅ Assets from that source appear in the collection.
- Refresh the page.
- ✅ The same source is still selected.
- ✅ The same assets still appear.

If your team wants broader source coverage, also test:
- project root
- workspace root
- nested folder selection

For each one:
- ✅ The collection reflects the chosen source correctly.

---

## 4. Dynamic Source Behavior

This is one of the most important parts of Collections.

- Keep the collection open.
- Upload a new asset into the collection’s source folder.
- Refresh the collection page if needed.
- ✅ The new asset appears in the collection without recreating the collection.

- If the source includes nested folders, add an asset to a child folder.
- ✅ The asset appears if it belongs to the selected source subtree.

- Move an existing asset out of the source folder, or change the source so that an existing asset is no longer inside it.
- ✅ That asset disappears from the collection.

- If an asset is deleted from the source folder:
- ✅ It should no longer appear in the collection.

---

## 5. Edit Name, Header, and Description

- Change the collection name.
- ✅ The new name appears immediately.
- Refresh.
- ✅ The name stays changed.

- Add or edit the description.
- ✅ The description appears in the collection header.
- Refresh.
- ✅ The description remains.

- If background or icon editing is available, change one of them.
- ✅ The collection header updates visually.

---

## 6. Search

- Use the search field inside the collection.
- Search for a known asset name.
- ✅ Matching assets remain visible.

- Search for text that should match nothing.
- ✅ An empty state appears.

- Clear the search.
- ✅ All matching collection assets return.

---

## 7. Filters

This tests whether Collections can create saved operating views.

- Click **Filter**.
- Add one filter, for example:
  - status
  - file type
  - folder
  - uploader
  - created date
- ✅ The collection narrows to only matching assets.

- Add a second filter.
- ✅ The collection updates again and only matching assets remain.

- Remove one filter.
- ✅ The results widen correctly.

- Remove all filters.
- ✅ The full source set returns.

- Refresh the page with filters active.
- ✅ The same filters remain active after refresh.
- ✅ The results still match those filters.

Dynamic filter behavior:
- Set a filter that excludes at least one asset.
- Change that asset so it now matches the filter, or upload a new asset that matches the filter.
- ✅ It appears in the collection.

- Change a matching asset so it no longer matches the filter.
- ✅ It disappears from the collection.

---

## 8. Sorting

- Use **Sorted by** and choose a different sort option.
- ✅ Asset order changes.

- Switch ascending/descending if that option is available.
- ✅ The order reverses correctly.

- Refresh the page.
- ✅ The same sort setting remains after refresh.

---

## 9. Grouping

- Use **Group** and choose **Group by folder**.
- ✅ Assets are split into folder sections.

- Switch to **No grouping**.
- ✅ Assets return to one section.

- Refresh the page.
- ✅ The selected grouping remains.

---

## 10. Visible Fields

- Click **Fields**.
- Turn off one or two fields.
- ✅ Those details disappear from cards or rows.

- Click **Clear all**.
- ✅ Extra metadata fields are removed.
- ✅ The page should not automatically restore default fields by itself.

- Refresh the page.
- ✅ The empty field selection remains.

- Click **Reset defaults**.
- ✅ Default fields return.

- Click **Show all** if available.
- ✅ All supported fields appear.

---

## 11. Appearance

- Click **Appearance**.
- Switch between **Grid** and **List**.
- ✅ The layout changes correctly.

- In Grid view, try different card sizes.
- ✅ Card size changes.

- Try different aspect ratios.
- ✅ Thumbnail shape changes.

- Change thumbnail fit/fill behavior.
- ✅ Thumbnail presentation updates.

- Turn **Show Card Info** on and off.
- ✅ Card metadata appears and disappears.

- Refresh the page.
- ✅ Appearance settings remain after refresh.

---

## 12. Open an Asset From a Collection

- Click an asset inside the collection.
- ✅ The asset review page opens.

- Go back to the collection.
- ✅ The collection still loads properly.

---

## 13. Download All From a Collection

- In a collection with assets, click **Download All**.
- ✅ A ZIP file downloads.

- Open the ZIP file.
- ✅ It contains the collection’s assets.

- If there are duplicate file names in the collection:
- ✅ Files still appear in the ZIP without overwriting each other.

---

## 14. Version and Metadata Sanity Check

If the source contains multiple versions of the same asset:
- ✅ The collection shows the correct top/latest version.
- ✅ Version count appears correctly where supported.

If comments already exist on some assets:
- ✅ Comment counts appear correctly where supported.

---

## 15. Create a Collection Share Link

- Click **Share**.
- Create a share link.
- Leave defaults on for the first pass.
- ✅ A share link is generated.
- Copy the link.

---

## 16. Open Shared Collection as a Guest

- Open the share link in an Incognito/Private window.
- ✅ The shared collection page opens.
- ✅ It looks like a read-only collection page, not a broken or simplified page.
- ✅ The collection name is visible.
- ✅ The creator name is visible.
- ✅ If a real description exists, it is shown.
- ✅ If no description exists, fake placeholder text like `Add a description...` is not shown.

Use search on the shared page:
- ✅ Search works.

---

## 17. Shared Collection Must Match Collection Settings

This is critical.

With the same share link:
- compare the signed-in collection page and the guest share page

Check that the shared page respects:
- visible fields
- layout mode
- card size
- thumbnail style
- grouping
- sorting
- filtered asset set

For each one:
- ✅ The shared collection reflects the same saved collection configuration.

---

## 18. Share Link Should Reflect Later Collection Changes

Create the share link first, then go back to the signed-in collection and change the collection.

Test each of the following one at a time:
- change sorting
- change grouping
- add a filter
- remove a filter
- change visible fields
- change layout
- change source folder

After each change:
- refresh the already-open guest share page
- ✅ The guest share page reflects the updated collection configuration.

This confirms the share link is tied to the collection view, not a stale snapshot.

---

## 19. New Assets Should Also Appear on the Shared Collection

- Keep the guest share page open.
- Add a new asset to the collection’s source folder that matches the collection rules.
- Refresh the guest share page.
- ✅ The new asset appears there too.

- Add an asset that does not match the active filters.
- Refresh the guest share page.
- ✅ It does not appear.

---

## 20. Share Permissions: Downloads

Create a share link with **Allow download ON**.
- Open it in Incognito.
- ✅ **Download All** is visible.
- Click it.
- ✅ A ZIP file downloads successfully.

Create another share link with **Allow download OFF**.
- Open it in Incognito.
- ✅ **Download All** is hidden or unavailable.

---

## 21. Share Permissions: Comments

Create a share link with **Allow comments OFF**.
- Open an asset from the shared collection.
- ✅ Guest can view the asset.
- ✅ Guest cannot successfully add comments.

Create another share link with **Allow comments ON**.
- Open an asset from the shared collection.
- ✅ Guest can attempt to comment.

---

## 22. Guest Comment Flow

- On a shared asset, start a new comment or annotation as a guest.
- ✅ If not identified yet, the identity dialog appears.

- Enter guest name and email.
- ✅ The page should not hard reload just because the guest identified themselves.
- ✅ The comment in progress should not be lost.

- Submit the comment.
- ✅ The comment appears successfully.

Repeat for:
- plain comment
- drawn annotation on image, if available

---

## 23. Shared Asset Review

From the shared collection page:
- open an image asset
- open a video asset, if available
- open a PDF asset, if available

For each type:
- ✅ The asset loads correctly
- ✅ Existing comments render correctly
- ✅ Guest restrictions behave correctly based on share settings

---

## 24. Revoke the Collection Share Link

- In the signed-in window, revoke the collection share link.
- Return to the Incognito window.
- Refresh the shared collection page.
- ✅ Access is blocked or the page shows as unavailable.

---

## 25. Final Pass

- Return to the main Collections page.
- Re-open the same collection.
- ✅ Source, search, fields, filters, layout, grouping, and sorting still look correct.
- ✅ The collection still behaves like a live saved view over its source.

---

## Final Report Template

- Tester:
- Date:
- Browser:
- Workspace used:
- Collection used:
- Share link tested:
- Passed:
- Failed:
- Notes:
