/* M7 ERP Etapa 20A: devoluções vinculadas a recebimentos, com crédito auditável. */
(() => {
  if (typeof sb === "undefined" || typeof S === "undefined") return;
  const $r = id => document.getElementById(id);
  const allowed = () => ["owner", "admin", "manager", "stock_operator"].includes(activeCompanyRole);
  const money = n => R(Number(n || 0));
  const qty = n => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const escR = s => esc(String(s ?? ""));
  const pending = () => (S.purchase_pending || []).find(x => x.kind === "purchase_return");
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
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
      toast("O servidor respondeu, mas não foi possível confirmar a atualização local. A devolução foi mantida para reconciliação segura; repita os mesmos dados.");
      return false;
    }
  };
  // Confirma a persistência da chave idempotente antes de registrar a devolução.
  function persistPendingOrThrow() {
    try {
      const serialized = JSON.stringify(S);
      localStorage.setItem(activeStorageKey, serialized);
      if (localStorage.getItem(activeStorageKey) !== serialized) throw new Error("A gravação local não pôde ser confirmada.");
    } catch (error) {
      throw new Error("Não foi possível salvar a devolução pendente neste aparelho. Libere espaço e tente novamente; nada foi enviado ao servidor.");
    }
  }
  let receipts=[], receiptItems=[], returns=[], returnItems=[], suppliers=[], selectedReceipt=null, busy=false;
  const status = message => { const el=$r("purchase-returns-status"); if(el) el.textContent=message; };
  async function requireWorkspace(){
    if(!sb||!navigator.onLine) throw new Error("Conecte-se à internet para registrar devoluções.");
    const ctx=await getActiveCompany();
    if(!allowed()) throw new Error("Seu perfil não tem permissão para registrar devoluções.");
    return ctx;
  }
  function returnedQty(receiptItemId){return returnItems.filter(x=>x.receipt_item_id===receiptItemId).reduce((sum,x)=>sum+Number(x.quantity),0);}
  function renderReceiptOptions(){
    const select=$r("purchase-return-receipt"); if(!select)return;
    const pendingOp=pending();const previous=select.value||selectedReceipt;
    select.innerHTML='<option value="">Selecione um recebimento</option>'+receipts.map(x=>{
      const supplier=suppliers.find(s=>s.id===x.supplier_id)?.name||"Fornecedor";
      return `<option value="${escR(x.id)}">${escR(supplier)} · ${D(x.receipt_date)} · ${money(x.total_cost)} · ${x.id.slice(0,8).toUpperCase()}</option>`;
    }).join("");
    if(pendingOp?.payload?.receipt_id)select.value=pendingOp.payload.receipt_id;else if(previous&&receipts.some(x=>x.id===previous))select.value=previous;
    selectedReceipt=select.value;
  }
  function renderReceiptItems(){
    const host=$r("purchase-return-items");if(!host)return;
    const pendingOp=pending();const restore=pendingOp?.payload;
    const rows=receiptItems.filter(x=>x.receipt_id===selectedReceipt);
    host.innerHTML=rows.length?rows.map(i=>{
      const remaining=Math.max(0,Number(i.quantity)-returnedQty(i.id));
      const old=restore?.receipt_id===selectedReceipt?restore.items.find(x=>x.receipt_item_id===i.id):null;
      return `<div class="stock-row"><b>${escR(i.product_name||"Produto")}</b><div class="k">Recebido ${qty(i.quantity)} · já devolvido ${qty(returnedQty(i.id))} · disponível ${qty(remaining)} · custo ${money(i.unit_cost)}/un</div><label>Quantidade a devolver</label><input type="number" min="0" max="${old?Math.max(remaining,Number(old.quantity)):remaining}" step="0.001" inputmode="decimal" data-return-item="${escR(i.id)}" value="${old?escR(old.quantity):""}" ${remaining<=0&&!old?"disabled":""}></div>`;
    }).join(""):'<div class="empty">Selecione um recebimento com itens disponíveis para devolução.</div>';
    if(restore?.receipt_id===selectedReceipt){$r("purchase-return-date").value=restore.return_date;$r("purchase-return-reason").value=restore.reason;}
  }
  function renderHistory(){
    const host=$r("purchase-returns-history");if(!host)return;
    const supplierMap=new Map(suppliers.map(s=>[s.id,s.name]));
    host.innerHTML=returns.length?returns.map(ret=>{
      const detail=returnItems.filter(i=>i.return_id===ret.id).map(i=>`<div class="k">${qty(i.quantity)} un · ${money(i.total_credit)} · custo médio ${i.cost_before==null?"sem base":money(i.cost_before)} → ${i.cost_after==null?"zerado":money(i.cost_after)}</div>`).join("");
      return `<div class="stock-row"><div class="row2" style="justify-content:space-between"><b>${escR(supplierMap.get(ret.supplier_id)||"Fornecedor")} · ${D(ret.return_date)}</b><span class="tag t-a">Crédito ${money(ret.total_credit)}</span></div><div class="k">Devolução ${ret.id.slice(0,8).toUpperCase()} · ${qty(ret.total_quantity)} unidade(s) · ${escR(ret.reason)}</div>${detail}</div>`;
    }).join(""):'<div class="empty">Nenhuma devolução registrada nesta empresa.</div>';
  }
  async function refresh(){
    try{
      const {companyId}=await requireWorkspace();status("Carregando recebimentos e devoluções…");
      [suppliers,receipts,returns]=await Promise.all([
        fetchPagedRows(()=>sb.from("suppliers").select("id,name").eq("company_id",companyId).order("name")),
        fetchPagedRows(()=>sb.from("purchase_receipts").select("id,purchase_order_id,receipt_date,total_cost,reason,created_at").eq("company_id",companyId).order("receipt_date",{ascending:false}).order("id",{ascending:false})),
        fetchPagedRows(()=>sb.from("purchase_returns").select("id,receipt_id,supplier_id,return_date,reason,total_quantity,total_credit,created_at").eq("company_id",companyId).order("return_date",{ascending:false}).order("created_at",{ascending:false}))
      ]);
      const orderIds=[...new Set(receipts.map(x=>x.purchase_order_id))];let orders=[];
      for(let i=0;i<orderIds.length;i+=100){const chunk=orderIds.slice(i,i+100);orders.push(...await fetchPagedRows(()=>sb.from("purchase_orders").select("id,supplier_id").eq("company_id",companyId).in("id",chunk)));}
      const orderSupplier=new Map(orders.map(x=>[x.id,x.supplier_id]));receipts.forEach(x=>x.supplier_id=orderSupplier.get(x.purchase_order_id));
      const receiptIds=receipts.map(x=>x.id);receiptItems=[];
      for(let i=0;i<receiptIds.length;i+=100){const chunk=receiptIds.slice(i,i+100);receiptItems.push(...await fetchPagedRows(()=>sb.from("purchase_receipt_items").select("id,receipt_id,product_id,quantity,unit_cost,total_cost").eq("company_id",companyId).in("receipt_id",chunk).order("id")));}
      const productIds=[...new Set(receiptItems.map(x=>x.product_id))];let products=[];
      for(let i=0;i<productIds.length;i+=100){const chunk=productIds.slice(i,i+100);products.push(...await fetchPagedRows(()=>sb.from("products").select("id,name").eq("company_id",companyId).in("id",chunk)));}
      const productMap=new Map(products.map(x=>[x.id,x.name]));receiptItems.forEach(x=>x.product_name=productMap.get(x.product_id)||"Produto");
      const returnIds=returns.map(x=>x.id);returnItems=[];
      for(let i=0;i<returnIds.length;i+=100){const chunk=returnIds.slice(i,i+100);returnItems.push(...await fetchPagedRows(()=>sb.from("purchase_return_items").select("id,return_id,receipt_item_id,quantity,total_credit,cost_before,cost_after").eq("company_id",companyId).in("return_id",chunk).order("id")));}
      renderReceiptOptions();renderReceiptItems();renderHistory();
      status(`${receipts.length} recebimento(s) disponíveis · ${returns.length} devolução(ões) registradas.`);
    }catch(e){status("Não foi possível carregar devoluções: "+(e.message||"erro"));}
  }
  async function saveReturn(){
    if(busy)return;const btn=$r("purchase-return-save");btn.disabled=true;busy=true;
    try{
      const {companyId}=await requireWorkspace();const receiptId=$r("purchase-return-receipt").value;
      const returnDate=$r("purchase-return-date").value;const reason=$r("purchase-return-reason").value.trim();
      if(!receiptId)throw new Error("Selecione o recebimento original.");
      const sourceReceipt=receipts.find(x=>x.id===receiptId);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)||returnDate>today()||(sourceReceipt&&returnDate<sourceReceipt.receipt_date))throw new Error("Informe uma data válida, entre a data do recebimento e hoje.");
      if(reason.length<3||reason.length>500)throw new Error("Informe o motivo entre 3 e 500 caracteres.");
      const items=[...$r("purchase-return-items").querySelectorAll("[data-return-item]")].map(el=>({receipt_item_id:el.dataset.returnItem,quantity:Number(el.value)})).filter(x=>x.quantity>0);
      if(!items.length)throw new Error("Informe a quantidade de pelo menos um item.");
      if(items.some(x=>!Number.isFinite(x.quantity)||Math.round(x.quantity*1000)!==x.quantity*1000))throw new Error("Use quantidades com até três casas decimais.");
      const payload={receipt_id:receiptId,return_date:returnDate,reason,items};let op=pending();
      if(op&&!same(op.payload,payload))throw new Error("Existe uma devolução pendente. Repita exatamente os mesmos dados para reconciliar antes de iniciar outra.");
      if(!op){op={kind:"purchase_return",operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(op);save();}
      persistPendingOrThrow();
      $r("purchase-return-form-status").textContent="Confirmando devolução, saída de estoque e crédito do fornecedor…";
      const {data,error}=await sb.rpc("register_purchase_return_v1",{p_company_id:companyId,p_receipt_id:payload.receipt_id,p_operation_id:op.operation_id,p_return_date:payload.return_date,p_reason:payload.reason,p_items:payload.items});
      if(error){if(error.code)removePending(op.operation_id);throw error;}
      const result=Array.isArray(data)?data[0]:data;if(!result?.return_id)throw new Error("O servidor não confirmou a devolução.");
      removePending(op.operation_id);$r("purchase-return-form-status").textContent=result.already_processed?"Devolução já confirmada anteriormente e reconciliada.":`Devolução registrada. Crédito do fornecedor: ${money(result.total_credit)}.`;
      $r("purchase-return-reason").value="";$r("purchase-return-items").querySelectorAll("[data-return-item]").forEach(el=>el.value="");
      await refresh();document.dispatchEvent(new Event("m7:purchase-updated"));try{await syncProducts();}catch(_){/* O ledger remoto já foi confirmado. */}
    }catch(e){$r("purchase-return-form-status").textContent="Devolução não confirmada. Se houve falha de conexão, mantenha os mesmos dados e tente novamente: "+(e.message||"erro");}
    finally{busy=false;btn.disabled=false;}
  }
  $r("purchase-return-receipt").addEventListener("change",()=>{selectedReceipt=$r("purchase-return-receipt").value;renderReceiptItems();});
  $r("purchase-return-save").addEventListener("click",saveReturn);
  $r("purchase-return-refresh").addEventListener("click",refresh);
  document.addEventListener("m7:purchase-updated",refresh);
  const oldGo=go;go=function(tab){oldGo(tab);if(tab==="comp")refresh();};
  $r("purchase-return-date").value=today();
  refresh();
})();
