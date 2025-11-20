
import React, { useState, useRef, useMemo } from 'react';
import { Transaction, DateValidationError, CNPJValidationError, CurrencyValidationError } from '../types';
import { TRANSACTION_CATEGORIES } from '../constants';
import { formatCNPJForDisplay } from '../utils/cnpjUtils';
import { ArrowPathIcon, ExclamationTriangleIcon, SparklesIcon } from './icons/Icons';

interface DataTableProps {
  transactions: Transaction[];
  onDataChange: (transaction: Transaction, field: keyof Omit<Transaction, 'id' | 'balance'>) => void;
  dateErrors: Record<string, DateValidationError>;
  cnpjErrors: Record<string, CNPJValidationError>;
  currencyErrors: Record<string, CurrencyValidationError>;
  onSuggestCategory: (transactionId: string) => void;
  categorizingId: string | null;
}

const TableInput: React.FC<{
    value: string | number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    type?: 'text' | 'number' | 'date';
    className?: string;
    hasError?: boolean;
    maxLength?: number;
}> = ({ value, onChange, type = 'text', className, hasError = false, maxLength }) => {
  const errorClasses = hasError ? 'ring-2 ring-red-500 focus:ring-red-500' : 'focus:ring-2 focus:ring-blue-500';
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      className={`w-full bg-transparent p-2 focus:outline-none focus:bg-blue-100 dark:focus:bg-slate-700 rounded-md transition-colors duration-200 ${errorClasses} ${className}`}
      maxLength={maxLength}
    />
  );
};

