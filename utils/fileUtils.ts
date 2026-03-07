
import { Transaction, InvestmentTransaction, CompanyInfo } from '../types';
import { formatCNPJForDisplay } from './cnpjUtils';

declare global {
  interface Window {
    XLSX: any;
    jspdf: any;
    pdfjsLib: any;
  }
}

const getXLSX = () => window.XLSX;
const getJsPDF = () => window.jspdf;
const getPdfjsLib = () => window.pdfjsLib;

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // remove prefix: "data:application/pdf;base64,"
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

export const countPdfPages = async (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = async () => {
      try {
        // Using a smaller range of the file if possible would be better for large files,
        // but getDocument with ArrayBuffer is simplest for now.
        const pdfjs = getPdfjsLib();
        if (!pdfjs) {
          console.warn("pdfjsLib is not loaded.");
          resolve(0);
          return;
        }
        const loadingTask = pdfjs.getDocument({ data: reader.result });
        const pdf = await loadingTask.promise;
        resolve(pdf.numPages);
      } catch (error) {
        console.error("Error counting PDF pages:", error);
        // Resolve with 0 or reject depending on how you want to handle it.
        // Resolving 0 allows the app to continue without crashing on this non-critical feature.
        resolve(0);
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

const downloadBlob = (blob: Blob, filename: string) => {
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

const HEADERS = ['Data', 'Descrição', 'Nome da Empresa', 'CNPJ', 'Categoria', 'Conta Débito', 'Conta Crédito', 'Histórico Contábil', 'Débito', 'Crédito', 'Saldo', 'Incomum', 'Motivo da Sinalização'];
const INVESTMENT_HEADERS = ['Data', 'Fundo de Investimento', 'CNPJ do Fundo', 'Operação', 'Qtd Cotas', 'Vlr Cota', 'Valor Bruto', 'IR Retido', 'Valor Líquido', 'Administrador', 'Gestor', 'Incomum', 'Motivo da Sinalização'];

const getRowsForExport = (data: Transaction[]): (string | number)[][] => {
  return data.map(t => [
    t.date,
    t.description,
    t.companyName,
    t.cnpj,
    t.category,
    t.accountDebit,
    t.accountCredit,
    t.accountingHistory,
    t.debit,
    t.credit,
    typeof t.balance === 'number' ? t.balance.toLocaleString('pt-BR', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.balance,
    t.isUnusual ? 'Sim' : 'Não',
    t.unusualReason
  ]);
};

const getInvestmentRowsForExport = (data: InvestmentTransaction[]): (string | number)[][] => {
  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCotas = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });

  return data.map(t => [
    t.date,
    t.fundName,
    t.fundCNPJ,
    t.operationType,
    fmtCotas(t.shareQuantity),
    fmt(t.shareValue),
    fmt(t.grossValue),
    fmt(t.irWithheld),
    fmt(t.netValue),
    t.administrator,
    t.gestor,
    t.isUnusual ? 'Sim' : 'Não',
    t.unusualReason
  ]);
};

export const exportToCSV = (data: (Transaction | InvestmentTransaction)[], filename: string, isInvestment = false) => {
  if (data.length === 0) return;

  const headers = isInvestment ? INVESTMENT_HEADERS : HEADERS;
  const rows = isInvestment
    ? getInvestmentRowsForExport(data as InvestmentTransaction[])
    : getRowsForExport(data as Transaction[]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      const val = String(cell);
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(','))
  ].join('\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
};


export const exportToTXT = (data: (Transaction | InvestmentTransaction)[], filename: string, isInvestment = false) => {
  if (data.length === 0) return;

  const headers = isInvestment ? INVESTMENT_HEADERS : HEADERS;
  const rows = isInvestment
    ? getInvestmentRowsForExport(data as InvestmentTransaction[]).map(r => r.map(c => String(c)))
    : getRowsForExport(data as Transaction[]).map(r => r.map(c => String(c)));

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));

  let txtContent = headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + '\n';
  txtContent += colWidths.map((w) => '-'.repeat(w)).join('-|-') + '\n';

  rows.forEach(row => {
    txtContent += row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + '\n';
  });

  const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
  downloadBlob(blob, filename);
};


export const exportToXLSX = (data: (Transaction | InvestmentTransaction)[], filename: string, isInvestment = false) => {
  if (data.length === 0) return;
  const xlsx = getXLSX();
  if (!xlsx) {
    console.error("XLSX is not loaded.");
    return;
  }

  const headers = isInvestment ? INVESTMENT_HEADERS : HEADERS;
  const rows = isInvestment
    ? getInvestmentRowsForExport(data as InvestmentTransaction[])
    : getRowsForExport(data as Transaction[]);

  const worksheet = xlsx.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, isInvestment ? 'Investimentos' : 'Transações');
  xlsx.writeFile(workbook, filename);
};

export const exportToPDF = (data: (Transaction | InvestmentTransaction)[], companyInfo: CompanyInfo, filename: string, isInvestment = false) => {
  if (data.length === 0) return;

  const jspdfModule = getJsPDF();
  if (!jspdfModule) {
    console.error("jsPDF is not loaded.");
    return;
  }

  const { jsPDF } = jspdfModule;
  const doc = new jsPDF(isInvestment ? 'l' : 'p'); // Landscape for investment as it has many columns

  doc.setFontSize(18);
  doc.text(isInvestment ? 'Relatório de Investimentos' : 'Relatório de Transações', 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }

  const infoText =
    `Empresa: ${companyInfo.companyName}
CNPJ: ${formatCNPJForDisplay(companyInfo.cnpj)}
Período: ${formatDate(companyInfo.periodStart)} a ${formatDate(companyInfo.periodEnd)}
Corretora/Banco: ${companyInfo.bankName}
Usuário: ${companyInfo.user}`;

  doc.text(infoText, 14, 32);

  const headers = isInvestment ? INVESTMENT_HEADERS : HEADERS;
  const rows = isInvestment
    ? getInvestmentRowsForExport(data as InvestmentTransaction[])
    : getRowsForExport(data as Transaction[]);

  (doc as any).autoTable({
    head: [headers],
    body: rows,
    startY: 70,
    theme: 'grid',
    headStyles: { fillColor: isInvestment ? [39, 174, 96] : [41, 128, 185], textColor: 255 },
    styles: { fontSize: isInvestment ? 7 : 8 },
    columnStyles: isInvestment ? {
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
    } : {
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
    }
  });

  doc.save(filename);
};
