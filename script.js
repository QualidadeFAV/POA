// --- CONFIGURAÇÃO DA API (GOOGLE SHEETS) ---
// Substitua pela sua URL se necessário
const API_URL = "https://script.google.com/macros/s/AKfycbw5FgjU_NeBebC82cyMXb8-sYiyql5P9iw5ujdbQTnu7w0hMNCqTFwxPocIPh2bQVg/exec";

// --- DADOS GLOBAIS ---
let appointments = {}; 
let validTokensMap = {}; // Armazena: { "1234": { name: "Raphael", role: "GESTOR" } }
let selectedDateKey = '2026-02-01'; 
let currentView = 'booking';
let currentSlotId = null;
let currentDateKey = null;

// --- CONTROLE DE SESSÃO ---
let currentUserToken = null; 
let currentUserRole = null; // Armazena se é 'USER' ou 'GESTOR'
let pendingAction = null;   

// --- INDICADOR DE CARREGAMENTO (UI) ---
function setLoading(isLoading) {
    const body = document.body;
    body.style.cursor = isLoading ? 'wait' : 'default';
}

// --- COMUNICAÇÃO COM O BACKEND (GOOGLE SHEETS) ---

// 1. CARREGAR TOKENS VÁLIDOS E PERMISSÕES
async function fetchValidTokens() {
    try {
        // Pede a lista de tokens para a planilha
        const response = await fetch(`${API_URL}?type=tokens`, { redirect: "follow" });
        const data = await response.json();
        
        if (data.error) {
            console.error("Erro ao carregar tokens:", data.error);
        } else {
            validTokensMap = data; 
            console.log("Sistema carregado. Tokens ativos:", Object.keys(validTokensMap).length);
        }
    } catch (error) {
        console.error("Falha fatal na conexão:", error);
    }
}

// 2. BUSCAR AGENDAMENTOS (GET)
async function fetchRemoteData(dateKey) {
    if (API_URL.includes("SUA_URL")) {
        alert("Configure a API_URL no script.js!");
        return;
    }

    setLoading(true);
    try {
        const response = await fetch(`${API_URL}?date=${dateKey}`, { redirect: "follow" });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        // Mapeamento dos dados
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
            procedure: row.procedure, 
            detail: row.detail,
            eye: row.eye,
            createdBy: row.created_by 
        }));

        renderSlotsList();
        updateKPIs();
        
        // Se estiver na tela de admin, atualiza ela também
        if (currentView === 'admin') renderAdminTable();

    } catch (error) {
        console.error("Erro no fetch:", error);
        showMessageModal('Erro de Conexão', 'Falha ao buscar dados. Verifique sua internet.', 'error');
    } finally {
        setLoading(false);
    }
}

// 3. ENVIAR DADOS (POST)
async function sendUpdateToSheet(payload) {
    setLoading(true);
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();

        if (result.status === 'success') {
            return true;
        } else {
            throw new Error(result.message || "Erro no servidor.");
        }

    } catch (error) {
        console.error("Erro no envio:", error);
        showMessageModal('Erro', `Falha ao salvar: ${error.message}`, 'error');
        return false;
    } finally {
        setLoading(false);
    }
}

// --- SISTEMA DE LOGIN E SEGURANÇA ---

