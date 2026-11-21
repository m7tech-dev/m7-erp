/* Etapa 19: consulta de contas a pagar e pagamentos parciais idempotentes. */
(() => {
  if (typeof sb === "undefined" || typeof S === "undefined") return;
  const $a = id => document.getElementById(id);
  const canAccess = () => ["owner", "admin", "manager", "stock_operator"].includes(activeCompanyRole);
  const canPay = () => ["owner", "admin", "manager"].includes(activeCompanyRole);
  const money = n => R(Number(n || 0));
  const escA = s => esc(String(s ?? ""));
  const removePending = op => {
    const previous = S.purchase_pending || [];
    S.purchase_pending = previous.filter(x => x.operation_id !== op);
    try {
      const serialized = JSON.stringify(S);
      localStorage.setItem(activeStorageKey, serialized);
      if (localStorage.getItem(activeStorageKey) !== serialized) throw new Error("readback mismatch");
      return true;
    } catch (_) {
      S.purchase_pending = previous;
      toast("O servidor respondeu, mas não foi possível confirmar a atualização local. A operação foi mantida para reconciliação segura; repita os mesmos dados.");
      return false;
    }
  };
  // Confirma a persistência da chave idempotente antes de enviar alterações financeiras.
  function persistPendingOrThrow() {
    try {
      const serialized = JSON.stringify(S);
      localStorage.setItem(activeStorageKey, serialized);
      if (localStorage.getItem(activeStorageKey) !== serialized) throw new Error("A gravação local não pôde ser confirmada.");
    } catch (error) {
      throw new Error("Não foi possível salvar a operação pendente neste aparelho. Libere espaço e tente novamente; nada foi enviado ao servidor.");
    }
  }
  const pending = () => (S.purchase_pending || []).find(x => x.kind === "payable_payment");
  const refundPending = () => (S.purchase_pending || []).find(x => x.kind === "credit_refund");
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const status = (message) => { const el=$a("purchase-payables-status"); if(el) el.textContent=message; };
  let payables=[], installments=[], payments=[], suppliers=[], credits=[], cancellations=[], refunds=[], activeInstallment=null, activeCredit=null, busy=false;

  async function requireWorkspace(){
    if(!sb||!navigator.onLine) throw new Error("Conecte-se à internet para consultar e pagar fornecedores.");
    const ctx=await getActiveCompany();
    if(!canAccess()) throw new Error("Seu perfil não tem permissão para consultar contas a pagar.");
    return ctx;
  }
  function installmentStatus(i){
    if(i.status==="cancelled") return "Cancelada";
    const remaining=Math.max(0,Number(i.amount)-Number(i.paid_amount));
    if(remaining<=0) return "Quitada";
    if(i.due_date<today()) return "Vencida";
    if(Number(i.paid_amount)>0) return "Parcial";
    return "Em aberto";
  }
  function render(){
    const host=$a("purchase-payables-list"); if(!host)return;
    const supplierMap=new Map(suppliers.map(s=>[s.id,s.name]));
    host.innerHTML=payables.length?payables.map(p=>{
      const rows=installments.filter(i=>i.payable_id===p.id).map(i=>{
        const remaining=Math.max(0,Number(i.amount)-Number(i.paid_amount));
        const label=installmentStatus(i),late=label==="Vencida";
        const history=payments.filter(x=>x.installment_id===i.id).map(x=>`<div class="k">${x.payment_method==="supplier_credit"?"Compensação de crédito":"Pagamento"} ${D(x.paid_at)} · ${money(x.amount)} · ${escA(({cash:"Dinheiro",pix:"Pix",bank_transfer:"Transferência",card:"Cartão",other:"Outro",supplier_credit:"Crédito do fornecedor"})[x.payment_method]||x.payment_method)}${x.notes?` · ${escA(x.notes)}`:""} · responsável ${escA(String(x.created_by||"").slice(0,8))}</div>`).join("");
        const pendingOp=pending();const reconcilePending=pendingOp?.payload?.installment_id===i.id;
        const button=(remaining>0||reconcilePending)&&i.status!=="cancelled"&&p.status!=="cancelled"&&canPay()?`<button class="sm" data-pay-installment="${escA(i.id)}" data-pay-balance="${remaining.toFixed(2)}">${reconcilePending?"Reconciliar pagamento pendente":"Pagar / complementar"}</button>`:"";
        return `<div class="stock-row"><div class="row2" style="justify-content:space-between;align-items:center"><b>${Number(i.installment_number)}/${p.installment_count||installments.filter(x=>x.payable_id===p.id).length}</b><span class="tag ${i.status==="paid"?"t-g":late?"t-r":i.status==="partial"?"t-a":"t-b"}">${label}</span></div><div class="k">Vencimento ${D(i.due_date)} · Parcela ${money(i.amount)} · Pago ${money(i.paid_amount)} · Saldo ${money(remaining)}</div>${history}${button?`<div class="acts">${button}</div>`:""}</div>`;
      }).join("");
      const remaining=Math.max(0,Number(p.total_amount)-Number(p.paid_amount));
      const titleStatus=p.status==="paid"?"Quitado":p.status==="partial"?"Parcial":p.status==="cancelled"?"Cancelado":"Em aberto";
      const cancelBtn=canPay()&&p.status!=="cancelled"&&Number(p.paid_amount)===0?`<button class="sm gh" data-cancel-payable="${escA(p.id)}">Cancelar título sem pagamento</button>`:"";
      const cancellation=cancellations.find(x=>x.payable_id===p.id);
      return `<div class="card"><div class="row2" style="justify-content:space-between;align-items:center"><b>${escA(supplierMap.get(p.supplier_id)||"Fornecedor")} · ${escA(p.description)}</b><span class="tag ${p.status==="paid"?"t-g":p.status==="partial"?"t-a":p.status==="cancelled"?"t-r":"t-b"}">${titleStatus}</span></div><div class="k">Emitido ${D(p.issue_date)} · Total ${money(p.total_amount)} · Pago/compensado ${money(p.paid_amount)} · Saldo ${money(remaining)}</div>${cancellation?`<div class="k">Cancelado em ${D(String(cancellation.cancelled_at||"").slice(0,10))}: ${escA(cancellation.reason)} · responsável ${escA(String(cancellation.cancelled_by||"").slice(0,8))}</div>`:""}${rows||'<div class="empty">Nenhuma parcela encontrada.</div>'}${cancelBtn?`<div class="acts">${cancelBtn}</div>`:""}</div>`;
    }).join(""):'<div class="empty">Nenhuma conta a pagar gerada por recebimentos nesta empresa.</div>';
    const creditHost=$a("purchase-supplier-credits-list");
    if(creditHost) creditHost.innerHTML=canPay()?(credits.length?credits.map(c=>{const left=Math.max(0,Number(c.credit_amount)-Number(c.applied_amount)-Number(c.refunded_amount));return `<div class="stock-row"><div class="row2" style="justify-content:space-between"><b>${escA(supplierMap.get(c.supplier_id)||"Fornecedor")} · Crédito ${money(c.credit_amount)}</b><span class="tag ${left>0?"t-a":"t-g"}">Disponível ${money(left)}</span></div><div class="k">Aplicado ${money(c.applied_amount)} · Reembolsado ${money(c.refunded_amount)} · ${D(String(c.created_at||"").slice(0,10))}</div>${left>0?`<div class="acts"><button class="sm" data-apply-credit="${escA(c.id)}">Compensar em parcela</button><button class="sm gh" data-refund-credit="${escA(c.id)}">Registrar reembolso</button></div>`:""}${refunds.filter(r=>r.supplier_credit_id===c.id).map(r=>`<div class="k">Reembolso ${D(r.refunded_at)} · ${money(r.amount)} · ${escA(({cash:"Dinheiro",pix:"Pix",bank_transfer:"Transferência",card:"Cartão",other:"Outro"})[r.payment_method]||r.payment_method)}${r.notes?` · ${escA(r.notes)}`:""}</div>`).join("")}</div>`;}).join(""):'<div class="empty">Nenhum crédito de fornecedor disponível.</div>'):'<div class="k">Créditos visíveis apenas para owner, admin e manager.</div>';
  }
  async function refresh(){
    try{
      const {companyId}=await requireWorkspace();
      status("Carregando títulos, parcelas e pagamentos…");
      [payables,suppliers]=await Promise.all([
        fetchPagedRows(()=>sb.from("purchase_payables").select("id,supplier_id,purchase_order_id,receipt_id,issue_date,description,total_amount,paid_amount,status,created_at").eq("company_id",companyId).order("issue_date",{ascending:false}).order("id",{ascending:false})),
        fetchPagedRows(()=>sb.from("suppliers").select("id,name").eq("company_id",companyId).order("name"))
      ]);
      credits=canPay()?await fetchPagedRows(()=>sb.from("purchase_supplier_credits").select("id,supplier_id,return_id,credit_amount,applied_amount,refunded_amount,status,created_at").eq("company_id",companyId).order("created_at",{ascending:false})):[];
      refunds=canPay()?await fetchPagedRows(()=>sb.from("purchase_supplier_credit_refunds").select("id,supplier_credit_id,operation_id,amount,payment_method,refunded_at,notes,created_by,created_at").eq("company_id",companyId).order("refunded_at",{ascending:false}).order("created_at",{ascending:false})):[];
      cancellations=canPay()?await fetchPagedRows(()=>sb.from("purchase_payable_cancellations").select("id,payable_id,reason,cancelled_by,cancelled_at").eq("company_id",companyId).order("cancelled_at",{ascending:false})):[];
      const ids=payables.map(p=>p.id);installments=[];payments=[];
      for(let i=0;i<ids.length;i+=100){const chunk=ids.slice(i,i+100);installments.push(...await fetchPagedRows(()=>sb.from("purchase_payable_installments").select("id,payable_id,installment_number,due_date,amount,paid_amount,status").eq("company_id",companyId).in("payable_id",chunk).order("due_date").order("installment_number")));}
      const installmentIds=installments.map(i=>i.id);
      for(let i=0;i<installmentIds.length;i+=100){const chunk=installmentIds.slice(i,i+100);payments.push(...await fetchPagedRows(()=>sb.from("purchase_payable_payments").select("id,payable_id,installment_id,operation_id,payment_method,supplier_credit_id,amount,paid_at,notes,created_by,created_at").eq("company_id",companyId).in("installment_id",chunk).order("paid_at").order("created_at")));}
      render();
      const open=installments.filter(i=>i.status!=="cancelled"&&Number(i.amount)>Number(i.paid_amount));
      const overdue=open.filter(i=>i.due_date<today()).length;
      status(`${payables.length} título(s) · ${open.length} parcela(s) em aberto · ${overdue} vencida(s).`);
    }catch(e){status("Não foi possível carregar contas a pagar: "+(e.message||"erro"));}
  }
  function openPayment(id,balance){
    const item=installments.find(x=>x.id===id);if(!item)return;
    const p=payables.find(x=>x.id===item.payable_id);if(!p)return;
    const pend=pending();if(pend&&pend.payload?.installment_id!==id){status("Existe um pagamento pendente. Reconcilie a mesma parcela antes de iniciar outro.");return;}
    activeInstallment=item;
    const restore=pend?.payload;
    $a("purchase-payable-payment-title").textContent=`${supplierName(p.supplier_id)} · Parcela ${item.installment_number} · Saldo ${money(balance)}`;
    $a("purchase-payable-payment-amount").value=restore?.amount??Number(balance).toFixed(2);
    $a("purchase-payable-payment-date").value=restore?.paid_at||today();
    $a("purchase-payable-payment-method").value=restore?.payment_method||"cash";
    $a("purchase-payable-payment-notes").value=restore?.notes||"";
    $a("purchase-payable-payment-status").textContent=pend?"Pagamento pendente. Repita exatamente os mesmos dados para reconciliar.":"O pagamento será registrado no histórico e não poderá ser apagado.";
    $a("purchase-payable-payment-save").disabled=false;
    $a("purchase-payable-payment-dlg").showModal();
  }
  function supplierName(id){return suppliers.find(s=>s.id===id)?.name||"Fornecedor";}
  async function savePayment(){
    if(busy||!activeInstallment)return;
    const btn=$a("purchase-payable-payment-save");btn.disabled=true;busy=true;
    try{
      const {companyId}=await requireWorkspace();
      const amount=Number($a("purchase-payable-payment-amount").value),method=$a("purchase-payable-payment-method").value,paidAt=$a("purchase-payable-payment-date").value,notes=$a("purchase-payable-payment-notes").value.trim()||null;
      if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)!==amount*100)throw new Error("Informe um valor positivo com até duas casas decimais.");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)||paidAt>today())throw new Error("Informe uma data de pagamento válida.");
      if(notes&&notes.length>500)throw new Error("A observação pode ter até 500 caracteres.");
      const payload={installment_id:activeInstallment.id,amount:Number(amount.toFixed(2)),payment_method:method,paid_at:paidAt,notes};
      let op=pending();
      if(op&&!same(op.payload,payload))throw new Error("Existe um pagamento pendente. Repita exatamente os mesmos dados antes de iniciar outro.");
      if(!op){op={kind:"payable_payment",operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(op);save();}
      $a("purchase-payable-payment-status").textContent="Confirmando pagamento no servidor…";
      persistPendingOrThrow();
      const {data,error}=await sb.rpc("register_purchase_payable_payment_v1",{p_company_id:companyId,p_installment_id:payload.installment_id,p_operation_id:op.operation_id,p_amount:payload.amount,p_payment_method:payload.payment_method,p_paid_at:payload.paid_at,p_notes:payload.notes});
      if(error){if(error.code)removePending(op.operation_id);throw error;}
      const result=Array.isArray(data)?data[0]:data;if(!result?.payment_id)throw new Error("O servidor não confirmou o pagamento.");
      removePending(op.operation_id);$a("purchase-payable-payment-dlg").close();
      status(result.already_processed?"Pagamento já confirmado anteriormente e reconciliado.":`Pagamento registrado. Saldo da parcela: ${money(result.remaining_amount)}.`);
      await refresh();
    }catch(e){$a("purchase-payable-payment-status").textContent="Pagamento não confirmado. Se houve falha de conexão, mantenha os mesmos dados e tente novamente: "+(e.message||"erro");}
    finally{busy=false;btn.disabled=false;}
  }
  function openCreditApply(id){
    const c=credits.find(x=>x.id===id);if(!c)return;activeCredit=c;
    const supplier=suppliers.find(x=>x.id===c.supplier_id)?.name||"Fornecedor";
    const options=installments.filter(i=>{const p=payables.find(x=>x.id===i.payable_id);return p&&p.supplier_id===c.supplier_id&&p.status!=="cancelled"&&Number(i.amount)>Number(i.paid_amount);});
    const sel=$a("purchase-credit-installment");sel.innerHTML=options.map(i=>{const p=payables.find(x=>x.id===i.payable_id);return `<option value="${escA(i.id)}">${escA(p.description)} · parcela ${i.installment_number} · saldo ${money(Number(i.amount)-Number(i.paid_amount))}</option>`;}).join("");
    if(!options.length){status("Não há parcelas em aberto para este fornecedor.");return;}
    $a("purchase-credit-apply-title").textContent=`${supplier} · Crédito disponível ${money(Number(c.credit_amount)-Number(c.applied_amount)-Number(c.refunded_amount))}`;
    $a("purchase-credit-amount").value="";$a("purchase-credit-date").value=today();$a("purchase-credit-notes").value="";$a("purchase-credit-status").textContent="A compensação quita saldo sem movimentar dinheiro ou caixa.";$a("purchase-credit-apply-dlg").showModal();
  }
  async function saveCreditApply(){
    if(busy||!activeCredit)return;const btn=$a("purchase-credit-save");btn.disabled=true;busy=true;
    try{const {companyId}=await requireWorkspace();const payload={credit_id:activeCredit.id,installment_id:$a("purchase-credit-installment").value,amount:Number($a("purchase-credit-amount").value),applied_at:$a("purchase-credit-date").value,notes:$a("purchase-credit-notes").value.trim()||null};
      if(!payload.installment_id||!Number.isFinite(payload.amount)||payload.amount<=0||Math.round(payload.amount*100)!==payload.amount*100)throw new Error("Informe parcela e valor válido com até duas casas decimais.");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.applied_at)||payload.applied_at>today())throw new Error("Data de compensação inválida.");
      let op=(S.purchase_pending||[]).find(x=>x.kind==="payable_credit");if(op&&!same(op.payload,payload))throw new Error("Existe uma compensação pendente. Repita os mesmos dados para reconciliar.");if(!op){op={kind:"payable_credit",operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(op);save();}
      $a("purchase-credit-status").textContent="Confirmando compensação…";
      persistPendingOrThrow();
      const {data,error}=await sb.rpc("apply_purchase_supplier_credit_v1",{p_company_id:companyId,p_credit_id:payload.credit_id,p_installment_id:payload.installment_id,p_operation_id:op.operation_id,p_amount:payload.amount,p_applied_at:payload.applied_at,p_notes:payload.notes});
      if(error){if(error.code)removePending(op.operation_id);throw error;}const result=Array.isArray(data)?data[0]:data;if(!result?.payment_id)throw new Error("Servidor não confirmou a compensação.");removePending(op.operation_id);$a("purchase-credit-apply-dlg").close();status(result.already_processed?"Compensação anterior reconciliada.":`Crédito aplicado. Saldo restante do crédito: ${money(result.remaining_credit)}.`);await refresh();
    }catch(e){$a("purchase-credit-status").textContent="Compensação não confirmada. Preserve os mesmos dados para reconciliar: "+(e.message||"erro");}finally{busy=false;btn.disabled=false;}
  }

  function openCreditRefund(id){
    const c=credits.find(x=>x.id===id);if(!c)return;activeCredit=c;
    const left=Math.max(0,Number(c.credit_amount)-Number(c.applied_amount)-Number(c.refunded_amount));
    const pend=refundPending();if(pend&&pend.payload?.credit_id!==id){status("Existe um reembolso pendente. Reconcilie o mesmo crédito antes de iniciar outro.");return;}
    $a("purchase-credit-refund-title").textContent=`${supplierName(c.supplier_id)} · Saldo disponível ${money(left)}`;
    $a("purchase-credit-refund-amount").value=pend?.payload?.amount??left.toFixed(2);
    $a("purchase-credit-refund-date").value=pend?.payload?.refunded_at||today();
    $a("purchase-credit-refund-method").value=pend?.payload?.payment_method||"cash";
    $a("purchase-credit-refund-notes").value=pend?.payload?.notes||"";
    $a("purchase-credit-refund-status").textContent=pend?"Reembolso pendente. Repita os mesmos dados para reconciliar.":"Registre somente o valor efetivamente recebido do fornecedor. O lançamento não pode ser apagado.";
    $a("purchase-credit-refund-dlg").showModal();
  }
  async function saveCreditRefund(){
    if(busy||!activeCredit)return;const btn=$a("purchase-credit-refund-save");btn.disabled=true;busy=true;
    try{
      const {companyId}=await requireWorkspace();
      const payload={credit_id:activeCredit.id,amount:Number($a("purchase-credit-refund-amount").value),payment_method:$a("purchase-credit-refund-method").value,refunded_at:$a("purchase-credit-refund-date").value,notes:$a("purchase-credit-refund-notes").value.trim()||null};
      if(!Number.isFinite(payload.amount)||payload.amount<=0||Math.round(payload.amount*100)!==payload.amount*100)throw new Error("Informe valor positivo com até duas casas decimais.");
      if(!["cash","pix","bank_transfer","card","other"].includes(payload.payment_method))throw new Error("Forma de reembolso inválida.");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.refunded_at)||payload.refunded_at>today())throw new Error("Data do reembolso inválida.");
      let op=refundPending();if(op&&!same(op.payload,payload))throw new Error("Existe um reembolso pendente. Repita exatamente os mesmos dados para reconciliar.");
      if(!op){op={kind:"credit_refund",operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(op);save();}
      $a("purchase-credit-refund-status").textContent="Confirmando reembolso…";
      persistPendingOrThrow();
      const {data,error}=await sb.rpc("refund_purchase_supplier_credit_v1",{p_company_id:companyId,p_credit_id:payload.credit_id,p_operation_id:op.operation_id,p_amount:payload.amount,p_payment_method:payload.payment_method,p_refunded_at:payload.refunded_at,p_notes:payload.notes});
      if(error){if(error.code)removePending(op.operation_id);throw error;}
      const result=Array.isArray(data)?data[0]:data;if(!result?.refund_id)throw new Error("Servidor não confirmou o reembolso.");
      removePending(op.operation_id);$a("purchase-credit-refund-dlg").close();status(result.already_processed?"Reembolso anterior reconciliado.":`Reembolso registrado. Saldo restante do crédito: ${money(result.remaining_credit)}.`);await refresh();
    }catch(e){$a("purchase-credit-refund-status").textContent="Reembolso não confirmado. Preserve os mesmos dados para reconciliar: "+(e.message||"erro");}
    finally{busy=false;btn.disabled=false;}
  }
  async function cancelPayable(id){if(busy)return;const p=payables.find(x=>x.id===id);if(!p)return;if(!confirm("Cancelar este título? Só é permitido quando não há pagamentos nem compensações."))return;const reason=prompt("Informe o motivo do cancelamento (3 a 500 caracteres):");if(reason===null)return;if(reason.trim().length<3||reason.trim().length>500){status("Motivo inválido.");return;}busy=true;try{const {companyId}=await requireWorkspace();const payload={payable_id:id,reason:reason.trim()};let op=(S.purchase_pending||[]).find(x=>x.kind==="payable_cancel");if(op&&!same(op.payload,payload))throw new Error("Existe cancelamento pendente. Reconcilie-o antes de iniciar outro.");if(!op){op={kind:"payable_cancel",operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(op);save();}persistPendingOrThrow();const {data,error}=await sb.rpc("cancel_purchase_payable_v1",{p_company_id:companyId,p_payable_id:id,p_operation_id:op.operation_id,p_reason:payload.reason});if(error){if(error.code)removePending(op.operation_id);throw error;}const result=Array.isArray(data)?data[0]:data;if(!result?.cancellation_id)throw new Error("Servidor não confirmou cancelamento.");removePending(op.operation_id);status(result.already_processed?"Cancelamento anterior reconciliado.":"Título cancelado e registrado no histórico.");await refresh();}catch(e){status("Cancelamento não confirmado: "+(e.message||"erro"));}finally{busy=false;}}
  $a("purchase-payables-list").addEventListener("click",event=>{const b=event.target.closest("[data-pay-installment]");if(b)openPayment(b.dataset.payInstallment,Number(b.dataset.payBalance));const c=event.target.closest("[data-cancel-payable]");if(c)cancelPayable(c.dataset.cancelPayable);});
  $a("purchase-supplier-credits-list").addEventListener("click",event=>{const b=event.target.closest("[data-apply-credit]");if(b)openCreditApply(b.dataset.applyCredit);const r=event.target.closest("[data-refund-credit]");if(r)openCreditRefund(r.dataset.refundCredit);});
  $a("purchase-credit-save").addEventListener("click",saveCreditApply);$a("purchase-credit-close").addEventListener("click",()=>$a("purchase-credit-apply-dlg").close());
  $a("purchase-credit-refund-save").addEventListener("click",saveCreditRefund);$a("purchase-credit-refund-close").addEventListener("click",()=>$a("purchase-credit-refund-dlg").close());
  $a("purchase-payable-payment-save").addEventListener("click",savePayment);
  $a("purchase-payable-payment-close").addEventListener("click",()=>$a("purchase-payable-payment-dlg").close());
  document.addEventListener("m7:purchase-updated",refresh);
  if(pending()){const p=pending();if(p.payload?.installment_id){const old=$a("purchase-payables-status");if(old)old.textContent="Existe um pagamento pendente. Abra a mesma parcela para reconciliar a operação.";}}
})();
