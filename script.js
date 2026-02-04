// --- CONFIGURAÇÃO DA API (GOOGLE SHEETS) ---
const API_URL = "https://script.google.com/macros/s/AKfycbw5FgjU_NeBebC82cyMXb8-sYiyql5P9iw5ujdbQTnu7w0hMNCqTFwxPocIPh2bQVg/exec";

// --- DADOS GLOBAIS ---
let appointments = {}; 
let validTokensMap = {}; 

// --- CACHE DE PERFORMANCE (NOVO) ---
const DASH_CACHE = {}; 
// Estrutura: { "2026-02": { total: 100, occupied: 50, stats: { ... } } }

// CONFIGURAÇÃO DA DATA INICIAL (HOJE)
const todayDate = new Date();
const yInit = todayDate.getFullYear();
const mInit = String(todayDate.getMonth() + 1).padStart(2, '0');
const dInit = String(todayDate.getDate()).padStart(2, '0');
let selectedDateKey = `${yInit}-${mInit}-${dInit}`; 

let currentView = 'booking';
let currentSlotId = null;
let currentDateKey = null;

// --- CONTROLE DE SESSÃO ---
let currentUserToken = null;
let currentUserRole = null;
let pendingAction = null;

// --- CONSTANTES DE CONTRATOS ---
const CONTRACTS = {
    LOCALS: ["ESTADO", "SERRA", "SALGUEIRO"],
    MUNICIPAL: ["RECIFE", "JABOATÃO"]
};

// --- INDICADOR DE CARREGAMENTO (CURSOR) ---
function setLoading(isLoading) {
    const body = document.body;
    body.style.cursor = isLoading ? 'wait' : 'default';
}

