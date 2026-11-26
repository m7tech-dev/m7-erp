/* Cadastro de notas fiscais e relatório contábil — armazenamento local do M7, sem integração SEFAZ. */
(() => {
  "use strict";
  if (typeof S === "undefined") return;
  const $ = id => document.getElementById(id);
  const escNF = v => typeof esc === "function" ? esc(String(v ?? "")) : String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const moneyNF = n => Number(n || 0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const digits = v => String(v || "").replace(/\D/g,"");
  let importedXml = "";
  const records = () => { if(!Array.isArray(S.invoices)) S.invoices=[]; return S.invoices; };
  const persist = () => { if(typeof save==="function") save(); else { try{localStorage.setItem(activeStorageKey,JSON.stringify(S));}catch(e){alert("Não foi possível salvar a nota: "+e.message);} } };
  const notify = msg => typeof toast==="function" ? toast(msg) : alert(msg);
  const val = id => $(id)?.value?.trim() || "";
  const set = (id,v) => { const el=$(id); if(!el)return; if("value" in el)el.value=v??""; else el.textContent=v??""; };
  const currentLot = () => {
    const month=val("nf-month"),year=val("nf-year"),q=val("nf-search").toLocaleLowerCase("pt-BR");
    return records().filter(n=>{
      const d=String(n.issueDate||"");
      if(month && d.slice(5,7)!==month)return false;
      if(year && d.slice(0,4)!==year)return false;
      return !q || [n.number,n.supplier,n.document,n.accessKey].some(x=>String(x||"").toLocaleLowerCase("pt-BR").includes(q));
    }).sort((a,b)=>String(b.issueDate).localeCompare(String(a.issueDate))||String(b.number).localeCompare(String(a.number)));
  };
  const formatDate = d => d ? d.split("-").reverse().join("/") : "";
  function renderInvoices(){
    if(!$("nf-rows"))return;
    const lot=currentLot(),sum=lot.reduce((a,n)=>a+Number(n.total||0),0);
    $("nf-count").textContent=String(lot.length); $("nf-sum").textContent=moneyNF(sum);
    $("nf-rows").innerHTML=lot.map(n=>`<tr>
      <td>${escNF(n.number)}</td><td>${escNF(n.accessKey||"—")}</td><td>${escNF(formatDate(n.issueDate))}</td>
      <td>${escNF(n.supplier)}</td><td>${escNF(n.document)}</td><td>${escNF(n.type)}</td><td>${moneyNF(n.total)}</td>
      <td>${n.sentAt?`Enviado<br>${escNF(new Date(n.sentAt).toLocaleString("pt-BR"))}`:"Pendente"}</td>
      <td><button class="sm gh" data-nf-edit="${escNF(n.id)}">Editar</button> <button class="sm gh" data-nf-del="${escNF(n.id)}">Excluir</button></td></tr>`).join("") || `<tr><td colspan="9" class="k">Nenhuma nota encontrada.</td></tr>`;
  }
  function fillForm(n){
    set("nf-edit-id",n?.id||"");set("nf-number",n?.number||"");set("nf-key",n?.accessKey||"");set("nf-date",n?.issueDate||"");
    set("nf-supplier",n?.supplier||"");set("nf-doc",n?.document||"");set("nf-type",n?.type||"ENTRADA");set("nf-total",n?.total??"");
    importedXml=n?.xml||"";set("nf-review-note",n?"Edite os dados e revise antes de salvar.":"Confira todos os campos antes de salvar.");
  }
  function parseMoney(s){
    if(s==null)return "";let x=String(s).trim().replace(/[R$\s]/g,"");
    if(x.includes(","))x=x.replace(/\./g,"").replace(",",".");
    const n=Number(x);return Number.isFinite(n)?n:"";
  }
  function extractText(t){
    const text=String(t||"").replace(/\u00a0/g," ").replace(/[ \t]+/g," ");
    const pick=patterns=>{for(const re of patterns){const m=text.match(re);if(m?.[1])return m[1].trim();}return "";};
    const number=pick([/(?:N[º°.]?\s*|NÚMERO\s*(?:DA\s*)?NOTA\s*[:\-]?\s*)(\d{1,12})/i,/\bnNF\s*[:=]?\s*(\d+)/i]);
    const key=pick([/(?:CHAVE\s+DE\s+ACESSO)[^\d]{0,30}((?:\d[\s.-]*){44})/i,/\b(\d{44})\b/]).replace(/\D/g,"");
    const dateRaw=pick([/(?:DATA\s+DE\s+EMISSÃO|EMISSÃO|DATA\s+EMISSÃO)[^\d]{0,25}(\d{2}\/\d{2}\/\d{4})/i,/\b(\d{4}-\d{2}-\d{2})\b/]);
    let date="";if(/^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)){const [d,m,y]=dateRaw.split("/");date=`${y}-${m}-${d}`;}else if(/^\d{4}-\d{2}-\d{2}$/.test(dateRaw))date=dateRaw;
    const doc=pick([/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/,/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/]).replace(/\D/g,"");
    let supplier=pick([/(?:NOME\/RAZÃO\s+SOCIAL|RAZÃO\s+SOCIAL|EMITENTE|FORNECEDOR)\s*[:\-]?\s*([^\n\r]{3,100})/i]);
    supplier=supplier.replace(/\s+(?:CNPJ|CPF|INSCRIÇÃO|ENDEREÇO).*/i,"").trim();
    const totalRaw=pick([/(?:VALOR\s+TOTAL\s+DA\s+NOTA|VALOR\s+TOTAL\s+NOTA|VALOR\s+TOTAL|TOTAL\s+DA\s+NOTA|vNF)\s*[:=]?\s*R?\$?\s*([\d.]+,\d{2}|\d+\.\d{2})/i]);
    if(number)set("nf-number",number);if(key.length===44)set("nf-key",key);if(date)set("nf-date",date);
    if(supplier)set("nf-supplier",supplier);if(doc)set("nf-doc",doc);if(totalRaw!==""){const n=parseMoney(totalRaw);if(n!=="")set("nf-total",n.toFixed(2));}
    set("nf-review-note","Extração assistida concluída. Confira e corrija cada campo; nada foi salvo automaticamente.");
    return [number,key,date,supplier,doc,totalRaw].filter(Boolean).length;
  }
  function parseXml(xml){
    const doc=new DOMParser().parseFromString(xml,"application/xml");
    if(doc.querySelector("parsererror"))throw new Error("O arquivo não é um XML válido.");
    const find=local=>{const el=Array.from(doc.getElementsByTagName("*")).find(e=>e.localName===local);return el?.textContent?.trim()||"";};
    const inf=Array.from(doc.getElementsByTagName("*")).find(e=>e.localName==="infNFe");
    if(!inf)throw new Error("Não encontrei o elemento infNFe neste XML.");
    const id=inf.getAttribute("Id")||inf.getAttribute("ID")||"";
    const key=id.replace(/^NFe/i,"").replace(/\D/g,"");
    const rawDate=find("dhEmi")||find("dEmi");
    const issueDate=rawDate?rawDate.slice(0,10):"";
    const supplier=find("xNome");
    const document= find("CNPJ")||find("CPF");
    const total=find("vNF");
    set("nf-number",find("nNF"));if(key.length===44)set("nf-key",key);
    if(issueDate)set("nf-date",issueDate);if(supplier)set("nf-supplier",supplier);
    if(document)set("nf-doc",digits(document));if(total)set("nf-total",Number(total).toFixed(2));
    importedXml=xml;set("nf-review-note","XML lido. Revise os campos extraídos e o tipo da operação antes de salvar.");
    set("nf-file-msg","XML carregado; o conteúdo original será guardado junto à nota.");
  }
  async function loadPdf(file){
    set("nf-file-msg","Lendo texto do PDF...");
    try{
      if(!window.pdfjsLib){
        await new Promise((resolve,reject)=>{const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";sc.onload=resolve;sc.onerror=()=>reject(new Error("Não foi possível carregar o leitor de PDF. Verifique a conexão ou cole o texto manualmente."));document.head.appendChild(sc);});
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let lines=[];
      for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),content=await page.getTextContent();lines.push(content.items.map(x=>x.str).join(" "));}
      const text=lines.join("\n").trim();
      if(!text){set("nf-file-msg","Este PDF parece escaneado ou não contém texto selecionável. Não foi possível fazer OCR. Cole/digite o texto da nota abaixo para extração assistida.");return;}
      set("nf-text",text);const count=extractText(text);
      set("nf-file-msg",count?"Texto do PDF extraído. Revise os campos destacados antes de salvar.":"Texto extraído, mas os campos não foram reconhecidos. Corrija manualmente ou use “Extrair do texto”.");
    }catch(e){set("nf-file-msg",(e.message||"Falha na leitura do PDF.")+" Você pode colar o texto manualmente.");}
  }
  function formData(){
    const number=val("nf-number"),accessKey=digits(val("nf-key")),issueDate=val("nf-date"),supplier=val("nf-supplier"),document=digits(val("nf-doc")),type=val("nf-type"),total=Number(val("nf-total"));
    if(!number||!issueDate||!supplier||!type||val("nf-total")===""||!Number.isFinite(total)||total<0){notify("Preencha número, data, fornecedor, tipo e valor total.");return null;}
    if(accessKey && accessKey.length!==44){notify("A chave de acesso deve conter exatamente 44 dígitos ou ficar vazia.");return null;}
    if(document && ![11,14].includes(document.length)){notify("CNPJ/CPF deve conter 11 ou 14 dígitos.");return null;}
    return {number,accessKey,issueDate,supplier,document,type,total:Number(total.toFixed(2))};
  }
  function saveRecord(){
    const data=formData();if(!data)return;
    const id=val("nf-edit-id");
    const duplicate=records().find(n=>n.accessKey && n.accessKey===data.accessKey && n.id!==id);
    if(duplicate && !confirm("Já existe uma nota com esta chave de acesso. Deseja salvar mesmo assim?"))return;
    const now=new Date().toISOString(),old=records().find(n=>n.id===id);
    const record={...old,...data,id:id||("nf-"+Date.now()+"-"+Math.random().toString(36).slice(2,8)),xml:importedXml||old?.xml||"",createdAt:old?.createdAt||now,updatedAt:now,sentAt:old?.sentAt||null};
    if(id){const i=records().findIndex(n=>n.id===id);if(i>=0)records()[i]=record;else records().push(record);}else records().push(record);
    persist();fillForm(null);set("nf-file","");set("nf-text","");set("nf-file-msg","");renderInvoices();notify("Nota fiscal salva.");
  }
  function markSent(lot){
    const stamp=new Date().toISOString(),ids=new Set(lot.map(n=>n.id));
    S.invoices=records().map(n=>ids.has(n.id)?{...n,sentAt:stamp}:n);persist();renderInvoices();
  }
  function csvExport(){
    const lot=currentLot();if(!lot.length)return notify("Não há notas no lote atual.");
    const header=["Número","Chave de Acesso","Data de Emissão","Fornecedor","CNPJ/CPF","Tipo","Valor Total","Status/Data de Envio ao Contador"];
    const quote=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
    const rows=lot.map(n=>[n.number,n.accessKey,formatDate(n.issueDate),n.supplier,n.document,n.type,Number(n.total).toFixed(2).replace(".",","),n.sentAt?`Enviado em ${new Date(n.sentAt).toLocaleString("pt-BR")}`:"Pendente"].map(quote).join(";"));
    const blob=new Blob(["\uFEFF"+[header.map(quote).join(";"),...rows].join("\r\n")],{type:"text/csv;charset=utf-8"});
    download(blob,`notas-fiscais-contador-${new Date().toISOString().slice(0,10)}.csv`);markSent(lot);set("nf-export-msg",`CSV gerado para ${lot.length} nota(s). Status atualizado para Enviado ao contador.`);
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function printLot(){
    const lot=currentLot();if(!lot.length)return notify("Não há notas no lote atual.");
    const sum=lot.reduce((a,n)=>a+Number(n.total||0),0);
    const rows=lot.map(n=>`<tr><td>${escNF(n.number)}</td><td>${escNF(n.accessKey||"—")}</td><td>${escNF(formatDate(n.issueDate))}</td><td>${escNF(n.supplier)}</td><td>${escNF(n.document)}</td><td>${escNF(n.type)}</td><td>${moneyNF(n.total)}</td><td>${n.sentAt?"Enviado em "+escNF(new Date(n.sentAt).toLocaleString("pt-BR")):"Pendente"}</td></tr>`).join("");
    const w=window.open("","_blank");if(!w)return notify("Permita pop-ups para abrir a impressão.");
    w.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório de Notas Fiscais</title><style>body{font:12px Arial;padding:24px;color:#222}h1{font-size:20px}.summary{margin:18px 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}td:nth-child(7){text-align:right}@media print{body{padding:0}}</style><h1>Relatório de Notas Fiscais — Contador</h1><div class="summary">Quantidade: <b>${lot.length}</b> &nbsp; Soma total: <b>${moneyNF(sum)}</b></div><table><thead><tr><th>Número</th><th>Chave</th><th>Emissão</th><th>Fornecedor</th><th>CNPJ/CPF</th><th>Tipo</th><th>Valor</th><th>Status/Data de envio</th></tr></thead><tbody>${rows}</tbody></table></html>`);
    w.document.close();w.focus();markSent(lot);w.print();
  }
  function exportXmls(){
    const lot=currentLot();if(!lot.length)return notify("Não há notas no lote atual.");
    const withXml=lot.filter(n=>n.xml),without=lot.length-withXml.length;
    if(!withXml.length){set("nf-export-msg",`Nenhuma nota do lote possui XML salvo. ${without} nota(s) sem XML.`);return notify("Este lote não possui XML salvo. Notas cadastradas manualmente ou via PDF não têm XML original.");}
    withXml.forEach((n,i)=>setTimeout(()=>download(new Blob([n.xml],{type:"application/xml;charset=utf-8"}),`NFe-${String(n.number||i+1).replace(/[^a-z0-9_-]/gi,"_")}.xml`),i*250));
    markSent(lot);
    const msg=`${withXml.length} XML(s) baixado(s). ${without?without+" nota(s) do lote não possuem XML salvo (cadastro manual/PDF).": "Todas as notas do lote possuem XML."}`;
    set("nf-export-msg",msg);if(without)notify(msg);
  }
  document.addEventListener("change",async e=>{
    if(e.target.id==="nf-file"){
      const f=e.target.files?.[0];if(!f)return;
      if(/\.xml$/i.test(f.name)||f.type.includes("xml")){try{parseXml(await f.text());}catch(err){set("nf-file-msg",err.message);}}
      else if(/\.pdf$/i.test(f.name)||f.type==="application/pdf")await loadPdf(f);
      else set("nf-file-msg","Formato não suportado. Selecione XML ou PDF.");
    }
    if(["nf-month","nf-year"].includes(e.target.id))renderInvoices();
  });
  document.addEventListener("input",e=>{if(e.target.id==="nf-search")renderInvoices();});
  document.addEventListener("click",e=>{
    if(e.target.closest("#nf-extract")){const t=val("nf-text");if(!t)return notify("Cole o texto da nota antes de extrair.");const n=extractText(t);set("nf-file-msg",n?`${n} campo(s) reconhecido(s). Revise antes de salvar.`:"Não foi possível reconhecer campos. Preencha manualmente.");}
    if(e.target.closest("#nf-clear")){fillForm(null);set("nf-file","");set("nf-text","");set("nf-file-msg","");}
    if(e.target.closest("#nf-save"))saveRecord();
    if(e.target.closest("#nf-csv"))csvExport();
    if(e.target.closest("#nf-print"))printLot();
    if(e.target.closest("#nf-xmls"))exportXmls();
    const edit=e.target.closest("[data-nf-edit]");if(edit){const n=records().find(x=>x.id===edit.dataset.nfEdit);if(n){fillForm(n);$("nf-number").focus();}}
    const del=e.target.closest("[data-nf-del]");if(del){const n=records().find(x=>x.id===del.dataset.nfDel);if(n&&confirm(`Excluir a nota ${n.number}?`)){S.invoices=records().filter(x=>x.id!==n.id);persist();renderInvoices();}}
  });
  // O estado principal já é persistido pelo núcleo; a propriedade é normalizada aqui também.
  if(!Array.isArray(S.invoices))S.invoices=[];
  window.renderInvoices=renderInvoices;
  renderInvoices();
})();
