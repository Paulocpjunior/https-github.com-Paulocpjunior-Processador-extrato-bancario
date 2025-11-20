
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
}

export interface GeminiTransactionResponse {
    transactions: (Omit<Transaction, 'id' | 'balance' | 'debit' | 'credit'> & { debit: number, credit: number })[];
    finalBalance?: number;
    bankName?: string;
}

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