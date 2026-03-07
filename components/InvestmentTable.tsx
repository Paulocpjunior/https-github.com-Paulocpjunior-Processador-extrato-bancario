import React from 'react';
import { InvestmentTransaction, InvestmentOperationType } from '../types';
import { formatCNPJForDisplay } from '../utils/cnpjUtils';

interface Props {
    transactions: InvestmentTransaction[];
}

const OP_COLORS: Record<InvestmentOperationType, string> = {
    'Aplicação': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'Resgate': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    'Rendimento': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    'Come-cotas': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    'Amortização': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    'Transferência': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'Outro': 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
};

const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtQty = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });

const fmtDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

export const InvestmentTable: React.FC<Props> = ({ transactions }) => {
    if (transactions.length === 0) {
        return (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500">
                Nenhuma movimentação encontrada.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                        {['Data', 'Fundo', 'CNPJ Fundo', 'Tipo', 'Qtd Cotas', 'Valor Cota', 'Valor Bruto', 'IR Retido', 'Valor Líquido', '⚠'].map(h => (
                            <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                    {transactions.map(t => (
                        <tr
                            key={t.id}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${t.isUnusual ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}`}
                        >
                            <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">
                                {fmtDate(t.date)}
                            </td>
                            <td className="px-3 py-2 max-w-xs">
                                <div className="font-medium text-slate-800 dark:text-slate-200 truncate" title={t.fundName}>
                                    {t.fundName}
                                </div>
                                {t.administrator && (
                                    <div className="text-xs text-slate-400 dark:text-slate-500 truncate" title={t.administrator}>
                                        Adm: {t.administrator}
                                    </div>
                                )}
                                {t.gestor && (
                                    <div className="text-xs text-slate-400 dark:text-slate-500 truncate" title={t.gestor}>
                                        Gest: {t.gestor}
                                    </div>
                                )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-600 dark:text-slate-400 text-xs">
                                {t.fundCNPJ ? formatCNPJForDisplay(t.fundCNPJ) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${OP_COLORS[t.operationType] || OP_COLORS['Outro']}`}>
                                    {t.operationType}
                                </span>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-slate-700 dark:text-slate-300">
                                {t.shareQuantity > 0 ? fmtQty(t.shareQuantity) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-slate-700 dark:text-slate-300">
                                {t.shareValue > 0 ? fmt(t.shareValue) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                                {t.grossValue > 0 ? fmt(t.grossValue) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-red-600 dark:text-red-400">
                                {t.irWithheld > 0 ? fmt(t.irWithheld) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-right font-mono font-semibold text-green-700 dark:text-green-400">
                                {t.netValue > 0 ? fmt(t.netValue) : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-center">
                                {t.isUnusual ? (
                                    <span title={t.unusualReason} className="cursor-help text-yellow-500">⚠</span>
                                ) : null}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
