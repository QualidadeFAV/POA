// --- CONFIGURAÇÃO DA API (GOOGLE SHEETS) ---
// IMPORTANTE: Verifique se esta URL é a da sua implantação mais recente
const API_URL = "https://script.google.com/macros/s/AKfycbw5FgjU_NeBebC82cyMXb8-sYiyql5P9iw5ujdbQTnu7w0hMNCqTFwxPocIPh2bQVg/exec";

// --- DADOS GLOBAIS ---
let appointments = {};
let validTokensMap = {};

// --- CACHE DE PERFORMANCE ---
const DASH_CACHE = {};
// Estrutura: { "2026-02": { total: 100, occupied: 50, loaded: true, counts: {...} } }

// CONFIGURAÇÃO DA DATA INICIAL (HOJE)
const todayDate = new Date();
const yInit = todayDate.getFullYear();
const mInit = String(todayDate.getMonth() + 1).padStart(2, '0');
const dInit = String(todayDate.getDate()).padStart(2, '0');
let selectedDateKey = `${yInit}-${mInit}-${dInit}`;

let currentView = 'booking';
let currentSlotId = null;
let currentDateKey = null;

// FLATPICKR INSTANCE
let fpInstance = null;

// --- ESTADO & CLIPBOARD (NOVO) ---
let clipboardPatient = null;
let isMoveMode = false;

// --- CONTROLE DE SESSÃO ---
let currentUserToken = null;
let currentUserRole = null;
let pendingAction = null;

// --- CONSTANTES DE CONTRATOS ---
const CONTRACTS = {
    LOCALS: ["ESTADO", "SERRA", "SALGUEIRO"],
    MUNICIPAL: ["RECIFE", "JABOATÃO"]
};

// --- CONFIGURAÇÃO DE PROCEDIMENTOS POR ESPECIALIDADE ---
const SPECIALTY_PROCEDURES = {
    "RETINA": [
        "Capsulectomia Posterior Cirúrgica",
        "Implante Secundário de Lentre Intra-Ocular-Lio",
        "Reposicionamento de Lente Intraocular"
    ],
    "CATARATA": [
        "Facetomia com Implante de Lente Intra-Ocular",
        "Facetomia sem Implante de Lente Intra-Ocular",
        "Facoemulsificação com Implante de Lente Intra-ocular Rigida",
        "Facoemulsificação com Implante de Lente Intra-ocular Dobrável",
        "Capsulectomia Posterior Cirúrgica",
        "Implante Secundário de Lentre Intra-Ocular-Lio",
        "Reposicionamento de Lente Intraocular",
        "Vitrectomia Anterior"
    ],
    "GLAUCOMA": [
        "Trabeculectomia",
        "Implante Secundário de Lentre Intra-Ocular-Lio",
        "Reposicionamento de Lente Intraocular",
        "Vitrectomia Anterior"
    ],
    "CORNEA": [
        "Implante Intra-Estromal",
        "Implante Secundário de Lentre Intra-Ocular-Lio",
        "Reposicionamento de Lente Intraocular",
        "Recobrimento Conjuntival"
    ],
    "PLASTICA": [
        "Correção Cirúrgica de Entropio e Ectropio",
        "Correção Cirúrgica de Epicanto e Telecanto",
        "Correção Cirúrgica de Lagoftalmo",
        "Dacriocistorrinostomia",
        "Exérese de Calazio e outras Pequenas Lesões",
        "Reconstituição de Canal Lacrimal",
        "Reconstituição de Fornix Conjuntival",
        "Tratamento de Ptose Palpebral"
    ],
    "ESTRABISMO": [
        "Correção Cirúrgica de Estrabismo (Acima de 02 Musculos)",
        "Correção Cirúrgica de Estrabismo (Até de 02 Musculos)"
    ],
    "LASER": [
        "Setorial",
        "Periferia",
        "Periferia 360",
        "Complemento de Panfoto",
        "Laser Focal",
        "Panfoto",
        "Capsulotomia",
        "Trabeculoplastia"
    ],
    "GERAL": [
        "Recobrimento Conjuntival"
    ]
};

// --- INDICADOR DE CARREGAMENTO (CURSOR) ---
function setLoading(isLoading, isBlocking = false) {
    const body = document.body;
    if (isLoading && isBlocking) {
        body.style.cursor = 'wait';
    } else {
        body.style.cursor = 'default';
    }
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

// --- FUNÇÃO DE ANIMAÇÃO (NUMBERS GO UP) ---
function animateMetric(elementId, targetValue, isPercentage = false) {
    const element = document.getElementById(elementId);
    if (!element) return;

    let startValue = 0;
    const currentText = element.innerText;

    if (currentText !== '--' && currentText !== '--%') {
        startValue = parseFloat(currentText.replace('%', '').replace('(', '').replace(')', ''));
        if (isNaN(startValue)) startValue = 0;
    }

    if (Math.abs(startValue - targetValue) < 0.1) {
        element.innerText = isPercentage ? targetValue.toFixed(1) + '%' : Math.floor(targetValue);
        return;
    }

    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4);

        const current = startValue + (targetValue - startValue) * ease;

        if (isPercentage) {
            element.innerText = current.toFixed(1) + '%';
        } else {
            element.innerText = Math.floor(current);
        }

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.innerText = isPercentage ? targetValue.toFixed(1) + '%' : Math.floor(targetValue);
        }
    }

    requestAnimationFrame(update);
}

// --- FUNÇÃO AUXILIAR PARA SUB-ESTATÍSTICAS ---
function animateSubMetric(elementId, val, groupTotal) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const pct = groupTotal > 0 ? (val / groupTotal) * 100 : 0;
    const finalText = `${pct.toFixed(1)}% (${val})`;

    element.innerText = finalText;
}

// --- NOVAS FUNÇÕES AUXILIARES DE PROCEDIMENTOS ---

// Helper para ler/escrever os procedimentos do slot (compatível com JSON novo e String antiga)
function getProceduresFromSlot(slot) {
    if (!slot.procedure) return [];

    try {
        const parsed = JSON.parse(slot.procedure);
        if (Array.isArray(parsed)) return parsed;
        return [{ name: slot.procedure, regulated: (slot.regulated === true || slot.regulated === "TRUE" || slot.regulated === "YES") }];
    } catch (e) {
        // Fallback: é uma string antiga
        return [{ name: slot.procedure, regulated: (slot.regulated === true || slot.regulated === "TRUE" || slot.regulated === "YES") }];
    }
}

