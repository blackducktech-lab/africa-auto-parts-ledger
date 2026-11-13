# 汽車零件出口收支帳本 / Auto Parts Export Ledger

手機可操作的繁體中文／英文雙語帳本，支援 USD／TWD 分開統計、月份篩選、收支分類、CSV 匯出與 JSON 備份還原。

## 資料保存

- 未登入時使用本機帳本，原始資料仍儲存在 `auto_parts_export_ledger_v1` localStorage。
- 兩支手機各自使用已授權的 Google 帳號登入，會切換至同一本 Firebase 共用帳本。連網時即時更新；共用模式需連線成功才能新增、修改或刪除。離線時不會宣稱已同步，也不會改存至本機帳本。
- 登入不會自動上傳本機舊帳或範例。按「匯入此手機舊帳」並確認後才會合併；本機原帳仍保留。兩支手機有相同 ID 和內容時略過，有差異時保留共用紀錄並回報衝突。
- 編輯和刪除使用交易及開啟時的版本檢查；另一人修改後，舊表單無法直接覆寫。儲存失敗保留表單內容。
- GitHub 儲存庫與 GitHub Pages 只接收程式及公開範例，不上傳使用者實際帳目。
- 請定期下載 JSON 備份。清除瀏覽器資料、更換瀏覽器、網址或手機，都可能使原帳目無法在新位置讀取。
- 本機模式還原 JSON 會在確認後取代本機全部帳目；共用模式則合併匯入，不覆寫有差異的既有紀錄。換手機或匯入前請保留 JSON 備份。
- 第一次啟動包含明確標示的五筆範例；請點「清除範例」後開始正式記帳。
- 網頁第一次連網載入並完成離線快取後，可離線再次開啟。支援的瀏覽器可加入主畫面。

## 本機建置

使用 Node.js 24.12 以上、Java 21 以上及 npm：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:rules
npm run build
npm run preview
```

預覽網址為 `http://127.0.0.1:4173/`。部署檔案只會輸出至 `dist/`，不包含原始對話、參考檔、備份或測試資料。

## GitHub Pages

1. 將本專案的安全來源檔推送至專用儲存庫的 `main` 分支。
2. 在該儲存庫的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
3. `.github/workflows/pages.yml` 會測試、建置並部署。成功網址顯示在 workflow 的 `github-pages` environment。
4. 網頁使用相對路徑，適用 `https://<帳號>.github.io/<儲存庫>/`，不需要修改 DNS 或既有主機。

GitHub Free 的 Pages 需使用公開儲存庫；私人儲存庫的 Pages 支援依帳號方案而定。網站和原始碼的公開性，與實際帳目的瀏覽器本機保存是不同事項；不要把 JSON 帳本備份加進 Git。

## 來源與部署調整

原始需求及網頁由使用者提供的 [Gemini 分享對話](https://share.gemini.google/Cw0wXfKoNTdw) 取出，日期 2026-11-12（Asia/Taipei）。

原始 HTML UTF-8 SHA-256：`b9c3e4a252febf2241cf329ce13d1bd6766bdf7904081fa2f51820f3e7a3a611`。

部署版保留原介面與主要功能，將開發用 Tailwind CDN 改為本機建置 CSS，加入相對路徑的 manifest／離線快取，補上 JSON 格式驗證、還原確認、CSV 公式文字防護、儲存失敗處理與分幣別金額顯示。

原始 HTML 副本保留在本機忽略的 `reference/`；完整 Gemini 對話不加入儲存庫。

## 共用帳本後端

使用獨立 Firebase 專案 `africa-ledger-bd-20261113`，Firestore 預設標準資料庫位於 `asia-east1`，啟用刪除保護。GitHub Actions 只部署靜態網頁；Firestore 規則需由已授權的專案擁有人獨立部署：

```sh
npx firebase deploy --only firestore:rules --project africa-ledger-bd-20261113
```

- `src/firebase-config.json` 是官方網頁 SDK 所需的公開設定，並非管理憑證。實際權限由 `firestore.rules` 驗證 Google 登入、已驗證信箱與私人白名單。
- `/access/shared-ledger` 文件的 `emails` 陣列只由專案擁有人管理。瀏覽器不能讀取或修改白名單；信箱不得加入 Git。白名單未設定時拒絕所有帳目讀寫，不採用「第一個登入者自動取得權限」。
- 金額以整數分儲存，帳目位於 `/entries/{id}`。共用紀錄只使用記憶體快取，不會寫入原本本機帳本或 Service Worker 快取。
- 共用紀錄刪除後保留刪除標記，避免重新匯入舊手機或 JSON 備份時復活已刪紀錄；瀏覽器不能直接移除標記或復活紀錄。
- 測試只使用 `demo-africa-ledger` 模擬器及假信箱，不上傳正式帳目。同步測試涵蓋兩個獨立客戶端、即時新增和刪除、版本衝突、重複匯入、未授權帳號和白名單保護。
