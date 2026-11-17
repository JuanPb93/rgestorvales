'use strict';

const STORE_KEY = 'gestor_vales_v1_2_dados';
const PREVIOUS_STORE_KEY = 'gestor_vales_v1_1_dados';
const OLD_STORE_KEY = 'gestor_vales_v1_dados';
const LOT_KEY = 'gestor_vales_v1_2_ultimo_lote';
const PREVIOUS_LOT_KEY = 'gestor_vales_v1_1_ultimo_lote';
const OLD_LOT_KEY = 'gestor_vales_v1_ultimo_lote';
const DRAFT_KEY = 'gestor_vales_recuperacao_1h_v1';
const DRAFT_DURATION_MS = 60 * 60 * 1000;
const FIXED_VT = '8,00';
const FIXED_AA = '10,00';
// Os 14 nomes vêm de funcionarios.js (mesma pasta do index.html) e são iguais em qualquer dispositivo.
// Apenas dias/recibos e preferências de sessão dependem do armazenamento local do navegador.
const EQUIPE_FIXA = (typeof globalThis !== 'undefined' && Array.isArray(globalThis.GESTOR_VALES_FUNCIONARIOS))
  ? globalThis.GESTOR_VALES_FUNCIONARIOS.filter(f => f && typeof f.id === 'string' && typeof f.nome === 'string' && f.nome.trim())
  : [];