// --- FUNÇÃO CENTRAL DE CONTROLE DE CONTRATO ---
function handleContractChange() {
    const contract = document.getElementById('bk-contract').value;
    const isMunicipal = CONTRACTS.MUNICIPAL.includes(contract);
    const checkBoxes = document.querySelectorAll('.proc-reg-check');

    checkBoxes.forEach(cb => {
        const label = cb.parentElement;

        if (isMunicipal) {
            // REGRA: Se municipal, desmarca e desabilita (cinza)
            cb.checked = false;
            cb.disabled = true;
            label.style.opacity = '0.5';
            label.style.cursor = 'not-allowed';
            label.title = "Não aplicável para contratos municipais";
        } else {
            // Se não for municipal, habilita
            cb.disabled = false;
            label.style.opacity = '1';
            label.style.cursor = 'pointer';
            label.title = "Marcar se é Regulado";
        }
    });

    checkWarning(); // Recalcula KPIs
}

// Adiciona uma linha visual no modal
function addProcedureRow(name = '', isRegulated = true) {
    const container = document.getElementById('procedures-container');
    const id = Date.now() + Math.random().toString(16).slice(2);

    // Verifica estado atual do contrato para criar o checkbox já correto
    const contract = document.getElementById('bk-contract').value;
    const isMunicipal = CONTRACTS.MUNICIPAL.includes(contract);

    // Verifica Especialidade da Vaga
    const rawSpecialty = document.getElementById('bk-specialty').value || "";
    // Normaliza para chave (upper e sem acentos básicos se necessário, aqui assumindo match direto ou upper)
    // Mapeamento simples de segurança para acentos
    const mapAccents = { 'Ç': 'C', 'Ã': 'A', 'Õ': 'O', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Â': 'A', 'Ê': 'E' };
    let normalizedSpec = rawSpecialty.toUpperCase().replace(/[ÇÃÕÁÉÍÓÚÂÊ]/g, c => mapAccents[c] || c);

    // Fallback: Se for "LASERS" (plural), converte para "LASER"
    if (normalizedSpec === 'LASERS') normalizedSpec = 'LASER';

    const allowedProcs = SPECIALTY_PROCEDURES[normalizedSpec];

    let checkState = isRegulated ? 'checked' : '';
    let disabledAttr = '';
    let opacityStyle = '1';
    let cursorStyle = 'pointer';

    if (isMunicipal) {
        checkState = ''; // Força desmarcado
        disabledAttr = 'disabled';
        opacityStyle = '0.5';
        cursorStyle = 'not-allowed';
    }

    const row = document.createElement('div');
    row.className = 'procedure-row';
    row.id = `proc-row-${id}`;
    row.style.cssText = "display:flex; gap:8px; align-items:center;";

    let inputHtml = '';

    if (allowedProcs && allowedProcs.length > 0) {
        // Renderiza SELECT
        let options = `<option value="">Selecione o procedimento...</option>`;
        allowedProcs.forEach(proc => {
            const selected = proc === name ? 'selected' : '';
            options += `<option value="${proc}" ${selected}>${proc}</option>`;
        });

        inputHtml = `
            <select class="form-select proc-name-input" style="flex:1;">
                ${options}
            </select>
        `;
    } else {
        // Renderiza INPUT TEXT (Fallback)
        inputHtml = `<input type="text" class="form-input proc-name-input" placeholder="Ex: Faco, Lio..." value="${name}" style="flex:1;">`;
    }

    row.innerHTML = `
        ${inputHtml}
        
        <label style="display:flex; align-items:center; gap:4px; font-size:0.8rem; cursor:${cursorStyle}; background:white; padding:8px; border:1px solid #cbd5e1; border-radius:8px; opacity:${opacityStyle}" title="Marcar se é Regulado">
            <input type="checkbox" class="proc-reg-check" ${checkState} ${disabledAttr} onchange="checkWarning()">
            Regulado
        </label>

        <button type="button" class="btn btn-danger" onclick="removeProcedureRow('${id}')" style="padding:8px; border-radius:8px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
    container.appendChild(row);
    if (name === '') checkWarning();
}

function removeProcedureRow(id) {
    const row = document.getElementById(`proc-row-${id}`);
    if (row) row.remove();
    checkWarning();
}

// --- LÓGICA DE PRÉ-PROCESSAMENTO DO CACHE ---
function recalculateMonthCache(monthKey) {
    if (!monthKey) return;

    let totalSlots = 0;
    let occupiedSlots = 0;

    let counts = {
        Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
    };

    Object.keys(appointments).forEach(dateKey => {
        if (dateKey.startsWith(monthKey)) {
            const daySlots = appointments[dateKey];
            totalSlots += daySlots.length;

            daySlots.forEach(s => {
                if (s.status === 'OCUPADO') {
                    occupiedSlots++;

                    const c = s.contract ? s.contract.toUpperCase() : null;
                    if (!c) return;

                    const procs = getProceduresFromSlot(s);

                    if (CONTRACTS.MUNICIPAL.includes(c)) {
                        const countToAdd = procs.length > 0 ? procs.length : 1;
                        counts.Municipal.Total += countToAdd;
                        if (counts.Municipal[c] !== undefined) counts.Municipal[c] += countToAdd;

                    } else if (CONTRACTS.LOCALS.includes(c)) {
                        if (procs.length > 0) {
                            procs.forEach(p => {
                                if (p.regulated) {
                                    counts.Regulado.Total++;
                                    if (counts.Regulado[c] !== undefined) counts.Regulado[c]++;
                                } else {
                                    counts.Interno.Total++;
                                    if (counts.Interno[c] !== undefined) counts.Interno[c]++;
                                }
                            });
                        } else {
                            // Fallback
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
                }
            });
        }
    });

    if (!DASH_CACHE[monthKey]) DASH_CACHE[monthKey] = {};

    DASH_CACHE[monthKey].total = totalSlots;
    DASH_CACHE[monthKey].occupied = occupiedSlots;
    DASH_CACHE[monthKey].counts = counts;

    // Atualiza marcadores visuais sempre que recalcular cache
    updateCalendarMarkers();
}

// --- COMUNICAÇÃO COM O BACKEND (GOOGLE SHEETS) ---

// 1. CARREGAR TOKENS VÁLIDOS
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

// 2. PROCESSAMENTO DE DADOS (RAW -> APP)
function processRawData(rows, forceDateKey = null) {
    if ((!rows || rows.length === 0) && forceDateKey) {
        if (!appointments[forceDateKey]) appointments[forceDateKey] = [];
        return;
    }

    rows.forEach(row => {
        const key = row.date;
        if (!key) return;

        if (!appointments[key]) appointments[key] = [];

        const exists = appointments[key].find(s => String(s.id) === String(row.id));

        if (!exists) {
            appointments[key].push({
                id: row.id,
                date: row.date,
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
            });
        } else {
            const idx = appointments[key].findIndex(s => String(s.id) === String(row.id));
            if (idx !== -1) {
                appointments[key][idx] = {
                    ...appointments[key][idx],
                    status: row.status,
                    patient: row.patient,
                    record: row.record,
                    contract: row.contract,
                    regulated: (row.regulated === true || row.regulated === "TRUE" || row.regulated === "YES"),
                    procedure: row.procedure,
                    detail: row.detail,
                    eye: row.eye,
                    createdBy: row.created_by
                };
            }
        }
    });

    if (forceDateKey) {
        recalculateMonthCache(forceDateKey.substring(0, 7));
    } else if (rows.length > 0) {
        recalculateMonthCache(rows[0].date.substring(0, 7));
    }
}

// 3. BUSCAR DADOS DE UM DIA ESPECÍFICO (FALLBACK)
async function fetchRemoteData(dateKey, isBackground = false) {
    if (API_URL.includes("SUA_URL")) { alert("Configure a API_URL!"); return; }
    if (!isBackground) setLoading(true);

    try {
        const response = await fetch(`${API_URL}?date=${dateKey}`, { redirect: "follow" });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        if (data.length === 0) appointments[dateKey] = [];

        processRawData(data, dateKey);

        if (dateKey === selectedDateKey) {
            renderSlotsList();
            if (currentView === 'admin') renderAdminTable();
        }
        updateKPIs();

    } catch (error) {
        console.error(`Erro fetch (${dateKey}):`, error);
        if (!isBackground) showToast('Erro de conexão.', 'error');
    } finally {
        if (!isBackground) setLoading(false);
    }
}

// 4. SINCRONIZAR MÊS INTEIRO
// 4. SINCRONIZAR MÊS INTEIRO
async function syncMonthData(baseDateKey) {
    if (!baseDateKey) return;

    const parts = baseDateKey.split('-');
    const monthKey = `${parts[0]}-${parts[1]}`;

    if (DASH_CACHE[monthKey] && DASH_CACHE[monthKey].loaded) {
        console.log("Mês já carregado (Cache).");
        return;
    }

    setLoading(true);
    console.log(`Buscando mês inteiro: ${monthKey}`);

    try {
        // SNAPSHOT ANTES DO UPDATE (Para evitar flash se dados forem iguais)
        const preUpdateHash = JSON.stringify(appointments[selectedDateKey] || []);

        const response = await fetch(`${API_URL}?month=${monthKey}`, { redirect: "follow" });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        // Limpeza estratégica: remove chaves do mês mas NÃO ACESSA DOM
        Object.keys(appointments).forEach(k => {
            if (k.startsWith(monthKey)) delete appointments[k];
        });

        processRawData(data); // Repopula global 'appointments'

        if (!DASH_CACHE[monthKey]) recalculateMonthCache(monthKey);
        DASH_CACHE[monthKey].loaded = true;

        if (selectedDateKey.startsWith(monthKey)) {
            // SNAPSHOT DEPOIS DO UPDATE
            const postUpdateHash = JSON.stringify(appointments[selectedDateKey] || []);

            // Só re-renderiza se houve alteração real nos dados do dia visualizado
            if (preUpdateHash !== postUpdateHash) {
                renderSlotsList();
            } else {
                console.log("Dados do dia idênticos. Skip render.");
            }

            // Admin Table e KPI sempre atualizam pois podem afetar outros dias/visões
            if (currentView === 'admin') renderAdminTable();
            updateKPIs();
        }

    } catch (e) {
        console.error("Erro syncMonth:", e);
        showToast("Erro ao sincronizar mês.", "error");
    } finally {
        setLoading(false);
    }
}

// 5. ENVIAR DADOS (POST)
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
        // SEMPRE PEDE TOKEN PARA ADMIN, MESMO SE JÁ TIVER TOKEN
        // Isso atende: "se eu for fazer outra coisa... é pra pedir de novo!"
        requestToken(() => executeSwitch('admin'), "Acesso Gestor");
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

    // INICIALIZA O FLATPICKR
    fpInstance = flatpickr("#sidebar-date-picker", {
        locale: "pt",
        dateFormat: "Y-m-d",
        defaultDate: selectedDateKey,
        disableMobile: "true", // Força o tema customizado mesmo em mobile
        onChange: function (selectedDates, dateStr, instance) {
            if (dateStr && dateStr !== selectedDateKey) {
                selectedDateKey = dateStr;
                updateSidebarDate();
            }
        },
        onMonthChange: function (selectedDates, dateStr, instance) {
            // Quando muda o mês no calendário, garante que temos dados daquele mês
            const year = instance.currentYear;
            const month = String(instance.currentMonth + 1).padStart(2, '0');
            syncMonthData(`${year}-${month}`);
        }
    });

    const dashPicker = document.getElementById('dashboard-month-picker');
    if (dashPicker) {
        dashPicker.value = selectedDateKey.substring(0, 7);
        dashPicker.addEventListener('change', (e) => {
            syncMonthData(e.target.value);
        });
    }

    // Await para garantir que o splash screen cubra o carregamento inicial
    await syncMonthData(selectedDateKey);

    // CLICK TRIGGER PARA O CALENDÁRIO
    const triggerBox = document.getElementById('date-trigger-box');
    if (triggerBox && fpInstance) {
        triggerBox.addEventListener('click', () => {
            fpInstance.open();
        });
    }

    const splash = document.getElementById('app-splash-screen');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => { splash.remove(); }, 500);
    }

    renderSlotsList();
    updateKPIs();
    updateCalendarMarkers(); // Atualiza bolinhas iniciais
}

// ATUALIZA MARCADORES DO CALENDÁRIO (BOLINHA VERDE)
function updateCalendarMarkers() {
    if (!fpInstance) return;

    // Identifica dias com vagas livres
    const freeDates = [];
    Object.keys(appointments).forEach(key => {
        const slots = appointments[key];
        const hasFree = slots.some(s => s.status === 'LIVRE');
        if (hasFree) freeDates.push(key);
    });

    // Remove a classe customizada de todos os dias (limpeza)
    const days = document.querySelectorAll('.flatpickr-day');
    days.forEach(day => day.classList.remove('has-free-slots'));

    // Adiciona a classe visual nos dias livres
    // Flatpickr não tem API direta fácil para "addClassToDate", mas podemos redesenhar ou usar config.
    // Uma forma eficiente é manipular via onDayCreate, mas para atualizar dinamicamente setamos o evento novamente.

    fpInstance.set('onDayCreate', function (dObj, dStr, fp, dayElem) {
        // Formata a data do elemento dia para YYYY-MM-DD
        const date = dayElem.dateObj;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;

        if (freeDates.includes(key)) {
            dayElem.classList.add('has-free-slots');
        }
    });

    // Força redraw para aplicar o onDayCreate se já estiver aberto, ou prepara para próxima abertura
    // (Flatpickr redesenha dias ao navegar, mas set('onDayCreate') não redesenha o mês atual automaticamente se nao mudar algo)
    // Redraw hack:
    fpInstance.redraw();
}

function updateSidebarDate() {
    // Atualiza input se mudou externamente (setas)
    if (fpInstance && fpInstance.input.value !== selectedDateKey) {
        fpInstance.setDate(selectedDateKey, false); // false = não disparar onChange
    }

    if (isMoveMode && clipboardPatient) {
        showToast("Modo de Realocação Ativo: Selecione o novo destino.", "warning");
    }

    document.getElementById('room-filter').value = 'ALL';
    document.getElementById('location-filter').value = 'ALL';

    const monthKey = selectedDateKey.substring(0, 7);

    if (DASH_CACHE[monthKey] && DASH_CACHE[monthKey].loaded) {
        renderSlotsList();
    } else {
        // Carregamento de navegação não precisa bloquear cursor totalmente, mas ok ser breve.
        // Se quiser bloquear: setLoading(true, true);
        // Se quiser suave: setLoading(true, false);
        setLoading(true, false);
        syncMonthData(selectedDateKey).then(() => {
            renderSlotsList();
            setLoading(false);
        });
    }
}

// ATUALIZAÇÃO MANUAL (SEM POLLLING)
async function refreshData() {
    // 1. Guarda estado dos filtros (já estão no DOM, mas garantindo)
    // 2. Chama sync forçado (invalidate cache se quiser, mas syncMonthData ja faz fetch remoto)

    const btn = document.getElementById('btn-manual-refresh');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'wait';
        // Opcional: Animar ícone
        const icon = btn.querySelector('svg');
        if (icon) icon.style.animation = 'spin 1s linear infinite';
    }

    try {
        // Invalida cache do mês atual para forçar novo fetch
        const monthKey = selectedDateKey.substring(0, 7);
        if (DASH_CACHE[monthKey]) DASH_CACHE[monthKey].loaded = false;

        setLoading(true, false);
        await syncMonthData(selectedDateKey); // Busca dados frescos

        // 3. Renderiza mantendo filtros
        renderSlotsList();
        updateKPIs();
        updateCalendarMarkers();

        showToast("Agenda atualizada.", "success");
    } catch (error) {
        console.error("Erro ao atualizar:", error);
        showToast("Falha na atualização.", "error");
    } finally {
        setLoading(false);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            const icon = btn.querySelector('svg');
            if (icon) icon.style.animation = 'none';
        }
    }
}

// --- VERIFICAÇÃO DE DISPONIBILIDADE (ANTI-COLISÃO) ---
async function verifySlotAvailability(slotId, isBackground = false) {
    // Para ser robusto com 15 users, o ideal seria um endpoint específico 'checkSlot'.
    // Como estamos usando Sheets/GET geral, o melhor é forçar um refresh silencioso da data/mês 
    // se quisermos certeza absoluta, OU confiar no 'syncMonthData' se ele foi chamado recentemente.
    // Pela regra de negócio "Segurança no Clique", vamos fazer um fetch pontual dos dados atuais
    // para garantir que 'appointments' esteja fresco.

    // Invalida cache propositalmente
    const monthKey = selectedDateKey.substring(0, 7);
    if (DASH_CACHE[monthKey]) DASH_CACHE[monthKey].loaded = false;

    // Se background, cursor wait mas NÃO blocking (se quiser) ou loading suave do botão
    setLoading(true, !isBackground);
    await syncMonthData(selectedDateKey);
    setLoading(false);

    // Busca novamente o slot na memória atualizada
    let foundSlot = null;
    if (appointments[selectedDateKey]) {
        foundSlot = appointments[selectedDateKey].find(s => String(s.id) === String(slotId));
    }

    if (!foundSlot) return null; // Slot sumiu (excluido?)
    return foundSlot;
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

// --- UI LISTA DE VAGAS ---

function handleSlotClick(slot, key) {
    currentSlotId = slot.id;
    currentDateKey = key;
    renderSlotsList();

    if (currentView === 'booking') {
        // Se estiver em modo Move, verifica compatibilidade básica
        if (slot.status === 'LIVRE') {
            handleVerifyAndOpen(slot);
        } else {
            // Se ocupado, abre modal de edição
            openBookingModal(slot, key);
        }
    }
}

async function handleVerifyAndOpen(slot) {
    // 1. OTIMISTA: Abre o modal IMEDIATAMENTE
    openBookingModal(slot, selectedDateKey);

    // 2. VERIFICAÇÃO EM BACKGROUND
    const modalTitle = document.getElementById('msg-title');
    const originalTitle = modalTitle ? modalTitle.innerText : 'Agendar';
    if (modalTitle) modalTitle.innerText = 'Agendar (Verificando...)';

    const FRESH_SLOT = await verifySlotAvailability(slot.id, true); // Background = true

    if (modalTitle) modalTitle.innerText = originalTitle;

    // 3. SE CONFIRMAR CONFLITO, FECHA E AVISA
    if (!FRESH_SLOT) {
        closeModal();
        showToast("Vaga não encontrada ou excluída.", "error");
        renderSlotsList(); // Refresh
        return;
    }

    if (FRESH_SLOT.status !== 'LIVRE') {
        closeModal();
        showMessageModal("Vaga Ocupada", "Esta vaga acabou de ser ocupada por outro usuário.", "alert");
        renderSlotsList(); // Já atualizou via verifySlotAvailability
        return;
    }

    // Se ainda está aberto, atualiza dados (caso algo sutil tenha mudado) e segue a vida
}

function updateFilterOptions() {
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

    const currentDateSlots = appointments[selectedDateKey] || [];

    // FILTRAGEM SEGURA (Estado Mantido)
    const locFilter = document.getElementById('location-filter').value;
    const roomFilter = document.getElementById('room-filter').value;
    const shiftFilter = document.getElementById('shift-filter').value;

    let slots = currentDateSlots.filter(s => {
        // Excluir tecnicamente os 'EXCLUIDO' se vierem do backend
        if (String(s.status).toUpperCase() === 'EXCLUIDO') return false;

        let pass = true;
        if (locFilter !== 'ALL' && s.location !== locFilter) pass = false;
        if (roomFilter !== 'ALL' && String(s.room) !== String(roomFilter)) pass = false;

        // Filtro de turno simples baseado na hora
        if (shiftFilter !== 'ALL') {
            const h = parseInt(s.time.split(':')[0]);
            if (shiftFilter === 'MANHA' && h >= 13) pass = false;
            if (shiftFilter === 'TARDE' && h < 13) pass = false;
        }
        return pass;
    });

    slots.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.status !== b.status) return a.status === 'LIVRE' ? -1 : 1;
        return a.time.localeCompare(b.time);
    });

    if (slots.length === 0) {
        container.innerHTML = `
        <div style="padding:40px; text-align:center; color:#94a3b8;">
            <div style="font-size:3rem; margin-bottom:16px; opacity:0.3">📭</div>
            <div>Nenhuma vaga encontrada para os filtros.</div>
        </div>`;
        return;
    }

    slots.forEach((slot, index) => {
        const item = document.createElement('div');
        item.className = 'slot-item';
        if (currentSlotId === slot.id) item.classList.add('active');

        // STAGGERED ANIMATION DELAY
        // Efeito cascata: 0.05s por item
        item.style.animationDelay = `${index * 0.05}s`;

        let statusClass = slot.status === 'LIVRE' ? 'free' : 'booked';
        let statusText = slot.status === 'LIVRE' ? 'Disponível' : 'Ocupado';
        let doctorName = slot.doctor ? `<b>${slot.doctor.split(' ')[0]} ${slot.doctor.split(' ')[1] || ''}</b>` : 'Sem Médico';

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
        `;

        if (slot.status === 'OCUPADO') {
            const procs = getProceduresFromSlot(slot);
            let procDisplay = '-';
            if (procs.length === 1) {
                procDisplay = procs[0].name;
            } else if (procs.length > 1) {
                procDisplay = `${procs.length} Procedimentos`;
            } else {
                procDisplay = slot.specialty || '-';
            }

            mainInfo += `
            <div style="font-size:0.75rem; color:#0284c7; margin-top:2px; font-weight:600">${procDisplay}</div>
            <div class="slot-detail-box">
                <div class="detail-patient">${slot.patient}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">Pront: ${slot.record || '?'}</div>
                <div class="detail-meta"><span class="badge-kpi">${slot.contract}</span></div>
            </div>
            <div style="font-size:0.65rem; color:#94a3b8; text-align:right; margin-top:4px; font-style:italic">
                ${slot.createdBy ? 'Agendado por: ' + slot.createdBy : ''}
            </div>
            `;
        } else {
            mainInfo += `<div style="font-size:0.75rem; color:var(--text-light); margin-top:2px;">${slot.specialty || '-'}</div>`;
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
            specialty: group, // Aqui definimos a ESPECIALIDADE (categoria)
            procedure: group, // Inicialmente procedure = group (compatibilidade)
            createdBy: currentUserToken
        });
    }

    showMessageModal('Processando', `Criando ${qty} vagas...`, 'loading');

    const payload = { action: "create_bulk", data: slotsToSend };

    sendUpdateToSheet(payload).then(success => {
        closeMessageModal();
        if (success) {
            showToast(`${qty} vagas criadas!`, 'success');

            processRawData(slotsToSend.map(s => ({ ...s, status: 'LIVRE', created_by: currentUserToken })));

            selectedDateKey = dateVal;
            document.getElementById('sidebar-date-picker').value = selectedDateKey;
            renderSlotsList();
            updateKPIs();
            executeSwitch('booking');
        }
    });
}