// --- NOTIFICAÇÃO TOAST (CONFIRMAÇÃO VISUAL) ---
function showToast(message, type = 'success') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #1e293b; color: white; padding: 12px 24px; border-radius: 50px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-weight: 600; font-size: 0.9rem;
            z-index: 5000; opacity: 0; transition: opacity 0.3s, top 0.3s; pointer-events: none;
            display: flex; align-items: center; gap: 8px;
        `;
        document.body.appendChild(toast);
    }
    const bg = type === 'success' ? '#059669' : (type === 'error' ? '#dc2626' : '#1e293b');
    toast.style.background = bg;
    
    const icon = type === 'success' 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        : '';

    toast.innerHTML = `${icon} ${message}`;
    toast.style.top = '20px';
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.top = '0px';
    }, 3000);
}

// --- LÓGICA DE PRÉ-PROCESSAMENTO ---
function recalculateMonthCache(monthKey) {
    if (!monthKey) return;

    let totalSlots = 0;
    let occupiedSlots = 0;

    // Estrutura de contagem
    let counts = {
        Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
    };

    // Varredura única no mês (O(N) local)
    Object.keys(appointments).forEach(dateKey => {
        if (dateKey.startsWith(monthKey)) {
            const daySlots = appointments[dateKey];
            totalSlots += daySlots.length;

            daySlots.forEach(s => {
                if (s.status === 'OCUPADO') {
                    occupiedSlots++;
                    
                    const c = s.contract ? s.contract.toUpperCase() : null;
                    if (!c) return;

                    if (CONTRACTS.MUNICIPAL.includes(c)) {
                        counts.Municipal.Total++;
                        if (counts.Municipal[c] !== undefined) counts.Municipal[c]++;
                    } else if (CONTRACTS.LOCALS.includes(c)) {
                        let isReg = (s.regulated === true || s.regulated === "TRUE" || s.regulated === "YES");
                        if (isReg) {
                            counts.Regulado.Total++;
                            if (counts.Regulado[c] !== undefined) counts.Regulado[c]++;
                        } else {
                            counts.Interno.Total++;
                            if (counts.Interno[c] !== undefined) counts.Interno[c]++;
                        }
                    }
                }
            });
        }
    });

    // Salva no Cache Global
    DASH_CACHE[monthKey] = {
        total: totalSlots,
        occupied: occupiedSlots,
        counts: counts
    };
}

// --- COMUNICAÇÃO COM O BACKEND (GOOGLE SHEETS) ---

// 1. CARREGAR TOKENS VÁLIDOS E PERMISSÕES
async function fetchValidTokens() {
    try {
        const response = await fetch(`${API_URL}?type=tokens`, { redirect: "follow" });
        const data = await response.json();
        if (data.error) {
            console.error("Erro tokens:", data.error);
        } else {
            validTokensMap = data;
        }
    } catch (error) {
        console.error("Falha tokens:", error);
    }
}

// 2. BUSCAR AGENDAMENTOS (GET)
// isBackground = true impede que a tela mostre spinners bloqueantes
async function fetchRemoteData(dateKey, isBackground = false) {
    if (API_URL.includes("SUA_URL")) {
        alert("Configure a API_URL no script.js!");
        return;
    }

    if (!isBackground) setLoading(true);

    const container = document.getElementById('slots-list-container');
    // Só mexe na UI da lista se for o dia que o usuário está olhando
    if (container && !isBackground) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; color:#94a3b8; text-align:center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite; margin-bottom:12px">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                </svg>
                <div style="font-size:0.9rem; font-weight:500">Buscando agenda...</div>
            </div>
            <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
        `;
    }

    try {
        const response = await fetch(`${API_URL}?action=get&date=${dateKey}`, { redirect: "follow" });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        // Atualiza Dados Brutos
        appointments[dateKey] = data.map(row => ({
            id: row.id,
            date: dateKey,
            time: row.time,
            room: row.room,
            location: row.location,
            doctor: row.doctor,
            specialty: row.specialty,
            status: row.status,
            patient: row.patient,
            record: row.record,
            contract: row.contract,
            regulated: (row.regulated === true || row.regulated === "TRUE" || row.regulated === "YES"),
            procedure: row.procedure,
            detail: row.detail,
            eye: row.eye,
            createdBy: row.created_by
        }));

        // --- ATUALIZAÇÃO DO CACHE MENSAL IMEDIATA ---
        const currentMonth = dateKey.substring(0, 7);
        recalculateMonthCache(currentMonth);
        // ---------------------------------------------

        // Se a visualização estiver ativa no mês corrente, atualiza a lista
        if (dateKey.substring(0, 7) === selectedDateKey.substring(0, 7)) {
            renderSlotsList();
            if (currentView === 'admin') renderAdminTable();
        }
        
        updateKPIs(); 

    } catch (error) {
        console.error(`Erro fetch (${dateKey}):`, error);
        if (container && !isBackground) {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:#ef4444;">
                    <p>Erro ao carregar dados.</p>
                    <button class="btn btn-ghost" onclick="fetchRemoteData('${dateKey}')">Tentar Novamente</button>
                </div>
            `;
            showToast('Erro de conexão.', 'error');
        }
    } finally {
        if (!isBackground) setLoading(false);
    }
}

// 3. SINCRONIZAR MÊS (OTIMIZADO COM LOTES)
async function syncMonthData(baseDateKey) {
    if(!baseDateKey) return;
    
    // Suporte para input tipo "YYYY-MM" ou "YYYY-MM-DD"
    const parts = baseDateKey.split('-');
    const year = parts[0];
    const month = parts[1];
    
    const daysInMonth = new Date(year, month, 0).getDate();
    
    // Identifica quais dias faltam baixar
    let missingDays = [];
    for (let i = 1; i <= daysInMonth; i++) {
        const dStr = String(i).padStart(2, '0');
        const targetKey = `${year}-${month}-${dStr}`;
        if (!appointments[targetKey]) missingDays.push(targetKey);
    }

    // Se não falta nada, apenas recalcula para garantir e atualiza
    if(missingDays.length === 0) {
        recalculateMonthCache(`${year}-${month}`); 
        updateKPIs();
        return;
    }

    // Função para dividir em blocos (chunks)
    const chunkArray = (arr, size) => {
        return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
            arr.slice(i * size, i * size + size)
        );
    };

    // Divide em lotes de 6 dias (Rápido e seguro para o Google)
    const batches = chunkArray(missingDays, 6);

    console.log(`Iniciando carga de ${missingDays.length} dias em ${batches.length} lotes.`);

    // Processa cada lote em paralelo
    for (const batch of batches) {
        await Promise.all(batch.map(dayKey => fetchRemoteData(dayKey, true)));
        // A cada lote que chega, o updateKPIs é chamado dentro do fetchRemoteData
        // fazendo os números do dashboard subirem em tempo real.
    }
    
    console.log("Mês carregado completamente.");
}

// 4. ENVIAR DADOS (POST)
async function sendUpdateToSheet(payload) {
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            redirect: "follow",
            body: JSON.stringify(payload),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });

        const result = await response.json();

        if (result.status === 'success') {
            return true;
        } else {
            throw new Error(result.message || "Erro no servidor.");
        }

    } catch (error) {
        console.error("Erro no envio:", error);
        return false;
    }
}

// --- SISTEMA DE LOGIN ---

function attemptLogin() {
    const input = document.getElementById('login-token');
    const val = input.value.trim();
    const err = document.getElementById('login-error');

    if (validTokensMap.hasOwnProperty(val)) {
        currentUserToken = val;
        const userData = validTokensMap[val];
        currentUserRole = userData.role || 'USER';

        input.style.borderColor = '#16a34a';
        input.style.color = '#16a34a';

        setTimeout(() => {
            closeLoginModal();
            if (pendingAction) {
                const action = pendingAction;
                pendingAction = null;
                action();
            }
        }, 400);
    } else {
        currentUserToken = null;
        currentUserRole = null;
        err.style.display = 'block';
        input.style.borderColor = '#dc2626';
        input.style.color = '#dc2626';
        input.focus();
        
        const card = document.querySelector('#login-modal .modal-card');
        card.style.animation = 'none';
        card.offsetHeight; 
        card.style.animation = 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both';
    }
}

function handleLoginKey(e) { if (e.key === 'Enter') attemptLogin(); }

function requestToken(callback, customTitle = null) {
    pendingAction = callback;
    const modal = document.getElementById('login-modal');
    const input = document.getElementById('login-token');
    modal.querySelector('h2').innerText = customTitle || "Acesso Restrito";
    input.value = '';
    document.getElementById('login-error').style.display = 'none';
    input.style.borderColor = '';
    input.style.color = '';
    modal.style.display = 'flex';
    input.focus();
}

function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('login-token').value = '';
}

// --- NAVEGAÇÃO ---

function switchView(view) {
    if (view === 'admin') {
        if (!currentUserToken) {
            requestToken(() => executeSwitch('admin'), "Acesso Gestor");
        } else {
            executeSwitch('admin');
        }
    } else {
        currentUserToken = null; 
        currentUserRole = null;
        executeSwitch('booking');
    }
}

function executeSwitch(view) {
    if (view === 'admin' && currentUserRole !== 'GESTOR') {
        return showToast('Permissão insuficiente.', 'error');
    }

    currentView = view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-view-${view}`).classList.add('active');

    document.getElementById('view-booking').style.display = 'none';
    document.getElementById('view-admin').style.display = 'none';
    document.getElementById('section-stats').style.display = 'none';

    const sidebar = document.querySelector('.listing-column');

    if (view === 'booking') {
        document.getElementById('view-booking').style.display = 'block';
        document.getElementById('section-stats').style.display = 'block';
        sidebar.classList.remove('locked');
        updateKPIs(); 
    } else {
        document.getElementById('view-admin').style.display = 'block';
        renderAdminTable();
        sidebar.classList.add('locked');
    }
}

