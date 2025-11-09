
import React, { useState, useEffect } from 'react';
import { CompanyInfo } from '../types';
import { validateCNPJ, formatCNPJForDisplay } from '../utils/cnpjUtils';
import { BRAZILIAN_BANKS } from '../constants';
import { ArrowPathIcon } from './icons/Icons';

interface HeaderFormProps {
  onConfirm: (info: CompanyInfo) => void;
}

export const HeaderForm: React.FC<HeaderFormProps> = ({ onConfirm }) => {
  const [info, setInfo] = useState<CompanyInfo>({
    companyName: '',
    cnpj: '',
    user: '',
    periodStart: '',
    periodEnd: '',
    bankName: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyInfo, string>>>({});
  const [isCnpjLoading, setIsCnpjLoading] = useState(false);

  useEffect(() => {
    const cnpj = info.cnpj.replace(/\D/g, '');
    if (cnpj.length === 14) {
      const cnpjValidation = validateCNPJ(cnpj);
      if(cnpjValidation.isValid) {
        const fetchCompanyName = async () => {
          setIsCnpjLoading(true);
          setErrors(prev => {
              const newErrors = {...prev};
              delete newErrors.cnpj;
              return newErrors;
          });
          try {
            const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });
            if (response.ok) {
              const data = await response.json();
              setInfo(prev => ({ ...prev, companyName: data.razao_social }));
            } else {
              setErrors(prev => ({ ...prev, cnpj: 'CNPJ não encontrado ou inválido.' }));
            }
          } catch (error) {
            console.error("CNPJ lookup failed:", error);
            setErrors(prev => ({ ...prev, cnpj: 'Falha ao buscar o CNPJ. Verifique sua conexão.' }));
          } finally {
            setIsCnpjLoading(false);
          }
        };
        fetchCompanyName();
      } else {
        setErrors(prev => ({ ...prev, cnpj: cnpjValidation.message }));
      }
    }
  }, [info.cnpj]);


  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    let processedValue = value;

    if (name === 'cnpj') {
        const digitsOnly = value.replace(/\D/g, '');
        if (digitsOnly.length !== 14) {
            setInfo(prev => ({...prev, companyName: ''}));
        }
        processedValue = digitsOnly;
    }

    setInfo(prev => ({ ...prev, [name]: processedValue }));

    if (errors[name as keyof CompanyInfo]) {
        setErrors(prev => {
            const newErrors = {...prev};
            delete newErrors[name as keyof CompanyInfo];
            return newErrors;
        })
    }
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof CompanyInfo, string>> = {};
    if (!info.companyName) newErrors.companyName = 'Nome da empresa é obrigatório.';
    if (!info.bankName) newErrors.bankName = 'Nome do banco é obrigatório.';
    if (!info.user) newErrors.user = 'Nome do usuário é obrigatório.';
    if (!info.periodStart) newErrors.periodStart = 'Data de início é obrigatória.';
    if (!info.periodEnd) newErrors.periodEnd = 'Data de fim é obrigatória.';
    
    if (!info.cnpj) {
        newErrors.cnpj = 'CNPJ é obrigatório.';
    } else {
        const cnpjValidation = validateCNPJ(info.cnpj);
        if (!cnpjValidation.isValid) {
            newErrors.cnpj = cnpjValidation.message;
        }
    }
    if (info.periodStart && info.periodEnd && info.periodStart > info.periodEnd) {
        newErrors.periodEnd = 'Data de fim deve ser posterior à data de início.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onConfirm(info);
    }
  };

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 shadow-lg rounded-xl p-6 md:p-8 mb-8 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Informações do Relatório</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Por favor, preencha os campos abaixo para iniciar o processamento.</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CNPJ - Moved to first position */}
          <div>
            <label htmlFor="cnpj" className="block text-sm font-medium text-slate-700 dark:text-slate-300">CNPJ</label>
            <div className="relative mt-1">
                <input type="text" name="cnpj" id="cnpj" value={formatCNPJForDisplay(info.cnpj)} onChange={handleChange} className={`block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm pr-10 ${errors.cnpj ? 'border-red-500 ring-red-500' : ''}`} maxLength={18} />
                {isCnpjLoading && (
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                        <ArrowPathIcon className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                )}
            </div>
            {errors.cnpj && <p className="mt-2 text-sm text-red-600">{errors.cnpj}</p>}
          </div>
          {/* Company Name */}
          <div>
            <label htmlFor="companyName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nome da Empresa</label>
            <input type="text" name="companyName" id="companyName" value={info.companyName} onChange={handleChange} disabled={isCnpjLoading} className={`mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm disabled:bg-slate-50 dark:disabled:bg-slate-700/50 ${errors.companyName ? 'border-red-500 ring-red-500' : ''}`} />
            {errors.companyName && <p className="mt-2 text-sm text-red-600">{errors.companyName}</p>}
          </div>
          {/* Bank Name */}
           <div>
            <label htmlFor="bankName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nome do Banco</label>
            <select name="bankName" id="bankName" value={info.bankName} onChange={handleChange} className={`mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm ${errors.bankName ? 'border-red-500 ring-red-500' : ''}`}>
                <option value="" disabled>Selecione um banco</option>
                {BRAZILIAN_BANKS.map(bank => (
                    <option key={bank} value={bank}>{bank}</option>
                ))}
            </select>
            {errors.bankName && <p className="mt-2 text-sm text-red-600">{errors.bankName}</p>}
          </div>
          {/* User */}
          <div>
            <label htmlFor="user" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Usuário</label>
            <input type="text" name="user" id="user" value={info.user} onChange={handleChange} className={`mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm ${errors.user ? 'border-red-500 ring-red-500' : ''}`} />
            {errors.user && <p className="mt-2 text-sm text-red-600">{errors.user}</p>}
          </div>
          {/* Period */}
          <div className="grid grid-cols-2 gap-4 md:col-span-2">
            <div>
              <label htmlFor="periodStart" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Início do Período</label>
              <input type="date" name="periodStart" id="periodStart" value={info.periodStart} onChange={handleChange} className={`mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm ${errors.periodStart ? 'border-red-500 ring-red-500' : ''}`} />
              {errors.periodStart && <p className="mt-2 text-sm text-red-600">{errors.periodStart}</p>}
            </div>
            <div>
              <label htmlFor="periodEnd" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Fim do Período</label>
              <input type="date" name="periodEnd" id="periodEnd" value={info.periodEnd} onChange={handleChange} className={`mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm ${errors.periodEnd ? 'border-red-500 ring-red-500' : ''}`} />
              {errors.periodEnd && <p className="mt-2 text-sm text-red-600">{errors.periodEnd}</p>}
            </div>
          </div>
        </div>
        <div className="mt-8 flex justify-end">
          <button type="submit" className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
            Confirmar e Avançar
          </button>
        </div>
      </form>
    </div>
  );
};