// --- ADMIN TABLE ---

function renderAdminTable() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    const currentlyChecked = Array.from(document.querySelectorAll('.slot-checkbox:checked'))
        .map(cb => String(cb.value));

    tbody.innerHTML = '';

    const targetMonth = selectedDateKey.substring(0, 7);
    const slots = [];

    Object.keys(appointments).forEach(k => {
        if (k.startsWith(targetMonth)) slots.push(...appointments[k]);
    });

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
        const isChecked = currentlyChecked.includes(String(slot.id)) ? 'checked' : '';

        let specDisplay = slot.specialty;
        const procs = getProceduresFromSlot(slot);
        if (procs.length > 1) specDisplay = `${procs.length} Procs`;
        else if (procs.length === 1) specDisplay = procs[0].name;

        tr.innerHTML = `
            <td style="text-align:center">
                <input type="checkbox" class="slot-checkbox" value="${slot.id}" ${isChecked} onchange="updateDeleteButton()">
            </td>
            <td>${dateFmt}</td>
            <td>${slot.time}</td>
            <td>${slot.room}</td>
            <td>
                <div style="font-weight:600; font-size:0.85rem">${slot.doctor}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">${specDisplay}</div>
            </td>
            <td>${statusHtml}</td>
            <td style="text-align:center">
                <button class="btn btn-danger btn-delete-single" style="padding:4px 8px; font-size:0.75rem" onclick="deleteSlot('${slot.id}')">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDeleteButton();

    const masterCheck = document.getElementById('check-all-slots');
    if (masterCheck) {
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

async function processBatchDelete(ids) {
    showMessageModal('Processando', `Iniciando exclusão...`, 'loading');
    const msgBody = document.getElementById('msg-body');

    let successCount = 0;
    const total = ids.length;

    for (let i = 0; i < total; i++) {
        const id = ids[i];
        if (msgBody) msgBody.innerText = `Excluindo ${i + 1} de ${total}...`;
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

                Object.keys(appointments).forEach(key => {
                    appointments[key] = appointments[key].filter(s => String(s.id) !== String(id));
                });
            }
        } catch (e) { console.error("Erro delete:", e); }
    }

    recalculateMonthCache(selectedDateKey.substring(0, 7));

    closeMessageModal();
    renderSlotsList();
    renderAdminTable();
    updateKPIs();

    showToast(`${successCount} vagas excluídas.`, 'success');
}

function deleteSlot(id) {
    const monthKey = selectedDateKey.substring(0, 7);
    let slot = null;

    Object.keys(appointments).forEach(k => {
        if (!slot && k.startsWith(monthKey)) slot = appointments[k].find(s => String(s.id) === String(id));
    });

    let msg = 'Excluir vaga permanentemente?';
    if (slot && slot.status === 'OCUPADO') {
        msg = `<b>ATENÇÃO:</b> Vaga com paciente <b>${slot.patient}</b>. Excluir removerá ambos.`;
    }

    showMessageModal('Excluir', msg, 'confirm', async () => {
        closeMessageModal();
        setLoading(true, true); // Bloqueante pois é uma ação destrutiva

        const success = await sendUpdateToSheet({ action: "delete", id: id });
        if (success) {
            Object.keys(appointments).forEach(key => {
                appointments[key] = appointments[key].filter(s => String(s.id) !== String(id));
            });

            recalculateMonthCache(selectedDateKey.substring(0, 7));
            renderSlotsList();
            renderAdminTable();
            updateKPIs();

            showToast('Vaga excluída.', 'success');
        }

        // STRICT TOKEN
        currentUserToken = null;
        currentUserRole = null;

        setLoading(false);
    });
}

// --- MODAL DE AGENDAMENTO E EDIÇÃO ---
function openBookingModal(slot, dateKey) {
    document.getElementById('booking-modal').classList.add('open');
    document.getElementById('msg-title').innerText = 'Agendar';

    // Preenche info do cabeçalho
    document.getElementById('modal-slot-info').innerHTML = `
        DATA: <b>${dateKey.split('-').reverse().join('/')}</b> • 
        HORA: <b>${slot.time}</b> • 
        SALA: <b>${slot.room}</b>
    `;

    document.getElementById('selected-slot-id').value = slot.id;
    document.getElementById('bk-specialty').value = slot.specialty || '';

    const container = document.getElementById('procedures-container');
    container.innerHTML = '';

    const btnArea = document.getElementById('action-buttons-area');
    btnArea.innerHTML = ''; // Limpa botões

    // --- MODO: VAGA OCUPADA (EDIÇÃO/REALOCAÇÃO) ---
    if (slot.status === 'OCUPADO') {
        document.getElementById('bk-patient').value = slot.patient || '';
        document.getElementById('bk-record').value = slot.record || '';
        document.getElementById('bk-contract').value = slot.contract || '';
        document.getElementById('bk-detail').value = slot.detail || '';
        document.getElementById('bk-eye').value = slot.eye || '';

        // Parse procedimentos salvos
        try {
            if (slot.procedure) {
                const plist = JSON.parse(slot.procedure);
                if (Array.isArray(plist)) {
                    plist.forEach(p => addProcedureRow(p.name, p.regulated));
                }
            }
        } catch (e) {
            // Se falhar parse (formato antigo?), tenta adicionar como string única
            if (slot.procedure) addProcedureRow(slot.procedure, slot.regulated);
        }

        // Botão de Realocação
        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn btn-ghost';
        moveBtn.style.color = '#d97706'; // Amber
        moveBtn.style.border = '1px solid #fcd34d';
        moveBtn.innerHTML = `
            <svg width="16" height="16" viewsBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
            Realocar
        `;
        moveBtn.onclick = () => initMovePatient(slot);
        btnArea.appendChild(moveBtn);

        // Botão de Cancelar/Liberar
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-danger';
        cancelBtn.innerText = 'Liberar Vaga';
        cancelBtn.onclick = cancelSlotBooking;
        btnArea.appendChild(cancelBtn);

        // Botão Salvar Edição
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.innerText = 'Salvar Alterações';
        saveBtn.onclick = confirmBookingFromModal;
        btnArea.appendChild(saveBtn);

        // --- MODO: VAGA LIVRE (DESTINO DE REALOCAÇÃO OU NOVO) ---
    } else {
        // Se estamos em modo de realocação, preenche com dados do clipboard
        if (isMoveMode && clipboardPatient) {
            document.getElementById('bk-patient').value = clipboardPatient.patient;
            document.getElementById('bk-record').value = clipboardPatient.record;
            document.getElementById('bk-contract').value = clipboardPatient.contract;
            document.getElementById('bk-detail').value = clipboardPatient.detail;
            document.getElementById('bk-eye').value = clipboardPatient.eye;

            if (clipboardPatient.procedures && Array.isArray(clipboardPatient.procedures)) {
                clipboardPatient.procedures.forEach(p => addProcedureRow(p.name, p.regulated));
            } else {
                addProcedureRow(); // Default
            }

            const confirmMoveBtn = document.createElement('button');
            confirmMoveBtn.className = 'btn btn-primary';
            confirmMoveBtn.style.background = '#d97706'; // Amber
            confirmMoveBtn.innerText = 'Confirmar Realocação';
            confirmMoveBtn.onclick = confirmBookingFromModal; // Reusa lógica com flag
            btnArea.appendChild(confirmMoveBtn);

            showToast("Dados do paciente importados. Confirme para finalizar.", "info");

        } else {
            // Limpa campos para novo agendamento
            document.getElementById('bk-patient').value = '';
            document.getElementById('bk-record').value = '';
            document.getElementById('bk-contract').value = '';
            document.getElementById('bk-detail').value = '';
            document.getElementById('bk-eye').value = '';
            addProcedureRow(); // Linha vazia inicial

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'btn btn-primary';
            confirmBtn.innerText = 'Confirmar';
            confirmBtn.onclick = confirmBookingFromModal;
            btnArea.appendChild(confirmBtn);
        }
    }
}

function initMovePatient(slot) {
    // 1. Copia dados
    let procData = [];
    try { procData = JSON.parse(slot.procedure); } catch (e) { }

    clipboardPatient = {
        originId: slot.id,
        patient: slot.patient,
        record: slot.record,
        contract: slot.contract,
        detail: slot.detail,
        eye: slot.eye,
        procedures: procData,
        regulated: slot.regulated
    };

    isMoveMode = true;
    closeModal();

    // Feedback visual persistente (Toast longo ou Modal informativo)
    showToast("📋 Paciente copiado! Selecione agora a NOVA vaga disponível.", "warning");

    // Opcional: Destacar UI indicando modo move (pode mudar cor do fundo ou algo assim)
    document.querySelector('.listing-column').style.borderLeft = "4px solid #d97706";
}

function closeModal() { document.getElementById('booking-modal').classList.remove('open'); }

function checkWarning() {
    const contract = document.getElementById('bk-contract').value;
    const warningBox = document.getElementById('warning-box');
    const msgText = document.getElementById('warning-msg-text');

    if (!contract || CONTRACTS.MUNICIPAL.includes(contract)) {
        warningBox.style.display = 'none';
        return;
    }

    let newReg = 0;
    let newInt = 0;
    document.querySelectorAll('.procedure-row').forEach(row => {
        const nameInput = row.querySelector('.proc-name-input');
        if (nameInput && nameInput.value.trim()) {
            const isReg = row.querySelector('.proc-reg-check').checked;
            if (isReg) newReg++; else newInt++;
        }
    });

    if (newReg === 0 && newInt === 0) newReg = 1;

    const monthKey = selectedDateKey.substring(0, 7);
    const stats = DASH_CACHE[monthKey];

    if (!stats || stats.total === 0) return;

    let currentTotalReg = stats.counts.Regulado.Total;
    let currentTotalInt = stats.counts.Interno.Total;

    let simTotalReg = currentTotalReg + newReg;
    let simTotalInt = currentTotalInt + newInt;
    let simTotal = simTotalReg + simTotalInt;

    if (simTotal === 0) simTotal = 1;

    const pctReg = (simTotalReg / simTotal) * 100;
    const pctInt = (simTotalInt / simTotal) * 100;

    let showWarning = false;
    let msg = "";

    if (newInt > 0 && pctInt > 40) {
        showWarning = true;
        msg = `Atenção: Procedimentos Internos atingirão <b>${pctInt.toFixed(1)}%</b> (Limite: 40%)`;
    } else if (newInt > 0 && pctReg < 60) {
        showWarning = true;
        msg = `Atenção: Regulados cairão para <b>${pctReg.toFixed(1)}%</b> (Meta: >60%)`;
    }

    if (showWarning) {
        warningBox.style.display = 'flex';
        if (msgText) msgText.innerHTML = msg;
        else {
            const div = document.createElement('div');
            div.id = 'warning-msg-text';
            div.innerHTML = msg;
            warningBox.appendChild(div);
        }
    } else {
        warningBox.style.display = 'none';
    }
}

function confirmBookingFromModal() {
    const id = document.getElementById('selected-slot-id').value;
    const record = document.getElementById('bk-record').value;
    const patient = document.getElementById('bk-patient').value;
    const contract = document.getElementById('bk-contract').value;
    const detail = document.getElementById('bk-detail').value;
    const eye = document.getElementById('bk-eye').value;

    const procRows = document.querySelectorAll('.procedure-row');
    const proceduresList = [];

    procRows.forEach(row => {
        const name = row.querySelector('.proc-name-input').value.trim();
        const isReg = row.querySelector('.proc-reg-check').checked;
        if (name) {
            proceduresList.push({ name: name, regulated: isReg });
        }
    });

    if (!patient || !contract || !record || !eye || proceduresList.length === 0) {
        return showToast('Preencha os campos obrigatórios e ao menos 1 procedimento.', 'error');
    }

    const procedureJSON = JSON.stringify(proceduresList);
    const mainRegulatedStatus = proceduresList.some(p => p.regulated);

    const summary = `
        <div style="text-align:left; background:#f8fafc; padding:16px; border-radius:8px; font-size:0.9rem; border:1px solid #e2e8f0">
            <div><b>Paciente:</b> ${patient}</div>
            <div><b>Contrato:</b> ${contract}</div>
            <div style="margin-top:8px; font-weight:600; border-top:1px dashed #ccc; padding-top:4px">Procedimentos (${proceduresList.length}):</div>
            <ul style="margin:0; padding-left:20px; font-size:0.85rem">
                ${proceduresList.map(p => `<li>${p.name} (${p.regulated ? 'Regulado' : 'Interno'})</li>`).join('')}
            </ul>
        </div>
        <div style="margin-top:16px; font-weight:600">Confirmar?</div>
    `;

    showMessageModal('Confirmação', summary, 'confirm', () => {
        requestToken(async () => {
            Object.keys(appointments).forEach(dateKey => {
                const slotIndex = appointments[dateKey].findIndex(s => String(s.id) === String(id));
                if (slotIndex !== -1) {
                    appointments[dateKey][slotIndex] = {
                        ...appointments[dateKey][slotIndex],
                        status: 'OCUPADO',
                        patient: patient,
                        record: record,
                        contract: contract,
                        regulated: mainRegulatedStatus,
                        procedure: procedureJSON,
                        detail: detail,
                        eye: eye,
                        createdBy: currentUserToken
                    };
                }
            });

            recalculateMonthCache(selectedDateKey.substring(0, 7));
            closeMessageModal();
            closeModal();
            renderSlotsList();
            updateKPIs();
            showToast("Agendamento realizado!", "success");

            const payload = {
                action: "update",
                id: id,
                status: 'OCUPADO',
                patient: patient,
                record: record,
                contract: contract,
                regulated: mainRegulatedStatus,
                procedure: procedureJSON,
                detail: detail,
                eye: eye,
                createdBy: currentUserToken
            };

            // STRICT TOKEN: Limpa o token imediatamente após o uso
            currentUserToken = null;
            currentUserRole = null;

            sendUpdateToSheet(payload).then(async (success) => {
                if (!success) {
                    showToast("CONFLITO: Vaga já ocupada ou erro de servidor.", "error");
                    await refreshData(); // Auto refresh em conflito
                } else {
                    // SE SUCESSO E ESTAMOS EM MODO MOVE, LIBERA A ORIGEM
                    if (isMoveMode && clipboardPatient && clipboardPatient.originId) {
                        const originId = clipboardPatient.originId;
                        // Envia liberação da antiga
                        await sendUpdateToSheet({
                            action: "update",
                            id: originId,
                            status: 'LIVRE',
                            patient: '', record: '', contract: '', regulated: null,
                            procedure: '', detail: '', eye: ''
                        });

                        // Limpa estado local da origem
                        Object.keys(appointments).forEach(k => {
                            const idx = appointments[k].findIndex(s => String(s.id) === String(originId));
                            if (idx !== -1) {
                                appointments[k][idx].status = 'LIVRE';
                                appointments[k][idx].patient = '';
                                // ... limpar resto se quiser visualmente perfeito,
                                // mas o refresh ou render ja resolve
                            }
                        });

                        showToast("Realocação concluída com sucesso!", "success");

                        // Reset flags
                        isMoveMode = false;
                        clipboardPatient = null;
                        document.querySelector('.listing-column').style.borderLeft = "none";

                        // Refresh final para garantir consistencia visual
                        renderSlotsList();
                    }
                }
            });
        });
    });
}

function cancelSlotBooking() {
    showMessageModal('Liberar Vaga', 'Remover paciente e procedimentos?', 'confirm', () => {
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

            recalculateMonthCache(selectedDateKey.substring(0, 7));
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

            // STRICT TOKEN: Limpa o token imediatamente
            currentUserToken = null;
            currentUserRole = null;

            sendUpdateToSheet(payload);
        }, "Autorizar Cancelamento");
    });
}

// --- KPI: AJUSTADA PARA CONTAR PROCEDIMENTOS ---
function updateKPIs() {
    const picker = document.getElementById('dashboard-month-picker');
    let targetMonth = selectedDateKey.substring(0, 7);

    if (picker && picker.value) {
        targetMonth = picker.value;
    } else if (picker) {
        picker.value = targetMonth;
    }

    if (!DASH_CACHE[targetMonth]) recalculateMonthCache(targetMonth);

    const stats = DASH_CACHE[targetMonth] || {
        total: 0, occupied: 0,
        counts: {
            Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
            Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
            Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
        }
    };

    const { total, occupied, counts } = stats;

    const totalMunicipal = counts.Municipal.Total;
    const totalReg = counts.Regulado.Total;
    const totalInt = counts.Interno.Total;

    // Universo GOV = Soma de procedimentos estaduais/locais
    const universeGov = totalReg + totalInt;
    const validBaseGov = universeGov > 0 ? universeGov : 1;

    // Ocupação Global (Ainda baseada em vagas físicas)
    const realIdleCount = total - occupied;

    animateMetric('glb-total', total);

    const pctOccupiedPhysical = total > 0 ? (occupied / total) * 100 : 0;
    animateMetric('glb-occupied', pctOccupiedPhysical, true);

    animateMetric('glb-idle', realIdleCount);

    // --- KPIS GOV (Baseado em Procedimentos) ---
    const pctRegGlobal = (totalReg / validBaseGov) * 100;

    animateMetric('kpi-60-val', pctRegGlobal, true);
    document.getElementById('prog-60').style.width = Math.min(pctRegGlobal, 100) + '%';

    animateSubMetric('stat-estado', counts.Regulado.ESTADO, totalReg);
    animateSubMetric('stat-serra', counts.Regulado.SERRA, totalReg);
    animateSubMetric('stat-salgueiro', counts.Regulado.SALGUEIRO, totalReg);

    const pctIntGlobal = (totalInt / validBaseGov) * 100;

    animateMetric('kpi-40-val', pctIntGlobal, true);
    document.getElementById('prog-40').style.width = Math.min(pctIntGlobal, 100) + '%';

    animateSubMetric('stat-int-estado', counts.Interno.ESTADO, totalInt);
    animateSubMetric('stat-int-serra', counts.Interno.SERRA, totalInt);
    animateSubMetric('stat-int-salgueiro', counts.Interno.SALGUEIRO, totalInt);

    animateMetric('stat-recife', counts.Municipal.RECIFE);
    animateMetric('stat-jaboatao', counts.Municipal.JABOATÃO);
    animateMetric('kpi-mun-val', counts.Municipal.Total);
}

// --- PDF: TAMBÉM AJUSTADO ---
function generateDashboardPDF() {
    const monthVal = document.getElementById('dashboard-month-picker').value || 'Geral';

    let stats = DASH_CACHE[monthVal];
    if (!stats) {
        recalculateMonthCache(monthVal);
        stats = DASH_CACHE[monthVal];
    }

    const { total, occupied, counts } = stats;

    // Cálculos
    const totalMunicipal = counts.Municipal.Total;
    const totalReg = counts.Regulado.Total;
    const totalInt = counts.Interno.Total;
    const universeGov = totalReg + totalInt;
    const validBase = universeGov > 0 ? universeGov : 1;

    const realIdleCount = total - occupied;
    const pctOccupied = total > 0 ? (occupied / total * 100).toFixed(1) : "0.0";

    const pctRegGlobal = (totalReg / validBase * 100).toFixed(1);
    const pctIntGlobal = (totalInt / validBase * 100).toFixed(1);

    const calcSubPct = (val, groupTot) => groupTot > 0 ? (val / groupTot * 100).toFixed(1) : "0.0";

    const regEstadoPct = calcSubPct(counts.Regulado.ESTADO, totalReg);
    const regSerraPct = calcSubPct(counts.Regulado.SERRA, totalReg);
    const regSalgPct = calcSubPct(counts.Regulado.SALGUEIRO, totalReg);

    const intEstadoPct = calcSubPct(counts.Interno.ESTADO, totalInt);
    const intSerraPct = calcSubPct(counts.Interno.SERRA, totalInt);
    const intSalgPct = calcSubPct(counts.Interno.SALGUEIRO, totalInt);

    const content = document.createElement('div');
    content.innerHTML = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 20px;">
                <h1 style="color: #1e293b; font-size: 24px; margin: 0;">Relatório de Governança Cirúrgica</h1>
                <div style="color: #64748b; font-size: 14px; margin-top: 5px;">Período de Referência: ${monthVal}</div>
                <div style="color: #dc2626; font-size: 11px; margin-top: 2px;">*Metas calculadas sobre total de PROCEDIMENTOS (não vagas)</div>
            </div>

            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 30px;">
                <h3 style="margin-top:0; color:#475569; font-size:16px; border-bottom:1px solid #cbd5e1; padding-bottom:5px;">Visão Geral</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Capacidade Física (Vagas):</strong> ${total}</td>
                         <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Vagas Livres:</strong> ${realIdleCount}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Taxa Ocupação Física:</strong> ${pctOccupied}%</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Total Procedimentos Gov:</strong> ${universeGov}</td>
                    </tr>
                </table>
            </div>

            <div style="display:flex; gap:20px;">
                <div style="flex:1;">
                    <h3 style="color:#7c3aed; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Procedimentos Regulados (Meta 60%)</h3>
                    <div style="font-size:24px; font-weight:bold; color:#7c3aed; margin-bottom:10px;">${pctRegGlobal}% <span style="font-size:12px; color:#666">dos procs</span></div>
                    <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                        <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Unidade</th><th style="padding:8px; text-align:right;">% Grupo (Qtd)</th></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Estado</td><td style="padding:8px; text-align:right;">${regEstadoPct}% (${counts.Regulado.ESTADO})</td></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Serra Talhada</td><td style="padding:8px; text-align:right;">${regSerraPct}% (${counts.Regulado.SERRA})</td></tr>
                        <tr><td style="padding:8px;">Salgueiro</td><td style="padding:8px; text-align:right;">${regSalgPct}% (${counts.Regulado.SALGUEIRO})</td></tr>
                        <tr style="background:#f8fafc; font-weight:bold;"><td style="padding:8px;">TOTAL</td><td style="padding:8px; text-align:right;">100% (${totalReg})</td></tr>
                    </table>
                </div>

                <div style="flex:1;">
                    <h3 style="color:#059669; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Procedimentos Internos (Meta 40%)</h3>
                    <div style="font-size:24px; font-weight:bold; color:#059669; margin-bottom:10px;">${pctIntGlobal}% <span style="font-size:12px; color:#666">dos procs</span></div>
                    <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                        <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Unidade</th><th style="padding:8px; text-align:right;">% Grupo (Qtd)</th></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Estado</td><td style="padding:8px; text-align:right;">${intEstadoPct}% (${counts.Interno.ESTADO})</td></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Serra Talhada</td><td style="padding:8px; text-align:right;">${intSerraPct}% (${counts.Interno.SERRA})</td></tr>
                        <tr><td style="padding:8px;">Salgueiro</td><td style="padding:8px; text-align:right;">${intSalgPct}% (${counts.Interno.SALGUEIRO})</td></tr>
                        <tr style="background:#f8fafc; font-weight:bold;"><td style="padding:8px;">TOTAL</td><td style="padding:8px; text-align:right;">100% (${totalInt})</td></tr>
                    </table>
                </div>
            </div>

            <div style="margin-top: 30px;">
                 <h3 style="color:#64748b; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Municípios (Procedimentos Realizados)</h3>
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
        margin: 10,
        filename: `Relatorio_Gov_${monthVal}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
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
        let procFormatted = s.procedure;
        try {
            if (s.procedure && (s.procedure.startsWith('[') || s.procedure.startsWith('{'))) {
                const parsed = JSON.parse(s.procedure);
                if (Array.isArray(parsed)) {
                    procFormatted = parsed.map(p => `${p.name} (${p.regulated ? 'Reg' : 'Int'})`).join('; ');
                }
            }
        } catch (e) { console.warn("Erro ao formatar procedimento export:", e); }

        return [
            key, s.time, s.location, s.room, s.status, s.patient, s.record, s.contract,
            (s.regulated ? 'SIM' : 'NÃO'), s.doctor, procFormatted, s.detail
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