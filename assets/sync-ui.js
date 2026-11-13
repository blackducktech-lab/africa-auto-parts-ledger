(function () {
    'use strict';
    let previousMode = 'local';
    let localRecords = null;
    let lastUser = null;
    const element = id => document.getElementById(id);
    const announce = message => { element('syncMessage').textContent = message; };

    window.showSyncError = function (error, draft = false) {
        let message;
        switch (error.code) {
            case 'conflict': message = '另一支手機已修改或刪除此筆。請先複製備註，再關閉並重新開啟紀錄。 / Record changed on another device.'; break;
            case 'permission-denied': case 'firestore/permission-denied':
                message = '此 Google 帳號尚未獲得共用帳本權限，請確認登入帳號。 / This account has no access.'; break;
            case 'auth/popup-blocked': message = '請允許此網站開啟登入視窗，再按一次 Google 登入。 / Allow the sign-in popup.'; break;
            case 'auth/popup-closed-by-user': case 'auth/cancelled-popup-request': return;
            case 'not-ready': case 'unavailable': case 'auth/network-request-failed':
                message = '尚未連上共用帳本，請連網後再試。 / Connect to the shared ledger and try again.'; break;
            case 'busy': message = '正在儲存，請稍候 / Saving, please wait.'; break;
            case 'invalid-data': message = '共用帳目格式需要檢查，已暫停修改並保留資料。 / Shared records need review.'; break;
            default: message = '無法完成操作，請稍後再試。 / Could not complete the action. Please retry.';
        }
        if (draft) message += ' 表單內容已保留。 / Your draft is kept.';
        announce(message);
        element('formSyncError').textContent = draft ? message : '';
        element('formSyncError').classList.toggle('hidden', !draft);
        showToast(message);
    };

    function localImportRecords() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? validateTransactions(JSON.parse(raw)).filter(record => !record.isSample) : [];
        } catch (_) { return []; }
    }

    window.promptCloudImport = function (records) {
        if (!isCloudLedger()) return;
        const checked = validateTransactions(records).filter(record => !record.isSample);
        if (!checked.length) { showToast('沒有可匯入的正式帳目 / No records to import.'); return; }
        const userId = window.ledgerSync.state.user?.uid;
        element('confirmTitle').textContent = '匯入至兩人共用帳本？ / Import to shared ledger?';
        element('confirmMessage').textContent = `將上傳 ${checked.length} 筆正式帳目，讓你們兩人都能查看。範例不會上傳；相同資料略過，有差異的既有紀錄不覆寫。本機原帳會保留，建議先下載備份。 / Import ${checked.length} records. Existing records stay intact.`;
        pendingConfirmCallback = async () => {
            if (!isCloudLedger() || window.ledgerSync.state.user?.uid !== userId) {
                showToast('登入帳號已變更，請重新匯入 / Account changed. Try again.'); return;
            }
            try {
                const result = await window.ledgerSync.merge(checked);
                const message = `匯入完成：新增 ${result.created} 筆、重複 ${result.skipped} 筆、差異 ${result.conflicts} 筆保留未覆寫。 / Import complete.`;
                announce(message); showToast(message); closeDataToolsModal();
            } catch (error) {
                window.showSyncError(error);
                announce('匯入未全部完成，可重新匯入；已完成的相同資料會自動略過。 / Retry safely; identical records will be skipped.');
            }
        };
        element('confirmDialog').classList.remove('hidden');
    };

    function renderState(state) {
        const cloud = state.mode === 'cloud';
        if (cloud && previousMode === 'local') localRecords = transactions.map(record => ({ ...record }));
        if (previousMode !== state.mode || lastUser !== state.user?.uid) {
            closeConfirmDialog();
            if (!element('recordModal').classList.contains('hidden')) {
                element('formSyncError').textContent = '帳本或帳號已切換，請先複製表單內容，再重新開啟紀錄。 / Ledger changed; copy your draft before reopening.';
                element('formSyncError').classList.remove('hidden');
            }
        }
        previousMode = state.mode;
        lastUser = state.user?.uid;
        element('syncTitle').textContent = cloud ? '兩人共用帳本 / Shared ledger' : '本機帳本 / This phone';
        element('syncStatus').textContent = cloud ? (state.busy ? '儲存中 / Saving' : state.error ? '連線需確認 / Check connection' : state.ready ? '已連線・自動同步 / Connected' : '連線中或離線 / Connecting or offline') : '尚未登入・僅存此瀏覽器 / Local only';
        element('syncAccount').textContent = cloud ? state.user.email : '兩支手機各自登入指定 Google 帳號，即可共用帳目。 / Sign in on both phones to share records.';
        element('googleSignIn').classList.toggle('hidden', cloud);
        element('googleSignOut').classList.toggle('hidden', !cloud);
        element('googleSignOut').disabled = state.busy;
        element('syncRetry').classList.toggle('hidden', !cloud || state.ready);
        element('syncRetry').disabled = state.busy;
        element('syncPanel').dataset.mode = cloud ? (state.ready ? 'connected' : 'waiting') : 'local';
        const count = localImportRecords().length;
        element('importLocalRecords').classList.toggle('hidden', !cloud || !count);
        element('importLocalRecords').textContent = `匯入此手機 ${count} 筆舊帳 / Import local records`;
        element('importLocalRecords').disabled = !state.ready || state.busy;
        element('syncLocalHelp').classList.toggle('hidden', !cloud);
        element('restoreHelp').textContent = cloud ? '共用模式會合併匯入；相同資料略過，有差異的既有紀錄保留。 / Merge without overwriting existing records.' : '本機模式還原會取代此瀏覽器全部帳目，請先下載現有備份。 / Restore replaces this browser’s ledger.';
        element('storageSummary').textContent = cloud ? '共用帳本需連網儲存，舊帳仍保留在本機' : '本機保存；登入後可使用兩人共用帳本';
        element('storageDetails').textContent = cloud ? '目前顯示兩人共用帳目。新增、修改、刪除需連網，另一支手機會自動更新。未登入時的舊帳不會自動上傳；可自行匯入。 / Shared records update automatically while connected.' : '目前帳目只存在此瀏覽器。Google 登入後會切換到共用帳本，原本資料保留，可選擇匯入。請定期下載 JSON 備份。 / Local records stay on this browser until you choose to import.';
        const submit = document.querySelector('button[form="recordForm"]');
        submit.disabled = cloud && (state.busy || !state.ready);
        element('saveProgress').classList.toggle('hidden', !state.busy);
        if (state.error) window.showSyncError({ code: state.error });
    }

    window.addEventListener('load', () => {
        try {
            const adapter = window.createCloudAdapter();
            window.ledgerSync = new window.LedgerSync.Controller(adapter, validateTransactions, {
                state: renderState,
                records: records => {
                    if (isCloudLedger()) transactions = records || [];
                    else if (localRecords) {
                        transactions = localRecords;
                        localRecords = null;
                    }
                    populateMonthDropdown(); renderApp();
                }
            });
            element('googleSignIn').addEventListener('click', async () => {
                const button = element('googleSignIn'); button.disabled = true;
                announce('');
                try { await window.ledgerSync.signIn(); }
                catch (error) { window.showSyncError(error); }
                finally { button.disabled = false; }
            });
            element('googleSignOut').addEventListener('click', async () => {
                announce('');
                try { await window.ledgerSync.signOut(); }
                catch (error) { window.showSyncError(error); }
            });
            element('importLocalRecords').addEventListener('click', () => window.promptCloudImport(localImportRecords()));
            element('syncRetry').addEventListener('click', () => { announce(''); window.ledgerSync.useUser(window.ledgerSync.state.user); });
            for (const name of ['online', 'offline']) window.addEventListener(name, () => window.ledgerSync.networkChanged());
            window.ledgerSync.start();
        } catch (_) {
            announce('共用帳本暫時無法啟動，原本本機帳目仍可使用。 / Shared ledger unavailable; local records are preserved.');
            element('googleSignIn').disabled = true;
        }
    });
})();