// --- INICIALIZAÇÃO OTIMIZADA ---
async function initData() {
    fetchValidTokens();
    
    // Binding do Seletor de Data Lateral
    const picker = document.getElementById('sidebar-date-picker');
    if (picker) picker.value = selectedDateKey; 
    
    // Binding do Seletor de Mês do Dashboard
    const dashPicker = document.getElementById('dashboard-month-picker');
    if (dashPicker) {
        dashPicker.value = selectedDateKey.substring(0, 7);
        // O pulo do gato: Ao mudar o mês do dash, forçar a sincronia
        dashPicker.addEventListener('change', (e) => {
            syncMonthData(e.target.value);
        });
    }

    // 1. CARREGAMENTO PRIORITÁRIO: Dia Atual
    // O await garante que o splash screen só saia DEPOIS que o dia de hoje estiver carregado
    await fetchRemoteData(selectedDateKey, true); 

    // 2. Renderiza a lista do dia (agora que temos dados)
    renderSlotsList();

    // 3. Remove Splash Screen (Usuário já pode ver a agenda)
    const splash = document.getElementById('app-splash-screen');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 500);
    }

    // 4. DISPARA O MÊS EM BACKGROUND
    syncMonthData(selectedDateKey);
}

function updateSidebarDate() {
    const picker = document.getElementById('sidebar-date-picker');
    if (picker && picker.value) {
        selectedDateKey = picker.value;
    }
    document.getElementById('room-filter').value = 'ALL';
    document.getElementById('location-filter').value = 'ALL';

    // Ao mudar data no sidebar, carregamos o dia em questão e garantimos sync do mês
    fetchRemoteData(selectedDateKey, false).then(() => {
        syncMonthData(selectedDateKey);
    });
}

function changeDate(delta) {
    const current = new Date(selectedDateKey + 'T00:00:00');
    current.setDate(current.getDate() + delta);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');

    selectedDateKey = `${y}-${m}-${d}`;
    document.getElementById('sidebar-date-picker').value = selectedDateKey;
    updateSidebarDate();
}

// --- UI LISTA DE VAGAS (VISUALIZAÇÃO MENSAL) ---

function handleSlotClick(slot, key) {
    currentSlotId = slot.id;
    currentDateKey = key;
    renderSlotsList();

    if (currentView === 'booking') {
        openBookingModal(slot, key, slot.status === 'OCUPADO');
    }
}

function updateFilterOptions() {
    // MODIFICADO: Filtros agora olham APENAS para o DIA selecionado
    // Em vez de 'getSlotsFromMonth', usamos direto 'appointments[selectedDateKey]'
    const slots = appointments[selectedDateKey] || [];

    const rooms = [...new Set(slots.map(s => s.room))].sort();
    const locations = [...new Set(slots.map(s => s.location || 'Iputinga'))].sort();

    const roomSelect = document.getElementById('room-filter');
    const locSelect = document.getElementById('location-filter');

    if (roomSelect.options.length <= 1) {
        roomSelect.innerHTML = '<option value="ALL">Todas Salas</option>';
        rooms.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r; opt.textContent = r; roomSelect.appendChild(opt);
        });
    }
    
    if (locSelect.options.length <= 1) {
        locSelect.innerHTML = '<option value="ALL">Todas Unidades</option>';
        locations.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l; opt.textContent = l; locSelect.appendChild(opt);
        });
    }
}

function applyFilters() { renderSlotsList(); }

function renderSlotsList() {
    updateFilterOptions();
    const container = document.getElementById('slots-list-container');
    container.innerHTML = '';

    // MODIFICADO: PEGA APENAS O DIA SELECIONADO
    let slots = appointments[selectedDateKey] || [];

    // 2. APLICA FILTROS
    const locFilter = document.getElementById('location-filter').value;
    const roomFilter = document.getElementById('room-filter').value;
    const shiftFilter = document.getElementById('shift-filter').value;

    if (locFilter !== 'ALL') slots = slots.filter(s => (s.location || 'Iputinga') === locFilter);
    if (roomFilter !== 'ALL') slots = slots.filter(s => String(s.room) === String(roomFilter));

    if (shiftFilter !== 'ALL') {
        slots = slots.filter(s => {
            if (shiftFilter === 'MANHA') return s.time <= '11:59';
            if (shiftFilter === 'TARDE') return s.time >= '12:00';
            return true;
        });
    }

    // 3. ORDENAÇÃO (DATA -> STATUS -> HORA)
    slots.sort((a, b) => {
        // 1. Garante data (caso raro de mistura)
        if (a.date !== b.date) return a.date.localeCompare(b.date);

        // 2. Prioriza LIVRE no topo, OCUPADO no fim
        if (a.status !== b.status) {
            // Se A é LIVRE, ele vem antes (-1). Se não, vai depois (1).
            return a.status === 'LIVRE' ? -1 : 1;
        }

        // 3. Se o status for igual, ordena por horário
        return a.time.localeCompare(b.time);
    });

    if (slots.length === 0) {
        container.innerHTML = `
        <div style="text-align:center; color:#64748b; padding:40px; display:flex; flex-direction:column; align-items:center; gap:16px">
            <div style="background:#f1f5f9; padding:16px; border-radius:50%">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            </div>
            <div>Sem agendas neste dia.</div>
        </div>`;
        return;
    }

    slots.forEach(slot => {
        const item = document.createElement('div');
        item.className = 'slot-item';
        if (currentSlotId === slot.id) item.classList.add('active');

        let statusClass = slot.status === 'LIVRE' ? 'free' : 'booked';
        let statusText = slot.status === 'LIVRE' ? 'Disponível' : 'Ocupado';
        let doctorName = slot.doctor ? `<b>${slot.doctor.split(' ')[0]} ${slot.doctor.split(' ')[1] || ''}</b>` : 'Sem Médico';

        // FORMATAÇÃO DA DATA "AO LADO"
        const dayPart = slot.date.split('-')[2];
        const monthPart = slot.date.split('-')[1];
        const formattedDate = `${dayPart}/${monthPart}`;

        let mainInfo = `
        <div style="flex:1">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%">
                <div class="slot-time" style="display:flex; gap:8px; align-items:center;">
                    <span style="background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:600;">${formattedDate}</span>
                    <span>${slot.time}</span>
                </div>
                 <div class="slot-room-badge">Sala ${slot.room}</div>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">${slot.location || 'Iputinga'}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">${doctorName}</div>
            <div style="font-size:0.75rem; color:var(--text-light); margin-top:2px;">${slot.specialty || '-'}</div>
        `;

        if (slot.status === 'OCUPADO') {
            mainInfo += `
            <div class="slot-detail-box">
                <div class="detail-patient">${slot.patient}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">Pront: ${slot.record || '?'}</div>
                <div class="detail-meta"><span class="badge-kpi">${slot.contract}</span></div>
            </div>
            <div style="font-size:0.65rem; color:#94a3b8; text-align:right; margin-top:4px; font-style:italic">
                ${slot.createdBy ? 'Agendado por: ' + slot.createdBy : ''}
            </div>
            `;
        }
        mainInfo += `</div>`;

        item.innerHTML = `
        ${mainInfo}
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px">
             <div class="slot-status-badge ${statusClass}">${statusText}</div>
             ${slot.detail ? `<div style="font-size:0.7rem; color:var(--text-secondary); margin-top:4px">${slot.detail}</div>` : ''}
        </div>`;

        item.onclick = () => handleSlotClick(slot, slot.date);
        container.appendChild(item);
    });
}

