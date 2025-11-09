import React from 'react';
import { DocumentChartBarIcon } from './icons/Icons';

export const Header: React.FC = () => {
  return (
    <header className="bg-white dark:bg-slate-800/50 shadow-sm backdrop-blur-md sticky top-0 z-10">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <DocumentChartBarIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            <span className="text-xl font-bold text-slate-800 dark:text-slate-100">
              Processador de Extratos Bancários
            </span>
          </div>
          <div className="hidden sm:block text-sm font-medium text-slate-500 dark:text-slate-400">
            Desenvolvido por SP ASSESSORIA CONTÁBIL
          </div>
        </div>
      </div>
    </header>
  );
};