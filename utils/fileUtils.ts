
import { Transaction, CompanyInfo } from '../types';

declare const XLSX: any;
declare const jspdf: any;
declare const pdfjsLib: any;

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
        const loadingTask = pdfjsLib.getDocument({ data: reader.result });
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

const HEADERS = ['Data', 'Descrição', 'Nome da Empresa', 'CNPJ', 'Categoria', 'Débito', 'Crédito', 'Saldo', 'Incomum', 'Motivo da Sinalização'];

const getRowsForExport = (data: Transaction[]): (string | number)[][] => {
    return data.map(t => [
        t.date,
        t.description,
        t.companyName,
        t.cnpj,
        t.category,
        t.debit,
        t.credit,
        typeof t.balance === 'number' ? t.balance.toLocaleString('pt-BR', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.balance,
        t.isUnusual ? 'Sim' : 'Não',
        t.unusualReason
    ]);
};

export const exportToCSV = (data: Transaction[], filename: string) => {
  if (data.length === 0) return;

  const rows = data.map(t => [
    t.date,
    `"${t.description.replace(/"/g, '""')}"`,
    `"${t.companyName.replace(/"/g, '""')}"`,
    t.cnpj,
    t.category,
    t.debit,
    t.credit,
    t.balance,
    t.isUnusual ? 'Sim' : 'Não',
    `"${t.unusualReason.replace(/"/g, '""')}"`
  ]);

  const csvContent = [
    HEADERS.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel compatibility
  downloadBlob(blob, filename);
};


export const exportToTXT = (data: Transaction[], filename: string) => {
  if (data.length === 0) return;

  const rows = getRowsForExport(data).map(row => row.map(cell => String(cell)));
  
  const colWidths = HEADERS.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));

  let txtContent = HEADERS.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + '\n';
  txtContent += colWidths.map((w) => '-'.repeat(w)).join('-|-') + '\n';

  rows.forEach(row => {
      txtContent += row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + '\n';
  });

  const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
  downloadBlob(blob, filename);
};


export const exportToXLSX = (data: Transaction[], filename: string) => {
  if (data.length === 0) return;
  const rows = getRowsForExport(data);
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transações');
  XLSX.writeFile(workbook, filename);
};

export const exportToPDF = (data: Transaction[], companyInfo: CompanyInfo, filename: string) => {
  if (data.length === 0) return;
  
  const { jsPDF } = jspdf;
  const doc = new jsPDF();
  
  doc.setFontSize(18);
  doc.text('Relatório de Transações', 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }

  const infoText = 
`Empresa: ${companyInfo.companyName}
CNPJ: ${companyInfo.cnpj}
Banco: ${companyInfo.bankName}
Período: ${formatDate(companyInfo.periodStart)} a ${formatDate(companyInfo.periodEnd)}
Usuário: ${companyInfo.user}`;

  doc.text(infoText, 14, 32);

  (doc as any).autoTable({
      head: [HEADERS],
      body: getRowsForExport(data),
      startY: 70,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      styles: { fontSize: 8 },
      columnStyles: {
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
      }
  });

  doc.save(filename);
};