function attemptLogin() {
    const input = document.getElementById('login-token');
    const val = input.value.trim();
    const err = document.getElementById('login-error');

    // Verifica se o token existe na lista baixada do Google Sheets
    if (validTokensMap.hasOwnProperty(val)) {
        currentUserToken = val; 
        
        // PEGA A PERMISSÃO (ROLE) DO USUÁRIO
        const userData = validTokensMap[val];
        currentUserRole = userData.role || 'USER'; // Se não tiver nada na planilha, assume USER
        
        // Feedback visual
        input.style.borderColor = '#16a34a';
        input.style.color = '#16a34a';

        setTimeout(() => {
            closeLoginModal();
            // Executa ação pendente se houver
            if (pendingAction) {
                const action = pendingAction;
                pendingAction = null; 
                action();
            }
        }, 400); 
    } else {
        // Login falhou
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

function handleLoginKey(e) {
    if (e.key === 'Enter') attemptLogin();
}

function requestToken(callback, customTitle = null) {
    pendingAction = callback;
    
    const modal = document.getElementById('login-modal');
    const input = document.getElementById('login-token');
    const titleEl = modal.querySelector('h2');

    if(customTitle) titleEl.innerText = customTitle;
    else titleEl.innerText = "Acesso Restrito";
    
    input.value = ''; 
    document.getElementById('login-error').style.display = 'none'; 
    input.style.borderColor = ''; 
    input.style.color = '';
    
    modal.style.display = 'flex';
    input.focus();
}

function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    const input = document.getElementById('login-token');
    modal.style.display = 'none';
    input.value = ''; 
}

// --- NAVEGAÇÃO E CONTROLE DE ACESSO ---

function switchView(view) {
    if (view === 'admin') {
        // Se não estiver logado, pede login
        if (!currentUserToken) {
            requestToken(() => {
                executeSwitch('admin');
            }, "Acesso Gestor");
        } else {
            // Se já estiver logado, tenta entrar
            executeSwitch('admin');
        }
    } else {
        executeSwitch('booking');
    }
}

function executeSwitch(view) {
    // --- BLOQUEIO DE SEGURANÇA ---
    // Se tentar acessar ADMIN e não for GESTOR, bloqueia.
    if (view === 'admin') {
        if (currentUserRole !== 'GESTOR') {
            return showMessageModal(
                'Acesso Negado', 
                `Este token pertence a <b>${validTokensMap[currentUserToken].name}</b> (Perfil: ${currentUserRole}).<br>Apenas <b>GESTOR</b> pode gerenciar vagas.`, 
                'error'
            );
        }
    }
    // -----------------------------

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
    } else {
        document.getElementById('view-admin').style.display = 'block';
        renderAdminTable();
        sidebar.classList.add('locked'); 
    }
}

// --- INICIALIZAÇÃO ---
function initData() {
    // 1. Baixa os tokens permitidos da planilha
    fetchValidTokens();

    const picker = document.getElementById('sidebar-date-picker');
    if(picker) picker.value = selectedDateKey;
    
    updateSidebarDate(); 
}

function updateSidebarDate() {
    const picker = document.getElementById('sidebar-date-picker');
    if (picker && picker.value) {
        selectedDateKey = picker.value;
    }
    document.getElementById('room-filter').value = 'ALL';
    document.getElementById('location-filter').value = 'ALL';
    
    fetchRemoteData(selectedDateKey);
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

// --- LÓGICA DE INTERFACE E AGENDAMENTO ---

function handleSlotClick(slot, key) {
    currentSlotId = slot.id;
    currentDateKey = key;
    renderSlotsList(); 
    
    if (currentView === 'booking') {
        openBookingModal(slot, key, slot.status === 'OCUPADO');
    }
}

function updateFilterOptions() {
    const key = selectedDateKey;
    const slots = appointments[key] || [];
    
    const rooms = [...new Set(slots.map(s => s.room))].sort();
    const locations = [...new Set(slots.map(s => s.location || 'Iputinga'))].sort();

    const roomSelect = document.getElementById('room-filter');
    const locSelect = document.getElementById('location-filter');
    const currRoom = roomSelect.value;
    const currLoc = locSelect.value;

    roomSelect.innerHTML = '<option value="ALL">Todas Salas</option>';
    locSelect.innerHTML = '<option value="ALL">Todas Unidades</option>';

    rooms.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r; roomSelect.appendChild(opt);
    });
    locations.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l; opt.textContent = l; locSelect.appendChild(opt);
    });

    if (rooms.includes(currRoom)) roomSelect.value = currRoom;
    if (locations.includes(currLoc)) locSelect.value = currLoc;
}

function applyFilters() { renderSlotsList(); }

