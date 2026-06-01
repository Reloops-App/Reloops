# Folder Feature UAT

Base URL: your local or self-hosted Reloops OSS app, usually `http://127.0.0.1:6173/`.

Open a project in Campaign Details before running these tests.

---

## 1. Create a folder

- Click **New Folder** (or the `+` folder button in the toolbar).
- Enter a name (e.g. `UAT Folder`) and confirm.
- ✅ Folder appears in the grid immediately.
- ✅ Refresh the page — folder is still there.

---

## 2. Upload a folder

- Drag a folder from your desktop onto the project page (or use the **Upload folder** button).
- ✅ A folder card appears for each nested directory in the dragged folder.
- ✅ Files inside the folder appear under the correct subfolder when you open it.
- ✅ Upload progress cards show for each file.

---

## 3. Upload two files

- Click **Upload files** (or drag two individual files onto the page).
- ✅ Both files show upload progress.
- ✅ Both files appear as asset cards once done.
- ✅ Thumbnails generate automatically for images and videos.

---

## 4. Download

- Open a folder and click the **⋯** menu → **Download as ZIP**.
- ✅ A `.zip` file downloads containing only the files inside that folder.
- Also test: select the whole project → **Download all** from the project header.
- ✅ ZIP contains all assets, preserving the folder structure.

---

## 5. Verify

- Open a folder — confirm asset cards inside are correct.
- Rename the folder (⋯ → Rename) and refresh — new name persists.
- Move an asset into the folder (asset card → ⋯ → Move to folder) — asset disappears from root, appears inside folder.
- Move the folder itself by dragging it onto another folder — ✅ nesting updates correctly.
- Delete the folder (⋯ → Delete folder) — ✅ folder and its contents are removed; asset count on parent updates.
