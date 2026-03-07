
export type DocumentType = 'bank' | 'investment';

export interface Transaction {
    id: string;
    date: string;
    description: string;
    debit: string;
    credit: string;
    balance: number | string;
    companyName: string;
    cnpj: string;
    category: string;
    isUnusual: boolean;
    unusualReason: string;
    accountDebit: string;
    accountCredit: string;
    accountingHistory: string;
}

export interface GeminiTransactionResponse {
    transactions: (Omit<Transaction, 'id' | 'balance' | 'debit' | 'credit'> & { debit: number, credit: number })[];
    finalBalance?: number;
    bankName?: string;
    accountHolderCNPJ?: string;
}

// ─── Extrato de Cotista (Fundos de Investimento) ───────────────────────────

export type InvestmentOperationType =
    | 'Aplicação'
    | 'Resgate'
    | 'Rendimento'
    | 'Come-cotas'
    | 'Amortização'
    | 'Transferência'
    | 'Outro';

export interface InvestmentTransaction {
    id: string;
    date: string;
    fundName: string;          // Nome do fundo
    fundCNPJ: string;          // CNPJ do fundo (só números)
    operationType: InvestmentOperationType;
    shareQuantity: number;     // Quantidade de cotas
    shareValue: number;        // Valor unitário da cota
    grossValue: number;        // Valor bruto da operação
    irWithheld: number;        // IR retido na fonte
    netValue: number;          // Valor líquido (grossValue - irWithheld)
    administrator: string;     // Administrador do fundo
    gestor: string;            // Gestor do fundo
    isUnusual: boolean;
    unusualReason: string;
}

export interface GeminiInvestmentResponse {
    investmentTransactions: InvestmentTransaction[];
    cotistaNome?: string;      // Nome do cotista
    cotistaCNPJ?: string;      // CNPJ do cotista (só números)
    bankName?: string;         // Corretora/banco
    periodStart?: string;      // Início do período (AAAA-MM-DD)
    periodEnd?: string;        // Fim do período (AAAA-MM-DD)
    // Campos de verificação de completude
    totalPagesInDocument?: number;
    pagesProcessed?: number;
    isExtractionComplete?: boolean;
    extractionNotes?: string;
}

// ──────────────────────────────────────────────────────────────────────────

export interface DateValidationError {
    message: string;
    suggestion?: string;
}

export interface CNPJValidationError {
    message: string;
}

export interface CurrencyValidationError {
    message: string;
}

export interface CompanyInfo {
    companyName: string;
    cnpj: string;
    user: string;
    periodStart: string;
    periodEnd: string;
    bankName: string;
}

export interface Filters {
    description: string;
    startDate: string;
    endDate: string;
    minAmount: string;
    maxAmount: string;
    category: string;
    showUnusual: 'all' | 'unusualOnly' | 'commonOnly';
    transactionType: 'all' | 'debit' | 'credit';
}

export interface InvestmentFilters {
    fundName: string;
    startDate: string;
    endDate: string;
    operationType: string;
    minAmount: string;
    maxAmount: string;
}
