/* Etapa 17: livro de estoque remoto, imutável e paginado. Depende do núcleo M7 carregado antes. */
(() => {
  if (typeof sb === "undefined" || typeof S === "undefined") return;
  S.stock_pending = Array.isArray(S.stock_pending) ? S.stock_pending : [];

  // Confirma a persistência da chave idempotente antes de registrar a movimentação.
  function persistPendingOrThrow() {
    try {
      const serialized = JSON.stringify(S);
      localStorage.setItem(activeStorageKey, serialized);
      if (localStorage.getItem(activeStorageKey) !== serialized) throw new Error("A gravação local não pôde ser confirmada.");
    } catch (error) {
      throw new Error("Não foi possível salvar a movimentação pendente neste aparelho. Libere espaço e tente novamente; nada foi enviado ao servidor.");
    }
  }
  const removeStockPending = operationId => {
    const previous = S.stock_pending;
    S.stock_pending = previous.filter(x => x.operation_id !== operationId);
    try {
      const serialized = JSON.stringify(S);
      localStorage.setItem(activeStorageKey, serialized);
      if (localStorage.getItem(activeStorageKey) !== serialized) throw new Error("readback mismatch");
      return true;
    } catch (_) {
      S.stock_pending = previous;
      toast("O servidor respondeu, mas a atualização local não foi confirmada. A movimentação foi mantida para reconciliação segura; repita os mesmos dados.");
      return false;
    }
  };

  let movementProductId = null;
  let historyProductId = null;
  let historyOffset = 0;
  let historyBusy = false;

  const movementLabels = {
    entry: "Entrada", exit: "Saída", loss: "Perda / avaria",
    return: "Devolução", adjustment: "Ajuste", reversal: "Estorno"
  };
  const reasonLabels = {
    legacy: "Histórico anterior", sale: "Venda", opening_balance: "Saldo inicial",
    purchase: "Compra / reposição", customer_return: "Devolução de cliente",
    supplier_return: "Devolução a fornecedor", damage: "Avaria", expired: "Vencimento / perda",
    internal_use: "Uso interno", inventory_count: "Contagem física", correction: "Correção", other: "Outro"
  };
  const canManage = () => ["owner", "admin", "manager", "stock_operator"].includes(activeCompanyRole);
  const fmtQty = v => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const findLocal = id => S.pr.find(p => String(p.id) === String(id));

  // Substitui somente a renderização da lista de produtos, preservando o cadastro original.
  const originalCad = cad;
  cad = function () {
    originalCad();
    const list = $("pr-list");
    if (!list) return;
    list.innerHTML = S.pr.length ? S.pr.map(p => `<div class="it"><div><b>${esc(p.name)}</b><small>${p.cost != null ? `custo ${R(p.cost)} · margem ${p.price > 0 ? Math.round((p.price-p.cost)/p.price*100) : 0}% · ` : ""}${p.stock == null ? "sem controle de estoque" : "Estoque: " + esc(p.stock)}${p.stock != null && p.stock <= LOW ? " · ⚠ acabando" : ""}</small><div class="acts"><button class="sm gh" data-ep="${esc(p.id)}">✎ Editar</button>${p.stock != null && p.remote_id ? `${canManage() ? `<button class="sm gh" data-stock-move="${esc(p.id)}">Movimentar</button>` : ""}<button class="sm gh" data-stock-history="${esc(p.id)}">Histórico</button>` : (p.stock != null ? `<small class="k">Sincronize para habilitar o livro remoto.</small>` : "")}<button class="sm gh" data-dp="${esc(p.id)}">Inativar</button></div></div><div class="amt g">${R(p.price)}</div></div>`).join("") : '<div class="empty">Nenhum produto.</div>';
  };

  // O saldo remoto não pode ser editado como metadado do produto.
  const oldProductClick = $("pr-list").onclick;
  $("pr-list").onclick = function (event) {
    if (oldProductClick) oldProductClick.call(this, event);
    const edit = event.target.closest("[data-ep]");
    if (edit) {
      const product = findLocal(edit.dataset.ep);
      setTimeout(() => {
        if (!product) return;
        $("pr-s").disabled = Boolean(product.remote_id);
        $("pr-c").disabled = Boolean(product.remote_id);
        $("pr-cost-help").textContent = product.remote_id
          ? "Custo remoto protegido: é atualizado automaticamente pelo recebimento de compras."
          : "Informe o custo inicial. Após sincronizar, o custo é atualizado pelo recebimento de compras.";
        $("pr-stock-help").textContent = product.remote_id
          ? "Saldo remoto protegido. Use Movimentar ou Histórico para alterar e auditar o estoque."
          : "Produto ainda não sincronizado: o valor será enviado como saldo inicial.";
      }, 0);
    }
  };
  $("pr-list").addEventListener("click", event => {
    const move = event.target.closest("[data-stock-move]");
    if (move) { event.preventDefault(); openMovement(move.dataset.stockMove); return; }
    const history = event.target.closest("[data-stock-history]");
    if (history) { event.preventDefault(); openHistory(history.dataset.stockHistory); }
  });
  $("pr-cancel").addEventListener("click", () => {
    $("pr-s").disabled = false; $("pr-c").disabled = false;
    $("pr-cost-help").textContent = "Informe o custo inicial. Após sincronizar, o custo é atualizado pelo recebimento de compras.";
    $("pr-stock-help").textContent = "No cadastro, informe o saldo inicial. Depois de sincronizado, o saldo é alterado pelo livro de movimentações.";
  });
  $("pr-add").addEventListener("click", () => {
    setTimeout(() => {
      $("pr-s").disabled = false; $("pr-c").disabled = false;
      $("pr-cost-help").textContent = "Informe o custo inicial. Após sincronizar, o custo é atualizado pelo recebimento de compras.";
      $("pr-stock-help").textContent = "No cadastro, informe o saldo inicial. Depois de sincronizado, o saldo é alterado pelo livro de movimentações.";
    }, 0);
  });

  async function validatedCompany() {
    if (!sb || !navigator.onLine) throw new Error("Conecte-se à internet para acessar o livro remoto de estoque.");
    const result = await getActiveCompany();
    if (!canManage()) throw new Error("Seu perfil não tem permissão para movimentar estoque.");
    return result;
  }

  async function openMovement(localId) {
    const product = findLocal(localId);
    if (!product?.remote_id) return toast("Sincronize o produto com a empresa antes de movimentar o estoque.");
    try {
      const { companyId } = await validatedCompany();
      const { data, error } = await sb.from("products")
        .select("id,name,current_stock,stock_control,status")
        .eq("id", product.remote_id).eq("company_id", companyId).maybeSingle();
      if (error) throw error;
      if (!data || !data.stock_control || data.status !== "active") throw new Error("Produto não encontrado, inativo ou sem controle de estoque.");
      movementProductId = product.id;
      $("stock-move-product").textContent = data.name;
      $("stock-move-balance").textContent = `Saldo atual no servidor: ${fmtQty(data.current_stock)} ${product.unit || "UN"}`;
      $("stock-move-type").value = "entry";
      $("stock-move-qty").value = "";
      $("stock-move-code").value = "purchase";
      $("stock-move-reason").value = "";
      $("stock-move-notes").value = "";
      const pending = S.stock_pending.find(x => x.product_id === product.remote_id);
      if (pending) {
        $("stock-move-type").value = pending.payload.type;
        $("stock-move-qty").value = pending.payload.quantity;
        $("stock-move-reason").value = pending.payload.reason;
        $("stock-move-notes").value = pending.payload.notes || "";
      }
      updateMovementLabels();
      if (pending) $("stock-move-code").value = pending.payload.reason_code;
      $("stock-move-status").textContent = pending
        ? "Existe uma operação pendente. Repita exatamente os mesmos dados para reconciliar com segurança."
        : "A movimentação será gravada no servidor e não poderá ser apagada.";
      $("stock-move-save").disabled = false;
      $("stock-move-dlg").showModal();
    } catch (error) { toast(error.message || "Não foi possível abrir a movimentação."); }
  }

  function updateMovementLabels() {
    const type = $("stock-move-type").value;
    $("stock-move-qty-label").textContent = type === "adjustment" ? "Saldo final contado" : "Quantidade";
    const allowed = {
      entry: ["purchase", "correction", "other"],
      exit: ["supplier_return", "internal_use", "correction", "other"],
      loss: ["damage", "expired", "other"],
      return: ["customer_return", "other"],
      adjustment: ["inventory_count", "correction", "other"]
    };
    const defaults = { entry: "purchase", exit: "internal_use", loss: "damage", return: "customer_return", adjustment: "inventory_count" };
    const valid = allowed[type] || ["other"];
    [...$("stock-move-code").options].forEach(option => { option.disabled = !valid.includes(option.value); });
    if (!valid.includes($("stock-move-code").value)) $("stock-move-code").value = defaults[type] || "other";
  }
  $("stock-move-type").addEventListener("change", updateMovementLabels);
  $("stock-move-close").addEventListener("click", () => $("stock-move-dlg").close());

  $("stock-move-save").addEventListener("click", async () => {
    const button = $("stock-move-save");
    const product = findLocal(movementProductId);
    if (!product?.remote_id) return toast("Produto não vinculado ao servidor.");
    const type = $("stock-move-type").value;
    const quantity = Number($("stock-move-qty").value);
    const reasonCode = $("stock-move-code").value;
    const reason = $("stock-move-reason").value.trim();
    const notes = $("stock-move-notes").value.trim();
    if (!Number.isFinite(quantity) || quantity < 0 || Math.round(quantity * 1000) !== quantity * 1000 || (type !== "adjustment" && quantity <= 0)) return toast("Informe uma quantidade válida com até três casas decimais.");
    if (reason.length < 3 || reason.length > 500) return toast("Informe um motivo entre 3 e 500 caracteres.");
    if (notes.length > 1000) return toast("Observação excede 1000 caracteres.");

    const payload = { type, quantity, reason_code: reasonCode, reason, notes };
    let pending = S.stock_pending.find(x => x.product_id === product.remote_id);
    if (pending && JSON.stringify(pending.payload) !== JSON.stringify(payload)) return toast("Há uma movimentação pendente para este produto. Repita os mesmos dados antes de iniciar outra.");
    if (!pending) {
      pending = { product_id: product.remote_id, operation_id: crypto.randomUUID(), payload };
      S.stock_pending.push(pending);
      save();
    }
    try { persistPendingOrThrow(); } catch (error) { $("stock-move-status").textContent = error.message; return; }
    button.disabled = true;
    $("stock-move-status").textContent = "Enviando movimentação ao servidor…";
    try {
      const { companyId } = await validatedCompany();
      const { data, error } = await sb.rpc("register_stock_movement_v2", {
        p_company_id: companyId, p_product_id: product.remote_id, p_movement_type: type,
        p_quantity: quantity, p_operation_id: pending.operation_id, p_reason_code: reasonCode,
        p_reason: reason, p_notes: notes || null
      });
      if (error) {
        // Resposta de erro do servidor: a transação foi rejeitada. Remova a chave
        // somente se a atualização local também puder ser confirmada.
        if (error.code) removeStockPending(pending.operation_id);
        throw error;
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.movement_id) throw new Error("O servidor não confirmou a movimentação.");
      // Mantém a chave pendente até confirmar também a leitura do novo saldo.
      const { data: remote, error: readError } = await sb.from("products").select("current_stock")
        .eq("id", product.remote_id).eq("company_id", companyId).maybeSingle();
      if (readError) throw readError;
      if (!remote) throw new Error("Movimentação confirmada; sincronize o catálogo para atualizar o saldo exibido.");
      product.stock = Number(remote.current_stock);
      const pendingCleared = removeStockPending(pending.operation_id);
      $("stock-move-dlg").close();
      render();
      toast(!pendingCleared
        ? "Movimentação confirmada no servidor; chave local mantida para reconciliação."
        : (result.already_processed ? "Movimentação já havia sido confirmada." : "Estoque atualizado com sucesso."));
    } catch (error) {
      $("stock-move-status").textContent = "Não foi possível confirmar. Os dados e o identificador foram mantidos para uma tentativa segura: " + (error.message || "erro de conexão");
      toast("Movimentação pendente. Não altere os dados ao tentar novamente.");
    } finally { button.disabled = false; }
  });

  async function openHistory(localId) {
    const product = findLocal(localId);
    if (!product?.remote_id) return toast("Sincronize o produto antes de consultar o histórico.");
    try {
      const { companyId } = await getActiveCompany();
      historyProductId = product.id; historyOffset = 0;
      $("stock-history-product").textContent = product.name + " · últimas movimentações primeiro";
      $("stock-history-list").innerHTML = "";
      $("stock-history-status").textContent = "Carregando histórico…";
      $("stock-history-more").style.display = "none";
      $("stock-history-dlg").showModal();
      await loadHistory(companyId, true);
    } catch (error) { $("stock-history-status").textContent = "Falha ao carregar histórico: " + (error.message || "erro"); }
  }

  async function loadHistory(companyId, reset = false) {
    if (historyBusy) return;
    historyBusy = true;
    const product = findLocal(historyProductId);
    const more = $("stock-history-more"); more.disabled = true;
    try {
      const start = reset ? 0 : historyOffset;
      const { data, error } = await sb.from("stock_movements")
        .select("id,movement_type,quantity,balance_before,balance_after,source,notes,reason_code,reason,created_by,created_at")
        .eq("company_id", companyId).eq("product_id", product.remote_id)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(start, start + 49);
      if (error) throw error;
      const rows = data || [];
      if (reset) $("stock-history-list").innerHTML = "";
      const html = rows.map(row => {
        const sign = ["entry", "return"].includes(row.movement_type) ? "+" : (["exit", "loss"].includes(row.movement_type) ? "−" : "");
        return `<div class="stock-row"><b>${esc(movementLabels[row.movement_type] || row.movement_type)} · ${sign}${fmtQty(row.quantity)}</b><small class="k">${new Date(row.created_at).toLocaleString("pt-BR")} · ${esc(reasonLabels[row.reason_code] || row.reason_code)}</small><small>${esc(row.reason)}</small><small class="k">Saldo: ${fmtQty(row.balance_before)} → ${fmtQty(row.balance_after)} · Responsável: ${esc(row.created_by || "não identificado")}</small>${row.notes ? `<small>${esc(row.notes)}</small>` : ""}</div>`;
      }).join("");
      $("stock-history-list").insertAdjacentHTML("beforeend", html || (reset ? '<div class="empty">Nenhuma movimentação registrada.</div>' : ""));
      historyOffset = start + rows.length;
      more.style.display = rows.length === 50 ? "" : "none";
      $("stock-history-status").textContent = `${historyOffset} movimentação(ões) carregada(s).`;
    } catch (error) {
      $("stock-history-status").textContent = "Falha ao carregar histórico: " + (error.message || "erro");
    } finally { historyBusy = false; more.disabled = false; }
  }
  $("stock-history-more").addEventListener("click", async () => {
    try { const { companyId } = await getActiveCompany(); await loadHistory(companyId, false); }
    catch (error) { $("stock-history-status").textContent = error.message || "Falha ao carregar mais itens."; }
  });
  $("stock-history-close").addEventListener("click", () => $("stock-history-dlg").close());

  // Nunca descarta uma operação idempotente pendente ao restaurar um backup antigo.
  $("bk-load").addEventListener("click", event => {
    if (S.stock_pending.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      toast("Há movimentação de estoque pendente. Reconcilie-a antes de restaurar um backup.");
    }
  }, true);

  cad();
})();
