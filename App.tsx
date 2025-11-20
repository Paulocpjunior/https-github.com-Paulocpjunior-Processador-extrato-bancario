import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { DataTable } from './components/DataTable';
import { Header } from './components/Header';
import { Loader } from './components/Loader';
import { HeaderForm } from './components/HeaderForm';
import { FilterBar } from './components/FilterBar';
import { Transaction, DateValidationError, CNPJValidationError, CurrencyValidationError, CompanyInfo, Filters } from './types';
import { processBankStatementPDF, suggestDateCorrection, suggestNewCategory } from './services/geminiService';
import { exportToCSV, exportToXLSX, exportToTXT, exportToPDF, countPdfPages } from './utils/fileUtils';
import { validateDate } from './utils/dateUtils';
import { validateCNPJ, formatCNPJForDisplay } from './utils/cnpjUtils';
import { parseCurrency, validateCurrency } from './utils/currencyUtils';
import { ArrowDownTrayIcon, ArrowPathIcon, ExclamationTriangleIcon, PencilIcon, ChevronDownIcon } from './components/icons/Icons';

const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatDateForDisplay = (dateString: string) => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
};

const initialFilters: Filters = {
  description: '',
  startDate: '',
  endDate: '',
  minAmount: '',
  maxAmount: '',
  category: '',
  showUnusual: 'all',
  transactionType: 'all',
};

