/* Etapas 18/19: compras, recebimentos, estoque e geração transacional de contas a pagar.
 * A RPC receive_purchase_v1 fica interna; o PWA atualizado usa receive_purchase_v2 para gerar o título financeiro. */
(() => {
  if (typeof sb === "undefined" || typeof S === "undefined") return;
  S.purchase_pending = Array.isArray(S.purchase_pending) ? S.purchase_pending.filter(x => x && typeof x === "object" && ["supplier","create","receive","payable_payment","payable_credit","payable_cancel","purchase_return","credit_refund"].includes(x.kind) && typeof x.operation_id === "string" && /^[0-9a-f-]{36}$/i.test(x.operation_id) && x.payload && typeof x.payload === "object") : [];
  const $p = id => document.getElementById(id);
  const allowed = () => ["owner", "admin", "manager", "stock_operator"].includes(activeCompanyRole);
  const money = n => R(Number(n || 0));
  const qty = n => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const escP = s => esc(String(s ?? ""));
  let suppliers = [], orders = [], orderItems = [], receipts = [], receiptItems = [], cart = [], receivingOrder = null, receivingItems = [];
  let busy = false;
  const removePending = op => {
    const previous = S.purchase_pending;
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
  // A chave idempotente precisa estar persistida antes de qualquer RPC mutável.
  function persistPendingOrThrow() {
    try {
      const serialized = JSON.stringify(S);
      localStorage.setItem(activeStorageKey, serialized);
      if (localStorage.getItem(activeStorageKey) !== serialized) throw new Error("A gravação local não pôde ser confirmada.");
    } catch (error) {
      throw new Error("Não foi possível salvar a operação pendente neste aparelho. Libere espaço e tente novamente; nada foi enviado ao servidor.");
    }
  }
  const getPending = kind => S.purchase_pending.find(x => x.kind === kind);
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const requireWorkspace = async () => {
    if (!sb || !navigator.onLine) throw new Error("Conecte-se à internet para usar Compras.");
    const ctx = await getActiveCompany();
    if (!allowed()) throw new Error("Seu perfil não tem permissão para gerenciar compras.");
    return ctx;
  };
  const status = (id,msg) => { const el=$p(id); if(el) el.textContent=msg; };

  function clearSupplierForm() {
    if(getPending("supplier")){status("sup-status","Há um cadastro pendente. Repita os mesmos dados para reconciliar antes de limpar o formulário.");return;}
    ["sup-id","sup-name","sup-doc","sup-phone","sup-email","sup-trade","sup-notes"].forEach(id=>$p(id).value="");
    $p("sup-save").textContent="Salvar fornecedor";
  }
  function renderSuppliers() {
    $p("sup-list").innerHTML = suppliers.length ? suppliers.map(s => `<div class="it"><div><b>${escP(s.name)}</b><small>${escP(s.document || "Sem documento")} · ${escP(s.phone || "Sem telefone")} · ${s.status === "active" ? "Ativo" : "Inativo"}</small><div class="acts">${s.status === "active" ? `<button class="sm gh" data-sup-edit="${escP(s.id)}">Editar</button><button class="sm gh" data-sup-off="${escP(s.id)}">Inativar</button>` : ""}</div></div></div>`).join("") : '<div class="empty">Nenhum fornecedor cadastrado.</div>';
    $p("po-supplier").innerHTML = '<option value="">Selecione o fornecedor</option>' + suppliers.filter(s=>s.status==="active").map(s=>`<option value="${escP(s.id)}">${escP(s.name)}</option>`).join("");
  }
  async function loadSuppliers(companyId) {
    suppliers = await fetchPagedRows(() => sb.from("suppliers").select("id,name,trade_name,document,email,phone,whatsapp,notes,status,updated_at").eq("company_id",companyId).order("name").order("id"));
    renderSuppliers();
  }
  async function saveSupplier() {
    if (busy) return;
    const btn=$p("sup-save"); btn.disabled=true; busy=true;
    try {
      const {companyId}=await requireWorkspace();
      const name=$p("sup-name").value.trim();
      if(name.length<2) throw new Error("Informe o nome do fornecedor.");
      const payload={name,trade_name:$p("sup-trade").value.trim()||null,document:$p("sup-doc").value.trim()||null,state_registration:null,email:$p("sup-email").value.trim()||null,phone:$p("sup-phone").value.trim()||null,whatsapp:$p("sup-phone").value.trim()||null,notes:$p("sup-notes").value.trim()||null};
      const supplierId=$p("sup-id").value||null;let pending=null;let operationId;
      if(!supplierId){pending=getPending("supplier");if(pending&&!same(pending.payload,payload))throw new Error("Existe um cadastro de fornecedor pendente. Repita exatamente os mesmos dados para reconciliar.");if(!pending){pending={kind:"supplier",operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(pending);save();}operationId=pending.operation_id;}
      else {if(getPending("supplier"))throw new Error("Reconcilie o cadastro de fornecedor pendente antes de editar outro fornecedor.");operationId=crypto.randomUUID();}
      if(pending) persistPendingOrThrow();
      const args={p_company_id:companyId,p_supplier_id:supplierId,p_operation_id:operationId,p_name:payload.name,p_trade_name:payload.trade_name,p_document:payload.document,p_state_registration:payload.state_registration,p_email:payload.email,p_phone:payload.phone,p_whatsapp:payload.whatsapp,p_notes:payload.notes};
      const {data,error}=await sb.rpc("save_supplier_v2",args); if(error){if(error.code&&pending)removePending(pending.operation_id);throw error;}
      const result=Array.isArray(data)?data[0]:data; if(!result?.supplier_id) throw new Error("O servidor não confirmou o fornecedor.");
      if(pending)removePending(pending.operation_id);clearSupplierForm(); status("sup-status",result.sync_status==="created"?"Fornecedor cadastrado.":result.sync_status==="unchanged"?"Cadastro já estava confirmado no servidor.":"Fornecedor atualizado."); try { await loadSuppliers(companyId); } catch(refreshError) { status("sup-status","Fornecedor salvo. A atualização da lista falhou; toque em Compras novamente para atualizar."); }
    } catch(e) { status("sup-status","Não foi possível salvar: "+(e.message||"erro desconhecido")); }
    finally {busy=false;btn.disabled=false;}
  }
  async function deactivateSupplier(id) {
    if(!confirm("Inativar este fornecedor? O histórico de compras será preservado.")) return;
    try { const {companyId}=await requireWorkspace(); const {data,error}=await sb.rpc("deactivate_supplier_v1",{p_company_id:companyId,p_supplier_id:id}); if(error)throw error; await loadSuppliers(companyId); status("sup-status","Fornecedor inativado. O histórico foi preservado."); }
    catch(e){status("sup-status","Falha ao inativar: "+(e.message||"erro"));}
  }
  function renderCart() {
    $p("po-cart").innerHTML=cart.length?cart.map((x,i)=>`<div class="it"><div><b>${escP(x.name)}</b><small>${qty(x.quantity)} ${escP(x.unit)} × ${money(x.unit_cost)}</small></div><div class="amt">${money(x.line_total)}<div><button class="sm gh" data-cart-remove="${i}">Remover</button></div></div></div>`).join(""):'<div class="empty">Adicione produtos ao pedido.</div>';
    $p("po-total").textContent="Total: "+money(cart.reduce((a,x)=>a+x.line_total,0));
  }
  function fillProductOptions() {
    const products=(S.pr||[]).filter(p=>p.remote_id&&p.stock!=null&&p.status!=="inactive");
    $p("po-product").innerHTML='<option value="">Selecione o produto sincronizado</option>'+products.map(p=>`<option value="${escP(p.remote_id)}">${escP(p.name)} · ${escP(p.unit||"UN")}</option>`).join("");
    $p("po-product").onchange=()=>{const p=products.find(x=>x.remote_id===$p("po-product").value);$p("po-cost").value=p&&p.cost!=null?Number(p.cost).toFixed(2):"";};
  }
  function addCartItem() {
    if(getPending("create"))return status("po-status","Há um pedido pendente. Recarregue os dados pendentes antes de alterar os itens.");
    const p=(S.pr||[]).find(x=>x.remote_id===$p("po-product").value);
    if(!p) return status("po-status","Selecione um produto remoto com controle de estoque.");
    const quantity=Number($p("po-qty").value),unitCost=Number($p("po-cost").value);
    if(!Number.isFinite(quantity)||quantity<=0||Math.round(quantity*1000)!==quantity*1000) return status("po-status","Quantidade inválida. Use até três casas decimais.");
    let cents; try{cents=moneyToCents(unitCost,"Custo unitário");}catch(e){return status("po-status",e.message);}
    if(cart.some(x=>x.product_id===p.remote_id)) return status("po-status","Este produto já está no pedido. Remova-o e adicione novamente para alterar a quantidade.");
    cart.push({product_id:p.remote_id,name:p.name,unit:p.unit||"UN",quantity,unit_cost:cents/100,line_total:Math.round(quantity*cents)/100});
    $p("po-qty").value=""; renderCart(); status("po-status","Item adicionado.");
  }
  function restorePendingCreate() {
    const pending=getPending("create"); if(!pending?.payload) return;
    const p=pending.payload; $p("po-supplier").value=p.supplier_id||""; $p("po-date").value=p.order_date||today(); $p("po-expected").value=p.expected_date||""; $p("po-notes").value=p.notes||"";
    cart=(p.items||[]).map(i=>{const product=(S.pr||[]).find(x=>x.remote_id===i.product_id);return {product_id:i.product_id,name:product?.name||"Produto sincronizado",unit:product?.unit||"UN",quantity:Number(i.quantity),unit_cost:Number(i.unit_cost),line_total:Math.round(Number(i.quantity)*Number(i.unit_cost)*100)/100};});
    renderCart(); status("po-status","Há um pedido pendente de confirmação. Mantenha os mesmos dados e toque em Criar pedido para reconciliar com segurança.");
  }
  async function createOrder() {
    if(busy)return;
    const btn=$p("po-save");btn.disabled=true;busy=true;
    try {
      const {companyId}=await requireWorkspace();
      const payload={supplier_id:$p("po-supplier").value,order_date:$p("po-date").value||today(),expected_date:$p("po-expected").value||null,notes:$p("po-notes").value.trim()||null,items:cart.map(x=>({product_id:x.product_id,quantity:x.quantity,unit_cost:x.unit_cost}))};
      if(!payload.supplier_id)throw new Error("Selecione um fornecedor."); if(!payload.items.length)throw new Error("Adicione pelo menos um produto.");
      let pending=getPending("create");
      if(pending&&!same(pending.payload,payload))throw new Error("Existe um pedido pendente. Repita exatamente os mesmos dados antes de criar outro.");
      if(!pending){pending={kind:"create",operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(pending);save();}
      persistPendingOrThrow();
      status("po-status","Enviando pedido ao servidor…");
      const {data,error}=await sb.rpc("create_purchase_order_v1",{p_company_id:companyId,p_supplier_id:payload.supplier_id,p_operation_id:pending.operation_id,p_order_date:payload.order_date,p_expected_date:payload.expected_date,p_notes:payload.notes,p_items:payload.items});
      if(error){if(error.code){removePending(pending.operation_id);}throw error;}
      const result=Array.isArray(data)?data[0]:data;if(!result?.purchase_id)throw new Error("O servidor não confirmou o pedido.");
      removePending(pending.operation_id);cart=[];renderCart();$p("po-notes").value="";$p("po-expected").value="";
      status("po-status",result.already_processed?"Pedido já estava confirmado no servidor.":"Pedido criado. O estoque só será atualizado no recebimento."); try { await loadOrders(companyId); } catch(refreshError) { status("po-status","Pedido confirmado no servidor. A atualização da lista falhou; toque em Atualizar lista."); }
    }catch(e){status("po-status","Pedido não confirmado. Se foi falha de conexão, os dados e a chave de segurança foram preservados: "+(e.message||"erro"));}
    finally{busy=false;btn.disabled=false;}
  }
  const statusLabel={ordered:"Aguardando recebimento",partially_received:"Recebimento parcial",received:"Recebido",cancelled:"Cancelado"};
  function renderOrders() {
    const supplierMap=new Map(suppliers.map(s=>[s.id,s.name]));
    $p("po-list").innerHTML=orders.length?orders.map(o=>{
      const lines=orderItems.filter(i=>i.purchase_order_id===o.id);
      const detail=lines.map(i=>`<div class="k">${escP(i.product_name)} · pedido ${qty(i.ordered_quantity)} · recebido ${qty(i.received_quantity)} · pendente ${qty(Number(i.ordered_quantity)-Number(i.received_quantity))} · ${money(i.unit_cost)}/un</div>`).join("");
      const history=receipts.filter(r=>r.purchase_order_id===o.id).map(r=>{const received=receiptItems.filter(x=>x.receipt_id===r.id).map(x=>{const line=lines.find(i=>i.id===x.purchase_order_item_id);const costTrail=x.cost_after==null?"":` · custo médio ${x.cost_before==null?"sem base":money(x.cost_before)} → ${money(x.cost_after)}`;return `<div class="k">${escP(line?.product_name||"Produto")} · ${qty(x.quantity)} un · ${money(x.total_cost)}${costTrail}</div>`;}).join("");return `<div class="k">Recebido em ${D(r.receipt_date)} · ${money(r.total_cost)} · ${escP(r.reason)}</div>${received}`;}).join("");
      return `<div class="card"><div class="row2" style="justify-content:space-between;align-items:center"><b>Pedido ${escP(o.id.slice(0,8).toUpperCase())}</b><span class="tag ${o.status==='received'?'t-g':o.status==='partially_received'?'t-a':'t-b'}">${statusLabel[o.status]||o.status}</span></div><div class="k">${escP(supplierMap.get(o.supplier_id)||"Fornecedor")} · ${D(o.order_date)}${o.expected_date?` · Previsto ${D(o.expected_date)}`:""} · Total ${money(o.subtotal)}</div>${detail}${history?`<h3>Histórico de recebimentos</h3>${history}`:""}${o.status==='ordered'||o.status==='partially_received'?`<div class="acts"><button class="sm" data-po-receive="${escP(o.id)}">Receber mercadoria</button></div>`:""}</div>`;
    }).join(""):'<div class="empty">Nenhum pedido de compra cadastrado.</div>';
  }
  async function loadOrders(companyId) {
    status("po-list-status","Carregando pedidos…");
    orders=await fetchPagedRows(()=>sb.from("purchase_orders").select("id,supplier_id,order_date,expected_date,status,subtotal,notes,created_at").eq("company_id",companyId).order("created_at",{ascending:false}).order("id",{ascending:false}));
    const ids=orders.map(o=>o.id);orderItems=[];receipts=[];receiptItems=[];
    for(let i=0;i<ids.length;i+=100){const chunk=ids.slice(i,i+100);const rows=await fetchPagedRows(()=>sb.from("purchase_order_items").select("id,purchase_order_id,product_id,product_name,unit,ordered_quantity,received_quantity,unit_cost,line_total").eq("company_id",companyId).in("purchase_order_id",chunk).order("id"));orderItems.push(...rows);}
    for(let i=0;i<ids.length;i+=100){const chunk=ids.slice(i,i+100);const rows=await fetchPagedRows(()=>sb.from("purchase_receipts").select("id,purchase_order_id,receipt_date,total_cost,reason,created_at").eq("company_id",companyId).in("purchase_order_id",chunk).order("receipt_date",{ascending:false}));receipts.push(...rows);}
    const receiptIds=receipts.map(r=>r.id);for(let i=0;i<receiptIds.length;i+=100){const chunk=receiptIds.slice(i,i+100);const rows=await fetchPagedRows(()=>sb.from("purchase_receipt_items").select("id,receipt_id,purchase_order_item_id,quantity,unit_cost,total_cost,cost_before,cost_after,stock_movement_id").eq("company_id",companyId).in("receipt_id",chunk).order("id"));receiptItems.push(...rows);}
    renderOrders();status("po-list-status",`${orders.length} pedido(s) carregado(s).`);
  }
  function openReceive(orderId) {
    const order=orders.find(x=>x.id===orderId);if(!order)return;
    const pending=getPending("receive");if(pending && pending.purchase_id!==orderId) return status("po-list-status","Existe um recebimento pendente de outro pedido. Retome aquele recebimento antes de iniciar outro.");
    const restore=pending?.purchase_id===orderId?pending.payload:null;
    // Em resposta perdida, o servidor pode já ter recebido tudo. Reabrimos os itens do payload pendente
    // (inclusive linhas agora completas) para repetir a mesma chave e obter a confirmação idempotente.
    const lines=restore?orderItems.filter(x=>x.purchase_order_id===orderId&&restore.items.some(y=>y.purchase_item_id===x.id)):orderItems.filter(x=>x.purchase_order_id===orderId&&Number(x.ordered_quantity)>Number(x.received_quantity));
    if(!lines.length)return status("po-list-status","Este pedido não possui saldo pendente.");
    receivingOrder=order;receivingItems=lines;
    $p("purchase-receive-title").textContent=`Pedido ${order.id.slice(0,8).toUpperCase()} · ${D(order.order_date)}`;
    $p("purchase-receive-items").innerHTML=lines.map(i=>{const remaining=Number(i.ordered_quantity)-Number(i.received_quantity);const old=restore?.items?.find(x=>x.purchase_item_id===i.id);const max=old?Math.max(remaining,Number(old.quantity)):remaining;return `<div class="stock-row"><b>${escP(i.product_name)}</b><div class="k">Pendente no servidor: ${qty(remaining)} ${escP(i.unit)} · custo ${money(i.unit_cost)}</div><label>Quantidade a receber</label><input type="number" min="0" max="${max}" step="0.001" inputmode="decimal" data-receive-line="${escP(i.id)}" value="${old?escP(old.quantity):""}"></div>`;}).join("");
    $p("purchase-receive-reason").value=restore?.reason||"";$p("purchase-receive-due").value=restore?.first_due_date||new Date(Date.now()+30*86400000).toISOString().slice(0,10);$p("purchase-receive-installments").value=restore?.installment_count||1;$p("purchase-receive-status").textContent=pending&&pending.purchase_id===orderId?"Recebimento pendente. Repita os mesmos dados para reconciliar.":"O estoque e o custo médio serão atualizados somente após confirmação do servidor.";
    $p("purchase-receive-save").disabled=false;$p("purchase-receive-dlg").showModal();
  }
  async function saveReceipt() {
    if(busy||!receivingOrder)return;const btn=$p("purchase-receive-save");btn.disabled=true;busy=true;
    try {
      const {companyId}=await requireWorkspace();const reason=$p("purchase-receive-reason").value.trim();const dueDate=$p("purchase-receive-due").value;const installmentCount=Number($p("purchase-receive-installments").value);
      if(reason.length<3||reason.length>500)throw new Error("Informe uma justificativa entre 3 e 500 caracteres.");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||dueDate<(getPending("receive")?.payload?.receipt_date||today()))throw new Error("O primeiro vencimento deve ser igual ou posterior ao recebimento.");
      if(!Number.isInteger(installmentCount)||installmentCount<1||installmentCount>24)throw new Error("Informe de 1 a 24 parcelas.");
      const items=[...$p("purchase-receive-items").querySelectorAll("[data-receive-line]")].map(el=>({purchase_item_id:el.dataset.receiveLine,quantity:Number(el.value)})).filter(x=>x.quantity>0);
      if(!items.length)throw new Error("Informe a quantidade de pelo menos um item.");
      if(items.some(x=>!Number.isFinite(x.quantity)||Math.round(x.quantity*1000)!==x.quantity*1000))throw new Error("Use quantidades com até três casas decimais.");
      let pending=getPending("receive");if(pending&&pending.purchase_id===receivingOrder.id&&pending.payload.first_due_date&&(dueDate!==pending.payload.first_due_date||installmentCount!==Number(pending.payload.installment_count)))throw new Error("Existe um recebimento pendente. Mantenha o mesmo primeiro vencimento e a mesma quantidade de parcelas.");const payload={purchase_id:receivingOrder.id,receipt_date:pending?.purchase_id===receivingOrder.id?pending.payload.receipt_date:today(),reason,items,first_due_date:pending?.purchase_id===receivingOrder.id?(pending.payload.first_due_date||dueDate):dueDate,installment_count:pending?.purchase_id===receivingOrder.id?(pending.payload.installment_count||installmentCount):installmentCount};
      if(pending&&pending.purchase_id===receivingOrder.id&&(!pending.payload.first_due_date||!pending.payload.installment_count)){pending.payload={...pending.payload,first_due_date:payload.first_due_date,installment_count:payload.installment_count};save();}
      if(pending&&!same(pending.payload,payload))throw new Error("Existe um recebimento pendente. Repita exatamente os mesmos dados antes de iniciar outro.");
      if(pending&&pending.purchase_id!==receivingOrder.id)throw new Error("Existe um recebimento pendente de outro pedido. Reconcilie-o primeiro.");
      if(!pending){pending={kind:"receive",purchase_id:receivingOrder.id,operation_id:crypto.randomUUID(),payload};S.purchase_pending.push(pending);save();}
      $p("purchase-receive-status").textContent="Confirmando recebimento e entrada no estoque…";
      persistPendingOrThrow();
      const {data,error}=await sb.rpc("receive_purchase_v2",{p_company_id:companyId,p_purchase_id:payload.purchase_id,p_operation_id:pending.operation_id,p_receipt_date:payload.receipt_date,p_reason:payload.reason,p_items:payload.items,p_first_due_date:payload.first_due_date,p_installment_count:payload.installment_count});
      if(error){if(error.code){removePending(pending.operation_id);}throw error;}
      const result=Array.isArray(data)?data[0]:data;if(!result?.receipt_id)throw new Error("O servidor não confirmou o recebimento.");
      removePending(pending.operation_id);$p("purchase-receive-dlg").close();
      status("po-list-status",`Recebimento confirmado. Pedido: ${statusLabel[result.purchase_status]||result.purchase_status}. Total recebido: ${money(result.total_cost)}. ${result.payable_id?`Título financeiro gerado com ${result.installment_count} parcela(s).`:"Recebimento sem custo financeiro; nenhum título a pagar foi criado."}`);
      try { await loadOrders(companyId); document.dispatchEvent(new Event("m7:purchase-updated")); await syncProducts(); } catch(refreshError) { status("po-list-status",`Recebimento confirmado. Atualize o catálogo e a lista para refletir o novo saldo e custo. ${refreshError.message||""}`); }
    }catch(e){$p("purchase-receive-status").textContent="Não foi possível confirmar. Se houve falha de conexão, mantenha os mesmos dados e tente novamente: "+(e.message||"erro");}
    finally{busy=false;btn.disabled=false;}
  }

  $p("sup-save").addEventListener("click",saveSupplier);$p("sup-cancel").addEventListener("click",clearSupplierForm);
  $p("sup-list").addEventListener("click",event=>{const edit=event.target.closest("[data-sup-edit]");if(edit){const s=suppliers.find(x=>x.id===edit.dataset.supEdit);if(!s)return;$p("sup-id").value=s.id;$p("sup-name").value=s.name||"";$p("sup-trade").value=s.trade_name||"";$p("sup-doc").value=s.document||"";$p("sup-email").value=s.email||"";$p("sup-phone").value=s.whatsapp||s.phone||"";$p("sup-notes").value=s.notes||"";$p("sup-save").textContent="Atualizar fornecedor";return;}const off=event.target.closest("[data-sup-off]");if(off)deactivateSupplier(off.dataset.supOff);});
  $p("po-add-item").addEventListener("click",addCartItem);$p("po-cart").addEventListener("click",event=>{const b=event.target.closest("[data-cart-remove]");if(b){if(getPending("create"))return status("po-status","Há um pedido pendente. Recarregue o formulário pendente antes de alterar os itens.");cart.splice(Number(b.dataset.cartRemove),1);renderCart();}});
  $p("po-save").addEventListener("click",createOrder);$p("po-refresh").addEventListener("click",async()=>{try{const {companyId}=await requireWorkspace();await loadSuppliers(companyId);await loadOrders(companyId);}catch(e){status("po-list-status",e.message||"Falha ao atualizar.");}});
  $p("po-list").addEventListener("click",event=>{const b=event.target.closest("[data-po-receive]");if(b)openReceive(b.dataset.poReceive);});
  $p("purchase-receive-save").addEventListener("click",saveReceipt);$p("purchase-receive-close").addEventListener("click",()=>$p("purchase-receive-dlg").close());
  $p("bk-load").addEventListener("click",event=>{if(S.purchase_pending.length){event.preventDefault();event.stopImmediatePropagation();toast("Há uma operação de compras pendente. Reconcilie-a antes de restaurar um backup.");}},true);
  $p("po-date").value=today();fillProductOptions();renderCart();
  const oldGo=go;go=function(tab){oldGo(tab);if(tab==="comp")refreshPurchases().catch(e=>{status("po-list-status",e.message||"Falha ao carregar compras.");});};
  async function refreshPurchases(){const {companyId}=await requireWorkspace();fillProductOptions();await loadSuppliers(companyId);await loadOrders(companyId);restorePendingCreate();document.dispatchEvent(new Event("m7:purchase-updated"));}
  if(getPending("create")){restorePendingCreate();}
  const supplierPending=getPending("supplier");if(supplierPending?.payload){$p("sup-name").value=supplierPending.payload.name||"";$p("sup-trade").value=supplierPending.payload.trade_name||"";$p("sup-doc").value=supplierPending.payload.document||"";$p("sup-email").value=supplierPending.payload.email||"";$p("sup-phone").value=supplierPending.payload.phone||"";$p("sup-notes").value=supplierPending.payload.notes||"";status("sup-status","Há um cadastro de fornecedor pendente. Repita os mesmos dados para reconciliar com segurança.");}
  const oldRender=render;render=function(){oldRender();if(document.getElementById("t-comp")?.classList.contains("on"))fillProductOptions();};
})();
