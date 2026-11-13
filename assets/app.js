// --- 0. PWA MANIFEST & APP ICON GENERATOR ---
        let deferredInstallPrompt = null;

        function setupPWA() {
            try {
                if (localStorage.getItem('pwa_banner_dismissed') === '1') {
                    document.getElementById('installPromoBanner').classList.add('hidden');
                }
            } catch (_) { /* Storage availability is handled when loading the ledger. */ }
            if ('serviceWorker' in navigator && location.protocol !== 'file:') {
                navigator.serviceWorker.register('./sw.js').catch(() => {
                    document.getElementById('offlineStatus').textContent = '離線快取未就緒，請保持網路連線 / Offline cache unavailable.';
                });
            }
        }

        // Capture Android/Chrome native install prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            const nativeSec = document.getElementById('nativeInstallSection');
            if (nativeSec) nativeSec.classList.remove('hidden');
        });

        async function triggerNativeInstall() {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') {
                showToast('App 安裝中 / Installing App...');
                closeInstallModal();
            }
            deferredInstallPrompt = null;
        }

        function openInstallModal() {
            document.getElementById('installModal').classList.remove('hidden');
        }

        function closeInstallModal() {
            document.getElementById('installModal').classList.add('hidden');
        }

        function dismissInstallBanner() {
            document.getElementById('installPromoBanner').classList.add('hidden');
            try { localStorage.setItem('pwa_banner_dismissed', '1'); } catch (_) {}
        }

        function openDataToolsModal() {
            document.getElementById('dataToolsModal').classList.remove('hidden');
        }

        function closeDataToolsModal() {
            document.getElementById('dataToolsModal').classList.add('hidden');
        }

        // --- 1. DATA & CATEGORIES CONFIGURATION ---
        const CATEGORIES = {
            INCOME: [
                { id: 'parts_sales', zh: '貨款收入 (訂金/尾款)', en: 'Parts Payment (Deposit/Balance)' },
                { id: 'freight_reimb', zh: '運費代收 (海運/空運)', en: 'Freight Collected' },
                { id: 'sample_fee', zh: '樣品費收入', en: 'Sample Fee' },
                { id: 'other_income', zh: '其他收入', en: 'Other Income' }
            ],
            EXPENSE: [
                { id: 'parts_purchase', zh: '零件採購 (工廠/供應商)', en: 'Parts Purchase' },
                { id: 'sea_air_freight', zh: '海空運費 / 櫃費', en: 'Sea & Air Freight' },
                { id: 'customs_docs', zh: '報關與認證 (SONCAP/PVOC)', en: 'Customs & Cert.' },
                { id: 'trucking_warehouse', zh: '國內物流與倉儲', en: 'Local Logistics' },
                { id: 'bank_fee', zh: '銀行手續費', en: 'Bank Fees' },
                { id: 'travel_client', zh: '交際與差旅', en: 'Travel & Client' },
                { id: 'other_expense', zh: '其他支出', en: 'Other Expense' }
            ]
        };

        const STORAGE_KEY = 'auto_parts_export_ledger_v1';
        let transactions = [];
        let currentCurrencyFilter = 'ALL'; // 'ALL', 'USD', 'TWD'
        let currentTypeFilter = 'ALL'; // 'ALL', 'INCOME', 'EXPENSE'
        let pendingConfirmCallback = null;
        let storageWriteBlocked = false;
        let preservedStorage = null;
        let editCloudVersion = null;
        let formLedgerMode = 'local';
        let formUserId = null;
        let draftRecordId = null;

        function isCloudLedger() { return window.ledgerSync?.state.mode === 'cloud'; }

        function validateTransactions(data) {
            if (!Array.isArray(data) || data.length > 50000) throw new Error('Invalid ledger');
            const ids = new Set();
            return data.map(item => {
                if (!item || typeof item !== 'object' || Array.isArray(item) ||
                    typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id) ||
                    !['INCOME', 'EXPENSE'].includes(item.type) || !['USD', 'TWD'].includes(item.currency) ||
                    typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 10000000000 ||
                    Math.abs(item.amount * 100 - Math.round(item.amount * 100)) > 0.001 ||
                    !CATEGORIES[item.type].some(c => c.id === item.categoryId) ||
                    typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
                    !Number.isFinite(Date.parse(item.date + 'T00:00:00Z')) ||
                    new Date(item.date + 'T00:00:00Z').toISOString().slice(0, 10) !== item.date ||
                    (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 10000))) {
                    throw new Error('Invalid record');
                }
                ids.add(item.id);
                return { id: item.id, type: item.type, currency: item.currency, amount: item.amount,
                    categoryId: item.categoryId, date: item.date, note: item.note || '', isSample: item.isSample === true };
            });
        }

        function persistTransactions(next) {
            if (storageWriteBlocked) {
                showToast('原始資料未覆寫；請先下載備份 / Back up the original data first.');
                return false;
            }
            try {
                const checked = validateTransactions(next);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
                transactions = checked;
                return true;
            } catch (_) {
                showToast('無法儲存，請檢查資料或瀏覽器儲存空間 / Save failed. Check data and browser storage.');
                return false;
            }
        }

        function csvText(value) {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
        }


        // --- 2. INITIALIZATION & SAMPLE DATA ---
        function initApp() {
            setupPWA();
            storageWriteBlocked = false;
            preservedStorage = null;
            let savedData;
            try { savedData = localStorage.getItem(STORAGE_KEY); }
            catch (_) {
                storageWriteBlocked = true;
                document.getElementById('storageWarning').textContent = '此瀏覽器無法保存帳目。請使用允許儲存的瀏覽器。 / Browser storage is unavailable.';
                document.getElementById('storageWarning').classList.remove('hidden');
                return;
            }
            if (savedData) {
                try {
                    transactions = validateTransactions(JSON.parse(savedData));
                } catch (e) {
                    transactions = [];
                    preservedStorage = savedData;
                    storageWriteBlocked = true;
                    document.getElementById('storageWarning').textContent = '既有帳目格式異常，原始資料已保留。請先由「匯出／備份」下載原始備份。 / Existing data needs review; original data is preserved.';
                    document.getElementById('storageWarning').classList.remove('hidden');
                }
            } else {
                // Load realistic sample data for Auto Parts Export to Africa
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 15);
                const pYyyy = prevMonthDate.getFullYear();
                const pMm = String(prevMonthDate.getMonth() + 1).padStart(2, '0');

                transactions = [
                    {
                        id: 'sample_1',
                        type: 'INCOME',
                        currency: 'USD',
                        amount: 14500,
                        categoryId: 'parts_sales',
                        date: `${yyyy}-${mm}-05`,
                        note: 'Nigeria 奈及利亞 - 煞車皮與濾芯 20呎櫃尾款 Balance',
                        isSample: true
                    },
                    {
                        id: 'sample_2',
                        type: 'EXPENSE',
                        currency: 'TWD',
                        amount: 265000,
                        categoryId: 'parts_purchase',
                        date: `${yyyy}-${mm}-03`,
                        note: '彰化零件工廠貨款 - 避震器與底盤件',
                        isSample: true
                    },
                    {
                        id: 'sample_3',
                        type: 'EXPENSE',
                        currency: 'USD',
                        amount: 2450,
                        categoryId: 'sea_air_freight',
                        date: `${yyyy}-${mm}-06`,
                        note: '高雄港 -> Lagos Apapa 海運費 (20GP)',
                        isSample: true
                    },
                    {
                        id: 'sample_4',
                        type: 'EXPENSE',
                        currency: 'TWD',
                        amount: 18500,
                        categoryId: 'customs_docs',
                        date: `${yyyy}-${mm}-06`,
                        note: '奈及利亞 SONCAP 認證與報關費',
                        isSample: true
                    },
                    {
                        id: 'sample_5',
                        type: 'INCOME',
                        currency: 'USD',
                        amount: 6800,
                        categoryId: 'parts_sales',
                        date: `${pYyyy}-${pMm}-20`,
                        note: 'Kenya 肯亞 Mombasa 客戶 40% 訂金 Deposit',
                        isSample: true
                    }
                ];
                persistTransactions(transactions);
            }

            populateMonthDropdown();
            renderApp();
        }


        // --- 3. FILTERING & RENDERING ---
        function populateMonthDropdown() {
            const select = document.getElementById('monthFilter');
            const currentVal = select.value;
            const months = new Set();

            // Always include current month
            const now = new Date();
            months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

            transactions.forEach(t => {
                if (t.date && t.date.length >= 7) {
                    months.add(t.date.substring(0, 7));
                }
            });

            const sortedMonths = Array.from(months).sort().reverse();
            select.innerHTML = `<option value="ALL">全部月份 / All Months</option>`;
            sortedMonths.forEach(m => {
                const option = document.createElement('option');
                option.value = m;
                option.textContent = `${m} 月份報表 / ${m}`;
                select.appendChild(option);
            });

            if (Array.from(select.options).some(opt => opt.value === currentVal)) {
                select.value = currentVal;
            }
        }

        function setCurrencyFilter(curr) {
            currentCurrencyFilter = curr;
            ['ALL', 'USD', 'TWD'].forEach(c => {
                const btn = document.getElementById(`tab-${c}`);
                if (c === curr) {
                    btn.className = 'px-2.5 py-1.5 rounded-lg text-xs font-bold transition bg-white text-navy-800 shadow-sm';
                } else {
                    btn.className = 'px-2.5 py-1.5 rounded-lg text-xs font-bold transition text-slate-500 hover:text-slate-700';
                }
            });

            // Toggle visibility of summary cards & adjust grid layout when single currency selected
            const summarySec = document.getElementById('summarySection');
            summarySec.className = curr === 'ALL' ? 'grid grid-cols-1 md:grid-cols-2 gap-3.5' : 'grid grid-cols-1 gap-3.5';
            document.getElementById('card-USD').style.display = (curr === 'ALL' || curr === 'USD') ? 'block' : 'none';
            document.getElementById('card-TWD').style.display = (curr === 'ALL' || curr === 'TWD') ? 'block' : 'none';

            renderApp();
        }

        function setTypeFilter(type) {
            currentTypeFilter = type;
            ['ALL', 'INCOME', 'EXPENSE'].forEach(t => {
                const btn = document.getElementById(`typeBtn-${t}`);
                if (t === type) {
                    btn.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-navy-800 text-white shadow-xs';
                } else {
                    btn.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-slate-600 border border-slate-200';
                }
            });
            renderApp();
        }

        function getCategoryInfo(type, categoryId) {
            const list = CATEGORIES[type] || [];
            return list.find(c => c.id === categoryId) || { zh: '其他項目', en: 'Other' };
        }

        function formatMoney(amount, currency) {
            const num = Number(amount) || 0;
            if (currency === 'USD') {
                return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            } else {
                return 'NT$' + num.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(num) ? 0 : 2, maximumFractionDigits: 2 });
            }
        }

        function renderApp() {
            const selectedMonth = document.getElementById('monthFilter').value;

            // Filter by month first (for Summary & Analytics)
            const monthFiltered = transactions.filter(t => {
                if (selectedMonth !== 'ALL' && !t.date.startsWith(selectedMonth)) return false;
                return true;
            });

            // Calculate USD & TWD totals
            let usdIn = 0, usdOut = 0, twdIn = 0, twdOut = 0;
            monthFiltered.forEach(t => {
                const amt = Math.round(Number(t.amount) * 100);
                if (t.currency === 'USD') {
                    if (t.type === 'INCOME') usdIn += amt;
                    else usdOut += amt;
                } else {
                    if (t.type === 'INCOME') twdIn += amt;
                    else twdOut += amt;
                }
            });

            usdIn /= 100; usdOut /= 100; twdIn /= 100; twdOut /= 100;
            const usdNet = Math.round((usdIn - usdOut) * 100) / 100;
            const twdNet = Math.round((twdIn - twdOut) * 100) / 100;

            document.getElementById('usdIncome').textContent = formatMoney(usdIn, 'USD');
            document.getElementById('usdExpense').textContent = formatMoney(usdOut, 'USD');
            const usdNetEl = document.getElementById('usdNet');
            usdNetEl.textContent = (usdNet < 0 ? '-' : '') + formatMoney(Math.abs(usdNet), 'USD');
            usdNetEl.className = `text-2xl font-bold tracking-tight ${usdNet < 0 ? 'text-rose-300' : 'text-emerald-300'}`;

            // Update USD Ratio Bar
            const usdTotalFlow = usdIn + usdOut;
            const usdInPct = usdTotalFlow > 0 ? Math.round((usdIn / usdTotalFlow) * 100) : 50;
            const usdOutPct = usdTotalFlow > 0 ? (100 - usdInPct) : 50;
            document.getElementById('usdInBar').style.width = `${usdInPct}%`;
            document.getElementById('usdOutBar').style.width = `${usdOutPct}%`;
            document.getElementById('usdRatioText').textContent = usdTotalFlow > 0 ? `收 ${usdInPct}% / 支 ${usdOutPct}%` : '尚無紀錄';

            document.getElementById('twdIncome').textContent = formatMoney(twdIn, 'TWD');
            document.getElementById('twdExpense').textContent = formatMoney(twdOut, 'TWD');
            const twdNetEl = document.getElementById('twdNet');
            twdNetEl.textContent = (twdNet < 0 ? '-' : '') + formatMoney(Math.abs(twdNet), 'TWD');
            twdNetEl.className = `text-xl font-bold tracking-tight ${twdNet < 0 ? 'text-rose-600' : 'text-emerald-700'}`;

            // Update TWD Ratio Bar
            const twdTotalFlow = twdIn + twdOut;
            const twdInPct = twdTotalFlow > 0 ? Math.round((twdIn / twdTotalFlow) * 100) : 50;
            const twdOutPct = twdTotalFlow > 0 ? (100 - twdInPct) : 50;
            document.getElementById('twdInBar').style.width = `${twdInPct}%`;
            document.getElementById('twdOutBar').style.width = `${twdOutPct}%`;
            document.getElementById('twdRatioText').textContent = twdTotalFlow > 0 ? `收 ${twdInPct}% / 支 ${twdOutPct}%` : '尚無紀錄';

            // Render Expense Analytics
            renderExpenseAnalytics(monthFiltered);

            // Check if sample data exists
            const hasSamples = transactions.some(t => t.isSample);
            document.getElementById('sampleBanner').classList.toggle('hidden', !hasSamples);

            // Filter list by Currency & Type
            const listFiltered = monthFiltered.filter(t => {
                if (currentCurrencyFilter !== 'ALL' && t.currency !== currentCurrencyFilter) return false;
                if (currentTypeFilter !== 'ALL' && t.type !== currentTypeFilter) return false;
                return true;
            }).sort((a, b) => new Date(b.date) - new Date(a.date));

            document.getElementById('recordCountText').textContent = `顯示 ${listFiltered.length} 筆紀錄 / Showing ${listFiltered.length} records`;

            const listContainer = document.getElementById('transactionList');
            if (listFiltered.length === 0) {
                listContainer.innerHTML = `
                    <div class="bg-white rounded-2xl p-8 text-center border border-slate-200 border-dashed">
                        <p class="text-slate-600 font-bold text-sm">尚無符合條件的紀錄</p>
                        <p class="text-slate-400 text-xs mt-1">No records found for this filter. Tap "+ 新增" below.</p>
                    </div>
                `;
                return;
            }

            listContainer.innerHTML = listFiltered.map(item => {
                const isIncome = item.type === 'INCOME';
                const cat = getCategoryInfo(item.type, item.categoryId);
                const badgeColor = isIncome ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800';
                const amountColor = isIncome ? 'text-emerald-600' : 'text-rose-600';
                const sign = isIncome ? '+' : '-';

                return `
                    <div class="ledger-record bg-white rounded-2xl p-3.5 shadow-xs border border-slate-200/90 flex flex-col gap-2 transition hover:border-slate-300">
                        <div class="record-top flex items-start justify-between gap-2">
                            <div class="record-info space-y-0.5">
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-md ${badgeColor}">
                                        ${isIncome ? '收入 IN' : '支出 OUT'}
                                    </span>
                                    <span class="text-xs font-semibold text-slate-500">${item.date}</span>
                                    ${item.isSample ? '<span class="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">範例 Sample</span>' : ''}
                                </div>
                                <h3 class="text-sm font-bold text-slate-800 pt-0.5">${cat.zh}</h3>
                                <p class="text-[11px] font-medium text-slate-400">${cat.en}</p>
                            </div>
                            <div class="record-money text-right shrink-0">
                                <p class="text-base font-bold ${amountColor}">
                                    ${sign}${formatMoney(item.amount, item.currency)}
                                </p>
                                <span class="text-[10px] font-bold text-slate-400 uppercase">${item.currency}</span>
                            </div>
                        </div>

                        ${item.note ? `
                        <div class="record-note bg-slate-50 px-3 py-1.5 rounded-xl text-xs text-slate-600 border border-slate-100">
                            📝 ${escapeHTML(item.note)}
                        </div>
                        ` : ''}

                        <div class="record-actions flex justify-end gap-2 pt-1 border-t border-slate-100">
                            <button onclick="openModal('${item.id}')" class="text-xs font-semibold text-slate-500 hover:text-navy-800 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-blue-50 transition">
                                編輯 / Edit
                            </button>
                            <button onclick="promptDelete('${item.id}')" class="text-xs font-semibold text-rose-500 hover:text-rose-700 px-2.5 py-1 rounded-lg bg-rose-50/50 hover:bg-rose-50 transition">
                                刪除 / Delete
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderExpenseAnalytics(monthFiltered) {
            // Focus on selected currency or default to TWD/USD breakdown
            const targetCurr = currentCurrencyFilter === 'USD' ? 'USD' : 'TWD';
            document.getElementById('analyticsBadge').textContent = `${targetCurr} 支出占比`;

            const expenses = monthFiltered.filter(t => t.type === 'EXPENSE' && t.currency === targetCurr);
            const container = document.getElementById('categoryBars');

            if (expenses.length === 0) {
                container.innerHTML = `<p class="text-xs text-slate-400 py-2 text-center">此月份尚無 ${targetCurr} 支出紀錄 / No ${targetCurr} expenses yet</p>`;
                return;
            }

            const totalExp = expenses.reduce((sum, t) => sum + Number(t.amount), 0);
            const grouped = {};
            expenses.forEach(t => {
                grouped[t.categoryId] = (grouped[t.categoryId] || 0) + Number(t.amount);
            });

            const sortedCats = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 4);

            container.innerHTML = sortedCats.map(([catId, sum]) => {
                const pct = Math.round((sum / totalExp) * 100);
                const cat = getCategoryInfo('EXPENSE', catId);
                return `
                    <div>
                        <div class="flex justify-between text-xs mb-1">
                            <span class="font-semibold text-slate-700 truncate pr-2">${cat.zh} <span class="text-slate-400 font-normal">(${pct}%)</span></span>
                            <span class="font-bold text-slate-800 shrink-0">${formatMoney(sum, targetCurr)}</span>
                        </div>
                        <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div class="bg-navy-800 h-2 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // --- 4. MODAL & FORM LOGIC ---
        function selectFormType(type) {
            document.getElementById('formType').value = type;
            const btnIn = document.getElementById('btnTypeIncome');
            const btnOut = document.getElementById('btnTypeExpense');
            const currSelect = document.getElementById('formCurrency');

            if (type === 'INCOME') {
                btnIn.className = 'py-3 px-3 rounded-xl border-2 font-bold text-sm flex flex-col items-center justify-center transition border-emerald-600 bg-emerald-50 text-emerald-700';
                btnOut.className = 'py-3 px-3 rounded-xl border-2 font-bold text-sm flex flex-col items-center justify-center transition border-slate-200 bg-white text-slate-500';
                if (!document.getElementById('editId').value) currSelect.value = 'USD'; // Export income usually USD
            } else {
                btnOut.className = 'py-3 px-3 rounded-xl border-2 font-bold text-sm flex flex-col items-center justify-center transition border-rose-600 bg-rose-50 text-rose-700';
                btnIn.className = 'py-3 px-3 rounded-xl border-2 font-bold text-sm flex flex-col items-center justify-center transition border-slate-200 bg-white text-slate-500';
                if (!document.getElementById('editId').value) currSelect.value = 'TWD'; // Local purchasing usually TWD
            }

            // Populate Categories
            const catSelect = document.getElementById('formCategory');
            catSelect.innerHTML = CATEGORIES[type].map(c =>
                `<option value="${c.id}">${c.zh} / ${c.en}</option>`
            ).join('');
        }

        function openModal(editId = null) {
            if (isCloudLedger() && !window.ledgerSync.state.ready) {
                showToast('請等待共用帳本連線完成 / Wait for the shared ledger to connect.');
                return;
            }
            formLedgerMode = isCloudLedger() ? 'cloud' : 'local';
            formUserId = window.ledgerSync?.state.user?.uid || null;
            editCloudVersion = editId && isCloudLedger() ? window.ledgerSync.version(editId) : null;
            draftRecordId = editId || ('tx_' + crypto.randomUUID());
            const modal = document.getElementById('recordModal');
            const form = document.getElementById('recordForm');
            form.reset();
            document.getElementById('formSyncError').classList.add('hidden');

            if (editId) {
                const record = transactions.find(t => t.id === editId);
                if (!record) return;
                document.getElementById('modalTitle').textContent = '編輯收支紀錄 / Edit Record';
                document.getElementById('editId').value = record.id;
                selectFormType(record.type);
                document.getElementById('formCurrency').value = record.currency;
                document.getElementById('formAmount').value = record.amount;
                document.getElementById('formCategory').value = record.categoryId;
                document.getElementById('formDate').value = record.date;
                document.getElementById('formNote').value = record.note || '';
            } else {
                document.getElementById('modalTitle').textContent = '新增收支紀錄 / Add Record';
                document.getElementById('editId').value = '';
                selectFormType('INCOME');
                // Set today's date in local timezone
                const today = new Date();
                const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                document.getElementById('formDate').value = localDate;
            }

            modal.classList.remove('hidden');
            document.body.classList.add('modal-open');
        }

        function closeModal() {
            document.getElementById('recordModal').classList.add('hidden');
            document.body.classList.remove('modal-open');
        }

        function appendTag(tagText) {
            const input = document.getElementById('formNote');
            if (input.value.trim() === '') {
                input.value = tagText;
            } else if (!input.value.includes(tagText)) {
                input.value = `${input.value.trim()} - ${tagText}`;
            }
        }

        async function saveRecord(e) {
            e.preventDefault();
            const editId = document.getElementById('editId').value;
            const type = document.getElementById('formType').value;
            const currency = document.getElementById('formCurrency').value;
            const amount = parseFloat(document.getElementById('formAmount').value);
            const categoryId = document.getElementById('formCategory').value;
            const date = document.getElementById('formDate').value;
            const note = document.getElementById('formNote').value.trim();

            const record = { id: editId || draftRecordId || ('tx_' + crypto.randomUUID()), type, currency, amount, categoryId, date, note, isSample: false };
            if (formLedgerMode !== (isCloudLedger() ? 'cloud' : 'local') || formUserId !== (window.ledgerSync?.state.user?.uid || null)) {
                showToast('帳本已切換，請先保留內容再重新開啟表單 / Ledger changed. Reopen the form.');
                return;
            }
            if (isCloudLedger()) {
                try {
                    await window.ledgerSync.save(record, editCloudVersion);
                    showToast('已儲存至共用帳本 / Saved to shared ledger');
                    closeModal();
                } catch (error) { window.showSyncError(error, true); }
                return;
            }
            const next = editId ? transactions.map(t => t.id === editId ? record : t) : [record, ...transactions];
            if (!persistTransactions(next)) return;
            showToast(editId ? '已更新紀錄 / Record Updated' : '已新增紀錄 / Record Added');
            populateMonthDropdown();
            renderApp();
            closeModal();
        }

        // --- 5. DELETE & SAMPLE CLEAR CONFIRMATIONS ---
        function promptDelete(id) {
            const cloud = isCloudLedger();
            const version = cloud ? window.ledgerSync.version(id) : null;
            document.getElementById('confirmTitle').textContent = '確定刪除此筆紀錄？ / Delete Record?';
            document.getElementById('confirmMessage').textContent = '刪除後將無法復原 / This action cannot be undone.';
            pendingConfirmCallback = async () => {
                if (cloud !== isCloudLedger()) { showToast('帳本已切換，請重新操作 / Ledger changed. Try again.'); return; }
                if (cloud) {
                    try { await window.ledgerSync.remove(id, version); showToast('已刪除共用紀錄 / Deleted'); }
                    catch (error) { window.showSyncError(error); }
                    return;
                }
                if (!persistTransactions(transactions.filter(t => t.id !== id))) return;
                populateMonthDropdown();
                renderApp();
                showToast('已刪除紀錄 / Deleted');
            };
            document.getElementById('confirmDialog').classList.remove('hidden');
        }

        function promptClearSampleData() {
            if (isCloudLedger()) return;
            document.getElementById('confirmTitle').textContent = '清除所有範例資料？ / Clear Samples?';
            document.getElementById('confirmMessage').textContent = '只會清除系統預設的範例，保留您自己輸入的資料。';
            pendingConfirmCallback = () => {
                if (isCloudLedger()) return;
                if (!persistTransactions(transactions.filter(t => !t.isSample))) return;
                populateMonthDropdown();
                renderApp();
                showToast('已清除範例資料 / Samples Cleared');
            };
            document.getElementById('confirmDialog').classList.remove('hidden');
        }

        function closeConfirmDialog() {
            document.getElementById('confirmDialog').classList.add('hidden');
            pendingConfirmCallback = null;
        }

        document.getElementById('confirmActionBtn').addEventListener('click', async event => {
            const callback = pendingConfirmCallback;
            if (!callback || event.currentTarget.disabled) return;
            const button = event.currentTarget;
            button.disabled = true;
            try { await callback(); }
            finally { button.disabled = false; closeConfirmDialog(); }
        });

        // --- 6. EXPORT TO CSV (EXCEL FRIENDLY WITH UTF-8 BOM) ---
        function exportToCSV() {
            const selectedMonth = document.getElementById('monthFilter').value;
            const filtered = transactions.filter(t => {
                if (selectedMonth !== 'ALL' && !t.date.startsWith(selectedMonth)) return false;
                return true;
            }).sort((a, b) => new Date(b.date) - new Date(a.date));

            if (filtered.length === 0) {
                showToast('目前沒有資料可匯出 / No data to export');
                return;
            }

            const headers = [
                '日期 (Date)',
                '類型 (Type)',
                '分類中文 (Category ZH)',
                '分類英文 (Category EN)',
                '幣別 (Currency)',
                '金額 (Amount)',
                '客戶/國家/備註 (Client & Note)'
            ];

            const rows = filtered.map(t => {
                const cat = getCategoryInfo(t.type, t.categoryId);
                const typeLabel = t.type === 'INCOME' ? '收入 (Income)' : '支出 (Expense)';
                const signedAmount = t.type === 'INCOME' ? t.amount : -Math.abs(t.amount);
                return [
                    t.date,
                    typeLabel,
                    csvText(cat.zh),
                    csvText(cat.en),
                    t.currency,
                    signedAmount,
                    csvText(t.note)
                ].join(',');
            });

            // Add UTF-8 BOM so Excel opens Traditional Chinese cleanly without garbled characters
            const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            const fileName = `AutoParts_Export_Ledger_${selectedMonth}.csv`;
            link.setAttribute('href', url);
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            showToast('報表已匯出 / CSV Exported!');
        }

        // --- JSON BACKUP & RESTORE ---
        function backupJSON() {
            if (transactions.length === 0 && preservedStorage === null) {
                showToast('目前沒有資料可備份 / No data');
                return;
            }
            const todayStr = new Date().toISOString().slice(0, 10);
            const dataStr = !isCloudLedger() && preservedStorage !== null ? preservedStorage : JSON.stringify(transactions, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `AutoParts_Ledger_Backup_${todayStr}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            showToast('備份檔已下載 / Backup Saved!');
            closeDataToolsModal();
        }

        function restoreJSON(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > 20 * 1024 * 1024) { showToast('備份檔超過 20 MB / Backup exceeds 20 MB.'); event.target.value = ''; return; }
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const parsed = validateTransactions(JSON.parse(e.target.result));
                    if (isCloudLedger()) { window.promptCloudImport(parsed); event.target.value = ''; return; }
                    document.getElementById('confirmTitle').textContent = '以備份取代此帳本？ / Replace this ledger?';
                    document.getElementById('confirmMessage').textContent = '將以 ' + parsed.length + ' 筆備份資料取代此瀏覽器的全部帳目，並非合併。請先下載現有帳本備份。 / This replaces all records; it does not merge them. Download the current backup first.';
                    pendingConfirmCallback = () => {
                        if (!persistTransactions(parsed)) return;
                        populateMonthDropdown();
                        renderApp();
                        closeDataToolsModal();
                        showToast('成功還原 ' + parsed.length + ' 筆資料 / Backup restored.');
                    };
                    document.getElementById('confirmDialog').classList.remove('hidden');
                } catch (_) { showToast('備份內容格式錯誤，原帳目未變更 / Invalid backup; current records unchanged.'); }
                event.target.value = '';
            };
            reader.onerror = () => { showToast('無法讀取備份檔 / Could not read backup.'); event.target.value = ''; };
            reader.readAsText(file);
        }

        // --- 7. UTILITIES ---
        function showToast(msg) {
            const toast = document.getElementById('toast');
            document.getElementById('toastMsg').textContent = msg;
            toast.classList.remove('opacity-0');
            setTimeout(() => {
                toast.classList.add('opacity-0');
            }, 2500);
        }

        function escapeHTML(str) {
            return str.replace(/[&<>'"]/g, tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag]));
        }

        // Start App
        window.onload = initApp;
