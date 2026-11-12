# 汽車零件出口收支帳本 / Auto Parts Export Ledger

手機可操作的繁體中文／英文雙語帳本，支援 USD／TWD 分開統計、月份篩選、收支分類、CSV 匯出與 JSON 備份還原。

## 資料保存

- 帳目儲存在使用者目前瀏覽器的 localStorage；沒有雲端資料庫、帳號登入或跨手機自動同步。
- GitHub 儲存庫與 GitHub Pages 只接收程式及公開範例，不上傳使用者實際帳目。
- 請定期下載 JSON 備份。清除瀏覽器資料、更換瀏覽器、網址或手機，都可能使原帳目無法在新位置讀取。
- 還原 JSON 會在確認後取代全部帳目，並非合併。換手機前先保留兩邊備份。
- 第一次啟動包含明確標示的五筆範例；請點「清除範例」後開始正式記帳。
- 網頁第一次連網載入並完成離線快取後，可離線再次開啟。支援的瀏覽器可加入主畫面。

## 本機建置

使用 Node.js 22 以上及 npm：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
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