function renderSlotsList() {
    updateFilterOptions();
    const container = document.getElementById('slots-list-container');
    container.innerHTML = '';
    
    const key = selectedDateKey;
    let slots = appointments[key] ? [...appointments[key]] : []; 
    
    const locFilter = document.getElementById('location-filter').value;
    const roomFilter = document.getElementById('room-filter').value;

    if (locFilter !== 'ALL') slots = slots.filter(s => (s.location || 'Iputinga') === locFilter);
    if (roomFilter !== 'ALL') slots = slots.filter(s => String(s.room) === String(roomFilter));

    slots.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'LIVRE' ? -1 : 1;
        return a.time.localeCompare(b.time);
    });

    if (slots.length === 0) {
        container.innerHTML = `
        <div style="text-align:center; color:#64748b; padding:40px; display:flex; flex-direction:column; align-items:center; gap:16px">
            <div style="background:#f1f5f9; padding:16px; border-radius:50%">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            </div>
            <div>Sem agendas para esta data.</div>
            <button class="btn btn-ghost" style="font-size:0.8rem" onclick="switchView('admin'); document.getElementById('bulk-date').value = '${selectedDateKey}'">Criar Agenda</button>
        </div>`;
        return;
    }

    const dateObj = new Date(key + 'T00:00:00');
    const dayName = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
    const header = document.createElement('div');
    header.className = 'date-header';
    header.innerText = dayName;
    container.appendChild(header);

    slots.forEach(slot => {
        const item = document.createElement('div');
        item.className = 'slot-item';
        if (currentSlotId === slot.id) item.classList.add('active');

        let statusClass = slot.status === 'LIVRE' ? 'free' : 'booked';
        let statusText = slot.status === 'LIVRE' ? 'Disponível' : 'Ocupado';
        let doctorName = slot.doctor ? `<b>${slot.doctor.split(' ')[0]} ${slot.doctor.split(' ')[1] || ''}</b>` : 'Sem Médico';

        let mainInfo = `
        <div style="flex:1">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%">
                <div class="slot-time">${slot.time}</div>
                 <div class="slot-room-badge">Sala ${slot.room}</div>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">${slot.location || 'Iputinga'}</div>
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

        item.onclick = () => handleSlotClick(slot, key);
        container.appendChild(item);
    });
}

// --- ADMIN / GERAÇÃO EM LOTE ---

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
        return showMessageModal('Atenção', 'Preencha todos os campos corretamente.', 'warning');
    }
    
    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    const startMins = h1 * 60 + m1;
    const endMins = h2 * 60 + m2;

    if (endMins <= startMins) return showMessageModal('Erro', 'Horário final deve ser maior que o inicial.', 'error');

    const slotDuration = (endMins - startMins) / qty;
    let slotsToSend = [];

    for (let i = 0; i < qty; i++) {
        const currentSlotMins = startMins + (i * slotDuration);
        const h = Math.floor(currentSlotMins / 60);
        const m = Math.floor(currentSlotMins % 60);
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

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

    showMessageModal('Processando', 'Criando vagas na nuvem...', 'warning');

    const payload = {
        action: "create_bulk",
        data: slotsToSend
    };

    sendUpdateToSheet(payload).then(success => {
        closeMessageModal();
        if (success) {
            selectedDateKey = dateVal;
            document.getElementById('sidebar-date-picker').value = selectedDateKey;
            showMessageModal('Sucesso', `${qty} vagas criadas com sucesso!`);
            fetchRemoteData(selectedDateKey);
            executeSwitch('booking');
        }
    });
}

function renderAdminTable() {
    const tbody = document.getElementById('admin-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const slots = appointments[selectedDateKey] || [];
    slots.sort((a, b) => a.time.localeCompare(b.time));
    
    slots.forEach(slot => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${selectedDateKey.split('-')[2]}/${selectedDateKey.split('-')[1]}</td>
            <td>${slot.time}</td>
            <td>${slot.room}</td>
            <td>
                <div style="font-weight:600; font-size:0.85rem">${slot.doctor}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">${slot.specialty}</div>
            </td>
            <td style="font-size:0.8rem">${slot.status}</td>
            <td>
                <button class="btn btn-danger" style="padding:4px 8px; font-size:0.75rem" onclick="deleteSlot('${slot.id}')">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteSlot(id) {
    showMessageModal('Excluir Vaga', 'ATENÇÃO: Isso excluirá a vaga permanentemente da planilha.<br>Deseja continuar?', 'confirm', async () => {
        closeMessageModal(); 
        showMessageModal('Processando', 'Excluindo vaga...', 'warning');

        const payload = {
            action: "delete",
            id: id
        };

        const success = await sendUpdateToSheet(payload);

        if (success) {
            closeMessageModal();
            showMessageModal('Sucesso', 'Vaga excluída com sucesso.');
            fetchRemoteData(selectedDateKey);
        } else {
            closeMessageModal();
        }
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
    
    document.getElementById('modal-slot-info').innerText = `${key.split('-')[2]} Fev • ${slot.time} • ${slot.doctor}`;
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

function closeModal() {
    document.getElementById('booking-modal').classList.remove('open');
}

function checkWarning() {
    const contract = document.getElementById('bk-contract').value;
    const warningBox = document.getElementById('warning-box');
    
    if (!contract) { 
        warningBox.style.display = 'none'; 
        return; 
    }

    let totalSlots = 0, group60Count = 0, group40Count = 0;
    const dayArr = appointments[selectedDateKey] || [];
    totalSlots = dayArr.length;

    dayArr.forEach(s => {
        if (s.status === 'OCUPADO' && s.contract) {
            if (CONTRACTS["60"].includes(s.contract)) group60Count++;
            if (CONTRACTS["40"].includes(s.contract)) group40Count++;
        }
    });

    if (CONTRACTS["60"].includes(contract)) group60Count++;
    if (CONTRACTS["40"].includes(contract)) group40Count++;

    const pct60 = totalSlots > 0 ? group60Count / totalSlots : 0;
    const pct40 = totalSlots > 0 ? group40Count / totalSlots : 0;

    let showWarning = false;
    if (CONTRACTS["60"].includes(contract) && pct60 > 0.60) showWarning = true;
    if (CONTRACTS["40"].includes(contract) && pct40 > 0.40) showWarning = true;

    warningBox.style.display = showWarning ? 'flex' : 'none';
}

function confirmBookingFromModal() {
    const id = document.getElementById('selected-slot-id').value;
    const record = document.getElementById('bk-record').value;
    const patient = document.getElementById('bk-patient').value;
    const contract = document.getElementById('bk-contract').value;
    const procedure = document.getElementById('bk-procedure').value;
    const detail = document.getElementById('bk-detail').value;
    const eye = document.getElementById('bk-eye').value;

    if (!patient || !contract || !record || !detail || !eye) {
        return showMessageModal('Atenção', 'Preencha todos os campos obrigatórios.', 'warning');
    }

    const slotToUpdate = appointments[currentDateKey].find(s => String(s.id) === String(id));
    if (!slotToUpdate) return showMessageModal('Erro', 'Vaga não encontrada.', 'error');

    const summary = `
        <div style="text-align:left; background:#f8fafc; padding:16px; border-radius:8px; font-size:0.9rem; border:1px solid #e2e8f0">
            <div style="margin-bottom:8px"><b>Paciente:</b> ${patient}</div>
            <div style="margin-bottom:8px"><b>Contrato:</b> ${contract}</div>
            <div style="margin-bottom:8px"><b>Local:</b> ${slotToUpdate.location || 'Iputinga'}</div>
        </div>
        <div style="margin-top:16px; font-weight:600">Confirmar este agendamento?</div>
    `;

    showMessageModal('Confirmação', summary, 'confirm', () => {
        requestToken(async () => {
            const payload = {
                action: "update",
                id: id,
                status: 'OCUPADO',
                patient: patient,
                record: record,
                contract: contract,
                procedure: procedure,
                detail: detail,
                eye: eye,
                createdBy: currentUserToken // Envia Token (Back traduz para Nome)
            };

            closeMessageModal(); 
            showMessageModal('Salvando', 'Sincronizando com a nuvem...', 'warning');

            const success = await sendUpdateToSheet(payload);
            
            if (success) {
                closeMessageModal(); 
                closeModal(); 
                showSuccessAnimation(() => {
                    fetchRemoteData(selectedDateKey);
                });
            } else {
                closeMessageModal();
            }
        });
    });
}

function cancelSlotBooking() {
    showMessageModal('Liberar Vaga', 'Deseja realmente liberar este agendamento? Os dados do paciente serão removidos.', 'confirm', () => {
        requestToken(async () => {
            const id = document.getElementById('selected-slot-id').value;
            const payload = {
                action: "update",
                id: id,
                status: 'LIVRE',
                patient: '',
                record: '',
                contract: '',
                procedure: '', 
                detail: '',
                eye: '',
                createdBy: currentUserToken
            };

            closeMessageModal();
            showMessageModal('Salvando', 'Liberando vaga na nuvem...', 'warning');

            const success = await sendUpdateToSheet(payload);
            
            if (success) {
                closeMessageModal();
                closeModal();
                fetchRemoteData(selectedDateKey);
            } else {
                closeMessageModal();
            }
        }, "Autorizar Cancelamento");
    });
}

// --- UTILITÁRIOS E KPIS ---

let messageCallback = null;

function showMessageModal(title, message, type = 'success', onConfirm = null) {
    const modal = document.getElementById('message-modal');
    const iconEl = document.getElementById('msg-icon');
    const titleEl = document.getElementById('msg-title');
    const bodyEl = document.getElementById('msg-body');
    const btnCancel = document.getElementById('msg-btn-cancel');
    const btnConfirm = document.getElementById('msg-btn-confirm');
    const btns = document.getElementById('msg-actions');

    titleEl.innerText = title;
    bodyEl.innerHTML = message;
    messageCallback = onConfirm;
    
    btns.style.display = 'flex';
    iconEl.style.background = 'none';
    
    if (type === 'confirm') {
        btnCancel.style.display = 'block';
        btnConfirm.innerText = 'Confirmar';
        btnConfirm.onclick = () => { if (messageCallback) messageCallback(); };
    } else {
        btnCancel.style.display = 'none';
        btnConfirm.innerText = 'OK';
        btnConfirm.onclick = () => closeMessageModal();
    }

    const icons = {
        'success': { color: '#16a34a', bg: '#dcfce7', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` },
        'warning': { color: '#d97706', bg: '#fef3c7', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>` },
        'error': { color: '#dc2626', bg: '#fee2e2', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>` },
        'confirm': { color: '#0284c7', bg: '#e0f2fe', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>` }
    };
    
    const style = icons[type] || icons['success'];
    iconEl.style.color = style.color; 
    iconEl.style.background = style.bg; 
    iconEl.innerHTML = style.svg;

    modal.classList.add('open');
}

function closeMessageModal() {
    document.getElementById('message-modal').classList.remove('open');
    messageCallback = null;
}

function showSuccessAnimation(callback) {
    const modal = document.getElementById('message-modal');
    const iconEl = document.getElementById('msg-icon');
    const titleEl = document.getElementById('msg-title');
    const bodyEl = document.getElementById('msg-body');
    const btns = document.getElementById('msg-actions');

    iconEl.style.background = 'transparent';
    iconEl.innerHTML = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" style="animation: bounceIn 0.8s ease forwards;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    
    titleEl.innerText = 'Sucesso!';
    bodyEl.innerText = 'Dados sincronizados.';
    btns.style.display = 'none';

    if (!modal.classList.contains('open')) modal.classList.add('open');

    setTimeout(() => {
        closeMessageModal();
        btns.style.display = 'flex'; 
        if (callback) callback();
    }, 2000);
}

function updateKPIs() {
    let totalSlots = 0;
    let occupiedSlots = 0;
    
    let counts = {
        "ESTADO": 0, "SERRA": 0, "SALGUEIRO": 0,
        "JABOATÃO": 0, "GERAL": 0, "RECIFE": 0
    };

    const dayArr = appointments[selectedDateKey] || [];
    
    totalSlots += dayArr.length;
    dayArr.forEach(s => {
        if (s.status === 'OCUPADO') {
            occupiedSlots++;
            if (s.contract && counts[s.contract] !== undefined) {
                counts[s.contract]++;
            }
        }
    });

    const calcPct = (val) => totalSlots > 0 ? ((val / totalSlots) * 100).toFixed(1) : "0.0";
    const totalOccupiedPct = totalSlots > 0 ? ((occupiedSlots / totalSlots) * 100).toFixed(1) : "0.0";
    const totalIdlePct = totalSlots > 0 ? (100 - parseFloat(totalOccupiedPct)).toFixed(1) + "%" : "--";

    document.getElementById('glb-total').innerText = totalSlots;
    document.getElementById('glb-occupied').innerText = totalOccupiedPct + '%';
    document.getElementById('glb-idle').innerText = totalIdlePct;

    const totalMun = counts["RECIFE"] + counts["JABOATÃO"];
    const calcMunPct = (val) => totalMun > 0 ? ((val / totalMun) * 100).toFixed(1) : "0.0";

    document.getElementById('stat-estado').innerText = calcPct(counts["ESTADO"]) + '%';
    document.getElementById('stat-serra').innerText = calcPct(counts["SERRA"]) + '%';
    document.getElementById('stat-salgueiro').innerText = calcPct(counts["SALGUEIRO"]) + '%';
    
    document.getElementById('stat-recife').innerText = calcMunPct(counts["RECIFE"]) + '%';
    document.getElementById('stat-jaboatao').innerText = calcMunPct(counts["JABOATÃO"]) + '%';
    
    document.getElementById('stat-geral').innerText = calcPct(counts["GERAL"]) + '%';

    const sum60 = counts["ESTADO"] + counts["SERRA"] + counts["SALGUEIRO"];
    const pct60 = totalSlots > 0 ? (sum60 / totalSlots) * 100 : 0;
    const pct40 = totalSlots > 0 ? (counts["GERAL"] / totalSlots) * 100 : 0;

    document.getElementById('kpi-60-val').innerText = pct60.toFixed(1) + '%';
    document.getElementById('prog-60').style.width = pct60 + '%';
    
    document.getElementById('kpi-40-val').innerText = pct40.toFixed(1) + '%';
    document.getElementById('prog-40').style.width = pct40 + '%';
    
    document.getElementById('kpi-mun-val').innerText = totalMun;

    document.getElementById('kpi-60-val').style.color = pct60 > 60 ? '#be123c' : 'var(--text-main)';
    document.getElementById('kpi-40-val').style.color = pct40 > 40 ? '#be123c' : 'var(--text-main)';
}

function exportDailyReport() {
    const key = selectedDateKey;
    const slots = appointments[key] || [];
    
    if (slots.length === 0) return showMessageModal('Aviso', 'Nenhum agendamento para exportar nesta data.', 'warning');

    const headers = [
        "Data", "Hora", "Unidade", "Sala", "Status",
        "Paciente", "Prontuario", "Contrato",
        "Medico", "Especialidade", "Procedimento", "Olho", "Detalhe"
    ];

    const rows = slots.map(s => {
        return [
            `${key.split('-')[2]}/${key.split('-')[1]}/${key.split('-')[0]}`,
            s.time,
            s.location || 'Iputinga',
            s.room,
            s.status,
            s.patient || '',
            s.record || '',
            s.contract || '',
            s.doctor,
            s.specialty,
            s.procedure || '',
            s.eye || '',
            s.detail || ''
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(';');
    });

    const csvContent = "\uFEFF" + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Relatorio_${key}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.onclick = function(event) {
    const loginModal = document.getElementById('login-modal');
    const bookingModal = document.getElementById('booking-modal');
    const msgModal = document.getElementById('message-modal');

    if (event.target === loginModal) closeLoginModal();
    if (event.target === bookingModal) closeModal();
    if (event.target === msgModal) closeMessageModal();
}

// Inicia
initData();