// Nomes históricos da versão anterior são reconhecidos para migração sem duplicar colaboradores.
const NOMES_ANTIGOS = {
  'f471ce15dce8b': ['Alrilene Albuquerque Rodrigues'],
  'f913257dbbf86': ['Juan Pablo de Carvalho de Moura']
};
const SCHEDULES = {semana:[1,2,3,4,5],sabado:[1,2,3,4,5,6],todos:[0,1,2,3,4,5,6]};
const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const idNovo = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const brl = (cents) => (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const texto = (s) => String(s ?? '');
const htmlEscape = (s) => texto(s).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const xmlEscape = (s) => texto(s).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const normalizar = (s) => texto(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function cents(v) {
  let s = texto(v).trim().replace(/\s/g,'').replace(/R\$/gi,'');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g,'').replace(',', '.');
  s = s.replace(/[^\d.\-]/g,'');
  const n=Number(s); return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0;
}
function moneyField(v){return (cents(v)/100).toFixed(2).replace('.',',');}
function dateUTC(iso){if(!/^\d{4}-\d\d-\d\d$/.test(texto(iso)))return null;const d=new Date(iso+'T12:00:00Z');return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==iso?null:d;}
function dateISO(d){return d.toISOString().slice(0,10);}
function fmtDate(iso){const d=dateUTC(iso);if(!d)return '—';return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;}
function hojeISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function fullDate(iso){const d=dateUTC(iso);if(!d)return '—';const mes=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];return `${d.getUTCDate()} de ${mes[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;}
function parseHoliday(s){const v=texto(s).trim();if(dateUTC(v))return v;const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);if(m){const v2=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return dateUTC(v2)?v2:null;}return null;}
function holidaysSet(){return new Set(texto(state.config.feriados).split(/[\n,;]+/).map(parseHoliday).filter(Boolean));}
function shiftMonth(iso){const d=dateUTC(iso);if(!d)return iso;const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,day=d.getUTCDate();const last=new Date(Date.UTC(y,m+1,0,12)).getUTCDate();return dateISO(new Date(Date.UTC(y,m,Math.min(day,last),12)));}
function makeEmployee(name,config){return {id:idNovo(),nome:name,active:false,statusDistribuicao:'pendente',diasSelecionados:[],inicio:config.inicio,fim:config.fim,vt:config.vt,aa:config.aa,escala:'semana',feriasInicio:'',feriasFim:'',descontos:'0',diasManual:'',observacao:''};}
function defaultState(){const mes=hojeISO().slice(0,7),inicio=mes+'-21',fim=shiftMonth(inicio).slice(0,7)+'-20';const config={empresa:'Meneses e Meneses Ltda.',cidade:'Teresina/PI',emissao:mes+'-20',emissaoAuto:true,inicio,fim,mesCalendario:mes,diasLote:[],vt:'8,00',aa:'10,00',descricao:'vale refeição e vale transporte',feriados:''};return {schemaVersion:2,config,employees:EQUIPE_FIXA.map(f=>({...makeEmployee(f.nome,config),id:f.id,nome:f.nome}))};}
function validateState(candidate,asInitial=false){
 if(!candidate||!candidate.config||!Array.isArray(candidate.employees))throw new Error('Backup sem estrutura válida.');
 const base=defaultState();const config={...base.config,...candidate.config,vt:FIXED_VT,aa:FIXED_AA};
 // Emissão: sempre dia 20. Até que o usuário escolha outro mês/ano, acompanha automaticamente o calendário atual.
 if(config.emissaoAuto!==false){config.emissaoAuto=true;config.emissao=hojeISO().slice(0,7)+'-20';}
 else if(!dateUTC(config.emissao)){config.emissaoAuto=true;config.emissao=hojeISO().slice(0,7)+'-20';}
 else config.emissao=config.emissao.slice(0,7)+'-20';
 if(config.descricao==='auxílio-alimentação e vale-transporte')config.descricao='vale refeição e vale transporte';
 if(!/^\d{4}-\d{2}$/.test(config.mesCalendario))config.mesCalendario=String(config.inicio||'2026-11').slice(0,7);
 config.diasLote=Array.isArray(config.diasLote)?uniqueDates(config.diasLote):[];
 // O cadastro empacotado é a fonte da verdade: nomes/IDs não vêm do localStorage.
 // Ainda aproveita campos antigos de um funcionário quando há correspondência por ID ou nome.
 const anteriores = candidate.employees;
 const employees=EQUIPE_FIXA.map(f=>{
   const nomesValidos = [f.nome,...(NOMES_ANTIGOS[f.id]||[])].map(normalizar);
   const x = anteriores.find(p=>p && p.id===f.id)
      || anteriores.find(p=>p && nomesValidos.includes(normalizar(p.nome)))
      || {};
   const emp={...makeEmployee(f.nome,config),...x,id:f.id,nome:f.nome,vt:FIXED_VT,aa:FIXED_AA};
   if(asInitial){emp.statusDistribuicao='pendente';emp.diasSelecionados=[];emp.active=false;emp.descontos='0';emp.diasManual='';emp.feriasInicio='';emp.feriasFim='';}
   else{emp.statusDistribuicao=x.statusDistribuicao==='definido'?'definido':'pendente';emp.active=!!x.active&&emp.statusDistribuicao==='definido';emp.diasSelecionados=Array.isArray(x.diasSelecionados)?uniqueDates(x.diasSelecionados):[];}
   return emp;
 });
 return {schemaVersion:2,config,employees};
}
// Só os cadastros/configurações ficam guardados permanentemente.
// Calendário, férias e dias atribuídos são parte do lote temporário.
function permanentOnly(candidate){
 const clean=clone(candidate);
 clean.config.diasLote=[];
 clean.config.feriados='';
 for(const e of clean.employees){
   e.statusDistribuicao='pendente';e.diasSelecionados=[];e.active=false;
   e.feriasInicio='';e.feriasFim='';e.descontos='0';e.diasManual='';e.observacao='';
 }
 return clean;
}
function createDraft(candidate){
 return {
  config:{diasLote:uniqueDates(candidate.config.diasLote),mesCalendario:candidate.config.mesCalendario,feriados:candidate.config.feriados,inicio:candidate.config.inicio,fim:candidate.config.fim},
  employees:candidate.employees.map(e=>({id:e.id,statusDistribuicao:e.statusDistribuicao,diasSelecionados:e.diasSelecionados,inicio:e.inicio,fim:e.fim,active:!!e.active,feriasInicio:e.feriasInicio,feriasFim:e.feriasFim,descontos:e.descontos,diasManual:e.diasManual,observacao:e.observacao}))
 };
}
function meaningfulDraft(draft){
 return !!(draft && (draft.config?.diasLote?.length || draft.employees?.some(e=>e.statusDistribuicao==='definido')));
}
function readTimed(key){
 try{
  const saved=localStorage.getItem(key);if(!saved)return null;
  const data=JSON.parse(saved);
  if(!data || !Number.isFinite(data.savedAt) || Date.now()-data.savedAt>DRAFT_DURATION_MS || data.savedAt>Date.now()+60000 || !data.draft){localStorage.removeItem(key);return null;}
  return data;
 }catch(e){try{localStorage.removeItem(key);}catch(ignore){}return null;}
}
function timedSave(key,draft){try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),draft}));}catch(e){console.warn('Não foi possível salvar a recuperação temporária',e);}}
function loadState(){
 let original=null;
 try{for(const key of [STORE_KEY,PREVIOUS_STORE_KEY,OLD_STORE_KEY]){const raw=localStorage.getItem(key);if(raw){original=validateState(JSON.parse(raw));break;}}}catch(e){console.warn(e);}
 const current=original||defaultState();
 // Cada nova abertura começa mostrando o mês e ano atuais da emissão; o dia permanece 20.
 current.config.emissaoAuto=true;current.config.emissao=hojeISO().slice(0,7)+'-20';
 try{
  // Na primeira atualização da v1.2.3, conserva o lote antigo como recuperação por 1 hora.
  if(original&&!readTimed(DRAFT_KEY)&&meaningfulDraft(createDraft(original)))timedSave(DRAFT_KEY,createDraft(original));
  localStorage.setItem(STORE_KEY,JSON.stringify(permanentOnly(current)));
 }catch(e){console.warn(e);}
 return permanentOnly(current);
}
let state=loadState();
const miniDrafts=new Map();
let employeeFilter='all';
let modalSelection=new Set();
let sessionTouched=false;
function uniqueDates(dates){return [...new Set((dates||[]).filter(x=>dateUTC(x)))].sort();}
function assigned(e){return e.statusDistribuicao==='definido';}
function periodDates(e){return Array.isArray(e.diasSelecionados)?e.diasSelecionados:[];}
function sameDaySpan(dates){return dates.length?(dates.length===1?fmtDate(dates[0]):`${fmtDate(dates[0])} a ${fmtDate(dates[dates.length-1])}`):'Nenhum dia selecionado';}
function renderRecoveryBanner(){
 const el=byId('recovery-banner');if(!el)return;
 const saved=readTimed(DRAFT_KEY);
 const available=!sessionTouched&&saved&&meaningfulDraft(saved.draft);
 el.hidden=!available;
 if(available){const remaining=Math.max(1,Math.ceil((DRAFT_DURATION_MS-(Date.now()-saved.savedAt))/60000));byId('recovery-description').textContent=`Os dias do último trabalho podem ser recuperados por mais ${remaining} minuto(s). Os funcionários cadastrados permanecem salvos.`;}
}
function applyDraft(draft){
 if(!draft || !draft.config || !Array.isArray(draft.employees))throw new Error('Sessão sem dados válidos.');
 miniDrafts.clear();
 state.config.diasLote=uniqueDates(draft.config.diasLote||[]);
 if(/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.config.mesCalendario||''))state.config.mesCalendario=draft.config.mesCalendario;
 state.config.feriados=''; // Feriados da interface antiga não interferem mais no cálculo.
 if(dateUTC(draft.config.inicio))state.config.inicio=draft.config.inicio;
 if(dateUTC(draft.config.fim))state.config.fim=draft.config.fim;
 const byIdSaved=new Map(draft.employees.map(e=>[e.id,e]));
 for(const emp of state.employees){
  const prior=byIdSaved.get(emp.id);if(!prior)continue;
  emp.statusDistribuicao=prior.statusDistribuicao==='definido'?'definido':'pendente';
  emp.diasSelecionados=Array.isArray(prior.diasSelecionados)?uniqueDates(prior.diasSelecionados):null;
  if(dateUTC(prior.inicio))emp.inicio=prior.inicio;
  if(dateUTC(prior.fim))emp.fim=prior.fim;
  emp.active=emp.statusDistribuicao==='definido'&&!!prior.active;
  emp.feriasInicio='';emp.feriasFim='';emp.descontos='0';emp.diasManual='';emp.observacao='';
 }
}
function persist(){
 try{
  localStorage.setItem(STORE_KEY,JSON.stringify(permanentOnly(state)));
  if(sessionTouched||meaningfulDraft(createDraft(state))){sessionTouched=true;timedSave(DRAFT_KEY,createDraft(state));}
 }catch(e){console.warn('Armazenamento local indisponível',e);}
 renderRecoveryBanner();
}
function toast(msg){const el=byId('toast');el.textContent=msg;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4200);}
function selected(){return state.employees.filter(e=>e.active&&assigned(e));}
function calendarSelected(){return uniqueDates(state.config.diasLote);}
function holidaySetFromConfig(config){return new Set(texto(config.feriados).split(/[\n,;]+/).map(parseHoliday).filter(Boolean));}
function eligibleDays(e,globalHolidays){
  if(!assigned(e))return [];
  const holiday=globalHolidays||holidaysSet(),ferie1=dateUTC(e.feriasInicio),ferie2=dateUTC(e.feriasFim);
  if(Array.isArray(e.diasSelecionados))return uniqueDates(e.diasSelecionados).filter(iso=>{
    const d=dateUTC(iso);return !holiday.has(iso)&&!(ferie1&&ferie2&&ferie1<=d&&d<=ferie2);
  });
  const inicio=dateUTC(e.inicio),fim=dateUTC(e.fim);if(!inicio||!fim||inicio>fim)return [];
  const escala=SCHEDULES[e.escala]||SCHEDULES.semana;const days=[];
  for(let timestamp=inicio.getTime(),i=0;timestamp<=fim.getTime()&&i<3660;timestamp+=86400000,i++){
    const d=new Date(timestamp),iso=dateISO(d);
    if(!escala.includes(d.getUTCDay())||holiday.has(iso))continue;
    if(ferie1&&ferie2&&ferie1<=d&&d<=ferie2)continue;
    days.push(iso);
  }
  return days;
}
function calcEmp(e,globalHolidays){
  if(!assigned(e))return {dias:0,vt:0,aa:0,total:0};
  let dias=eligibleDays(e,globalHolidays).length;
  dias=Math.max(0,dias-Math.max(0,Math.floor(Number(e.descontos)||0)));
  if(texto(e.diasManual).trim()!=='')dias=Math.max(0,Math.floor(Number(e.diasManual)||0));
  const vt=dias*cents(e.vt),aa=dias*cents(e.aa);return {dias,vt,aa,total:vt+aa};
}
function calendarMonth(){const m=state.config.mesCalendario;return /^\d{4}-(0[1-9]|1[0-2])$/.test(m)?m:hojeISO().slice(0,7);}
function renderCalendar(){
  const [y,m]=calendarMonth().split('-').map(Number), first=new Date(Date.UTC(y,m-1,1,12)),start=first.getUTCDay(),daysInMonth=new Date(Date.UTC(y,m,0,12)).getUTCDate();
  byId('calendar-month-label').textContent=first.toLocaleDateString('pt-BR',{timeZone:'UTC',month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
  const marked=new Set(calendarSelected()),holiday=holidaysSet();const buttons=[];
  for(let i=0;i<start;i++)buttons.push('<span class="calendar-pad"></span>');
  for(let d=1;d<=daysInMonth;d++){
    const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const chosen=marked.has(iso),day=new Date(Date.UTC(y,m-1,d,12)).getUTCDay();
    buttons.push(`<button type="button" class="day-btn${chosen?' selected':''}${day===0||day===6?' weekend':''}${holiday.has(iso)?' holiday':''}" data-cal-date="${iso}" aria-pressed="${chosen}" title="${fmtDate(iso)}${holiday.has(iso)?' · excluído como feriado':''}">${d}</button>`);
  }
  byId('calendar-grid').innerHTML=buttons.join('');
  const dates=calendarSelected(),count=dates.length,payable=dates.filter(d=>!holiday.has(d)).length,vt=payable*cents(state.config.vt),aa=payable*cents(state.config.aa);
  byId('hero-total').textContent=brl(cents(state.config.vt)+cents(state.config.aa));byId('hero-detail').textContent=`${brl(cents(state.config.vt))} transporte + ${brl(cents(state.config.aa))} alimentação`;
  byId('calendar-days-count').innerHTML=`${count} <span>${count===1?'dia':'dias'}</span>`;
  byId('calendar-range').textContent=count?sameDaySpan(dates):'Escolha os dias diretamente no calendário.';
  byId('calendar-vt').textContent=brl(vt);byId('calendar-aa').textContent=brl(aa);byId('calendar-total').textContent=brl(vt+aa);
  const preview=byId('calendar-days-preview');preview.textContent=count?`${count} datas marcadas · ${count-payable} excluída(s) como feriado`:'Ainda não há dias marcados.';
  const ctx=byId('individual-context');if(ctx){ctx.hidden=true;ctx.innerHTML='';}
  updateDistribution();
}
function changeMonth(amount){const [y,m]=calendarMonth().split('-').map(Number),d=new Date(Date.UTC(y,m-1+amount,1));state.config.mesCalendario=dateISO(d).slice(0,7);persist();renderCalendar();}
function updateDistribution(){
 const total=state.employees.length,done=state.employees.filter(assigned).length,pending=total-done;
 const el=byId('distribution-status');if(el)el.innerHTML=`<div><b>${done}</b> com dias definidos</div><div><b>${pending}</b> pendentes de distribuição</div><div class="distribution-help">Os pendentes permanecem disponíveis para o próximo grupo.</div>`;
}

function mesAnoEmissao(){
  if(state.config.emissaoAuto!==false)return hojeISO().slice(0,7);
  const selectedMonth=texto(state.config.emissao).slice(0,7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)?selectedMonth:hojeISO().slice(0,7);
}
function dataEmissaoAtual(){return mesAnoEmissao()+'-20';}
function renderEmissao(){
  const parts=mesAnoEmissao().split('-'),mes=byId('emissao-mes'),ano=byId('emissao-ano');
  if(mes)mes.value=parts[1];
  if(ano)ano.value=parts[0];
  const prev=byId('emissao-preview');
  if(prev)prev.textContent=`No recibo: ${fullDate(dataEmissaoAtual())}${state.config.emissaoAuto!==false?' · mês atual automático':''}`;
}
function fillSettings(){for(const k of Object.keys(state.config)){const el=byId(k);if(el)el.value=state.config[k];}renderEmissao();renderCalendar();}
function labels(){const assignedPeople=state.employees.filter(assigned),sel=selected().length;
  byId('workers-label').textContent=`${sel} de ${assignedPeople.length} selecionados para exportação · ${state.employees.length-assignedPeople.length} pendente(s)`;
  const cb=byId('select-all');cb.checked=assignedPeople.length>0&&sel===assignedPeople.length;cb.indeterminate=sel>0&&sel<assignedPeople.length;}
function updateTotals(){
 const h=holidaysSet();
 for(const emp of state.employees){const card=document.querySelector(`[data-worker-id="${emp.id}"]`);if(!card)continue;const c=calcEmp(emp,h);
  card.classList.toggle('is-active',emp.active);const lbl=card.querySelector('.worker-label small');if(lbl)lbl.textContent=assigned(emp)?(Array.isArray(emp.diasSelecionados)?sameDaySpan(emp.diasSelecionados):`${fmtDate(emp.inicio)} a ${fmtDate(emp.fim)}`):'Pendente · escolha os dias no calendário';
  card.querySelector('.worker-days b').textContent=c.dias;card.querySelector('.worker-total').textContent=brl(c.total);
  card.querySelector('.worker-breakdown').innerHTML=`VT <b>${brl(c.vt)}</b> · Alimentação <b>${brl(c.aa)}</b> · Total <b>${brl(c.total)}</b>`;
 }
 labels();updateDistribution();
}
function miniInitialDates(emp){
 return assigned(emp)?(Array.isArray(emp.diasSelecionados)?uniqueDates(emp.diasSelecionados):eligibleDays(emp)):[];
}
function ensureMiniDraft(emp){
 if(!miniDrafts.has(emp.id)){
  const dates=miniInitialDates(emp),month=(dates.length?dates[0].slice(0,7):calendarMonth());
  miniDrafts.set(emp.id,{dates:[...dates],month});
 }
 return miniDrafts.get(emp.id);
}
function shiftMiniMonth(ym,amount){
 const [year,month]=ym.split('-').map(Number);
 const d=new Date(Date.UTC(year,month-1+amount,1,12));
 return dateISO(d).slice(0,7);
}
function renderMiniCalendar(emp){
 const card=[...document.querySelectorAll('[data-worker-id]')].find(x=>x.dataset.workerId===emp.id);
 if(!card||!card.open)return;
 const draft=ensureMiniDraft(emp),root=card.querySelector('.mini-calendar');if(!root)return;
 const [y,m]=draft.month.split('-').map(Number),first=new Date(Date.UTC(y,m-1,1,12)),start=first.getUTCDay(),last=new Date(Date.UTC(y,m,0,12)).getUTCDate();
 const monthName=first.toLocaleDateString('pt-BR',{timeZone:'UTC',month:'long',year:'numeric'}).replace(/^./,x=>x.toUpperCase());
 root.querySelector('.mini-month-label').textContent=monthName;
 const chosen=new Set(draft.dates);let buttons='';
 for(let i=0;i<start;i++)buttons+='<span class="mini-cal-pad" aria-hidden="true"></span>';
 for(let d=1;d<=last;d++){
  const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const on=chosen.has(iso),weekend=[0,6].includes(new Date(Date.UTC(y,m-1,d,12)).getUTCDay());
  buttons+=`<button type="button" class="mini-day${on?' selected':''}${weekend?' weekend':''}" data-action="mini-day" data-date="${iso}" aria-pressed="${on}" aria-label="${fmtDate(iso)}${on?' selecionado':''}">${d}</button>`;
 }
 root.querySelector('.mini-grid').innerHTML=buttons;
 const total=draft.dates.length;const old=miniInitialDates(emp);
 const modified=total!==old.length||draft.dates.some((d,i)=>d!==old[i]);
 root.querySelector('.mini-stats').textContent=`${total} ${total===1?'dia selecionado':'dias selecionados'} · ${brl(total*800)} transporte + ${brl(total*1000)} alimentação = ${brl(total*1800)}`;
 root.querySelector('.mini-feedback').textContent=modified?'Alterações não aplicadas. Clique em Aplicar alterações para registrar.':'Dias registrados. Você pode marcar ou desmarcar datas.';
 root.querySelector('.mini-feedback').classList.toggle('unsaved',modified);
}
function commitIndividualDays(emp,requestedDates){
 // Só esta função altera os dias efetivos do funcionário; clicar no mini calendário não altera estado nem valores.
 const dates=uniqueDates(requestedDates);
 emp.diasSelecionados=[...dates];emp.statusDistribuicao=dates.length?'definido':'pendente';emp.active=dates.length>0;
 if(dates.length){emp.inicio=dates[0];emp.fim=dates[dates.length-1];}
 emp.vt=FIXED_VT;emp.aa=FIXED_AA;emp.feriasInicio='';emp.feriasFim='';emp.descontos='0';emp.diasManual='';emp.observacao='';
 return dates;
}
function applyMiniCalendar(emp){
 const draft=miniDrafts.get(emp.id);if(!draft)return;
 const dates=commitIndividualDays(emp,draft.dates);
 miniDrafts.delete(emp.id);persist();renderEmployees(emp.id);
 toast(dates.length?`${dates.length} dia(s) de ${emp.nome} registrado(s).`:`Os dias de ${emp.nome} foram removidos; funcionário pendente.`);
}
function renderEmployees(openId){
 const term=normalizar(byId('search').value||'');
 const visible=state.employees.filter(e=>normalizar(e.nome).includes(term)&&(employeeFilter==='all'||(employeeFilter==='pending'?!assigned(e):assigned(e))));
 const esc=htmlEscape;
 byId('employee-list').innerHTML=visible.length?visible.map(e=>{
  const c=calcEmp(e),status=assigned(e),chosen=periodDates(e);
  return `<details class="worker ${e.active?'is-active':''}" data-worker-id="${esc(e.id)}" ${openId===e.id?'open':''}>
   <summary class="worker-summary"><input class="employee-check" type="checkbox" data-key="active" ${e.active?'checked':''} ${!status?'disabled':''} aria-label="Incluir ${esc(e.nome)} na exportação">
    <div class="worker-label"><strong>${esc(e.nome)}</strong><small>${status?(chosen.length?sameDaySpan(chosen):`${fmtDate(e.inicio)} a ${fmtDate(e.fim)}`):'Pendente · escolha os dias no mini calendário'}</small><span class="status-pill ${status?'done':'pending'}">${status?'✓ Dias definidos':'● Pendente'}</span></div>
    <div class="worker-counters"><div class="worker-days"><b>${c.dias}</b> dias</div><div class="worker-total">${brl(c.total)}</div></div><span class="worker-chevron">⌄</span>
   </summary>
   <div class="worker-body">
    <p class="worker-date-note">${status?`Dias confirmados: <b>${c.dias} ${c.dias===1?'dia':'dias'}</b> · ${esc(sameDaySpan(chosen))}`:'Ainda não há dias atribuídos a este funcionário.'}</p>
    <div class="mini-calendar" aria-label="Calendário individual de ${esc(e.nome)}">
     <div class="mini-heading"><div><strong>Calendário individual</strong><small>Selecione os dias deste funcionário.</small></div>
      <div class="mini-month-nav"><button class="btn light mini-nav" data-action="mini-prev" type="button" aria-label="Mês anterior">‹</button><b class="mini-month-label"></b><button class="btn light mini-nav" data-action="mini-next" type="button" aria-label="Próximo mês">›</button></div></div>
     <div class="mini-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div>
     <div class="mini-grid"></div>
     <div class="mini-stats" aria-live="polite"></div>
     <p class="mini-feedback"></p>
     <div class="mini-footer"><button type="button" class="btn primary" data-action="mini-apply">Aplicar alterações</button><span>Os demais funcionários não serão alterados.</span></div>
    </div>
    <div class="worker-footer"><div class="worker-breakdown">VT <b>${brl(c.vt)}</b> · Alimentação <b>${brl(c.aa)}</b> · Total <b>${brl(c.total)}</b></div>
     <div class="actions" style="margin-top:0"><button type="button" class="btn light" data-action="individual" ${status?'':'disabled'}>Baixar recibo Word</button></div>
    </div>
   </div>
  </details>`;
 }).join(''):'<p class="hint" style="padding:25px 6px">Nenhum funcionário corresponde à busca ou ao filtro atual.</p>';
 document.querySelectorAll('.filter-pill').forEach(b=>b.classList.toggle('active',b.dataset.filter===employeeFilter));
 updateTotals();
 if(openId){const emp=state.employees.find(e=>e.id===openId);if(emp)renderMiniCalendar(emp);}
}

function prepareExport(only){const people=only||selected();if(!people.length){toast('Defina os dias de ao menos um funcionário e inclua-o na exportação.');return null;}for(const p of people){if(!assigned(p)){toast('Defina os dias de '+p.nome+' antes de gerar recibo.');return null;}if(!texto(p.nome).trim()){toast('Preencha o nome de todos os funcionários incluídos.');return null;}const a=dateUTC(p.inicio),b=dateUTC(p.fim);if(!a||!b||a>b){toast('Corrija as datas de início/fim de '+p.nome+'.');return null;}if((p.feriasInicio&&!p.feriasFim)||(!p.feriasInicio&&p.feriasFim)){toast('Preencha as duas datas de férias de '+p.nome+'.');return null;}if(p.feriasInicio&&p.feriasFim&&(!dateUTC(p.feriasInicio)||!dateUTC(p.feriasFim)||p.feriasInicio>p.feriasFim)){toast('Corrija as datas de férias de '+p.nome+'.');return null;}}return people;}
function filename(s){return normalizar(s).toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,85)||'RECIBO';}
function loteBase(){const vals=selected().flatMap(e=>Array.isArray(e.diasSelecionados)?e.diasSelecionados:[e.inicio,e.fim]).filter(dateUTC).sort();return vals.length?`${fmtDate(vals[0]).replaceAll('/','-')}_A_${fmtDate(vals.at(-1)).replaceAll('/','-')}`:'SEM_PERIODO';}
function downloadBlob(content,name,type='application/octet-stream'){const b=content instanceof Blob?content:new Blob([content],{type});const url=URL.createObjectURL(b);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
function saveLot(quiet=false){timedSave(LOT_KEY,createDraft(state));persist();if(!quiet)toast('Lote temporário salvo por até 1 hora para repetir os dias e funcionários.');}
function csvContent(people){const header=['Funcionário','Início','Fim','Dias pagos','VT por dia','Alimentação por dia','Total VT','Total alimentação','Total a pagar','Férias início','Férias fim','Dias descontados','Dias manuais','Observação','Dias selecionados no calendário'];const esc=(v)=>'"'+texto(v).replace(/"/g,'""')+'"';const rows=people.map(e=>{const c=calcEmp(e);return [e.nome,fmtDate(e.inicio),fmtDate(e.fim),c.dias,moneyField(e.vt),moneyField(e.aa),(c.vt/100).toFixed(2).replace('.',','),(c.aa/100).toFixed(2).replace('.',','),(c.total/100).toFixed(2).replace('.',','),fmtDate(e.feriasInicio),fmtDate(e.feriasFim),e.descontos,e.diasManual,e.observacao,Array.isArray(e.diasSelecionados)?e.diasSelecionados.map(fmtDate).join(' | '):'Cadastro anterior'];});const totals=people.reduce((a,e)=>{const r=calcEmp(e);a.dias+=r.dias;a.vt+=r.vt;a.aa+=r.aa;return a;},{dias:0,vt:0,aa:0});rows.push(['TOTAL','','',totals.dias,'','',(totals.vt/100).toFixed(2).replace('.',','),(totals.aa/100).toFixed(2).replace('.',','),((totals.vt+totals.aa)/100).toFixed(2).replace('.',','),'','','','','','']);return '\ufeff'+[header,...rows].map(row=>row.map(esc).join(';')).join('\r\n');}

// Valores por extenso, de centavos até milhões, em português brasileiro.
function numeroExtenso(n){
  n=Math.floor(Math.max(0,n));if(n===0)return 'zero';
  const u=['','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
  const dez=['dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
  const d=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
  const c=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
  const ate999=(v)=>{if(v===100)return 'cem';const partes=[],cent=Math.floor(v/100),rest=v%100;if(cent)partes.push(c[cent]);if(rest>=20){partes.push(d[Math.floor(rest/10)]+(rest%10?' e '+u[rest%10]:''));}else if(rest>=10)partes.push(dez[rest-10]);else if(rest>0)partes.push(u[rest]);return partes.join(' e ');};
  if(n<1000)return ate999(n);
  const grupos=[];const milhoes=Math.floor(n/1000000);const milhares=Math.floor(n%1000000/1000);const unidades=n%1000;
  if(milhoes)grupos.push(ate999(milhoes)+(milhoes===1?' milhão':' milhões'));
  if(milhares)grupos.push((milhares===1?'mil':ate999(milhares)+' mil'));
  if(unidades){const conj=(unidades<100||unidades%100===0)?' e ':' ';if(grupos.length)grupos.push(conj+ate999(unidades));else grupos.push(ate999(unidades));}
  return grupos.join(grupos.length>1&&milhoes&&milhares&&!unidades?' e ':'');
}
function valorExtenso(valorCentavos){const reais=Math.floor(valorCentavos/100),cent=valorCentavos%100;let result='';if(reais>0)result=numeroExtenso(reais)+(reais===1?' real':(reais>=1000000&&reais%1000000===0?' de reais':' reais'));if(cent>0)result+=(result?' e ':'')+numeroExtenso(cent)+(cent===1?' centavo':' centavos');return (result||'zero reais').replace(/^./,c=>c.toUpperCase());}

// Gerador ZIP sem bibliotecas externas: compatível com Word e Windows; entradas não compactadas.
const encoder=new TextEncoder();
function makeZip(entries){
  const entriesPacked=[];let offset=0;const locals=[],central=[];
  const crcTable=new Uint32Array(256);for(let k=0;k<256;k++){let c=k;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):(c>>>1);crcTable[k]=c>>>0;}
  const crc32=(bytes)=>{let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
  const pack16=(a,o,v)=>{a[o]=v&255;a[o+1]=(v>>>8)&255;};
  const pack32=(a,o,v)=>{a[o]=v&255;a[o+1]=(v>>>8)&255;a[o+2]=(v>>>16)&255;a[o+3]=(v>>>24)&255;};
  const now=new Date(), time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),date=((Math.max(1980,now.getFullYear())-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  for(const [name,raw] of entries){const n=encoder.encode(name),data=typeof raw==='string'?encoder.encode(raw):(raw instanceof Uint8Array?raw:new Uint8Array(raw));const crc=crc32(data);
    const local=new Uint8Array(30+n.length);pack32(local,0,0x04034b50);pack16(local,4,20);pack16(local,6,0x0800);pack16(local,8,0);pack16(local,10,time);pack16(local,12,date);pack32(local,14,crc);pack32(local,18,data.length);pack32(local,22,data.length);pack16(local,26,n.length);local.set(n,30);locals.push(local,data);
    const cen=new Uint8Array(46+n.length);pack32(cen,0,0x02014b50);pack16(cen,4,20);pack16(cen,6,20);pack16(cen,8,0x0800);pack16(cen,10,0);pack16(cen,12,time);pack16(cen,14,date);pack32(cen,16,crc);pack32(cen,20,data.length);pack32(cen,24,data.length);pack16(cen,28,n.length);pack32(cen,42,offset);cen.set(n,46);central.push(cen);
    offset+=local.length+data.length;
  }
  const centerSize=central.reduce((x,a)=>x+a.length,0);const end=new Uint8Array(22);pack32(end,0,0x06054b50);pack16(end,8,entries.length);pack16(end,10,entries.length);pack32(end,12,centerSize);pack32(end,16,offset);
  const output=new Uint8Array(offset+centerSize+22);let at=0;for(const part of [...locals,...central,end]){output.set(part,at);at+=part.length;}return output;
}
function wordRun(textContent,bold=false,size=24){const props=`<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/>${bold?'<w:b/>':''}<w:sz w:val="${size}"/></w:rPr>`;return `<w:r>${props}<w:t xml:space="preserve">${xmlEscape(textContent)}</w:t></w:r>`;}
function wordParagraph(runs,align='left',before=0,after=0,pageBreak=false){return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${before}" w:after="${after}"/>${pageBreak?'<w:pageBreakBefore/>':''}</w:pPr>${runs}</w:p>`;}
function receiptPeriod(e){const days=periodDates(e);return days.length?[days[0],days[days.length-1]]:[e.inicio,e.fim];}
function receiptWordXml(e,index,issued){const c=calcEmp(e),value=brl(c.total),extenso=valorExtenso(c.total),cfg=state.config,period=receiptPeriod(e);
  const title=wordParagraph(wordRun('RECIBO',true,32),'center',0,850,index>0);
  const amount=wordParagraph(wordRun(value.replace(/\u00a0/g,' '),true,32),'right',0,950);
  const body=wordParagraph(wordRun('Eu, ')+wordRun(e.nome,true,28)+wordRun(', recebi da empresa '+cfg.empresa+' a importância de '+value+' ('+extenso+'), referente a '+cfg.descricao+' do dia '+fmtDate(period[0])+' à '+fmtDate(period[1])+'.'),'both',0,40);
  const sign=wordParagraph(wordRun('_'.repeat(46),false,28),'center',1820,0);
  const name=wordParagraph(wordRun(e.nome,true,28),'center',0,0);
  const city=wordParagraph(wordRun(cfg.cidade,false,24),'center',0,0);
  const emitted=wordParagraph(wordRun(fullDate(issued),false,24),'center',0,0);
  return title+amount+body+sign+name+city+emitted;
}
function makeDocx(people,issued=dataEmissaoAtual()){
  const wordNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const documentXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${wordNS}"><w:body>${people.map((e,i)=>receiptWordXml(e,i,issued)).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const docRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${wordNS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:style></w:styles>`;
  return makeZip([['[Content_Types].xml',types],['_rels/.rels',rels],['word/document.xml',documentXml],['word/_rels/document.xml.rels',docRels],['word/styles.xml',styles]]);
}
function dataDeEmissao(){
  const dia=dataEmissaoAtual();
  if(!dateUTC(dia)){toast('Escolha um mês e ano válidos para a emissão.');return null;}
  state.config.emissao=dia;
  persist();
  return dia;
}
function exportDocx(){const p=prepareExport();if(!p)return;const issued=dataDeEmissao();if(!issued)return;downloadBlob(makeDocx(p,issued),`RECIBOS_${loteBase()}.docx`,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');saveLot(true);toast(`Arquivo Word com ${p.length} recibo(s) gerado.`);}
function exportIndividual(e){const p=prepareExport([e]);if(!p)return;const issued=dataDeEmissao();if(!issued)return;downloadBlob(makeDocx(p,issued),`RECIBO_${filename(e.nome)}_${fmtDate(receiptPeriod(e)[0]).replaceAll('/','-')}_A_${fmtDate(receiptPeriod(e)[1]).replaceAll('/','-')}.docx`,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');saveLot(true);toast('Recibo individual gerado.');}
function exportCSV(){const p=prepareExport();if(!p)return;downloadBlob(csvContent(p),`RESUMO_VALES_${loteBase()}.csv`,'text/csv;charset=utf-8');saveLot(true);toast('Resumo CSV gerado.');}
function exportZIP(){const p=prepareExport();if(!p)return;const issued=dataDeEmissao();if(!issued)return;const entries=[];entries.push([`RECIBOS_CONSOLIDADOS_${loteBase()}.docx`,makeDocx(p,issued)]);for(let i=0;i<p.length;i++){const e=p[i];entries.push([`RECIBOS_INDIVIDUAIS/${String(i+1).padStart(2,'0')}_${filename(e.nome)}.docx`,makeDocx([e],issued)]);}entries.push([`RESUMO_VALES_${loteBase()}.csv`,csvContent(p)]);entries.push(['BACKUP_LOTE.json',JSON.stringify(state,null,2)]);downloadBlob(makeZip(entries),`GESTOR_VALES_${loteBase()}.zip`,'application/zip');saveLot(true);toast(`Pacote pronto: ${p.length} recibos individuais, Word consolidado e resumo.`);}
function openPrint(){const p=prepareExport();if(!p)return;const issueDate=dataDeEmissao();if(!issueDate)return;const w=window.open('','_blank');if(!w){toast('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.');return;}
const receiptHtml=p.map(e=>{const c=calcEmp(e),value=brl(c.total),period=receiptPeriod(e);return `<section class="page"><h1>RECIBO</h1><p class="amount">${htmlEscape(value)}</p><p class="content">Eu, <b>${htmlEscape(e.nome)}</b>, recebi da empresa ${htmlEscape(state.config.empresa)} a importância de ${htmlEscape(value)} (${htmlEscape(valorExtenso(c.total))}), referente a ${htmlEscape(state.config.descricao)} do dia ${fmtDate(period[0])} à ${fmtDate(period[1])}.</p><div class="signature"><div>____________________________________________</div><b>${htmlEscape(e.nome)}</b><div>${htmlEscape(state.config.cidade)}</div><div>${htmlEscape(fullDate(issueDate))}</div></div></section>`;}).join('');
w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibos de benefícios</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;font:12pt Arial,sans-serif;color:black}.page{page-break-after:always;break-after:page;min-height:250mm}.page:last-child{page-break-after:auto;break-after:auto}h1{text-align:center;font-size:16pt;margin:0 0 25pt}.amount{text-align:right;font-size:14pt;font-weight:bold;margin:0 0 30pt}.content{line-height:1.35;text-align:justify;margin:0}.signature{margin-top:75pt;text-align:center;line-height:1.5}.signature b{display:block}@media screen{body{background:#eee}.page{width:210mm;min-height:297mm;margin:18px auto;background:white;padding:15mm;box-shadow:0 8px 20px #bbb}}</style></head><body>${receiptHtml}<script>window.onload=function(){setTimeout(function(){window.print()},250)};<\/script></body></html>`);
w.document.close();saveLot(true);toast('Janela de impressão aberta. Selecione “Salvar como PDF” para gerar PDF.');
}

function modalCount(){const count=modalSelection.size;byId('modal-selection-count').textContent=`${count} funcionário(s) selecionado(s)`;byId('modal-confirmar').disabled=count===0;}
function renderModal(){
 byId('modal-employee-list').innerHTML=state.employees.length?state.employees.map(e=>`<label class="modal-person"><input type="checkbox" data-modal-worker="${htmlEscape(e.id)}" ${modalSelection.has(e.id)?'checked':''}><span class="modal-person-name"><b>${htmlEscape(e.nome)}</b><small>${assigned(e)?'Já tem dias definidos · pode substituir com confirmação':'Pendente · sem dias definidos'}</small></span><span class="status-pill ${assigned(e)?'done':'pending'}">${assigned(e)?'Definido':'Pendente'}</span></label>`).join(''):'<p class="hint">Não foi possível carregar a lista fixa de funcionários.</p>';
 const count=calendarSelected().length;byId('modal-info').textContent=`${count} dia(s) marcado(s) no calendário · ${brl(calendarSelected().filter(d=>!holidaysSet().has(d)).length*(cents(state.config.vt)+cents(state.config.aa)))} por funcionário antes de ajustes individuais.`;modalCount();
}
function openApplyModal(){
 if(!calendarSelected().length){toast('Selecione pelo menos um dia no calendário.');return;}
 if(!state.employees.length){toast('Lista de funcionários indisponível. Verifique se funcionarios.js foi publicado.');return;}
 modalSelection=new Set();
 for(const e of state.employees.filter(e=>!assigned(e)))modalSelection.add(e.id);
 renderModal();byId('modal-aplicar').hidden=false;document.body.classList.add('modal-open');byId('modal-confirmar').focus();
}
function closeApplyModal(){byId('modal-aplicar').hidden=true;document.body.classList.remove('modal-open');}
function confirmApply(){
 if(!modalSelection.size){toast('Selecione ao menos um funcionário.');return;}
 const dates=calendarSelected();if(!dates.length){toast('Marque dias no calendário antes de aplicar.');return;}
 const overwrite=state.employees.filter(e=>modalSelection.has(e.id)&&assigned(e));
 if(overwrite.length&&!window.confirm(`Você selecionou ${overwrite.length} funcionário(s) com dias já definidos. Substituir as datas antigas pelos ${dates.length} dias do calendário?`))return;
 let count=0;for(const e of state.employees){if(!modalSelection.has(e.id))continue;
   e.diasSelecionados=[...dates];e.inicio=dates[0];e.fim=dates[dates.length-1];e.statusDistribuicao='definido';e.active=true;
   e.vt=FIXED_VT;e.aa=FIXED_AA;e.diasManual='';e.descontos='0';e.feriasInicio='';e.feriasFim='';e.observacao='';count++;
 }
 miniDrafts.clear();closeApplyModal();persist();renderCalendar();renderEmployees();toast(`${dates.length} dias aplicados a ${count} funcionário(s). Os demais permanecem sem alteração.`);
}
function bind(){
 fillSettings();renderEmployees();renderRecoveryBanner();
  byId('btn-recover-session').addEventListener('click',()=>{const saved=readTimed(DRAFT_KEY);if(!saved||!meaningfulDraft(saved.draft)){renderRecoveryBanner();toast('O prazo da sessão anterior terminou.');return;}applyDraft(saved.draft);sessionTouched=true;fillSettings();persist();renderEmployees();toast('Sessão recuperada com os dias e funcionários da última atividade.');});
  byId('btn-dismiss-session').addEventListener('click',()=>{try{localStorage.removeItem(DRAFT_KEY);}catch(e){}renderRecoveryBanner();toast('Recuperação anterior descartada.');});
  setInterval(renderRecoveryBanner,30000);
 const alterarEmissao=()=>{
   const mes=byId('emissao-mes').value,ano=byId('emissao-ano').value.trim();
   if(!/^(0[1-9]|1[0-2])$/.test(mes)||!/^\d{4}$/.test(ano)||Number(ano)<1900||Number(ano)>2100){
     toast('Informe um mês e ano válidos para o recibo.');renderEmissao();return;
   }
   state.config.emissaoAuto=false;
   state.config.emissao=`${ano}-${mes}-20`;
   persist();renderEmissao();
 };
 byId('emissao-mes').addEventListener('change',alterarEmissao);
 byId('emissao-ano').addEventListener('change',alterarEmissao);


 byId('calendar-grid').addEventListener('click',ev=>{const btn=ev.target.closest('[data-cal-date]');if(!btn)return;const day=btn.dataset.calDate,sel=new Set(calendarSelected());if(sel.has(day))sel.delete(day);else sel.add(day);state.config.diasLote=[...sel].sort();persist();renderCalendar();});
 byId('mes-anterior').addEventListener('click',()=>changeMonth(-1));byId('mes-proximo').addEventListener('click',()=>changeMonth(1));
 byId('btn-uteis').addEventListener('click',()=>{const [y,m]=calendarMonth().split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate(),days=new Set(calendarSelected());for(let d=1;d<=last;d++){const dt=new Date(Date.UTC(y,m-1,d,12));if(dt.getUTCDay()>0&&dt.getUTCDay()<6)days.add(dateISO(dt));}state.config.diasLote=[...days].sort();persist();renderCalendar();});
 byId('btn-limpar-dias').addEventListener('click',()=>{state.config.diasLote=[];persist();renderCalendar();});

 byId('btn-aplicar').addEventListener('click',openApplyModal);
 byId('modal-fechar').addEventListener('click',closeApplyModal);byId('modal-cancelar').addEventListener('click',closeApplyModal);
 byId('modal-aplicar').addEventListener('click',ev=>{if(ev.target===byId('modal-aplicar'))closeApplyModal();});
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!byId('modal-aplicar').hidden)closeApplyModal();});
 byId('modal-employee-list').addEventListener('change',ev=>{const input=ev.target.closest('[data-modal-worker]');if(!input)return;if(input.checked)modalSelection.add(input.dataset.modalWorker);else modalSelection.delete(input.dataset.modalWorker);modalCount();});
 byId('modal-pendentes').addEventListener('click',()=>{modalSelection=new Set(state.employees.filter(e=>!assigned(e)).map(e=>e.id));renderModal();});
 byId('modal-todos').addEventListener('click',()=>{modalSelection=new Set(state.employees.map(e=>e.id));renderModal();});
 byId('modal-nenhum').addEventListener('click',()=>{modalSelection.clear();renderModal();});byId('modal-confirmar').addEventListener('click',confirmApply);
 byId('search').addEventListener('input',()=>{miniDrafts.clear();renderEmployees();});
 document.querySelectorAll('.filter-pill').forEach(b=>b.addEventListener('click',()=>{miniDrafts.clear();employeeFilter=b.dataset.filter;renderEmployees();}));
 byId('select-all').addEventListener('change',e=>{for(const p of state.employees)if(assigned(p))p.active=e.target.checked;persist();renderEmployees();});
 byId('employee-list').addEventListener('toggle',ev=>{
  const card=ev.target.closest('details[data-worker-id]');if(!card||ev.target!==card)return;
  const emp=state.employees.find(p=>p.id===card.dataset.workerId);if(!emp)return;
  if(card.open)renderMiniCalendar(emp);
  else miniDrafts.delete(emp.id); // Sair sem Aplicar descarta a edição não confirmada.
 },true);
 byId('employee-list').addEventListener('click',ev=>{
  if(ev.target.classList.contains('employee-check'))ev.stopPropagation();
  const btn=ev.target.closest('[data-action]');if(!btn)return;
  const card=btn.closest('[data-worker-id]');const person=state.employees.find(p=>p.id===card?.dataset.workerId);if(!person)return;
  const action=btn.dataset.action;
  if(action==='individual'){exportIndividual(person);return;}
  if(action==='mini-apply'){applyMiniCalendar(person);return;}
  if(action==='mini-prev'||action==='mini-next'){
   const d=ensureMiniDraft(person);d.month=shiftMiniMonth(d.month,action==='mini-prev'?-1:1);renderMiniCalendar(person);return;
  }
  if(action==='mini-day'){
   const d=ensureMiniDraft(person),day=btn.dataset.date;const dates=new Set(d.dates);
   dates.has(day)?dates.delete(day):dates.add(day);d.dates=uniqueDates([...dates]);renderMiniCalendar(person);return;
  }
 });
 byId('employee-list').addEventListener('change',ev=>{
  if(!ev.target.classList.contains('employee-check'))return;
  const card=ev.target.closest('[data-worker-id]');const emp=state.employees.find(p=>p.id===card?.dataset.workerId);
  if(!emp||!assigned(emp))return;
  emp.active=ev.target.checked;persist();updateTotals();
 });
 byId('btn-docx').addEventListener('click',exportDocx);byId('btn-print').addEventListener('click',openPrint);

}

if(typeof document!=='undefined')bind();
// Exporta funções puras para testes de integridade em ambiente Node.js (sem afetar navegador).
if(typeof module!=='undefined'&&module.exports){module.exports={makeZip,makeDocx,receiptPeriod,hojeISO,calcEmp,cents,numeroExtenso,valorExtenso,dateUTC,fmtDate,csvContent,defaultState,setState:(v)=>{state=v;},getState:()=>state,dataEmissaoAtual,mesAnoEmissao,validateState,fullDate,commitIndividualDays,uniqueDates,createDraft,meaningfulDraft};}