export default function App() {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [isInfoConfirmed, setIsInfoConfirmed] = useState<boolean>(false);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [statementBalance, setStatementBalance] = useState<number | null>(null);
  const [dateErrors, setDateErrors] = useState<Record<string, DateValidationError>>({});
  const [cnpjErrors, setCnpjErrors] = useState<Record<string, CNPJValidationError>>({});
  const [currencyErrors, setCurrencyErrors] = useState<Record<string, CurrencyValidationError>>({});
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportContainerRef = useRef<HTMLDivElement>(null);
  const [categorizingId, setCategorizingId] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportContainerRef.current && !exportContainerRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);


  const calculateBalances = (transactions: Omit<Transaction, 'id' | 'balance'>[]): { transactionsWithBalances: Transaction[], finalBalance: number } => {
    let runningBalance = 0;
    const transactionsWithBalances = transactions.map(t => {
      runningBalance += (parseCurrency(t.credit) || 0) - (parseCurrency(t.debit) || 0);
      return { 
        ...t, 
        id: crypto.randomUUID(),
        balance: runningBalance 
      };
    });
    return { transactionsWithBalances, finalBalance: runningBalance };
  };
  
  const handleInfoConfirm = (info: CompanyInfo) => {
    setCompanyInfo(info);
    setIsInfoConfirmed(true);
  };

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setTransactions([]);
    setError(null);
    setDateErrors({});
    setCnpjErrors({});
    setCurrencyErrors({});
    setPageCount(null);

    // Inicia a contagem de páginas em paralelo com o processamento
    countPdfPages(selectedFile)
        .then(count => setPageCount(count))
        .catch(err => console.error("Não foi possível contar as páginas:", err));

    handleProcessFile(selectedFile);
  };

  const handleProcessFile = async (pdfFile: File) => {
    setIsLoading(true);
    setError(null);
    setStatementBalance(null);
    setDateErrors({});
    setCnpjErrors({});
    setCurrencyErrors({});

    try {
      setLoadingMessage('Enviando para análise da IA. Isso pode levar alguns instantes...');
      const { transactions: extractedTransactions, finalBalance } = await processBankStatementPDF(pdfFile);
      
      setLoadingMessage('Análise concluída. Finalizando e validando dados...');
      
      const transactionsWithFormattedCurrency = extractedTransactions.map(t => ({
        ...t,
        debit: t.debit > 0 ? t.debit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
        credit: t.credit > 0 ? t.credit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
        category: t.category || 'Não categorizado',
        isUnusual: t.isUnusual || false,
        unusualReason: t.unusualReason || '',
      }));

      const { transactionsWithBalances } = calculateBalances(transactionsWithFormattedCurrency);
      setTransactions(transactionsWithBalances);
      setStatementBalance(finalBalance ?? null);

      // Validação inicial
      const initialDateErrors: Record<string, DateValidationError> = {};
      const initialCnpjErrors: Record<string, CNPJValidationError> = {};
      const dateValidationPromises = [];

      for(const t of transactionsWithBalances) {
          // Date validation
          const dateValidationResult = validateDate(t.date);
          if (!dateValidationResult.isValid) {
              const promise = suggestDateCorrection(t.date).then(suggestion => ({
                  id: t.id,
                  error: {
                      message: dateValidationResult.message!,
                      suggestion: suggestion !== t.date && validateDate(suggestion).isValid ? suggestion : undefined,
                  }
              }));
              dateValidationPromises.push(promise);
          }
          // CNPJ validation
          const cnpjValidationResult = validateCNPJ(t.cnpj);
          if (!cnpjValidationResult.isValid) {
              initialCnpjErrors[t.id] = { message: cnpjValidationResult.message! };
          }
      }

      const dateValidationResults = (await Promise.all(dateValidationPromises));
      dateValidationResults.forEach(result => {
          if (result) initialDateErrors[result.id] = result.error;
      });

      setDateErrors(initialDateErrors);
      setCnpjErrors(initialCnpjErrors);

    } catch (err) {
      console.error(err);
      setError('Falha ao processar o PDF. O arquivo pode estar corrompido ou em um formato não suportado. Por favor, tente novamente.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };
  
  const { calculatedFinalBalance, balanceMismatch } = useMemo(() => {
    if (transactions.length === 0) {
      return { calculatedFinalBalance: 0, balanceMismatch: false };
    }
    const finalBalance = transactions[transactions.length - 1].balance as number;
    const mismatch = statementBalance !== null && Math.abs(finalBalance - statementBalance) > 0.01; // Tolerância para arredondamento
    return { calculatedFinalBalance: finalBalance, balanceMismatch: mismatch };
  }, [transactions, statementBalance]);

  const unusualTransactionsCount = useMemo(() => {
    return transactions.filter(t => t.isUnusual).length;
  }, [transactions]);
  
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // Description filter
      if (filters.description && !t.description.toLowerCase().includes(filters.description.toLowerCase())) {
        return false;
      }
      // Category filter
      if (filters.category && t.category !== filters.category) {
        return false;
      }
      // Unusual filter
      if (filters.showUnusual === 'unusualOnly' && !t.isUnusual) {
        return false;
      }
      if (filters.showUnusual === 'commonOnly' && t.isUnusual) {
        return false;
      }
      // Date filter
      if (filters.startDate && t.date < filters.startDate) {
        return false;
      }
      if (filters.endDate && t.date > filters.endDate) {
        return false;
      }
      // Amount filter
      const debit = parseCurrency(t.debit);
      const credit = parseCurrency(t.credit);
      const amount = Math.abs(credit - debit);
      if (filters.minAmount && amount < parseFloat(filters.minAmount)) {
        return false;
      }
      if (filters.maxAmount && amount > parseFloat(filters.maxAmount)) {
        return false;
      }

      // Transaction Type filter
      if (filters.transactionType === 'debit' && debit <= 0) {
        return false;
      }
      if (filters.transactionType === 'credit' && credit <= 0) {
        return false;
      }

      return true;
    });
  }, [transactions, filters]);

  const handleDataChange = useCallback(async (updatedTransaction: Transaction, fieldChanged: keyof Omit<Transaction, 'id' | 'balance'>) => {
    setTransactions(currentTransactions => {
      const updatedList = currentTransactions.map(t =>
        t.id === updatedTransaction.id ? updatedTransaction : t
      );
      
      let runningBalance = 0;
      return updatedList.map(t => {
        runningBalance += (parseCurrency(t.credit) || 0) - (parseCurrency(t.debit) || 0);
        return { ...t, balance: runningBalance };
      });
    });

    const { id } = updatedTransaction;

    if (fieldChanged === 'date') {
        const { date } = updatedTransaction;
        setDateErrors(prev => { const newErrors = { ...prev }; delete newErrors[id]; return newErrors; });

        const validationResult = validateDate(date);
        if (!validationResult.isValid) {
            const suggestion = await suggestDateCorrection(date);
            setDateErrors(prev => ({
                ...prev,
                [id]: {
                    message: validationResult.message!,
                    suggestion: suggestion !== date && validateDate(suggestion).isValid ? suggestion : undefined,
                }
            }));
        }
    }

    if (fieldChanged === 'cnpj') {
        const { cnpj } = updatedTransaction;
        setCnpjErrors(prev => { const newErrors = { ...prev }; delete newErrors[id]; return newErrors; });

        const validationResult = validateCNPJ(cnpj);
        if (!validationResult.isValid) {
            setCnpjErrors(prev => ({
                ...prev,
                [id]: { message: validationResult.message! }
            }));
        }
    }

    if (fieldChanged === 'debit' || fieldChanged === 'credit') {
        const value = updatedTransaction[fieldChanged] as string;
        const errorKey = `${id}-${fieldChanged}`;
        setCurrencyErrors(prev => { const newErrors = { ...prev }; delete newErrors[errorKey]; return newErrors; });

        const validationResult = validateCurrency(value);
        if(!validationResult.isValid) {
            setCurrencyErrors(prev => ({
                ...prev,
                [errorKey]: { message: validationResult.message! }
            }));
        }
    }
  }, []);

  const handleExport = (format: 'csv' | 'xlsx' | 'txt' | 'pdf') => {
    if (file && companyInfo) {
      const filenameBase = `${companyInfo.companyName.replace(/\s/g, '_')}_${file.name.replace('.pdf', '')}_exportado`;
      const commonFilename = (ext: string) => `${filenameBase}.${ext}`;

      switch (format) {
        case 'csv':
          exportToCSV(filteredTransactions, commonFilename('csv'));
          break;
        case 'xlsx':
          exportToXLSX(filteredTransactions, commonFilename('xlsx'));
          break;
        case 'txt':
          exportToTXT(filteredTransactions, commonFilename('txt'));
          break;
        case 'pdf':
          exportToPDF(filteredTransactions, companyInfo, commonFilename('pdf'));
          break;
      }
      setExportMenuOpen(false);
    }
  };
  
  const handleReset = () => {
    setFile(null);
    setPageCount(null);
    setTransactions([]);
    setError(null);
    setIsLoading(false);
    setStatementBalance(null);
    setDateErrors({});
    setCnpjErrors({});
    setCurrencyErrors({});
    setIsInfoConfirmed(false);
    setCompanyInfo(null);
    setFilters(initialFilters);
    setExportMenuOpen(false);
  };
  
  const handleClearFilters = () => {
    setFilters(initialFilters);
  };

  const handleSuggestCategory = async (transactionId: string) => {
    const transaction = transactions.find(t => t.id === transactionId);
    if (!transaction || categorizingId) return;

    setCategorizingId(transactionId);
    try {
        const newCategory = await suggestNewCategory(transaction.description, transaction.category);
        if (newCategory !== transaction.category) {
            handleDataChange({ ...transaction, category: newCategory }, 'category');
        }
    } catch (error) {
        console.error("Falha ao sugerir categoria:", error);
    } finally {
        setCategorizingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-200">
      <Header />
      <main className="container mx-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto">

           {!isInfoConfirmed && !isLoading && (
            <HeaderForm onConfirm={handleInfoConfirm} />
          )}
          
          {isInfoConfirmed && companyInfo && !isLoading && !error && (
            <div className="mb-6 p-4 bg-white dark:bg-slate-800 shadow-md rounded-lg flex justify-between items-center animate-fade-in">
                <div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">{companyInfo.companyName}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        CNPJ: {formatCNPJForDisplay(companyInfo.cnpj)} | Banco: {companyInfo.bankName} | Usuário: {companyInfo.user} | Período: {formatDateForDisplay(companyInfo.periodStart)} a {formatDateForDisplay(companyInfo.periodEnd)}
                    </p>
                </div>
                <button
                    onClick={() => setIsInfoConfirmed(false)}
                    aria-label="Editar Informações"
                    className="inline-flex items-center justify-center p-2 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-md shadow-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                    <PencilIcon className="h-4 w-4" />
                </button>
            </div>
          )}

          {isInfoConfirmed && !file && !isLoading && (
            <FileUpload onFileSelect={handleFileSelect} />
          )}
          
          {isLoading && (
            <Loader message={loadingMessage || 'Analisando seu documento...'} />
          )}

          {error && !isLoading && (
             <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative text-center" role="alert">
                <strong className="font-bold">Ocorreu um erro!</strong>
                <span className="block sm:inline ml-2">{error}</span>
                <button 
                  onClick={handleReset} 
                  className="mt-4 sm:mt-0 sm:ml-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Tentar Novamente
                </button>
            </div>
          )}

          {!isLoading && transactions.length > 0 && (
            <div className="bg-white dark:bg-slate-800 shadow-xl rounded-xl overflow-hidden animate-fade-in">
              <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Transações Extraídas</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                      <span>Revise e edite os dados abaixo. Arquivo:</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400">{file?.name}</span>
                      {pageCount !== null && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                              {pageCount} {pageCount === 1 ? 'página' : 'páginas'}
                          </span>
                      )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleReset}
                    className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-md shadow-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <ArrowPathIcon className="h-5 w-5 mr-2"/>
                    Processar Novo Arquivo
                  </button>
                  <div className="relative inline-block text-left" ref={exportContainerRef}>
                    <div>
                      <button
                        type="button"
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        className="inline-flex w-full justify-center items-center gap-x-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-100 dark:focus:ring-offset-slate-800 focus:ring-blue-500"
                        id="menu-button"
                        aria-expanded={exportMenuOpen}
                        aria-haspopup="true"
                      >
                        <ArrowDownTrayIcon className="h-5 w-5 -ml-1 mr-2" />
                        Exportar
                        <ChevronDownIcon className="-mr-1 h-5 w-5 text-blue-200" aria-hidden="true" />
                      </button>
                    </div>

                    {exportMenuOpen && (
                      <div
                        className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white dark:bg-slate-700 shadow-lg ring-1 ring-black dark:ring-slate-600 ring-opacity-5 focus:outline-none"
                        role="menu"
                        aria-orientation="vertical"
                        aria-labelledby="menu-button"
                      >
                        <div className="py-1" role="none">
                          <a href="#" onClick={(e) => { e.preventDefault(); handleExport('csv'); }} className="text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 block px-4 py-2 text-sm" role="menuitem" id="menu-item-0">Exportar como CSV</a>
                          <a href="#" onClick={(e) => { e.preventDefault(); handleExport('xlsx'); }} className="text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 block px-4 py-2 text-sm" role="menuitem" id="menu-item-1">Exportar como XLSX</a>
                          <a href="#" onClick={(e) => { e.preventDefault(); handleExport('txt'); }} className="text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 block px-4 py-2 text-sm" role="menuitem" id="menu-item-2">Exportar como TXT</a>
                          <a href="#" onClick={(e) => { e.preventDefault(); handleExport('pdf'); }} className="text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 block px-4 py-2 text-sm" role="menuitem" id="menu-item-3">Exportar como PDF</a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <FilterBar filters={filters} onFilterChange={setFilters} onClear={handleClearFilters} />
              
              {(balanceMismatch || unusualTransactionsCount > 0) && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 flex flex-col gap-3">
                    {balanceMismatch && (
                        <div className="flex items-center">
                            <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500 mr-3 flex-shrink-0"/>
                            <div>
                            <h3 className="font-bold text-yellow-800 dark:text-yellow-200">Aviso de Divergência de Saldo</h3>
                            <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                O saldo final do extrato ({formatCurrency(statementBalance)}) não corresponde ao saldo calculado ({formatCurrency(calculatedFinalBalance)}).
                                Por favor, revise as transações, especialmente as destacadas em amarelo que foram sinalizadas pela IA como incomuns.
                            </p>
                            </div>
                        </div>
                    )}
                    {unusualTransactionsCount > 0 && (
                        <div className="flex items-center">
                            <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500 mr-3 flex-shrink-0"/>
                            <div>
                            <h3 className="font-bold text-yellow-800 dark:text-yellow-200">Transações Incomuns Detectadas</h3>
                            <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                A IA sinalizou {unusualTransactionsCount} transação(ões) que podem exigir atenção especial. Elas estão destacadas na tabela.
                            </p>
                            </div>
                        </div>
                    )}
                </div>
              )}
              
               <div className="p-4 text-sm text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                Exibindo {filteredTransactions.length} de {transactions.length} transações.
              </div>

              <DataTable 
                transactions={filteredTransactions} 
                onDataChange={handleDataChange} 
                dateErrors={dateErrors}
                cnpjErrors={cnpjErrors}
                currencyErrors={currencyErrors}
                onSuggestCategory={handleSuggestCategory}
                categorizingId={categorizingId}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}