// --- GERAÇÃO EM LOTE ---

function bulkCreateSlots() {
    const dateVal = document.getElementById('bulk-date').value;
    const location = document.getElementById('bulk-location').value;
    const room = document.getElementById('bulk-room').value;
    const group = document.getElementById('bulk-group').value;
    const doctor = document.getElementById('bulk-doctor').value;
    const startTime = document.getElementById('bulk-start-time').value;
    const endTime = document.getElementById('bulk-end-time').value;
    const qty = parseInt(document.getElementById('bulk-qty').value);

    if (!dateVal || !startTime || !endTime || !doctor || isNaN(qty) || qty < 1) {
        return showToast('Preencha todos os campos.', 'error');
    }

    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    const startMins = h1 * 60 + m1;
    const endMins = h2 * 60 + m2;

    if (endMins <= startMins) {
        return showToast('Horário final inválido.', 'error');
    }

    const slotDuration = (endMins - startMins) / qty;
    let slotsToSend = [];

    for (let i = 0; i < qty; i++) {
        const currentSlotMins = Math.round(startMins + (i * slotDuration));
        const h = Math.floor(currentSlotMins / 60);
        const m = currentSlotMins % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        slotsToSend.push({
            id: Date.now() + i,
            date: dateVal,
            time: timeStr,
            room: room || '1',
            location: location,
            doctor: doctor,
            specialty: group,
            procedure: group,
            createdBy: currentUserToken
        });
    }

    showMessageModal('Processando', `Criando ${qty} vagas...`, 'loading');

    const payload = { action: "create_bulk", data: slotsToSend };

    sendUpdateToSheet(payload).then(success => {
        closeMessageModal();
        if (success) {
            showToast(`${qty} vagas criadas!`, 'success');
            selectedDateKey = dateVal;
            document.getElementById('sidebar-date-picker').value = selectedDateKey;
            fetchRemoteData(selectedDateKey);
            executeSwitch('booking');
        }
    });
}

// --- ADMIN TABLE (MEMÓRIA DE SELEÇÃO) ---

