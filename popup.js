document.addEventListener("DOMContentLoaded", async () => {
  const listElement = document.getElementById("attachments-list");

  try {
	const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
	if (!tab) {
	  listElement.innerHTML = "Kein aktiver Tab gefunden.";
	  return;
	}

	const messages = await browser.mailTabs.getSelectedMessages(tab.id);
	if (!messages || messages.messages.length === 0) {
	  listElement.innerHTML = "Keine E-Mail ausgewählt.";
	  return;
	}

	const messageId = messages.messages[0].id;
	const attachments = await browser.messages.listAttachments(messageId);

	if (attachments.length === 0) {
	  listElement.innerHTML = "Keine Dateianhänge bei aktuell ausgewählter Email gefunden.";
	  return;
	}

	listElement.innerHTML = "";

	for (const attachment of attachments) {
	  const listItem = document.createElement("b");
	  
	  listItem.style.display = "block";
	  listItem.style.textAlign = "center";
	  listElement.appendChild(listItem);

	  if (attachment.contentType === "text/xml") {
		const fileContent = await browser.messages.getAttachmentFile(messageId, attachment.partName);
		const fileText = await fileContent.text();
		
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(fileText, "application/xml");

		const isXRechnung = checkIfXRechnung(xmlDoc);
		const isZUGFeRD = !isXRechnung && checkIfZUGFeRD(xmlDoc);

		if (isXRechnung) {
			invoiceData = extractInvoiceData(xmlDoc, "XRechnung");
		  listItem.innerHTML = sanitizeHTML(`<span style="color: green;">XRechnung erkannt</span>: <strong>${attachment.name}</strong>`);
		} else if (isZUGFeRD) {
			invoiceData = extractInvoiceData(xmlDoc, "ZUGFeRD");
		  listItem.innerHTML = sanitizeHTML(`<span style="color: blue;">ZUGFeRD-Rechnung erkannt</span>: <strong>${attachment.name}</strong>`);
		}
		
		if (invoiceData) {
		  displayInvoiceData(invoiceData, listElement);
		}
	  }
	}
  } catch (error) {
	console.error("Fehler im Popup:", error);
	listElement.innerHTML = `Fehler: ${error.message}`;
  }
  
  function sanitizeHTML(input) {
	const template = document.createElement("template");
	template.innerHTML = input;
  
	// Alle Skripte und potenziell gefährlichen Tags entfernen
	const tagsToRemove = ["script", "iframe", "object", "embed", "link"];
	tagsToRemove.forEach(tag => {
	  const elements = template.content.querySelectorAll(tag);
	  elements.forEach(el => el.remove());
	});
  
	// Entferne unsichere Attribute
	const elements = template.content.querySelectorAll("*");
	elements.forEach(el => {
	  [...el.attributes].forEach(attr => {
		const name = attr.name.toLowerCase();
		if (name.startsWith("on") || name === "style" || name === "srcdoc") {
		  el.removeAttribute(name);
		}
	  });
	});
  
	return template.innerHTML;
  }


  function checkIfXRechnung(xmlDoc) {
	try {
	  const invoiceElement = xmlDoc.documentElement;
	  const namespace = invoiceElement.namespaceURI;
	  const rootTag = invoiceElement.tagName;

	  if (namespace === "urn:cen.eu:en16931:2017" && rootTag === "Invoice") {
		return true;
	  }

	  const customizationID = xmlDoc.querySelector("cbc\\:CustomizationID, CustomizationID");
	  if (customizationID && customizationID.textContent.includes("urn:cen.eu:en16931")) {
		return true;
	  }

	  return false;
	} catch (error) {
	  console.error("Fehler bei der XRechnungsprüfung:", error);
	  return false;
	}
  }

  function checkIfZUGFeRD(xmlDoc) {
	try {
	  const invoiceElement = xmlDoc.documentElement;
	  const namespace = invoiceElement.namespaceURI;
	  const rootTag = invoiceElement.tagName;

	  if (namespace && namespace.includes("urn:ferd:CrossIndustryDocument") && rootTag.includes("CrossIndustryInvoice")) {
		return true;
	  }

	  const exchangedDocumentContext = xmlDoc.querySelector("ram\\:ExchangedDocumentContext, ExchangedDocumentContext");
	  const exchangedDocument = xmlDoc.querySelector("ram\\:ExchangedDocument, ExchangedDocument");

	  if (exchangedDocumentContext && exchangedDocument) {
		return true;
	  }

	  return false;
	} catch (error) {
	  console.error("Fehler bei der ZUGFeRD-Prüfung:", error);
	  return false;
	}
  }

function extractInvoiceData(xmlDoc, type) {
	try {
	  const nsResolver = xmlDoc.createNSResolver(xmlDoc.documentElement);
	  const data = {};

	  if (type === "XRechnung") {
		data["Rechnungsdatum"] = getXPathValue(xmlDoc, "//cbc:IssueDate", nsResolver);
		data["Rechnungsnummer"] = getXPathValue(xmlDoc, "//cbc:ID", nsResolver);
		data["Name des Verkäufers"] = getXPathValue(xmlDoc, "//cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name", nsResolver);
		data["Adresse des Verkäufers"] = [
		  getXPathValue(xmlDoc, "//cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:StreetName", nsResolver),
		  getXPathValue(xmlDoc, "//cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:PostalZone", nsResolver),
		  getXPathValue(xmlDoc, "//cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CityName", nsResolver),
		  getXPathValue(xmlDoc, "//cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode", nsResolver),
		].filter(Boolean).join(", ");
		data["Name des Käufers"] = getXPathValue(xmlDoc, "//cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name", nsResolver);
		data["Adresse des Käufers"] = [
		  getXPathValue(xmlDoc, "//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:StreetName", nsResolver),
		  getXPathValue(xmlDoc, "//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:PostalZone", nsResolver),
		  getXPathValue(xmlDoc, "//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CityName", nsResolver),
		  getXPathValue(xmlDoc, "//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode", nsResolver),
		].filter(Boolean).join(", ");
		data["Bankverbindung des Verkäufers"] = getXPathValue(xmlDoc, "//cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID", nsResolver);
		data["Gesamtbetrag"] = getXPathValue(xmlDoc, "//cac:LegalMonetaryTotal/cbc:PayableAmount", nsResolver);
		data["Terms"] = getXPathValue(xmlDoc, "//cac:PaymentTerms/cbc:Note", nsResolver);
	  } else if (type === "ZUGFeRD") {
		data["Rechnungsdatum"] = getXPathValue(xmlDoc, "//ram:IssueDateTime/udt:DateTimeString", nsResolver);
		data["Rechnungsnummer"] = getXPathValue(xmlDoc, "//rsm:ExchangedDocument/ram:ID", nsResolver);
		data["Name des Verkäufers"] = getXPathValue(xmlDoc, "//ram:SellerTradeParty/ram:Name", nsResolver);
		data["Adresse des Verkäufers"] = [
		  getXPathValue(xmlDoc, "//ram:SellerTradeParty/ram:PostalTradeAddress/ram:LineOne", nsResolver),
		  getXPathValue(xmlDoc, "//ram:SellerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode", nsResolver),
		  getXPathValue(xmlDoc, "//ram:SellerTradeParty/ram:PostalTradeAddress/ram:CityName", nsResolver),
		  getXPathValue(xmlDoc, "//ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountryID", nsResolver),
		].filter(Boolean).join(", ");
		data["Name des Käufers"] = getXPathValue(xmlDoc, "//ram:BuyerTradeParty/ram:Name", nsResolver);
		data["Adresse des Käufers"] = [
		  getXPathValue(xmlDoc, "//ram:BuyerTradeParty/ram:PostalTradeAddress/ram:LineOne", nsResolver),
		  getXPathValue(xmlDoc, "//ram:BuyerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode", nsResolver),
		  getXPathValue(xmlDoc, "//ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CityName", nsResolver),
		  getXPathValue(xmlDoc, "//ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CountryID", nsResolver),
		].filter(Boolean).join(", ");
		data["Bankverbindung des Verkäufers"] = getXPathValue(xmlDoc, "//ram:PayeePartyCreditorFinancialAccount/ram:IBANID", nsResolver);
		data["Gesamtbetrag"] = getXPathValue(xmlDoc, "//ram:GrandTotalAmount", nsResolver);
		data["Terms"] = getXPathValue(xmlDoc, "//ram:SpecifiedTradePaymentTerms/ram:Description", nsResolver);
	  }

	  return data;
	} catch (error) {
	  console.error("Fehler beim Extrahieren von Rechnungsdaten:", error);
	  return null;
	}
  }

  function getXPathValue(xmlDoc, xpath, nsResolver) {
	const result = xmlDoc.evaluate(xpath, xmlDoc, nsResolver, XPathResult.STRING_TYPE, null);
	return result.stringValue || null;
  }

function displayInvoiceData(invoiceData, parentElement) {
	const invoiceSection = document.createElement("section");
	invoiceSection.classList.add("invoice-section");
	invoiceSection.style.width = "100%";
	invoiceSection.style.boxSizing = "border-box";

	const sellerBlock = document.createElement("article");
	sellerBlock.classList.add("invoice-block");
	sellerBlock.style.textAlign = "left";
	sellerBlock.innerHTML = sanitizeHTML(`
	  <h3 style="text-align: left;">Verkäufer</h3>
	  <ul>
		<li><strong>Name:</strong> ${invoiceData["Name des Verkäufers"] || "Nicht gefunden"}</li>
		<li><strong>Adresse:</strong> ${invoiceData["Adresse des Verkäufers"] || "Nicht gefunden"}</li>
	  </ul>
	`);

	const buyerBlock = document.createElement("article");
	buyerBlock.classList.add("invoice-block");
	buyerBlock.style.textAlign = "left";
	buyerBlock.innerHTML = sanitizeHTML(`
	  <h3 style="text-align: left;">Käufer</h3>
	  <ul>
		<li><strong>Name:</strong> ${invoiceData["Name des Käufers"] || "Nicht gefunden"}</li>
		<li><strong>Adresse:</strong> ${invoiceData["Adresse des Käufers"] || "Nicht gefunden"}</li>
	  </ul>
	`);

	const detailsBlock = document.createElement("article");
	detailsBlock.classList.add("invoice-block");
	detailsBlock.style.display = "flex";
	detailsBlock.style.justifyContent = "space-between";

	const leftDetails = document.createElement("div");
	leftDetails.style.width = "70%";
	leftDetails.innerHTML = sanitizeHTML(`
	  <h3 style="text-align: left;">Rechnung</h3>
	  <ul>
		<li><strong>Rechnungsnummer:</strong> ${invoiceData["Rechnungsnummer"] || "Nicht gefunden"}</li>
		<li><strong>Rechnungsdatum:</strong> ${formatGermanDate(invoiceData["Rechnungsdatum"])}
		<li><strong>Gesamtbetrag:</strong> ${formatEuroAmount(invoiceData["Gesamtbetrag"])}
		<li><strong>Bankverbindung:</strong> ${invoiceData["Bankverbindung des Verkäufers"] || "Nicht gefunden"}</li>
		<li><strong>Terms:</strong> ${invoiceData["Terms"] || "Nicht gefunden"}</li>
	  </ul>
	`);

	const rightDetails = document.createElement("div");
	rightDetails.style.width = "30%";
	rightDetails.style.textAlign = "center";
	rightDetails.style.display = "flex";
	rightDetails.style.alignItems = "center";
	rightDetails.style.justifyContent = "center";

	const qrCanvas = document.createElement("canvas");
	qrCanvas.id = "qrCanvas";
	rightDetails.appendChild(qrCanvas);
	generateQRCode(qrCanvas, `BCD\n001\n1\nSCT\n\n${invoiceData["Name des Verkäufers"]}\n${invoiceData["Bankverbindung des Verkäufers"]}\nEUR${invoiceData["Gesamtbetrag"]}\n\nRechnung ${invoiceData["Rechnungsnummer"]}`);

	detailsBlock.appendChild(leftDetails);
	detailsBlock.appendChild(rightDetails);

	invoiceSection.appendChild(sellerBlock);
	invoiceSection.appendChild(buyerBlock);
	invoiceSection.appendChild(detailsBlock);

	parentElement.appendChild(invoiceSection);

	const spacer = document.createElement("div");
	spacer.style.height = "1em";
	parentElement.appendChild(spacer);
  }

  function generateQRCode(canvas, text) {
	// QRious library usage for QR code generation
	const qr = new QRious({
	  element: canvas,
	  value: text,
	  size: 150
	});
  }

  function formatGermanDate(dateString) {
	if (!dateString) return "Nicht gefunden";

	if (dateString.includes("-")) {
	  const [year, month, day] = dateString.split("-");
	  return `${day}.${month}.${year}`;
	}

	if (dateString.length === 8) {
	  const year = dateString.substring(0, 4);
	  const month = dateString.substring(4, 6);
	  const day = dateString.substring(6, 8);
	  return `${day}.${month}.${year}`;
	}

	return "Ungültiges Datum";
  }

  function formatEuroAmount(amountString) {
	if (!amountString) return "Nicht gefunden";
	const formatted = parseFloat(amountString).toFixed(2).replace(".", ",");
	return `${formatted} Euro`;
  }

});