export const DataTable: React.FC<DataTableProps> = ({ transactions, onDataChange, dateErrors, cnpjErrors, currencyErrors, onSuggestCategory, categorizingId }) => {
  
  const handleFieldChange = (id: string, field: keyof Omit<Transaction, 'id' | 'balance'>, value: string | number) => {
    const transactionToUpdate = transactions.find(t => t.id === id);
    if (transactionToUpdate) {
      let processedValue = value;
      if (field === 'cnpj' && typeof value === 'string') {
        processedValue = value.replace(/\D/g, '');
      }
      onDataChange({ ...transactionToUpdate, [field]: processedValue }, field);
    }
  };
  
  const formatCurrency = (value: number | string) => {
    const numValue = Number(value);
    if (isNaN(numValue)) return String(value);
    return numValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Virtualization Logic
  const ROW_HEIGHT = 60; 
  const VISIBLE_HEIGHT = 600; 
  const BUFFER = 5;

  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
  };

  const { virtualItems, paddingTop, paddingBottom } = useMemo(() => {
      const startIndex = Math.floor(scrollTop / ROW_HEIGHT);
      const effectiveStartIndex = Math.max(0, startIndex - BUFFER);
      
      const endIndex = Math.min(
        transactions.length, 
        Math.ceil((scrollTop + VISIBLE_HEIGHT) / ROW_HEIGHT) + BUFFER
      );

      const virtualItems = transactions.slice(effectiveStartIndex, endIndex);
      
      const paddingTop = effectiveStartIndex * ROW_HEIGHT;
      const paddingBottom = (transactions.length - endIndex) * ROW_HEIGHT;

      return { virtualItems, paddingTop, paddingBottom };
  }, [transactions, scrollTop]);


  return (
    <div 
      className="overflow-auto relative border rounded-lg border-slate-200 dark:border-slate-700"
      style={{ maxHeight: `${VISIBLE_HEIGHT}px` }}
      ref={containerRef}
      onScroll={handleScroll}
    >
      <table className="min-w-full text-sm text-left text-slate-500 dark:text-slate-400 border-collapse">
        <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300 sticky top-0 z-20 shadow-sm">
          <tr>
            <th scope="col" className="px-4 py-3 w-[10%] bg-slate-50 dark:bg-slate-700">Data</th>
            <th scope="col" className="px-4 py-3 w-[25%] bg-slate-50 dark:bg-slate-700">Descrição</th>
            <th scope="col" className="px-4 py-3 w-[15%] bg-slate-50 dark:bg-slate-700">Nome da Empresa</th>
            <th scope="col" className="px-4 py-3 w-[12%] bg-slate-50 dark:bg-slate-700">CNPJ</th>
            <th scope="col" className="px-4 py-3 w-[12%] bg-slate-50 dark:bg-slate-700">Categoria</th>
            <th scope="col" className="px-4 py-3 text-right w-[9%] bg-slate-50 dark:bg-slate-700">Débito</th>
            <th scope="col" className="px-4 py-3 text-right w-[9%] bg-slate-50 dark:bg-slate-700">Crédito</th>
            <th scope="col" className="px-4 py-3 text-right w-[8%] bg-slate-50 dark:bg-slate-700">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td colSpan={8} style={{ height: paddingTop }}></td></tr>
          )}
          {virtualItems.map((transaction) => {
            const dateError = dateErrors[transaction.id];
            const cnpjError = cnpjErrors[transaction.id];
            const debitError = currencyErrors[`${transaction.id}-debit`];
            const creditError = currencyErrors[`${transaction.id}-credit`];
            const isUnusual = transaction.isUnusual;

            return (
              <tr 
                key={transaction.id} 
                style={{ height: ROW_HEIGHT }}
                className={`border-b dark:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-900/20 
                  ${isUnusual ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'bg-white dark:bg-slate-800'}`
                }>
                <td className="px-2 py-1 relative align-top">
                   <TableInput 
                      type="date"
                      value={transaction.date} 
                      onChange={(e) => handleFieldChange(transaction.id, 'date', e.target.value)}
                      hasError={!!dateError}
                   />
                   {dateError && (
                     <div className="absolute left-2 top-full mt-1 p-2 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-200 text-xs rounded-md shadow-lg z-10 w-max max-w-xs" role="alert">
                       <p className="font-medium">{dateError.message}</p>
                       {dateError.suggestion && (
                         <p className="mt-1">
                           Sugestão:{' '}
                           <button
                             className="font-semibold underline hover:text-red-900 dark:hover:text-red-100"
                             onClick={() => handleFieldChange(transaction.id, 'date', dateError.suggestion!)}
                           >
                             {dateError.suggestion}
                           </button>
                         </p>
                       )}
                     </div>
                   )}
                </td>
                <td className="px-2 py-1 align-top">
                   <div className="flex items-center gap-2">
                     <TableInput 
                        value={transaction.description} 
                        onChange={(e) => handleFieldChange(transaction.id, 'description', e.target.value)}
                        className="flex-grow"
                     />
                     {isUnusual && (
                       <div className="relative group flex-shrink-0">
                         <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />
                         <div className="absolute bottom-full mb-2 -left-1/2 -translate-x-1/2 w-48 p-2 bg-slate-700 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10" role="tooltip">
                           <span className="font-bold block">Transação Incomum:</span>
                           {transaction.unusualReason}
                         </div>
                       </div>
                     )}
                   </div>
                </td>
                 <td className="px-2 py-1 align-top">
                   <TableInput 
                      value={transaction.companyName} 
                      onChange={(e) => handleFieldChange(transaction.id, 'companyName', e.target.value)}
                   />
                </td>
                 <td className="px-2 py-1 relative align-top">
                   <TableInput 
                      value={formatCNPJForDisplay(transaction.cnpj)} 
                      onChange={(e) => handleFieldChange(transaction.id, 'cnpj', e.target.value)}
                      hasError={!!cnpjError}
                      maxLength={18}
                   />
                    {cnpjError && (
                     <div className="absolute left-2 top-full mt-1 p-2 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-200 text-xs rounded-md shadow-lg z-10 w-max max-w-xs" role="alert">
                       <p className="font-medium">{cnpjError.message}</p>
                     </div>
                   )}
                </td>
                 <td className="px-2 py-1 align-top">
                   <div className="relative flex items-center gap-1">
                        <select
                            value={transaction.category}
                            onChange={(e) => handleFieldChange(transaction.id, 'category', e.target.value)}
                            className="w-full bg-transparent p-2 focus:outline-none focus:bg-blue-100 dark:focus:bg-slate-700 rounded-md transition-colors duration-200 focus:ring-2 focus:ring-blue-500"
                            disabled={categorizingId === transaction.id}
                            >
                            {TRANSACTION_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <button 
                            onClick={() => onSuggestCategory(transaction.id)}
                            disabled={!!categorizingId}
                            className="p-1 rounded-full text-slate-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            aria-label="Sugerir categoria com IA"
                            title="Sugerir categoria com IA"
                        >
                            {categorizingId === transaction.id ? (
                                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                            ) : (
                                <SparklesIcon className="h-4 w-4" />
                            )}
                        </button>
                   </div>
                </td>
                <td className="px-2 py-1 text-right font-mono text-red-600 dark:text-red-400 align-top relative">
                   <TableInput
                      type="text"
                      value={transaction.debit} 
                      onChange={(e) => handleFieldChange(transaction.id, 'debit', e.target.value)}
                      className="text-right"
                      hasError={!!debitError}
                   />
                   {debitError && (
                     <div className="absolute right-2 top-full mt-1 p-2 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-200 text-xs rounded-md shadow-lg z-10 w-max max-w-xs" role="alert">
                       <p className="font-medium">{debitError.message}</p>
                     </div>
                   )}
                </td>
                <td className="px-2 py-1 text-right font-mono text-green-600 dark:text-green-400 align-top relative">
                   <TableInput
                      type="text"
                      value={transaction.credit} 
                      onChange={(e) => handleFieldChange(transaction.id, 'credit', e.target.value)}
                      className="text-right"
                      hasError={!!creditError}
                   />
                   {creditError && (
                     <div className="absolute right-2 top-full mt-1 p-2 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-200 text-xs rounded-md shadow-lg z-10 w-max max-w-xs" role="alert">
                       <p className="font-medium">{creditError.message}</p>
                     </div>
                   )}
                </td>
                <td className="px-6 py-2 text-right font-mono text-slate-700 dark:text-slate-300 align-middle">
                  {formatCurrency(transaction.balance)}
                </td>
              </tr>
            )
          })}
          {paddingBottom > 0 && (
            <tr><td colSpan={8} style={{ height: paddingBottom }}></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};