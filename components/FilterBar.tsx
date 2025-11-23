
import React, { useState, useEffect } from 'react';
import { Filters } from '../types';
import { TRANSACTION_CATEGORIES } from '../constants';

interface FilterBarProps {
  filters: Filters;
  onFilterChange: (filters: Filters) => void;
  onClear: () => void;
}

type DatePreset = 'custom' | 'today' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth';

export const FilterBar: React.FC<FilterBarProps> = ({ filters, onFilterChange, onClear }) => {
  const [preset, setPreset] = useState<DatePreset>('custom');

  // Reset preset to 'custom' if dates don't match any preset (e.g. when filters are cleared externally or manually edited)
  useEffect(() => {
      if (filters.startDate === '' && filters.endDate === '') {
          setPreset('custom');
      }
  }, [filters.startDate, filters.endDate]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    if (name === 'startDate' || name === 'endDate') {
        setPreset('custom');
    }

    onFilterChange({
      ...filters,
      [name]: value,
    });
  };

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newPreset = e.target.value as DatePreset;
      setPreset(newPreset);

      if (newPreset === 'custom') return;

      const today = new Date();
      let startDate = '';
      let endDate = '';

      const formatDate = (date: Date) => date.toISOString().split('T')[0];

      switch (newPreset) {
          case 'today':
              startDate = endDate = formatDate(today);
              break;
          case 'last7days':
              const last7 = new Date(today);
              last7.setDate(today.getDate() - 6);
              startDate = formatDate(last7);
              endDate = formatDate(today);
              break;
          case 'last30days':
              const last30 = new Date(today);
              last30.setDate(today.getDate() - 29);
              startDate = formatDate(last30);
              endDate = formatDate(today);
              break;
          case 'thisMonth':
              startDate = formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
              endDate = formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
              break;
          case 'lastMonth':
              startDate = formatDate(new Date(today.getFullYear(), today.getMonth() - 1, 1));
              endDate = formatDate(new Date(today.getFullYear(), today.getMonth(), 0));
              break;
      }

      onFilterChange({
          ...filters,
          startDate,
          endDate
      });
  };

  const handleClearInternal = () => {
      setPreset('custom');
      onClear();
  }

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Descrição</label>
          <input
            type="text"
            name="description"
            id="description"
            value={filters.description}
            onChange={handleChange}
            placeholder="Pesquisar..."
            className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
            <label htmlFor="category" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Categoria</label>
            <select
                name="category"
                id="category"
                value={filters.category}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
                <option value="">Todas as categorias</option>
                {TRANSACTION_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                ))}
            </select>
        </div>

        <div>
            <label htmlFor="transactionType" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Tipo de Transação</label>
            <select
                name="transactionType"
                id="transactionType"
                value={filters.transactionType}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
                <option value="all">Todos</option>
                <option value="debit">Apenas Débitos</option>
                <option value="credit">Apenas Créditos</option>
            </select>
        </div>

        <div>
            <label htmlFor="showUnusual" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Status</label>
            <select
                name="showUnusual"
                id="showUnusual"
                value={filters.showUnusual}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
                <option value="all">Todas</option>
                <option value="unusualOnly">Apenas Incomuns</option>
                <option value="commonOnly">Apenas Comuns</option>
            </select>
        </div>

        <div className="flex flex-col gap-1">
            <label htmlFor="datePreset" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Período</label>
            <select
                id="datePreset"
                value={preset}
                onChange={handlePresetChange}
                className="block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
                <option value="custom">Personalizado</option>
                <option value="today">Hoje</option>
                <option value="last7days">Últimos 7 dias</option>
                <option value="last30days">Últimos 30 dias</option>
                <option value="thisMonth">Este mês</option>
                <option value="lastMonth">Mês passado</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
            <input
                type="date"
                name="startDate"
                id="startDate"
                value={filters.startDate}
                onChange={handleChange}
                aria-label="Data Inicial"
                className="block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-xs"
            />
            <input
                type="date"
                name="endDate"
                id="endDate"
                value={filters.endDate}
                onChange={handleChange}
                aria-label="Data Final"
                className="block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-xs"
            />
            </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="minAmount" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Valor Mín.</label>
            <input
              type="number"
              name="minAmount"
              id="minAmount"
              value={filters.minAmount}
              onChange={handleChange}
              placeholder="0,00"
              className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="maxAmount" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Valor Máx.</label>
            <input
              type="number"
              name="maxAmount"
              id="maxAmount"
              value={filters.maxAmount}
              onChange={handleChange}
              placeholder="1.000,00"
              className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>
        </div>
        
        <div>
          <button
            onClick={handleClearInternal}
            className="w-full inline-flex items-center justify-center px-4 py-2 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-md shadow-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Limpar Filtros
          </button>
        </div>
      </div>
    </div>
  );
};