function renderAdminTable() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    // 1. SALVA ESTADO: Antes de limpar, guarda quem estava marcado
    const currentlyChecked = Array.from(document.querySelectorAll('.slot-checkbox:checked'))
                                  .map(cb => String(cb.value));

    tbody.innerHTML = '';

    // Pega o MÊS inteiro também no Admin
    const targetMonth = selectedDateKey.substring(0, 7);
    const slots = getSlotsFromMonth(targetMonth);

    slots.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
    });

    slots.forEach(slot => {
        const tr = document.createElement('tr');
        
        let statusHtml = slot.status === 'OCUPADO' 
            ? `<span style="background:#fee2e2; color:#dc2626; padding:2px 8px; border-radius:12px; font-weight:600; font-size:0.75rem">OCUPADO</span>`
            : `<span style="background:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:12px; font-weight:600; font-size:0.75rem">LIVRE</span>`;
        
        const dateFmt = `${slot.date.split('-')[2]}/${slot.date.split('-')[1]}`;

        // 2. REAPLICA ESTADO: Se estava marcado, marca de novo
        const isChecked = currentlyChecked.includes(String(slot.id)) ? 'checked' : '';

        tr.innerHTML = `
            <td style="text-align:center">
                <input type="checkbox" class="slot-checkbox" value="${slot.id}" ${isChecked} onchange="updateDeleteButton()">
            </td>
            <td>${dateFmt}</td>
            <td>${slot.time}</td>
            <td>${slot.room}</td>
            <td>
                <div style="font-weight:600; font-size:0.85rem">${slot.doctor}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">${slot.specialty}</div>
            </td>
            <td>${statusHtml}</td>
            <td style="text-align:center">
                <button class="btn btn-danger btn-delete-single" style="padding:4px 8px; font-size:0.75rem" onclick="deleteSlot('${slot.id}')">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDeleteButton();
    
    // Opcional: Verifica se "Marcar Todos" deve estar ativo
    const masterCheck = document.getElementById('check-all-slots');
    if(masterCheck) {
        const total = document.querySelectorAll('.slot-checkbox').length;
        const checked = document.querySelectorAll('.slot-checkbox:checked').length;
        masterCheck.checked = (total > 0 && total === checked);
    }
}

function toggleAllSlots(source) {
    document.querySelectorAll('.slot-checkbox').forEach(cb => cb.checked = source.checked);
    updateDeleteButton();
}

function updateDeleteButton() {
    const total = document.querySelectorAll('.slot-checkbox:checked').length;
    const btn = document.getElementById('btn-delete-selected');
    const countSpan = document.getElementById('count-selected');
    const singleBtns = document.querySelectorAll('.btn-delete-single');

    singleBtns.forEach(b => {
        b.style.opacity = total > 0 ? '0.3' : '1';
        b.style.pointerEvents = total > 0 ? 'none' : 'auto';
    });

    if (btn) {
        if (total > 0) {
            btn.style.display = 'inline-flex';
            if (countSpan) countSpan.innerText = total;
        } else {
            btn.style.display = 'none';
        }
    }
}

async function deleteSelectedSlots() {
    const checkboxes = document.querySelectorAll('.slot-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    if (ids.length === 0) return;

    showMessageModal('Confirmação', `Deseja excluir ${ids.length} vagas selecionadas?`, 'confirm', () => {
        processBatchDelete(ids);
    });
}

// --- PROCESSAMENTO EM LOTE BLINDADO ---
async function processBatchDelete(ids) {
    showMessageModal('Processando', `Iniciando exclusão...`, 'loading');
    const msgBody = document.getElementById('msg-body');
    
    let successCount = 0;
    const total = ids.length;

    for (let i = 0; i < total; i++) {
        const id = ids[i];
        if(msgBody) msgBody.innerText = `Excluindo ${i + 1} de ${total}...`;
        await new Promise(r => setTimeout(r, 20));

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                redirect: "follow",
                body: JSON.stringify({ action: "delete", id: id }),
                headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
            const result = await response.json();
            if (result.status === 'success') {
                successCount++;
                
                // REMOVE DO CACHE GLOBAL
                Object.keys(appointments).forEach(key => {
                    appointments[key] = appointments[key].filter(s => String(s.id) !== String(id));
                });
            }
        } catch (e) { console.error("Erro delete:", e); }
    }

    // --- RECALCULA CACHE MENSAL APÓS DELETE ---
    recalculateMonthCache(selectedDateKey.substring(0, 7));
    // ------------------------------------------

    closeMessageModal();
    renderSlotsList(); 
    renderAdminTable(); 
    updateKPIs(); 

    showToast(`${successCount} vagas excluídas.`, 'success');
}

// --- EXCLUSÃO INDIVIDUAL BLINDADA ---
function deleteSlot(id) {
    // Busca no mês todo
    const monthKey = selectedDateKey.substring(0,7);
    const slots = getSlotsFromMonth(monthKey);
    const slot = slots.find(s => String(s.id) === String(id));

    let msg = 'Excluir vaga permanentemente?';
    
    if (slot && slot.status === 'OCUPADO') {
        msg = `<b>ATENÇÃO:</b> Vaga com paciente <b>${slot.patient}</b>. Excluir removerá ambos.`;
    }

    showMessageModal('Excluir', msg, 'confirm', async () => {
        closeMessageModal();
        setLoading(true); 
        
        const success = await sendUpdateToSheet({ action: "delete", id: id });
        if (success) {
            // Remove do cache GLOBALMENTE
             Object.keys(appointments).forEach(key => {
                appointments[key] = appointments[key].filter(s => String(s.id) !== String(id));
            });

            // Remove do DOM imediatamente
            const item = document.querySelector(`.slot-checkbox[value="${id}"]`)?.closest('tr');
            if(item) item.remove();

            // --- RECALCULA CACHE ---
            recalculateMonthCache(selectedDateKey.substring(0, 7));
            // ---------------------

            // Atualiza tudo
            renderSlotsList();
            renderAdminTable();
            updateKPIs();

            showToast('Vaga excluída.', 'success');
        }
        setLoading(false);
    });
}

// --- MODAL DE AGENDAMENTO ---

function openBookingModal(slot, key, isEdit = false) {
    const modal = document.getElementById('booking-modal');

    document.getElementById('bk-record').value = slot.record || '';
    document.getElementById('bk-patient').value = slot.patient || '';
    document.getElementById('bk-contract').value = slot.contract || '';
    document.getElementById('bk-procedure').value = slot.procedure || slot.specialty || '';
    document.getElementById('bk-detail').value = slot.detail || '';
    document.getElementById('bk-eye').value = slot.eye || '';
    document.getElementById('selected-slot-id').value = slot.id;

    let isReg = slot.regulated;
    if (isReg === undefined || isReg === null) isReg = true;
    if (slot.status === 'LIVRE') isReg = true;

    const radios = document.getElementsByName('bk-regulated');
    const radioVal = isReg ? 'yes' : 'no';
    for (const r of radios) { 
        if (r.value === radioVal) r.checked = true; 
    }

    // Data formatada para o Modal
    const dateFmt = `${slot.date.split('-')[2]}/${slot.date.split('-')[1]}`;
    document.getElementById('modal-slot-info').innerText = `${dateFmt} • ${slot.time} • ${slot.doctor}`;
    
    document.getElementById('warning-box').style.display = 'none';

    const btnArea = document.getElementById('action-buttons-area');
    if (isEdit) {
        btnArea.innerHTML = `<button class="btn btn-danger" onclick="cancelSlotBooking()">Liberar Vaga</button>`;
    } else {
        btnArea.innerHTML = `<button class="btn btn-primary" onclick="confirmBookingFromModal()">Confirmar</button>`;
    }

    modal.classList.add('open');
    checkWarning();
}

function closeModal() { document.getElementById('booking-modal').classList.remove('open'); }

function checkWarning() {
    const contract = document.getElementById('bk-contract').value;
    const warningBox = document.getElementById('warning-box');
    const radios = document.getElementsByName('bk-regulated');
    const isMunicipal = CONTRACTS.MUNICIPAL.includes(contract);
    
    for (const r of radios) r.disabled = isMunicipal;

    if (!contract || isMunicipal) {
        warningBox.style.display = 'none';
        return;
    }

    // Nota: O checkWarning ainda usa getSlotsFromMonth para projecão, 
    // mas por ser ação de usuário individual não impacta tanto a performance global
    let isNewBookingRegulated = true;
    for (const r of radios) { if (r.checked && r.value === 'no') isNewBookingRegulated = false; }

    const monthKey = selectedDateKey.substring(0,7);
    const slots = getSlotsFromMonth(monthKey);
    const totalSlots = slots.length;

    if (totalSlots === 0) {
        warningBox.style.display = 'none';
        return;
    }

    let countReg = 0;
    let countInt = 0;

    slots.forEach(s => {
        if (s.status === 'OCUPADO' && s.contract && !CONTRACTS.MUNICIPAL.includes(s.contract)) {
            const isReg = (s.regulated === true || s.regulated === "TRUE" || s.regulated === "YES");
            if (isReg) countReg++;
            else countInt++;
        }
    });

    let projectedReg = countReg;
    let projectedInt = countInt;
    
    if (isNewBookingRegulated) projectedReg++;
    else projectedInt++;

    const pctReg = (projectedReg / totalSlots) * 100;
    const pctInt = (projectedInt / totalSlots) * 100;

    let showWarning = false;
    let msg = "";

    if (isNewBookingRegulated && pctReg > 60) {
        showWarning = true;
        msg = `Atenção: Regulados atingirão <b>${pctReg.toFixed(1)}%</b> (Meta: 60%)`;
    } else if (!isNewBookingRegulated && pctInt > 40) {
        showWarning = true;
        msg = `Atenção: Internos atingirão <b>${pctInt.toFixed(1)}%</b> (Meta: 40%)`;
    }

    if (showWarning) {
        warningBox.style.display = 'flex';
        if(warningBox.querySelector('div:last-child > div:last-child')) {
             warningBox.querySelector('div:last-child > div:last-child').innerHTML = msg;
        } else {
             const div = document.createElement('div');
             div.innerHTML = msg;
             warningBox.appendChild(div);
        }
    } else {
        warningBox.style.display = 'none';
    }
}

// AGENDAMENTO OTIMISTA + TOAST
function confirmBookingFromModal() {
    const id = document.getElementById('selected-slot-id').value;
    const record = document.getElementById('bk-record').value;
    const patient = document.getElementById('bk-patient').value;
    const contract = document.getElementById('bk-contract').value;
    const procedure = document.getElementById('bk-procedure').value;
    const detail = document.getElementById('bk-detail').value;
    const eye = document.getElementById('bk-eye').value;

    if (!patient || !contract || !record || !detail || !eye) {
        return showToast('Preencha todos os campos.', 'error');
    }

    const radios = document.getElementsByName('bk-regulated');
    let isRegulated = true;
    const isMunicipal = CONTRACTS.MUNICIPAL.includes(contract);

    if (isMunicipal) {
        isRegulated = null; 
    } else {
        for (const r of radios) { if (r.checked && r.value === 'no') isRegulated = false; }
    }

    const summary = `
        <div style="text-align:left; background:#f8fafc; padding:16px; border-radius:8px; font-size:0.9rem; border:1px solid #e2e8f0">
            <div><b>Paciente:</b> ${patient}</div>
            <div><b>Contrato:</b> ${contract}</div>
            <div><b>Regulado:</b> ${isRegulated === true ? 'SIM' : (isRegulated === false ? 'NÃO' : '-')}</div>
        </div>
        <div style="margin-top:16px; font-weight:600">Confirmar?</div>
    `;

    showMessageModal('Confirmação', summary, 'confirm', () => {
        requestToken(async () => {
            // 1. Atualiza Localmente
            // Varre todas as chaves de data carregadas para achar o ID
            Object.keys(appointments).forEach(dateKey => {
                const slotIndex = appointments[dateKey].findIndex(s => String(s.id) === String(id));
                if (slotIndex !== -1) {
                    appointments[dateKey][slotIndex] = {
                        ...appointments[dateKey][slotIndex],
                        status: 'OCUPADO',
                        patient: patient,
                        record: record,
                        contract: contract,
                        regulated: isRegulated,
                        procedure: procedure,
                        detail: detail,
                        eye: eye,
                        createdBy: currentUserToken
                    };
                }
            });

            // --- RECALCULA CACHE APÓS EDITAR ---
            recalculateMonthCache(selectedDateKey.substring(0, 7));
            // -----------------------------------

            // 2. Atualiza UI + Toast
            closeMessageModal();
            closeModal();
            renderSlotsList();
            updateKPIs();
            showToast("Agendamento realizado!", "success");

            // 3. Envia Background
            const payload = {
                action: "update",
                id: id,
                status: 'OCUPADO',
                patient: patient,
                record: record,
                contract: contract,
                regulated: isRegulated,
                procedure: procedure,
                detail: detail,
                eye: eye,
                createdBy: currentUserToken
            };

            sendUpdateToSheet(payload).then(success => {
                if (!success) {
                    showToast("Falha ao salvar no servidor.", "error");
                }
            });
        });
    });
}

function cancelSlotBooking() {
    showMessageModal('Liberar Vaga', 'Remover paciente?', 'confirm', () => {
        requestToken(async () => {
            const id = document.getElementById('selected-slot-id').value;
            
            Object.keys(appointments).forEach(dateKey => {
                const slotIndex = appointments[dateKey].findIndex(s => String(s.id) === String(id));
                if (slotIndex !== -1) {
                    appointments[dateKey][slotIndex] = {
                        ...appointments[dateKey][slotIndex],
                        status: 'LIVRE',
                        patient: '', record: '', contract: '', regulated: null,
                        procedure: '', detail: '', eye: '', createdBy: currentUserToken
                    };
                }
            });

            // --- RECALCULA CACHE APÓS CANCELAR ---
            recalculateMonthCache(selectedDateKey.substring(0, 7));
            // -------------------------------------

            closeMessageModal();
            closeModal();
            renderSlotsList();
            updateKPIs();
            showToast("Vaga liberada.", "success");

            const payload = {
                action: "update",
                id: id,
                status: 'LIVRE',
                patient: '', record: '', contract: '', regulated: null,
                procedure: '', detail: '', eye: '', createdBy: currentUserToken
            };
            
            sendUpdateToSheet(payload);
        }, "Autorizar Cancelamento");
    });
}

// --- UTILITÁRIOS E KPIS MENSAIS (COM BLOQUEIO) ---

function getSlotsFromMonth(monthKey) {
    let allSlots = [];
    Object.keys(appointments).forEach(dateKey => {
        if (dateKey.startsWith(monthKey)) {
            allSlots = allSlots.concat(appointments[dateKey]);
        }
    });
    return allSlots;
}

// --- KPI OPTIMIZADO: LÊ DO CACHE (O(1)) ---
function updateKPIs() {
    // 1. Identifica o mês desejado pelo seletor (ou data atual)
    const picker = document.getElementById('dashboard-month-picker');
    let targetMonth = '';

    if (picker && picker.value) {
        targetMonth = picker.value;
    } else {
        targetMonth = selectedDateKey.substring(0, 7);
        if (picker) picker.value = targetMonth;
    }

    // 2. Tenta ler do cache. Se não existir, tenta criar na hora com o que tem.
    if (!DASH_CACHE[targetMonth]) {
        recalculateMonthCache(targetMonth);
    }
    
    // 3. Se ainda assim não existir (ex: mês futuro vazio), cria um dummy zerado
    // para não quebrar a tela com "--".
    if (!DASH_CACHE[targetMonth]) {
        DASH_CACHE[targetMonth] = {
            total: 0,
            occupied: 0,
            counts: {
                Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
                Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
                Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
            }
        };
    }

    // 3. LEITURA DIRETA DO CACHE (Instantâneo)
    const stats = DASH_CACHE[targetMonth];
    const { total, occupied, counts } = stats;

    // --- CÁLCULOS GERAIS ---
    const calcPct = (val, tot) => tot > 0 ? ((val / tot) * 100).toFixed(1) : "0.0";
    
    document.getElementById('glb-total').innerText = total;
    document.getElementById('glb-occupied').innerText = calcPct(occupied, total) + '%';
    
    const idleVal = total - occupied;
    document.getElementById('glb-idle').innerText = calcPct(idleVal, total) + '%';

    // --- LÓGICA DE REGULADOS (META 60%) ---
    // KPI Principal: % em relação ao TOTAL GERAL
    const totalReg = counts.Regulado.Total;
    const pctRegGlobal = total > 0 ? (totalReg / total) * 100 : 0;
    
    document.getElementById('kpi-60-val').innerText = pctRegGlobal.toFixed(1) + '%';
    document.getElementById('prog-60').style.width = Math.min(pctRegGlobal, 100) + '%';

    // Sub-KPIs: % em relação ao GRUPO REGULADO + (Qtd Absoluta)
    const fmtSub = (val, groupTotal) => {
        const pct = groupTotal > 0 ? ((val / groupTotal) * 100).toFixed(1) : "0.0";
        return `${pct}% (${val})`;
    };

    document.getElementById('stat-estado').innerText = fmtSub(counts.Regulado.ESTADO, totalReg);
    document.getElementById('stat-serra').innerText = fmtSub(counts.Regulado.SERRA, totalReg);
    document.getElementById('stat-salgueiro').innerText = fmtSub(counts.Regulado.SALGUEIRO, totalReg);

    // --- LÓGICA DE INTERNOS (META 40%) ---
    // KPI Principal: % em relação ao TOTAL GERAL
    const totalInt = counts.Interno.Total;
    const pctIntGlobal = total > 0 ? (totalInt / total) * 100 : 0;

    document.getElementById('kpi-40-val').innerText = pctIntGlobal.toFixed(1) + '%';
    document.getElementById('prog-40').style.width = Math.min(pctIntGlobal, 100) + '%';

    // Sub-KPIs: % em relação ao GRUPO INTERNO + (Qtd Absoluta)
    document.getElementById('stat-int-estado').innerText = fmtSub(counts.Interno.ESTADO, totalInt);
    document.getElementById('stat-int-serra').innerText = fmtSub(counts.Interno.SERRA, totalInt);
    document.getElementById('stat-int-salgueiro').innerText = fmtSub(counts.Interno.SALGUEIRO, totalInt);

    // --- LÓGICA MUNICIPAL ---
    document.getElementById('stat-recife').innerText = counts.Municipal.RECIFE;
    document.getElementById('stat-jaboatao').innerText = counts.Municipal.JABOATÃO;
    document.getElementById('kpi-mun-val').innerText = counts.Municipal.Total;
}

// --- NOVA GERAÇÃO DE PDF FORMATADO (TABELA LIMPA) ---
function generateDashboardPDF() {
    const monthVal = document.getElementById('dashboard-month-picker').value || 'Geral';
    
    // Recalcula dados para o PDF
    const slots = getSlotsFromMonth(monthVal);
    const totalSlots = slots.length;
    let occupied = 0;
    let counts = {
        Regulado: { ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Interno: { ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Municipal: { RECIFE: 0, JABOATÃO: 0 }
    };

    slots.forEach(s => {
        if (s.status === 'OCUPADO') {
            occupied++;
            const c = s.contract ? s.contract.toUpperCase() : null;
            if(c) {
                if (CONTRACTS.MUNICIPAL.includes(c)) {
                    if (counts.Municipal[c] !== undefined) counts.Municipal[c]++;
                } else if (CONTRACTS.LOCALS.includes(c)) {
                    let isReg = (s.regulated === true || s.regulated === "TRUE" || s.regulated === "YES");
                    if (isReg) { if (counts.Regulado[c] !== undefined) counts.Regulado[c]++; } 
                    else { if (counts.Interno[c] !== undefined) counts.Interno[c]++; }
                }
            }
        }
    });

    const totalReg = Object.values(counts.Regulado).reduce((a, b) => a + b, 0);
    const totalInt = Object.values(counts.Interno).reduce((a, b) => a + b, 0);
    const pctReg = totalSlots > 0 ? (totalReg / totalSlots * 100).toFixed(1) : "0.0";
    const pctInt = totalSlots > 0 ? (totalInt / totalSlots * 100).toFixed(1) : "0.0";
    const pctOcup = totalSlots > 0 ? (occupied / totalSlots * 100).toFixed(1) : "0.0";

    // Cria HTML Limpo para PDF
    const content = document.createElement('div');
    content.innerHTML = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 20px;">
                <h1 style="color: #1e293b; font-size: 24px; margin: 0;">Relatório de Governança Cirúrgica</h1>
                <div style="color: #64748b; font-size: 14px; margin-top: 5px;">Período de Referência: ${monthVal}</div>
            </div>

            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 30px;">
                <h3 style="margin-top:0; color:#475569; font-size:16px; border-bottom:1px solid #cbd5e1; padding-bottom:5px;">Visão Global</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Total de Vagas:</strong> ${totalSlots}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Ocupação:</strong> ${pctOcup}%</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Ociosidade:</strong> ${(100 - parseFloat(pctOcup)).toFixed(1)}%</td>
                    </tr>
                </table>
            </div>

            <div style="display:flex; gap:20px;">
                <div style="flex:1;">
                    <h3 style="color:#7c3aed; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Contratos Regulados (Meta 60%)</h3>
                    <div style="font-size:24px; font-weight:bold; color:#7c3aed; margin-bottom:10px;">${pctReg}% <span style="font-size:12px; color:#666">do total</span></div>
                    <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                        <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Unidade</th><th style="padding:8px; text-align:right;">Qtd</th></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Estado</td><td style="padding:8px; text-align:right;">${counts.Regulado.ESTADO}</td></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Serra Talhada</td><td style="padding:8px; text-align:right;">${counts.Regulado.SERRA}</td></tr>
                        <tr><td style="padding:8px;">Salgueiro</td><td style="padding:8px; text-align:right;">${counts.Regulado.SALGUEIRO}</td></tr>
                        <tr style="background:#f8fafc; font-weight:bold;"><td style="padding:8px;">TOTAL</td><td style="padding:8px; text-align:right;">${totalReg}</td></tr>
                    </table>
                </div>

                <div style="flex:1;">
                    <h3 style="color:#059669; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Contratos Internos (Meta 40%)</h3>
                    <div style="font-size:24px; font-weight:bold; color:#059669; margin-bottom:10px;">${pctInt}% <span style="font-size:12px; color:#666">do total</span></div>
                    <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                        <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Unidade</th><th style="padding:8px; text-align:right;">Qtd</th></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Estado</td><td style="padding:8px; text-align:right;">${counts.Interno.ESTADO}</td></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Serra Talhada</td><td style="padding:8px; text-align:right;">${counts.Interno.SERRA}</td></tr>
                        <tr><td style="padding:8px;">Salgueiro</td><td style="padding:8px; text-align:right;">${counts.Interno.SALGUEIRO}</td></tr>
                        <tr style="background:#f8fafc; font-weight:bold;"><td style="padding:8px;">TOTAL</td><td style="padding:8px; text-align:right;">${totalInt}</td></tr>
                    </table>
                </div>
            </div>

            <div style="margin-top: 30px;">
                 <h3 style="color:#64748b; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Municípios (Sem Meta)</h3>
                 <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                    <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Município</th><th style="padding:8px; text-align:right;">Qtd</th></tr>
                    <tr><td style="padding:8px; border-bottom:1px solid #eee;">Recife</td><td style="padding:8px; text-align:right;">${counts.Municipal.RECIFE}</td></tr>
                    <tr><td style="padding:8px;">Jaboatão</td><td style="padding:8px; text-align:right;">${counts.Municipal.JABOATÃO}</td></tr>
                 </table>
            </div>

            <div style="margin-top:40px; font-size:10px; color:#94a3b8; text-align:center; border-top:1px solid #eee; padding-top:10px;">
                Documento gerado automaticamente pelo sistema GovCirúrgica em ${new Date().toLocaleString()}
            </div>
        </div>
    `;

    const opt = {
        margin:       10,
        filename:     `Relatorio_Gov_${monthVal}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    setLoading(true);

    if (typeof html2pdf === 'undefined') {
        setLoading(false);
        return showToast('Erro: Biblioteca PDF não carregada.', 'error');
    }

    html2pdf().set(opt).from(content).save().then(() => {
        setLoading(false);
        showToast('PDF baixado com sucesso!', 'success');
    }).catch(err => {
        setLoading(false);
        console.error(err);
        showToast('Erro ao gerar PDF.', 'error');
    });
}

// --- MODAIS GERAIS ---

let messageCallback = null;

function showMessageModal(title, message, type = 'success', onConfirm = null) {
    const modal = document.getElementById('message-modal');
    const iconEl = document.getElementById('msg-icon');
    const btns = document.getElementById('msg-actions');

    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-body').innerHTML = message;
    messageCallback = onConfirm;

    btns.style.display = 'flex';
    if (type === 'loading') btns.style.display = 'none';

    const icons = {
        'success': { color: '#16a34a', bg: '#dcfce7', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` },
        'warning': { color: '#d97706', bg: '#fef3c7', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>` },
        'error': { color: '#dc2626', bg: '#fee2e2', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>` },
        'confirm': { color: '#0284c7', bg: '#e0f2fe', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>` },
        'loading': { color: '#0284c7', bg: '#f0f9ff', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>` }
    };

    const style = icons[type] || icons['success'];
    iconEl.style.color = style.color;
    iconEl.style.background = style.bg;
    iconEl.innerHTML = style.svg;

    const btnConfirm = document.getElementById('msg-btn-confirm');
    const btnCancel = document.getElementById('msg-btn-cancel');

    if (type === 'confirm') {
        btnCancel.style.display = 'block';
        btnConfirm.innerText = 'Confirmar';
        btnConfirm.onclick = () => { if (messageCallback) messageCallback(); };
    } else {
        btnCancel.style.display = 'none';
        btnConfirm.innerText = 'OK';
        btnConfirm.onclick = () => closeMessageModal();
    }

    modal.classList.add('open');
}

function closeMessageModal() {
    document.getElementById('message-modal').classList.remove('open');
    messageCallback = null;
}

function exportDailyReport() {
    const key = selectedDateKey;
    const slots = appointments[key] || [];

    if (slots.length === 0) return showToast('Nada para exportar.', 'warning');

    const headers = ["Data", "Hora", "Unidade", "Sala", "Status", "Paciente", "Prontuario", "Contrato", "Regulado", "Medico", "Procedimento", "Detalhe"];
    const rows = slots.map(s => {
        return [
            key, s.time, s.location, s.room, s.status, s.patient, s.record, s.contract, 
            (s.regulated ? 'SIM' : 'NÃO'), s.doctor, s.procedure, s.detail
        ].map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';');
    });

    const csvContent = "\uFEFF" + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Relatorio_${key}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.onclick = function (event) {
    if (event.target === document.getElementById('login-modal')) closeLoginModal();
    if (event.target === document.getElementById('booking-modal')) closeModal();
    if (event.target === document.getElementById('message-modal')) closeMessageModal();
}

// Inicia
initData();