document.addEventListener("DOMContentLoaded", async () => {
  const listElement = document.getElementById("attachments-list");

  try {
	const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
	if (!tab) {
	  const noTabMessage = document.createElement("div");
	  noTabMessage.textContent = "Kein aktiver Tab gefunden.";
	  listElement.appendChild(noTabMessage);
	  return;
	}

	const messages = await browser.mailTabs.getSelectedMessages(tab.id);
	if (!messages || messages.messages.length === 0) {
	  const noEmailMessage = document.createElement("div");
	  noEmailMessage.textContent = "Keine E-Mail ausgewählt.";
	  listElement.appendChild(noEmailMessage);
	  return;
	}

	const messageId = messages.messages[0].id;
	const attachments = await browser.messages.listAttachments(messageId);

	if (attachments.length === 0) {
	  const noAttachmentsMessage = document.createElement("div");
	  noAttachmentsMessage.textContent = "Keine Dateianhänge bei aktuell ausgewählter Email gefunden.";
	  listElement.appendChild(noAttachmentsMessage);
	  return;
	}

	listElement.innerHTML = "";

	for (const attachment of attachments) {
	  const listItem = document.createElement("b");
	  listItem.style.display = "block";
	  listItem.style.textAlign = "center";
	  listElement.appendChild(listItem);

	  let invoiceData = null;

	  if (attachment.contentType === "text/xml" || attachment.contentType === "application/pdf") {
		const fileContent = await browser.messages.getAttachmentFile(messageId, attachment.partName);
		const fileBlob = await fileContent.arrayBuffer();

		if (attachment.contentType === "application/pdf") {
		  try {
			const xmlContent = await extractTextFromPDF(fileBlob);
			const parser = new DOMParser();
			const xmlDoc = parser.parseFromString(xmlContent, "application/xml");

			const isZUGFeRD = checkIfZUGFeRD(xmlDoc);

			if (isZUGFeRD) {
			  invoiceData = extractInvoiceData(xmlDoc, "ZUGFeRD");
			  const recognizedMessage = document.createElement("span");
			  recognizedMessage.style.color = "blue";
			  recognizedMessage.textContent = "ZUGFeRD-Rechnung erkannt: ";
			  const attachmentName = document.createElement("strong");
			  attachmentName.textContent = DOMPurify.sanitize(attachment.name);
			  recognizedMessage.appendChild(attachmentName);
			  listItem.appendChild(recognizedMessage);

			  if (invoiceData) {
				displayInvoiceData(invoiceData, listElement);
			  }
			}
		  } catch (error) {
			const noZUGFeRDMessage = document.createElement("div");
			noZUGFeRDMessage.textContent = `PDF-Datei ohne eingebettetes ZUGFeRD: ${DOMPurify.sanitize(attachment.name)}`;
			listItem.appendChild(noZUGFeRDMessage);
		  }
		} else if (attachment.contentType === "text/xml") {
		  const fileText = new TextDecoder().decode(fileBlob);

		  const parser = new DOMParser();
		  const xmlDoc = parser.parseFromString(fileText, "application/xml");

		  const isXRechnung = checkIfXRechnung(xmlDoc);
		  const isZUGFeRD = !isXRechnung && checkIfZUGFeRD(xmlDoc);

		  if (isXRechnung) {
			invoiceData = extractInvoiceData(xmlDoc, "XRechnung");
			const recognizedMessage = document.createElement("span");
			recognizedMessage.style.color = "green";
			recognizedMessage.textContent = "XRechnung erkannt: ";
			const attachmentName = document.createElement("strong");
			attachmentName.textContent = DOMPurify.sanitize(attachment.name);
			recognizedMessage.appendChild(attachmentName);
			listItem.appendChild(recognizedMessage);
		  } else if (isZUGFeRD) {
			invoiceData = extractInvoiceData(xmlDoc, "ZUGFeRD");
			const recognizedMessage = document.createElement("span");
			recognizedMessage.style.color = "blue";
			recognizedMessage.textContent = "ZUGFeRD-Rechnung erkannt: ";
			const attachmentName = document.createElement("strong");
			attachmentName.textContent = DOMPurify.sanitize(attachment.name);
			recognizedMessage.appendChild(attachmentName);
			listItem.appendChild(recognizedMessage);
		  }

		  if (invoiceData) {
			displayInvoiceData(invoiceData, listElement);
		  }
		}
	  }
	}
  } catch (error) {
	const errorMessage = document.createElement("div");
	errorMessage.textContent = `Fehler: ${error.message}`;
	listElement.appendChild(errorMessage);
  }

  async function extractTextFromPDF(pdfBuffer) {
	pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.min.js'; // Lokaler Worker
  
	const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
	let xmlContent = null;
	
	const attachments = await pdf.getAttachments();
	if (attachments) {
	  //console.log("Gefundene Anhänge:", Object.keys(attachments));
	  for (const [name, attachment] of Object.entries(attachments)) {
		const decoder = new TextDecoder();
		if (name.endsWith('.xml') || attachment.filename.endsWith('.xml')) {
			xmlContent = decoder.decode(attachment.content);
			// Prüfen, ob die XML-ZUGFeRD-Daten enthalten sind
			if (xmlContent.includes('CrossIndustryInvoice>')) {
			  return xmlContent; // Gib die XML-Daten zurück
			}
		}
	  }
	} 

	throw new Error("Keine ZUGFeRD-Daten im PDF gefunden.");
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
	const sellerHeading = document.createElement("h3");
	sellerHeading.textContent = "Verkäufer";
	sellerBlock.appendChild(sellerHeading);
	
	const sellerList = document.createElement("ul");
	const sellerNameItem = document.createElement("li");
	const sellerNameLabel = document.createElement("strong");
	sellerNameLabel.textContent = "Name: ";
	sellerNameItem.appendChild(sellerNameLabel);
	sellerNameItem.appendChild(document.createTextNode(DOMPurify.sanitize(invoiceData["Name des Verkäufers"]) || "Nicht gefunden"));
	sellerList.appendChild(sellerNameItem);
	
	const sellerAddressItem = document.createElement("li");
	const sellerAddressLabel = document.createElement("strong");
	sellerAddressLabel.textContent = "Adresse: ";
	sellerAddressItem.appendChild(sellerAddressLabel);
	sellerAddressItem.appendChild(document.createTextNode(DOMPurify.sanitize(invoiceData["Adresse des Verkäufers"]) || "Nicht gefunden"));
	sellerList.appendChild(sellerAddressItem);
	
	sellerBlock.appendChild(sellerList);
	
	const buyerBlock = document.createElement("article");
	buyerBlock.classList.add("invoice-block");
	buyerBlock.style.textAlign = "left";
	const buyerHeading = document.createElement("h3");
	buyerHeading.textContent = "Käufer";
	buyerBlock.appendChild(buyerHeading);
	
	const buyerList = document.createElement("ul");
	const buyerNameItem = document.createElement("li");
	const buyerNameLabel = document.createElement("strong");
	buyerNameLabel.textContent = "Name: ";
	buyerNameItem.appendChild(buyerNameLabel);
	buyerNameItem.appendChild(document.createTextNode(DOMPurify.sanitize(invoiceData["Name des Käufers"]) || "Nicht gefunden"));
	buyerList.appendChild(buyerNameItem);
	
	const buyerAddressItem = document.createElement("li");
	const buyerAddressLabel = document.createElement("strong");
	buyerAddressLabel.textContent = "Adresse: ";
	buyerAddressItem.appendChild(buyerAddressLabel);
	buyerAddressItem.appendChild(document.createTextNode(DOMPurify.sanitize(invoiceData["Adresse des Käufers"]) || "Nicht gefunden"));
	buyerList.appendChild(buyerAddressItem);
	
	buyerBlock.appendChild(buyerList);
	
	const detailsBlock = document.createElement("article");
	detailsBlock.classList.add("invoice-block");
	detailsBlock.style.display = "flex";
	detailsBlock.style.justifyContent = "space-between";
	
	const leftDetails = document.createElement("div");
	leftDetails.style.width = "70%";
	
	const invoiceList = document.createElement("ul");
	const invoiceNumberItem = document.createElement("li");
	const invoiceNumberLabel = document.createElement("strong");
	invoiceNumberLabel.textContent = "Rechnungsnummer: ";
	invoiceNumberItem.appendChild(invoiceNumberLabel);
	invoiceNumberItem.appendChild(document.createTextNode(DOMPurify.sanitize(invoiceData["Rechnungsnummer"]) || "Nicht gefunden"));
	invoiceList.appendChild(invoiceNumberItem);
	
	const invoiceDateItem = document.createElement("li");
	const invoiceDateLabel = document.createElement("strong");
	invoiceDateLabel.textContent = "Rechnungsdatum: ";
	invoiceDateItem.appendChild(invoiceDateLabel);
	invoiceDateItem.appendChild(document.createTextNode(formatGermanDate(DOMPurify.sanitize(invoiceData["Rechnungsdatum"])) || "Nicht gefunden"));
	invoiceList.appendChild(invoiceDateItem);
	
	const invoiceAmountItem = document.createElement("li");
	const invoiceAmountLabel = document.createElement("strong");
	invoiceAmountLabel.textContent = "Gesamtbetrag: ";
	invoiceAmountItem.appendChild(invoiceAmountLabel);
	invoiceAmountItem.appendChild(document.createTextNode(formatEuroAmount(DOMPurify.sanitize(invoiceData["Gesamtbetrag"])) || "Nicht gefunden"));
	invoiceList.appendChild(invoiceAmountItem);
	
	const invoiceBankItem = document.createElement("li");
	const invoiceBankLabel = document.createElement("strong");
	invoiceBankLabel.textContent = "Bankverbindung: ";
	invoiceBankItem.appendChild(invoiceBankLabel);
	invoiceBankItem.appendChild(document.createTextNode(DOMPurify.sanitize(invoiceData["Bankverbindung des Verkäufers"]) || "Nicht gefunden"));
	invoiceList.appendChild(invoiceBankItem);
	
	const invoiceTermsItem = document.createElement("li");
	const invoiceTermsLabel = document.createElement("strong");
	invoiceTermsLabel.textContent = "Terms: ";
	invoiceTermsItem.appendChild(invoiceTermsLabel);
	invoiceTermsItem.appendChild(document.createTextNode(DOMPurify.sanitize(invoiceData["Terms"]) || "Nicht gefunden"));
	invoiceList.appendChild(invoiceTermsItem);
  
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
	
	leftDetails.appendChild(invoiceList);
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
